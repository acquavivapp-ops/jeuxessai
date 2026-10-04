// Arcade rules only: no real weapon specifications or dismemberment.
// All travel uses swept segments, so a low frame rate cannot shoot through a wall.
import { reportCrime } from './police.js';
import { isMobilityVehicle, vehicleRadius, vehicleHalfLength, mobilityExit } from './mobility.js';
import { nearbyVegetation } from './vegetation.js';

export const WEAPONS = Object.freeze([
  Object.freeze({ id: 'pistol', name: 'Pistolet', cooldown: .27, damage: 32, speed: 640, range: 530, explosive: false, radius: 0, pellets: 1, spread: 0, audioVariant: 0 }),
  Object.freeze({ id: 'smg', name: 'Rafale', cooldown: .09, damage: 16, speed: 740, range: 480, explosive: false, radius: 0, pellets: 1, spread: 0, audioVariant: 1 }),
  Object.freeze({ id: 'launcher', name: 'Lance-BOUM', cooldown: .9, damage: 310, speed: 320, range: 450, explosive: true, radius: 70, pellets: 1, spread: 0, audioVariant: 2 }),
  Object.freeze({ id: 'shotgun', name: 'Fusil à pompe', cooldown: .72, damage: 19, speed: 600, range: 260, explosive: false, radius: 0, pellets: 7, spread: .18, audioVariant: 3 }),
  Object.freeze({ id: 'rifle', name: 'Fusil de précision', cooldown: .68, damage: 84, speed: 1100, range: 900, explosive: false, radius: 0, pellets: 1, spread: 0, audioVariant: 4 }),
  Object.freeze({ id: 'carbine', name: 'Carabine', cooldown: .15, damage: 26, speed: 900, range: 640, explosive: false, radius: 0, pellets: 1, spread: .035, audioVariant: 5 }),
]);

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const active = (game) => typeof game.active === 'function' ? game.active() : game.mode === 'playing' && !game.tutorial;
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const point = (p) => [p.x, p.y];
const polygonOf = (b) => b.polygon || [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
const people = (game) => game.world.scenery.filter((p) => p.kind === 'pedestrian' || p.kind === 'gendarme');
const liveCars = (game) => game.cars.filter((car) => !car.destroyed && !car.pendingRoadblock);
const explosiveCause = (cause) => ['blast', 'launcher', 'vehicle', 'secondary'].includes(cause);
const mountedPolice = (game, person) => person.vehicleId && game.cars.some((car) => car.id === person.vehicleId);

function effectSeed(game) {
  game._effectSerial = (game._effectSerial || 0) + 1;
  return (Math.imul(game._effectSerial, 2654435761) ^ (game.initialSeed || 42)) >>> 0;
}

function limitedPush(array, value, maximum) {
  array.push(value);
  if (array.length > maximum) array.splice(0, array.length - maximum);
}

function limitedNearbyEffect(game, array, value, maximum) {
  if (array.length < maximum || !Number.isFinite(game.player?.x) || !Number.isFinite(game.player?.y)) {
    limitedPush(array, value, maximum); return;
  }
  const distanceSquared = effect => (effect.x - game.player.x) ** 2 + (effect.y - game.player.y) ** 2
    + (((effect.altitude || 0) - (game.player.altitude || 0)) * 4) ** 2;
  let farthest = 0, farthestDistance = distanceSquared(array[0]);
  for (let i = 1; i < array.length; i++) {
    const distance = distanceSquared(array[i]);
    if (distance > farthestDistance) { farthest = i; farthestDistance = distance; }
  }
  // Keep the earlier pulse on ties. A dense chain must not evict the nearby
  // initiating explosion before its first rendered frame. Work stays ≤64.
  if (distanceSquared(value) < farthestDistance) array[farthest] = value;
}

function effectRandom(seed, index) {
  return ((Math.imul(seed ^ Math.imul(index + 1, 2246822519), 3266489917) >>> 0) % 65536) / 65536;
}

/** The short damage pulse and longer visual fireball have separate lifetimes. */
export function createBlast(game, x, y, radius, cause = 'blast', altitude = 0) {
  const seed = effectSeed(game), id = ++game.id;
  const height = altitude > 0 ? { altitude } : {};
  limitedNearbyEffect(game, game.blasts, { id, x, y, radius, life: .45, maxLife: .45, cause, style: cause, seed, ...height }, 64);
  game.explosionEffects ||= [];
  limitedNearbyEffect(game, game.explosionEffects, { id, x, y, radius, life: 1.05, maxLife: 1.05, cause, style: cause, seed, ...height }, 64);
}

function fireHotspots(building, count, seed) {
  const polygon = polygonOf(building), holes = building.holes || [], spots = [];
  for (let i = 0; i < count; i++) {
    let candidate = polygon[0];
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = building.x + building.w * (.1 + .8 * effectRandom(seed, i * 80 + attempt * 2));
      const y = building.y + building.h * (.1 + .8 * effectRandom(seed, i * 80 + attempt * 2 + 1));
      if (inside([x, y], polygon) && !holes.some((hole) => inside([x, y], hole))) { candidate = [x, y]; break; }
    }
    spots.push({ x: candidate[0], y: candidate[1], size: count === 1 ? 3.5 : 4.5 + i, seed: seed ^ i });
  }
  return spots;
}

function leaveBlood(game, person, cause) {
  const seed = effectSeed(game), angle = Number.isFinite(person.hitAngle) ? person.hitAngle : person.dir || game.player.aimAngle || 0;
  game.blood ||= [];
  limitedPush(game.blood, { x: person.x, y: person.y, angle, size: cause === 'runover' ? 5.8 : explosiveCause(cause) ? 4.4 : 3.2, life: 35, maxLife: 35, cause, seed }, 80);
  for (let i = 0; i < 7; i++) {
    const direction = angle + (effectRandom(seed, i) - .5) * Math.PI * 1.4;
    const speed = 8 + effectRandom(seed, i + 8) * 18;
    limitedPush(game.particles, { x: person.x, y: person.y, vx: Math.cos(direction) * speed, vy: Math.sin(direction) * speed, life: .35, maxLife: .35, color: '#742635', size: 1, kind: 'blood' }, 512);
  }
}

function nearbyBuildings(game, minX, minY, maxX, maxY) {
  if (!(game.buildingIndex instanceof Map)) return game.world.buildings;
  const found = new Set();
  for (let cy = Math.floor(minY / 128); cy <= Math.floor(maxY / 128); cy++) {
    for (let cx = Math.floor(minX / 128); cx <= Math.floor(maxX / 128); cx++) {
      for (const building of game.buildingIndex.get(`${cx},${cy}`) || []) found.add(building);
    }
  }
  return found;
}

function segmentDistanceSq(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
  return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
}

function inside(p, polygon) {
  let yes = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (segmentDistanceSq(p, a, b) < 1e-12) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
  }
  return yes;
}

function segmentEdgeHit(a, b, c, d) {
  const ab = [b[0] - a[0], b[1] - a[1]], cd = [d[0] - c[0], d[1] - c[1]], ac = [c[0] - a[0], c[1] - a[1]];
  const denominator = cross(ab, cd);
  if (Math.abs(denominator) < 1e-10) {
    if (Math.abs(cross(ac, ab)) > 1e-8) return null;
    const lengthSq = ab[0] ** 2 + ab[1] ** 2;
    if (!lengthSq) return segmentDistanceSq(a, c, d) < 1e-12 ? 0 : null;
    const t1 = (ac[0] * ab[0] + ac[1] * ab[1]) / lengthSq;
    const t2 = ((d[0] - a[0]) * ab[0] + (d[1] - a[1]) * ab[1]) / lengthSq;
    const near = Math.max(0, Math.min(t1, t2)), far = Math.min(1, Math.max(t1, t2));
    return near <= far ? near : null;
  }
  const t = cross(ac, cd) / denominator, u = cross(ac, ab) / denominator;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? clamp(t, 0, 1) : null;
}

export function segmentBuildingHit(a, b, building) {
  const polygon = polygonOf(building), holes = building.holes || [];
  if (inside(a, polygon) && !holes.some((hole) => inside(a, hole))) return 0;
  let closest = null;
  for (const ring of [polygon, ...holes]) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const hit = segmentEdgeHit(a, b, ring[j], ring[i]);
    if (hit !== null && (closest === null || hit < closest)) closest = hit;
  }
  return closest;
}

function segmentCircleHit(a, b, center, radius) {
  const x = a[0] - center[0], y = a[1] - center[1], dx = b[0] - a[0], dy = b[1] - a[1];
  const c = x * x + y * y - radius * radius;
  if (c <= 0) return 0;
  const aa = dx * dx + dy * dy;
  if (!aa) return null;
  const bb = 2 * (x * dx + y * dy), discriminant = bb * bb - 4 * aa * c;
  if (discriminant < 0) return null;
  const t = (-bb - Math.sqrt(discriminant)) / (2 * aa);
  return t >= 0 && t <= 1 ? t : null;
}

function segmentCarHit(a, b, car, mapped) {
  if (isMobilityVehicle(car) && !vehicleHalfLength(car)) return segmentCircleHit(a, b, point(car), vehicleRadius(car));
  if (!mapped) return segmentCircleHit(a, b, point(car), 18);
  const dx = Math.cos(car.angle || 0), dy = Math.sin(car.angle || 0), shaft = car.collisionHalfLength ?? 7, radius = car.collisionRadius || 8;
  const start = [car.x - dx * shaft, car.y - dy * shaft], end = [car.x + dx * shaft, car.y + dy * shaft];
  const polygon = [
    [start[0] - dy * radius, start[1] + dx * radius], [end[0] - dy * radius, end[1] + dx * radius],
    [end[0] + dy * radius, end[1] - dx * radius], [start[0] + dy * radius, start[1] - dx * radius],
  ];
  const hits = [segmentCircleHit(a, b, start, radius), segmentCircleHit(a, b, end, radius), segmentBuildingHit(a, b, { polygon })].filter((t) => t !== null);
  return hits.length ? Math.min(...hits) : null;
}

function buildingDistance(p, building) {
  const polygon = polygonOf(building), holes = building.holes || [];
  if (inside(p, polygon) && !holes.some((hole) => inside(p, hole))) return 0;
  let best = Infinity;
  for (const ring of [polygon, ...holes]) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) best = Math.min(best, segmentDistanceSq(p, ring[j], ring[i]));
  return Math.sqrt(best);
}

function carDistance(p, car, mapped) {
  if (isMobilityVehicle(car) && !vehicleHalfLength(car)) return Math.max(0, Math.hypot(p[0] - car.x, p[1] - car.y) - vehicleRadius(car));
  if (!mapped) return Math.max(0, Math.hypot(p[0] - car.x, p[1] - car.y) - 18);
  const dx = Math.cos(car.angle || 0) * (car.collisionHalfLength ?? 7), dy = Math.sin(car.angle || 0) * (car.collisionHalfLength ?? 7);
  return Math.max(0, Math.sqrt(segmentDistanceSq(p, [car.x - dx, car.y - dy], [car.x + dx, car.y + dy])) - (car.collisionRadius || 8));
}

function resistance(building) {
  const supplied = building.maxHp ?? building.hp;
  if (Number.isFinite(supplied) && supplied > 1) return supplied;
  if (building.target) return 120;
  const area = Math.max(1, (building.w || 16) * (building.h || 16));
  const floors = building.construction?.floors || 1;
  const sturdy = /fort|citadel|castle|stone|concrete/i.test(`${building.kind} ${building.construction?.material || ''}`) ? 100 : 0;
  return Math.round(clamp(180 + Math.sqrt(area) * 2 + (floors - 1) * 40 + sturdy, 200, 680) / 10) * 10;
}

export function initCombat(game) {
  game.projectiles = []; game.weaponIndex = 0; game.weapon = WEAPONS[0];
  game.fireCooldown = 0; game.shotsFired = 0; game.destroyedBuildings = 0;
  game._airWeaponNotice = 0;
  game.eliminated = { pedestrians: 0, police: 0 };
  game.player.muzzleFlash = 0; game.player.recoil = 0; game.player.aimAngle = game.player.dir;
  game._vehicleExplosionQueue = []; game._resolvingVehicleExplosions = false;
  game._damagedBuildings = new Set();
  game._burningBuildings = new Set(); game._effectSerial = 0;
  game._crimeIncidentSerial = 0;
  game.blood = []; game.explosionEffects = []; game.destructionDust = [];
  for (const building of game.world.buildings) {
    building.maxHp = resistance(building); building.hp = building.destroyed ? 0 : building.maxHp;
    building.damageFlash = 0; building.fireTimer = 0; building.smokeTimer = 0;
    building.fireHotspots = []; building.destructionCause = null;
  }
  for (const car of game.cars) {
    car.maxHp = Number.isFinite(car.maxHp) && car.maxHp > 100 ? car.maxHp : 260;
    car.hp = car.destroyed ? 0 : car.maxHp; car.damageFlash = 0; car.fireTimer = 0;
    car.smokeTimer = 0; car.burnFuse = 0; car.exploded = false;
    car.destructionCause = null; car.fireHotspots = [];
  }
  for (const p of people(game)) { p.hp ??= 28; p.maxHp ??= p.hp; p.dead ??= false; p.deathTimer ??= 0; p.knockdownTimer ??= 0; }
}

export function cycleWeapon(game) {
  if (!active(game)) return false;
  game.weaponIndex = (game.weaponIndex + 1) % WEAPONS.length; game.weapon = WEAPONS[game.weaponIndex];
  // Switching never removes an active cooldown, so it cannot bypass fire rate.
  game.emit('weapon', { weapon: game.weapon.id, name: game.weapon.name });
  return game.weapon;
}

export function shoot(game, options = {}) {
  if (!active(game) || game.fireCooldown > 0) return false;
  const angle = typeof options === 'number' ? options : options?.angle;
  const direction = Number.isFinite(angle) ? angle : game.player.dir;
  const weapon = game.weapon || WEAPONS[0], vehicle = game.vehicle;
  if ((vehicle?.altitude || 0) > 8 && !weapon.explosive) {
    if (!game._airWeaponNotice) { game.emit('notice', { message: 'En vol, utilise le Lance-BOUM pour viser le sol.' }); game._airWeaponNotice = 1.5; }
    return false;
  }
  const height = vehicle?.altitude > 0 ? { altitude: vehicle.altitude, prevAltitude: vehicle.altitude, verticalSpeed: -100 } : {};
  const muzzle = vehicle ? 16 : 5;
  const shotId = game.shotsFired + 1;
  const shotSeed = (Math.imul(shotId, 2246822519) ^ (game.initialSeed || 42)) >>> 0;
  game.player.aimAngle = direction; game.player.muzzleFlash = weapon.id === 'shotgun' ? .12 : .09; game.player.recoil = 1;
  // Starting from the actor center also tests the short muzzle segment: walls
  // close to the player cannot be skipped by the muzzle offset.
  for (let pelletIndex = 0; pelletIndex < weapon.pellets; pelletIndex++) {
    // The pump fires a whole symmetric fan in one action. The carbine has a
    // small reproducible deviation, without consuming the world's random stream.
    const deviation = weapon.pellets > 1
      ? weapon.spread * (2 * pelletIndex / (weapon.pellets - 1) - 1)
      : weapon.spread * (effectRandom(shotSeed, 0) * 2 - 1);
    const projectileAngle = direction + deviation;
    game.projectiles.push({
      id: ++game.id, shotId, pelletIndex,
      x: game.player.x, y: game.player.y, prevX: game.player.x, prevY: game.player.y,
      angle: projectileAngle, vx: Math.cos(projectileAngle) * weapon.speed, vy: Math.sin(projectileAngle) * weapon.speed,
      life: weapon.range / weapon.speed, maxLife: weapon.range / weapon.speed,
      weapon: weapon.id, damage: weapon.damage, explosive: weapon.explosive, radius: weapon.radius,
      ownerCarId: game.vehicleId, muzzle, ...height,
    });
  }
  game.fireCooldown = weapon.cooldown; game.shotsFired++;
  reportCrime(game, 'shot');
  game.emit('shoot', { weapon: weapon.id, explosive: weapon.explosive, pellets: weapon.pellets, shotId, audioVariant: weapon.audioVariant });
  return true;
}

export function damageBuilding(game, building, amount, cause = 'shot') {
  if (!building || building.destroyed || !Number.isFinite(amount) || amount <= 0) return false;
  building.maxHp ??= resistance(building);
  if (!Number.isFinite(building.hp)) building.hp = building.maxHp;
  building.hp = Math.max(0, building.hp - amount); building.damageFlash = .2;
  game._damagedBuildings?.add(building);
  reportCrime(game, 'propertyDamage', { x: building.x + building.w / 2, y: building.y + building.h / 2, sourceId: `building-${building.id}` });
  if (building.hp > 0) return true;
  building.destroyed = true; game.destroyedBuildings++;
  const fiery = explosiveCause(cause), seed = effectSeed(game);
  building.destructionCause = cause;
  building.fireTimer = building.fireMaxLife = fiery ? 16 : 8;
  building.smokeTimer = building.smokeMaxLife = fiery ? 24 : 14;
  building.fireHotspots = fireHotspots(building, fiery ? 3 : 1, seed);
  game._burningBuildings?.add(building);
  game.shake = Math.max(game.shake || 0, .22);
  const x = building.x + building.w / 2, y = building.y + building.h / 2;
  limitedPush(game.destructionDust, { x, y, radius: clamp(Math.sqrt(building.w * building.h) * .45, 14, 70), life: 3.2, maxLife: 3.2, cause, seed }, 48);
  if (fiery) limitedNearbyEffect(game, game.explosionEffects, { x, y, radius: clamp(Math.sqrt(building.w * building.h) * .22, 12, 36), life: .9, maxLife: .9, cause, style: 'building', seed }, 64);
  game.spark(x, y, '#b89e77', 14);
  if (building.target) {
    game.demolished++; game.score += 250;
    game.popup(x, y, '+250 · PATATRAS !', '#ffe5a1');
    game.emit('demolish', { multiplier: 1, name: building.name, id: building.id, cause });
  } else {
    game.score += 50;
    game.popup(x, y, 'PATATRAS !', '#ffe5a1');
    game.emit('buildingDestroyed', { id: building.id, name: building.name, cause });
  }
  return true;
}

export function damagePerson(game, person, amount, cause = 'shot', type = 'pedestrian') {
  if (!person || person.dead || !Number.isFinite(amount) || amount <= 0) return false;
  person.maxHp ??= type === 'police' ? 80 : 28; person.hp ??= person.maxHp;
  person.hp = Math.max(0, person.hp - amount); person.damageFlash = .15;
  if (person.hp > 0) {
    person.stun = Math.max(person.stun || 0, .2);
    reportCrime(game, 'injury', { x: person.x, y: person.y, sourceId: `${type}-${person.id}` });
    return true;
  }
  person.dead = true; person.alive = false; person.deathTimer = 8;
  person.deathCause = cause;
  person.knockedDown = true; person.knockdownTimer = 0; person.speed = 0; person.path = [];
  game.eliminated[type === 'police' ? 'police' : 'pedestrians']++;
  if (type === 'police') game.score += 35;
  reportCrime(game, type === 'police' ? 'policeKill' : 'kill', { x: person.x, y: person.y, sourceId: `${type}-${person.id}` });
  leaveBlood(game, person, cause);
  game.emit('kill', { type, cause, id: person.id });
  return true;
}

export function damageCar(game, car, amount, cause = 'shot') {
  if (!car || car.destroyed || car.pendingRoadblock || !Number.isFinite(amount) || amount <= 0) return false;
  car.maxHp ??= 260; car.hp ??= car.maxHp;
  car.hp = Math.max(0, car.hp - amount); car.damageFlash = .2;
  reportCrime(game, 'propertyDamage', { x: car.x, y: car.y, sourceId: `car-${car.id}` });
  if (car.hp <= 0) {
    if (explosiveCause(cause)) explodeVehicle(game, car, cause);
    else {
      markVehicleDestroyed(game, car, cause);
      car.burnFuse = 1.4;
      game.emit('vehicleFire', { id: car.id, cause, delay: car.burnFuse });
    }
  }
  return true;
}

export function applyExplosion(game, x, y, radius, damage, cause = 'blast', { ignoreCarId = null, hurtPlayer = false, incidentId = null, altitude = 0 } = {}) {
  const explosionId = incidentId ?? `${cause}-${++game._crimeIncidentSerial}`;
  reportCrime(game, 'explosion', { x, y, incidentId: explosionId });
  const origin = [x, y];
  for (const building of nearbyBuildings(game, x - radius, y - radius, x + radius, y + radius)) {
    if (building.destroyed || altitude > (building.construction?.height || (building.construction?.floors || 2) * 3) + 8) continue;
    const d = buildingDistance(origin, building);
    if (d <= radius) damageBuilding(game, building, damage, cause);
  }
  for (const car of game.cars) {
    if (car.id === ignoreCarId || car.pendingRoadblock || car.destroyed && !car.burnFuse || Math.abs((car.altitude || 0) - altitude) > 8) continue;
    const d = carDistance(origin, car, game.mappedPhysics);
    if (d <= radius) {
      if (car.burnFuse > 0) explodeVehicle(game, car, cause);
      else damageCar(game, car, damage * (1 - .35 * d / radius), cause);
    }
  }
  if (altitude <= 8) {
    for (const p of people(game)) if (!p.dead && Math.hypot(p.x - x, p.y - y) <= radius + 5) damagePerson(game, p, damage, cause, p.kind === 'gendarme' ? 'police' : 'pedestrian');
    for (const p of game.police) if (!p.dead && !mountedPolice(game, p) && carDistance(origin, p, game.mappedPhysics) <= radius) damagePerson(game, p, damage, cause, 'police');
    for (const bottle of game.bottles) if (Math.hypot(bottle.x - x, bottle.y - y) <= radius && bottle.fuse > .25) bottle.fuse = .25;
  }
  if (hurtPlayer && Math.abs((game.player.altitude || 0) - altitude) <= 8 && Math.hypot(game.player.x - x, game.player.y - y) <= radius + (game.vehicle ? 15 : game.playerRadius || 7)) game.hurt('blast', { altitude });
}

function markVehicleDestroyed(game, car, cause) {
  if (car.destroyed) return;
  car.hp = 0; car.destroyed = true; car.wreck = true; car.kind = 'wreck'; car.speed = 0;
  car.destructionCause = cause;
  car.fireTimer = car.fireMaxLife = 18; car.smokeTimer = car.smokeMaxLife = 26;
  const seed = effectSeed(game), dx = Math.cos(car.angle || 0), dy = Math.sin(car.angle || 0);
  car.fireHotspots = [
    { x: car.x + dx * 6, y: car.y + dy * 6, size: 4, seed },
    { x: car.x - dx * 5, y: car.y - dy * 5, size: 2.8, seed: seed ^ 7 },
  ];
  if (game.vehicleId === car.id) {
    if (isMobilityVehicle(car) && (car.altitude > 0 || car.mobilityType === 'boat')) {
      const safeExit = car.altitude === 0 && typeof game.canOccupy === 'function' && mobilityExit(game, car);
      if (!safeExit) {
        game.player.altitude = car.altitude || 0;
        game.vehicleId = null;
        game.emit('car', { entered: false, destroyed: true, mobilityType: car.mobilityType });
        game.finish?.(false, 'crash');
      } else if (!explosiveCause(cause)) game.hurt('blast');
      return;
    }
    game.vehicleId = null; game.player.x = car.x; game.player.y = car.y;
    game.player.vx = 0; game.player.vy = 0;
    game.emit('car', { entered: false, destroyed: true });
    // A burning occupied car hurts once immediately; its secondary blast
    // follows within the usual protection window, so it cannot double-hit.
    if (!explosiveCause(cause)) game.hurt('blast');
  }
}

export function explodeVehicle(game, car, cause = 'shot') {
  if (!car || car.exploded || car.pendingRoadblock) return false;
  // Mark before splash damage. A burning wreck may explode later, but every
  // vehicle enters this queue once, even in a dense parked row.
  markVehicleDestroyed(game, car, cause);
  car.exploded = true; car.burnFuse = 0; car.explosionCause = cause;
  car.fireTimer = car.fireMaxLife = Math.max(car.fireTimer || 0, 18);
  car.smokeTimer = car.smokeMaxLife = Math.max(car.smokeTimer || 0, 26);
  game._vehicleExplosionQueue ||= []; game._vehicleExplosionQueue.push({ car, cause });
  if (game._resolvingVehicleExplosions) return true;
  game._resolvingVehicleExplosions = true;
  try {
    while (game._vehicleExplosionQueue.length) {
      const entry = game._vehicleExplosionQueue.shift(), current = entry.car;
      createBlast(game, current.x, current.y, 74, entry.cause === 'secondary' ? 'secondary' : 'vehicle', current.altitude || 0);
      game.shake = Math.max(game.shake || 0, .3); game.spark(current.x, current.y, '#ffbd64', 20);
      game.emit('vehicleExplosion', { id: current.id, cause: entry.cause });
      applyExplosion(game, current.x, current.y, 74, 290, 'vehicle', { ignoreCarId: current.id, hurtPlayer: true, incidentId: `car-${current.id}`, altitude: current.altitude || 0 });
    }
  } finally { game._resolvingVehicleExplosions = false; }
  return true;
}

function firstHit(game, a, b, projectile) {
  let result = null;
  const consider = (t, kind, entity) => {
    if (t === null) return;
    const height = (projectile.prevAltitude || 0) + ((projectile.altitude || 0) - (projectile.prevAltitude || 0)) * t;
    const targetHeight = kind === 'building' ? (entity.construction?.height || (entity.construction?.floors || 2) * 3) : entity.altitude || 0;
    if (kind === 'vegetation' ? height >= 8 : kind === 'building' ? height > targetHeight + 4 : Math.abs(height - targetHeight) > 8) return;
    if (!result || t < result.t) result = { t, kind, entity };
  };
  // Buildings win ties with actors on their walls.
  for (const building of nearbyBuildings(game, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]))) if (!building.destroyed) consider(segmentBuildingHit(a, b, building), 'building', building);
  for (const tree of nearbyVegetation(game.vegetationCollisionIndex, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]))) consider(segmentCircleHit(a, b, point(tree), tree.trunkRadius), 'vegetation', tree);
  for (const car of liveCars(game)) if (car.id !== projectile.ownerCarId) consider(segmentCarHit(a, b, car, game.mappedPhysics), 'car', car);
  for (const p of people(game)) if (!p.dead) consider(segmentCircleHit(a, b, point(p), 5), p.kind === 'gendarme' ? 'police' : 'pedestrian', p);
  for (const p of game.police) if (!p.dead && !mountedPolice(game, p)) consider(segmentCarHit(a, b, p, game.mappedPhysics), 'police', p);
  return result;
}

function detonateProjectile(game, projectile) {
  createBlast(game, projectile.x, projectile.y, projectile.radius, 'launcher', projectile.altitude || 0);
  game.shake = Math.max(game.shake || 0, .25); game.spark(projectile.x, projectile.y, '#ffcf6c', 16);
  game.emit('explosion', { weapon: projectile.weapon });
  applyExplosion(game, projectile.x, projectile.y, projectile.radius, projectile.damage, 'launcher', { hurtPlayer: true, incidentId: `rocket-${projectile.id}`, altitude: projectile.altitude || 0 });
}

export function collidePedestrians(game, previous, current, dt) {
  if (!active(game) || !previous || !current || current.destroyed || current.altitude > 8 || current.mobilityType === 'boat' || !Number.isFinite(dt) || dt <= 0) return;
  const moved = Math.hypot(current.x - previous.x, current.y - previous.y);
  const speed = moved / dt;
  if (speed < 8) return;
  const radius = current.mobilityType === 'motorcycle' ? 5 : Number.isFinite(current.collisionRadius) ? current.collisionRadius + (current.collisionHalfLength ?? 7) : game.mappedPhysics ? 13 : 18;
  for (const p of people(game)) {
    if (p.dead || p.knockedDown || segmentDistanceSq(point(p), point(previous), point(current)) > (radius + 5) ** 2) continue;
    if (speed >= 65) { p.hitAngle = current.angle || 0; damagePerson(game, p, 100, 'runover', p.kind === 'gendarme' ? 'police' : 'pedestrian'); }
    else {
      p.knockedDown = true; p.knockdownTimer = 1.2; p.speed = 0;
      game.spark(p.x, p.y, '#fff1a8', 3);
      reportCrime(game, 'injury', { x: p.x, y: p.y, sourceId: `${p.kind}-${p.id}` });
      game.emit('bump', { type: p.kind, id: p.id });
    }
  }
}

export function updateCombat(game, dt) {
  if (!active(game) || !Number.isFinite(dt) || dt <= 0) return;
  game.fireCooldown = Math.max(0, game.fireCooldown - dt);
  game._airWeaponNotice = Math.max(0, (game._airWeaponNotice || 0) - dt);
  game.player.muzzleFlash = Math.max(0, game.player.muzzleFlash - dt);
  game.player.recoil = Math.max(0, game.player.recoil - dt * 8);
  for (const b of game._damagedBuildings || []) {
    b.damageFlash = Math.max(0, (b.damageFlash || 0) - dt);
    if (!b.damageFlash) game._damagedBuildings.delete(b);
  }
  for (const b of game._burningBuildings || []) {
    b.fireTimer = Math.max(0, (b.fireTimer || 0) - dt); b.smokeTimer = Math.max(0, (b.smokeTimer || 0) - dt);
    if (!b.fireTimer && !b.smokeTimer) game._burningBuildings.delete(b);
  }
  for (const car of game.cars) {
    car.damageFlash = Math.max(0, (car.damageFlash || 0) - dt);
    car.fireTimer = Math.max(0, (car.fireTimer || 0) - dt); car.smokeTimer = Math.max(0, (car.smokeTimer || 0) - dt);
    if (car.burnFuse > 0) { car.burnFuse = Math.max(0, car.burnFuse - dt); if (!car.burnFuse) explodeVehicle(game, car, 'secondary'); }
  }
  for (const collection of ['blood', 'explosionEffects', 'destructionDust']) {
    for (const effect of game[collection] || []) effect.life = Math.max(0, effect.life - dt);
    game[collection] = (game[collection] || []).filter((effect) => effect.life > 0);
  }
  for (const p of [...people(game), ...game.police]) {
    p.damageFlash = Math.max(0, (p.damageFlash || 0) - dt);
    if (p.dead) p.deathTimer = Math.max(0, (p.deathTimer || 0) - dt);
    else if (p.knockedDown) { p.knockdownTimer = Math.max(0, (p.knockdownTimer || 0) - dt); if (!p.knockdownTimer) p.knockedDown = false; }
  }
  for (const projectile of game.projectiles) {
    let travel = Math.min(dt, projectile.life);
    const oldHeight = projectile.altitude || 0;
    if (oldHeight > 0 && projectile.verticalSpeed < 0) travel = Math.min(travel, oldHeight / -projectile.verticalSpeed);
    const a = [projectile.x, projectile.y], b = [projectile.x + projectile.vx * travel, projectile.y + projectile.vy * travel];
    projectile.prevX = projectile.x; projectile.prevY = projectile.y;
    if (projectile.altitude !== undefined) { projectile.prevAltitude = oldHeight; projectile.altitude = Math.max(0, oldHeight + (projectile.verticalSpeed || 0) * travel); }
    const hit = firstHit(game, a, b, projectile);
    if (hit) {
      projectile.x = a[0] + (b[0] - a[0]) * hit.t; projectile.y = a[1] + (b[1] - a[1]) * hit.t;
      if (projectile.altitude !== undefined) projectile.altitude = oldHeight + (projectile.altitude - oldHeight) * hit.t;
      if (projectile.explosive) detonateProjectile(game, projectile);
      else {
        if (hit.kind === 'building') damageBuilding(game, hit.entity, projectile.damage, 'shot');
        else if (hit.kind === 'car') damageCar(game, hit.entity, projectile.damage, 'shot');
        else if (hit.kind !== 'vegetation') { hit.entity.hitAngle = projectile.angle; damagePerson(game, hit.entity, projectile.damage, 'shot', hit.kind); }
        game.spark(projectile.x, projectile.y, '#ffdd86', 3);
      }
      projectile.life = 0;
    } else {
      projectile.x = b[0]; projectile.y = b[1]; projectile.life = Math.max(0, projectile.life - dt);
      if (projectile.explosive && (projectile.life === 0 || oldHeight > 0 && !projectile.altitude)) { detonateProjectile(game, projectile); projectile.life = 0; }
    }
  }
  game.projectiles = game.projectiles.filter((projectile) => projectile.life > 0);
}
