// Fictional arcade responses. Crime points express game difficulty, not law.
export const WANTED_THRESHOLDS = Object.freeze([2, 12, 30, 65, 110, 170]);
export const CRIME_POINTS = Object.freeze({ shot: 2, vehicleTheft: 12, propertyDamage: 8, injury: 14, kill: 32, explosion: 25, policeKill: 50 });
export const POLICE_LIMITS = Object.freeze({ units: 6, roadblocks: 2, projectiles: 32, retainedUnits: 24 });
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const active = (g) => typeof g.active === 'function' ? g.active() : g.mode === 'playing' && !g.tutorial;
const deltaAngle = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const tierNames = ['Aucune recherche', 'Patrouille locale', 'Poursuite renforcée', 'Barrages routiers', 'Recherche aérienne', 'Unités lourdes', 'Renforts militaires'];

export function wantedLevel(points) {
  return WANTED_THRESHOLDS.reduce((level, threshold) => level + Number(points >= threshold), 0);
}

export function initPolice(game) {
  game.heat = 0;
  game.wanted = { level: 0, points: 0, lastCrime: -Infinity, lastSeen: -Infinity, lastKnown: { x: game.player?.x || 0, y: game.player?.y || 0 }, state: 'clear', quietTime: 0, unseenTime: 0, responseLabel: tierNames[0] };
  game.police ||= [];
  game.roadblocks = []; game.helicopter = null;
  game.policeProjectiles = []; game.policeShots = [];
  game._crimeCooldowns = new Map();
  game._policeClock = { perception: 0, paths: 0, dispatch: .8, roadblock: 7, helicopter: 5, heavy: 7, military: 9, cleanup: 5 };
  game.spawnClock = Infinity;
}

function setLevel(game) {
  const wanted = game.wanted, previous = wanted.level;
  wanted.level = wantedLevel(wanted.points); game.heat = wanted.level;
  wanted.responseLabel = tierNames[wanted.level];
  if (!wanted.level) wanted.state = 'clear';
  if (previous !== wanted.level) {
    game.emit?.('heat', { heat: wanted.level, level: wanted.level, previous, points: wanted.points, responseLabel: wanted.responseLabel });
    if (wanted.level > previous) {
      game._policeClock.dispatch = previous === 0 ? .8 : Math.min(game._policeClock.dispatch, 1.2);
      if (previous < 3 && wanted.level >= 3) { game._policeClock.roadblock = 7; game.emit?.('notice', { message: 'Radio : des barrages se préparent sur les routes.' }); }
      if (previous < 4 && wanted.level >= 4) { game._policeClock.helicopter = 5; game.emit?.('notice', { message: 'Radio : un hélicoptère de recherche approche.' }); }
      if (previous < 5 && wanted.level >= 5) { game._policeClock.heavy = 7; game.emit?.('notice', { message: 'Radio : arrivée des unités lourdes dans quelques secondes.' }); }
      if (previous < 6 && wanted.level >= 6) { game._policeClock.military = 9; game.emit?.('notice', { message: 'Radio : des renforts militaires sont mobilisés.' }); }
    }
  }
}

/** Deduplicate a burst/incident, while new victims and objects remain separate. */
export function reportCrime(game, type, { x = game.player?.x || 0, y = game.player?.y || 0, sourceId, incidentId } = {}) {
  if (!(type in CRIME_POINTS) || !active(game)) return false;
  if (!game.wanted) initPolice(game);
  const now = game.elapsed || 0;
  const cooldown = { shot: .8, vehicleTheft: Infinity, propertyDamage: 1, injury: 2, kill: Infinity, explosion: 1.5, policeKill: Infinity }[type];
  const key = `${type}:${incidentId ?? sourceId ?? 'nearby'}`;
  if (game._crimeCooldowns.has(key) && now - game._crimeCooldowns.get(key) < cooldown) return false;
  // The ledger is bounded even during a long session on a very large map.
  if (game._crimeCooldowns.size >= 512) game._crimeCooldowns.delete(game._crimeCooldowns.keys().next().value);
  game._crimeCooldowns.set(key, now);
  const wanted = game.wanted;
  wanted.points = Math.min(220, wanted.points + CRIME_POINTS[type]);
  wanted.lastCrime = now; wanted.lastKnown = { x, y }; wanted.quietTime = 0;
  wanted.state = 'pursuit';
  game.spawnClock = Math.min(game.spawnClock ?? Infinity, 1.2);
  setLevel(game);
  game.emit?.('crime', { type, points: CRIME_POINTS[type], total: wanted.points, level: wanted.level, x, y });
  return true;
}

function roadCandidates(game, minDistance, maxDistance, forward = false) {
  const nodes = typeof game.navigationNodesNear === 'function' ? game.navigationNodesNear(game.player, maxDistance) : [...(game.nav?.values() || [])];
  const direction = game.vehicle?.angle ?? game.player.dir ?? 0;
  const component = game.nearestNode(game.player)?.component;
  return nodes.filter((p) => {
    const d = distance(p, game.player);
    return d >= minDistance && d <= maxDistance && p.neighbors?.length &&
      (component === undefined || p.component === component) &&
      !game.police.some((other) => !other.dead && distance(other, p) < 65) &&
      !game.roadblocks.some((other) => distance(other, p) < 140);
  }).map((p) => {
    const other = game.nav.get(p.neighbors[0]);
    const angle = other ? Math.atan2(other.y - p.y, other.x - p.x) : 0;
    const ahead = (p.x - game.player.x) * Math.cos(direction) + (p.y - game.player.y) * Math.sin(direction);
    return { ...p, angle, rank: distance(p, game.player) - (forward ? clamp(ahead, -200, 200) * .55 : 0) };
  }).sort((a, b) => a.rank - b.rank);
}

export function spawnPolice(game, { unit = 'patrol' } = {}) {
  if (!active(game) || !game.heat || game.police.filter((p) => !p.dead).length >= POLICE_LIMITS.units) return false;
  let candidates = roadCandidates(game, 310, 850);
  // Geometry fixtures without a graph can explicitly provide safe spawn points.
  if (!candidates.length) candidates = (game.world.starts?.patrolSpawns || []).filter((p) => distance(p, game.player) > 280 && distance(p, game.player) < 1100).map((p) => ({ ...p, angle: p.angle || 0 }));
  const position = candidates.find((p) => game.canCarOccupy(p.x, p.y, p.angle) && !game.police.some((other) => !other.dead && distance(other, p) < 65));
  if (!position) return false;
  const heavy = unit === 'heavy', military = unit === 'military';
  const hp = military ? 420 : heavy ? 340 : 80;
  const officer = { id: ++game.id, x: position.x, y: position.y, angle: position.angle, speed: 0, hp, maxHp: hp, stun: 0, warn: military ? 3.2 : heavy ? 2.5 : 1.6, alert: false, path: [], pathTimer: 0, kind: unit, faction: military ? 'army' : 'gendarmerie', fireCooldown: 2.5, fireWindup: 0, aimAngle: position.angle, dead: false };
  if (heavy || military) {
    const car = { id: `response-${officer.id}`, x: officer.x, y: officer.y, angle: officer.angle, speed: 0, hp, maxHp: hp, kind: 'response', model: military ? 'military' : 'armoured', lawEnforcement: true, locked: true, occupied: true, owned: true, destroyed: false, exploded: false, fireTimer: 0, smokeTimer: 0, burnFuse: 0, fireHotspots: [], color: military ? '#697052' : '#263e55' };
    game.cars.push(car); officer.vehicleId = car.id;
  }
  game.police.push(officer);
  if (game.police.length > POLICE_LIMITS.retainedUnits) {
    const removable = game.police.findIndex((p) => p.dead);
    if (removable >= 0) game.police.splice(removable, 1);
  }
  game.emit?.('reinforcement', { type: unit, id: officer.id, x: officer.x, y: officer.y, warn: officer.warn });
  game.emit?.('notice', { message: military ? 'Les véhicules militaires arrivent : quitte leur ligne de tir !' : heavy ? 'Un véhicule lourd arrive : il est destructible.' : 'Une patrouille arrive : garde un œil sur les gyrophares !' });
  return true;
}

function createRoadblock(game) {
  if (game.roadblocks.length >= POLICE_LIMITS.roadblocks) return false;
  // Occupy one side of a real street. Leave room to escape on foot, or shoot
  // the destructible vehicle; never place a wall across an arbitrary hillside.
  for (const p of roadCandidates(game, 270, 640, true)) {
    if (p.roadWidth < 28) continue;
    const x = p.x - Math.sin(p.angle) * 6, y = p.y + Math.cos(p.angle) * 6;
    if (!game.canCarOccupy(x, y, p.angle)) continue;
    const id = ++game.id, carId = `roadblock-${id}`;
    const block = { id, x, y, angle: p.angle, warn: 3.5, active: false, life: 45, kind: 'roadblock', carIds: [carId] };
    const car = { id: carId, x, y, angle: p.angle, speed: 0, hp: 260, maxHp: 260, kind: 'roadblock', model: 'gendarmerie', color: '#274960', lawEnforcement: true, locked: true, owned: true, occupied: false, destroyed: false, exploded: false, fireTimer: 0, smokeTimer: 0, burnFuse: 0, fireHotspots: [], pendingRoadblock: true };
    game.roadblocks.push(block); game.cars.push(car);
    game.emit?.('reinforcement', { type: 'roadblock', x, y, warn: block.warn });
    return true;
  }
  return false;
}

function updateRoadblocks(game, dt) {
  const clock = game._policeClock;
  if (game.heat >= 3) {
    clock.roadblock -= dt;
    if (clock.roadblock <= 0) { createRoadblock(game); clock.roadblock = 22; }
  }
  for (const block of game.roadblocks) {
    block.life -= dt;
    if (block.warn > 0) {
      block.warn = Math.max(0, block.warn - dt);
      if (!block.warn) {
        const cars = block.carIds.map((id) => game.cars.find((car) => car.id === id));
        // A warning never materializes a car inside the player or a civilian.
        if (cars.every((car) => car && game.canCarOccupy(car.x, car.y, car.angle, car.id) && distance(car, game.player) > 45)) {
          block.active = true;
          for (const car of cars) car.pendingRoadblock = false;
        } else block.life = 0;
      }
    }
    if (block.carIds.every((id) => game.cars.find((car) => car.id === id)?.destroyed)) block.life = 0;
    if (!game.heat && distance(block, game.player) > 180) block.life = 0;
  }
  const expired = game.roadblocks.filter((block) => block.life <= 0);
  game.roadblocks = game.roadblocks.filter((block) => block.life > 0);
  const expiredIds = new Set(expired.flatMap((block) => block.carIds));
  game.cars = game.cars.filter((car) => !expiredIds.has(car.id) || car.destroyed || game.vehicleId === car.id);
}

function updateHelicopter(game, dt) {
  const clock = game._policeClock;
  if (game.heat >= 4 && !game.helicopter) {
    clock.helicopter -= dt;
    if (clock.helicopter <= 0) {
      game.helicopter = { id: ++game.id, x: clamp(game.player.x + 220, 30, game.world.width - 30), y: clamp(game.player.y - 180, 30, game.world.height - 30), angle: 0, altitude: 80, rotor: 0, warn: 5, active: false, searchlight: { ...game.wanted.lastKnown }, visible: false, kind: 'helicopter', faction: 'gendarmerie', phase: 0 };
      game.emit?.('reinforcement', { type: 'helicopter', warn: 5 });
    }
  }
  const heli = game.helicopter;
  if (!heli) return;
  heli.rotor += dt * 32; heli.phase += dt * .6;
  if (heli.warn > 0) { heli.warn = Math.max(0, heli.warn - dt); heli.active = heli.warn === 0; return; }
  if (game.heat < 4) { heli.departure = (heli.departure || 0) + dt; heli.visible = false; heli.x += dt * 110; if (heli.departure > 4) game.helicopter = null; return; }
  heli.departure = 0;
  // Follow the last sighting first. The beam cannot discover the player through
  // an intact roof or a solid building between its ground position and target.
  const center = game.wanted.lastKnown;
  const target = { x: clamp(center.x + Math.cos(heli.phase) * 95, 30, game.world.width - 30), y: clamp(center.y + Math.sin(heli.phase) * 95, 30, game.world.height - 30) };
  const d = distance(heli, target), move = Math.min(d, 105 * dt);
  if (d > .01) { heli.angle = Math.atan2(target.y - heli.y, target.x - heli.x); heli.x += Math.cos(heli.angle) * move; heli.y += Math.sin(heli.angle) * move; }
  heli.searchlight = { ...center };
}

function perceive(game, dt) {
  const wanted = game.wanted, now = game.elapsed || 0;
  wanted.quietTime = Math.max(0, now - wanted.lastCrime);
  game._policeClock.perception -= dt;
  if (game._policeClock.perception <= 0) {
    game._policeClock.perception = .25;
    let seen = false;
    for (const p of game.police) {
      if (p.dead || p.warn > 0 || distance(p, game.player) > 230) continue;
      p.seesPlayer = game.clearSegment(p, game.player, 1, game.vehicleId, true);
      seen ||= p.seesPlayer;
    }
    const heli = game.helicopter;
    if (heli?.active) {
      heli.visible = game.heat >= 4 && distance(heli, game.player) < 240 && game.clearSegment(heli, game.player, 1, game.vehicleId, true);
      seen ||= heli.visible;
      if (heli.visible) heli.searchlight = { x: game.player.x, y: game.player.y };
    }
    if (seen) { wanted.lastSeen = now; wanted.lastKnown = { x: game.player.x, y: game.player.y }; }
    wanted.visible = seen;
  }
  wanted.unseenTime = Math.max(0, now - Math.max(wanted.lastSeen, wanted.lastCrime));
  if (!wanted.level) { wanted.state = 'clear'; return; }
  if (wanted.visible) wanted.state = 'pursuit';
  else if (wanted.quietTime < 12 || wanted.unseenTime < 8) wanted.state = 'search';
  else {
    wanted.state = 'cooling';
    wanted.points = Math.max(0, wanted.points - dt * 3.5);
    // Clear the final fraction instead of leaving invisible residual points.
    if (wanted.points < 2) wanted.points = 0;
    setLevel(game);
  }
}

function segmentDistanceSq(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
  return (x - a.x - dx * t) ** 2 + (y - a.y - dy * t) ** 2;
}

function updateProjectiles(game, dt) {
  for (const shot of game.policeProjectiles) {
    const next = { x: shot.x + shot.vx * dt, y: shot.y + shot.vy * dt };
    if (!game.clearSegment(shot, next, 1, game.vehicleId, true)) { shot.life = 0; continue; }
    if (segmentDistanceSq(game.player.x, game.player.y, shot, next) < (game.vehicle ? 13 : game.playerRadius + 2) ** 2) { game.hurt('gendarme'); shot.life = 0; }
    shot.x = next.x; shot.y = next.y; shot.life -= dt;
  }
  game.policeProjectiles = game.policeProjectiles.filter((shot) => shot.life > 0);
  for (const shot of game.policeShots) shot.life -= dt;
  game.policeShots = game.policeShots.filter((shot) => shot.life > 0);
}

function fireAtPlayer(game, officer, dt) {
  officer.fireCooldown = Math.max(0, officer.fireCooldown - dt);
  if (game.heat < 2 || officer.stun > 0) { officer.fireWindup = 0; return false; }
  const range = officer.kind === 'patrol' ? 160 : 200;
  if (officer.fireWindup > 0) {
    officer.fireWindup = Math.max(0, officer.fireWindup - dt);
    if (officer.fireWindup === 0) {
      const target = officer.fireTarget;
      if (target && game.clearSegment(officer, target, 1, game.vehicleId, true) && game.policeProjectiles.length < POLICE_LIMITS.projectiles) {
        const a = officer.aimAngle, speed = 260;
        game.policeProjectiles.push({ x: officer.x + Math.cos(a) * 15, y: officer.y + Math.sin(a) * 15, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: range / speed, kind: officer.kind, shooterId: officer.id });
        game.policeShots.push({ x: officer.x, y: officer.y, toX: target.x, toY: target.y, life: .14, maxLife: .14, kind: officer.kind, faction: officer.faction });
        game.emit?.('policeShot', { x: officer.x, y: officer.y, kind: officer.kind });
      }
      officer.fireCooldown = officer.kind === 'patrol' ? 4.5 : 3.8;
    }
    officer.speed = 0; return true;
  }
  if (officer.fireCooldown <= 0 && distance(officer, game.player) < range && game.clearSegment(officer, game.player, 1, game.vehicleId, true)) {
    officer.fireTarget = { x: game.player.x, y: game.player.y };
    officer.aimAngle = Math.atan2(game.player.y - officer.y, game.player.x - officer.x);
    officer.fireWindup = 1.25; officer.speed = 0;
    return true;
  }
  return false;
}

function moveOfficer(game, p, dt) {
  const onFoot = p.onFoot || p.role === 'officer' || p.kind === 'gendarme';
  const car = p.vehicleId && game.cars.find((item) => item.id === p.vehicleId);
  if (car?.destroyed) {
    p.hp = 0; p.dead = true; p.alert = false; p.speed = 0; p.deathTimer = 8; p.path = [];
    if (!p.crewReported) { p.crewReported = true; game.eliminated.police++; reportCrime(game, 'policeKill', { x: p.x, y: p.y, sourceId: p.id }); }
    return;
  }
  if (car) p.hp = car.hp;
  if (p.warn > 0) { p.warn = Math.max(0, p.warn - dt); return; }
  if (p.stun > 0) { p.stun = Math.max(0, p.stun - dt); p.speed = 0; return; }
  if (!game.heat) { p.alert = false; p.speed = 0; return; }
  p.alert = true;
  const ignored = new Set([game.vehicleId, p.vehicleId]);
  if (fireAtPlayer(game, p, dt)) return;
  p.pathTimer -= dt;
  const targetKnown = game.wanted.lastKnown;
  if (p.pathTimer <= 0 && game._policeClock.paths <= 0) {
    const radius = onFoot ? 5 : game.navRadius;
    const direct = game.clearSegment(p, targetKnown, radius, ignored, false);
    p.path = direct ? [] : onFoot && game.groundVegetationDetour?.(p, targetKnown, radius, p, 300) || game.streetPath(p, targetKnown, { ignoreCars: ignored, maxVisited: 3500, body: game.mappedPhysics ? { radius: onFoot ? 5 : 8, halfLength: onFoot ? 0 : 7 } : null });
    p.pathTimer = 2.2 + (Number(p.id) || 0) % 3 * .2; game._policeClock.paths = .3;
    if (p.path.length > 1 && game.clearSegment(p, p.path[1], radius, ignored, false)) p.path.shift();
  }
  while (p.path.length && distance(p, p.path[0]) < 3) p.path.shift();
  const target = p.path[0] || (game.clearSegment(p, targetKnown, onFoot ? 5 : game.navRadius, ignored, false) ? targetKnown : null);
  if (!target) { p.speed = 0; return; }
  const remaining = distance(p, target);
  const speed = (p.kind === 'military' ? 64 : p.kind === 'heavy' ? 72 : 80 + Math.min(3, game.heat) * 4)
    * (onFoot ? game.groundWalkingFactor?.(p.x, p.y, 5) ?? 1 : 1);
  const move = Math.min(remaining, speed * dt);
  if (remaining > .001) {
    const dx = (target.x - p.x) / remaining * move, dy = (target.y - p.y) / remaining * move;
    const desired = Math.atan2(dy, dx), angle = game.mappedPhysics ? p.angle + clamp(deltaAngle(p.angle, desired), -8 * dt, 8 * dt) : desired;
    if (onFoot || game.canCarOccupy(p.x, p.y, angle, ignored)) p.angle = angle;
    const fits = onFoot ? game.canMoveGroundCircle(p, { x: p.x + dx, y: p.y + dy }, 5, ignored)
      : game.canCarOccupy(p.x + dx, p.y + dy, p.angle, ignored);
    if (fits) { p.x += dx; p.y += dy; p.speed = speed; }
    else { p.pathTimer = Math.min(p.pathTimer, .5); p.speed = 0; }
  } else p.speed = 0;
  if (car) { car.x = p.x; car.y = p.y; car.angle = p.angle; car.speed = p.speed; }
  // Contact is the same arcade damage as before; protection prevents stacking.
  const dx = Math.cos(p.angle) * 7, dy = Math.sin(p.angle) * 7;
  const axisA = { x: p.x - dx, y: p.y - dy }, axisB = { x: p.x + dx, y: p.y + dy };
  const touches = onFoot ? distance(p, game.player) < 5 + (game.vehicle ? 13 : game.playerRadius)
    : game.mappedPhysics ? segmentDistanceSq(game.player.x, game.player.y, axisA, axisB) < (8 + (game.vehicle ? 13 : game.playerRadius)) ** 2 : distance(p, game.player) < 18 + (game.vehicle ? 18 : game.playerRadius);
  if (touches && game.player.invulnerable <= 0) { game.hurt('gendarme'); p.stun = 1.8; p.path = []; }
}

export function updatePolice(game, dt) {
  if (!active(game) || !Number.isFinite(dt) || dt <= 0) return;
  if (!game.wanted) initPolice(game);
  const clock = game._policeClock;
  clock.paths = Math.max(0, clock.paths - dt);
  updateProjectiles(game, dt); updateHelicopter(game, dt); perceive(game, dt);
  updateRoadblocks(game, dt);
  const alive = game.police.filter((p) => !p.dead);
  // Reserve each promised specialised vehicle's place while its arrival is
  // announced; regular patrols must not fill the cap before it can arrive.
  const reserved = Number(game.heat >= 5 && !alive.some((p) => p.kind === 'heavy')) + Number(game.heat >= 6 && !alive.some((p) => p.kind === 'military'));
  const targetCount = Math.min(POLICE_LIMITS.units, game.heat) - reserved;
  clock.dispatch -= dt; game.spawnClock = clock.dispatch;
  if (game.heat >= 6) clock.military -= dt;
  if (game.heat >= 5) clock.heavy -= dt;
  if (clock.dispatch <= 0 && alive.length < targetCount) {
    const kind = game.heat >= 6 && clock.military <= 0 && !alive.some((p) => p.kind === 'military') ? 'military'
      : game.heat >= 5 && clock.heavy <= 0 && alive.filter((p) => p.kind === 'heavy').length < 2 ? 'heavy' : 'patrol';
    spawnPolice(game, { unit: kind }); clock.dispatch = 2.8;
  }
  // If low-level patrols already fill the cap, replace one distant patrol with
  // the announced specialised response. Never teleport a unit beside a player.
  if (game.heat >= 5 && clock.heavy <= 0 && !alive.some((p) => p.kind === 'heavy')) upgradeDistant(game, 'heavy');
  if (game.heat >= 6 && clock.military <= 0 && !alive.some((p) => p.kind === 'military')) upgradeDistant(game, 'military');
  for (const officer of game.police) if (!officer.dead) moveOfficer(game, officer, dt);
  clock.cleanup -= dt;
  if (clock.cleanup <= 0) {
    clock.cleanup = 5;
    // Expired distant wrecks and responders cannot accumulate in free roaming.
    const removed = game.police.filter((p) => distance(p, game.player) > 1400);
    const ids = new Set(removed.map((p) => p.vehicleId));
    game.police = game.police.filter((p) => !removed.includes(p));
    game.cars = game.cars.filter((car) => !ids.has(car.id) && !(car.lawEnforcement && car.destroyed && !car.fireTimer && !car.smokeTimer && distance(car, game.player) > 350));
  }
  if (!game.heat) {
    const removed = game.police.filter((p) => !p.dead && distance(p, game.player) > 260);
    const ids = new Set(removed.map((p) => p.vehicleId));
    game.police = game.police.filter((p) => !removed.includes(p)); game.cars = game.cars.filter((car) => !ids.has(car.id));
  }
}

function upgradeDistant(game, kind) {
  const alive = game.police.filter((p) => !p.dead);
  if (alive.length < POLICE_LIMITS.units) { spawnPolice(game, { unit: kind }); return; }
  const old = alive.filter((p) => p.kind === 'patrol' && distance(p, game.player) > 300).sort((a, b) => distance(b, game.player) - distance(a, game.player))[0];
  if (!old) return;
  game.police = game.police.filter((p) => p !== old);
  if (!spawnPolice(game, { unit: kind })) game.police.push(old);
}
