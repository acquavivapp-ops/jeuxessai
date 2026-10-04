import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, createWorld, WORLD_WIDTH, WORLD_HEIGHT, DURATION, WALK_SPEED, DRIVE_SPEED, MAX_BOTTLES, BLAST_RADIUS, FUSE_DURATION, circleHitsPolygon } from '../engine.js';
import { createCalviWorld, buildCalviWorld } from '../calvi-world.js';
import { CALVI_MAP } from '../data/calvi-map.js';
import { createStreetGrid } from './fixtures/street-grid.js';
import { syntheticWorld, capsuleWorld, rectangleBuilding } from './fixtures/worlds.js';
import { reportCrime } from '../police.js';

const FRAME = .05;
const defendingFixtures = new WeakSet();
const controlledVehicles = new WeakMap();
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function running(seed = 42) {
  const events = [];
  const game = new Game({ seed, world: createStreetGrid(), onEvent: (name, data) => events.push({ name, data }) });
  game.start(); game.dismissTutorial();
  return { game, events };
}

// Check actual geometry independently of the engine's collision predicate.
function assertOutsideBuildings(game, actor, radius) {
  for (const b of game.world.buildings) {
    if (b.destroyed) continue;
    const dx = actor.x < b.x ? b.x - actor.x : actor.x > b.x + b.w ? actor.x - b.x - b.w : 0;
    const dy = actor.y < b.y ? b.y - actor.y : actor.y > b.y + b.h ? actor.y - b.y - b.h : 0;
    assert.ok(dx * dx + dy * dy >= radius * radius - 1e-6, `${actor.id || 'player'} must stay outside ${b.id}`);
  }
  const shoreline = game.world.scenery.find((item) => item.kind === 'water' && item.x === 0 && item.w === game.world.width && item.y + item.h === game.world.height);
  assert.ok(actor.x >= radius && actor.x <= game.world.width - radius);
  assert.ok(actor.y >= radius && actor.y <= (shoreline?.y || game.world.height) - radius, 'Actors stay on land and inside this fixture’s own bounds');
}

function defensiveInput(game, input) {
  if (game.vehicle) controlledVehicles.set(game, game.vehicle);
  const direction = Math.atan2(input.y || 0, input.x || 0);
  const clearAim = (target) => game.mappedPhysics
    ? game.clearSegment(game.player, target, 1, new Set([game.vehicleId, target.vehicleId, target.lawEnforcement ? target.id : null]), false)
    : game.clearSegment(game.player, target, 1, game.vehicleId, true);
  const barricade = game.cars.filter((car) => car.lawEnforcement && !car.destroyed && !car.pendingRoadblock && distance(car, game.player) < 260)
    .sort((one, two) => distance(one, game.player) - distance(two, game.player))
    .find((car) => Math.cos(Math.atan2(car.y - game.player.y, car.x - game.player.x) - direction) > .75 && clearAim(car));
  const officers = game.police.filter((p) => !p.dead && distance(p, game.player) < 220)
    .sort((one, two) => distance(one, game.player) - distance(two, game.player));
  const closeHeavy = game.mappedPhysics && !game.vehicle && officers.find((p) => p.vehicleId && distance(p, game.player) < 155 && clearAim(p));
  const target = closeHeavy || barricade || officers.find(clearAim);
  if (!target) return input;
  const mounted = target.vehicleId || target.lawEnforcement;
  if (game.mappedPhysics) {
    const d = distance(target, game.player);
    // Real photo parking rows can carry a blast back to the getaway car.
    // Check that actual chain before choosing the explosive weapon; otherwise
    // keep moving while using the ordinary carbine against the pursuer.
    const getaway = controlledVehicles.get(game);
    const protectedPositions = [game.player, ...getaway && !getaway.destroyed ? [getaway] : []];
    const chain = [game.cars.find((car) => car.id === target.vehicleId) || target];
    const reachable = new Set(chain);
    for (let at = 0; mounted && at < chain.length; at++) for (const car of game.cars) {
      if (reachable.has(car) || car.destroyed || car.pendingRoadblock || car.altitude > 8 || distance(chain[at], car) > 90) continue;
      reachable.add(car); chain.push(car);
    }
    const safeBlast = mounted && chain.every((car) => protectedPositions.every((position) => distance(car, position) > 90));
    const desired = mounted ? (d > 85 && safeBlast ? 'launcher' : !game.vehicle && d < 35 ? 'shotgun' : 'carbine') : 'rifle';
    for (let changes = 0; changes < 6 && game.weapon.id !== desired; changes++) game.cycleWeapon();
    if (closeHeavy) {
      const away = Math.atan2(game.player.y - closeHeavy.y, game.player.x - closeHeavy.x);
      const escape = Array.from({ length: 16 }, (_, i) => {
        const angle = away + (i - 8) * Math.PI / 8;
        const x = Math.cos(angle), y = Math.sin(angle);
        return { x, y, score: Math.cos(angle - away) * 2 + x * (input.x || 0) * .25 + y * (input.y || 0) * .25 };
      }).filter((v) => v.score > .6 && game.clearSegment(game.player, { x: game.player.x + v.x * 32, y: game.player.y + v.y * 32 }, game.playerRadius, null, false))
        .sort((one, two) => two.score - one.score)[0];
      if (escape) input = { ...input, x: escape.x, y: escape.y };
    }
  }
  const front = Math.cos(Math.atan2(target.y - game.player.y, target.x - game.player.x) - direction) > .75;
  return { ...input, shootHeld: true, aimAngle: Math.atan2(target.y - game.player.y, target.x - game.player.x), brake: Boolean(game.vehicle && mounted && front && distance(target, game.player) < (game.mappedPhysics ? 190 : 135)) };
}

function frame(game, input = { x: 0, y: 0 }, dt = FRAME) {
  if (defendingFixtures.has(game)) input = defensiveInput(game, input);
  game.update(dt, input);
  assertOutsideBuildings(game, game.player, game.vehicle ? 18 : 7);
  for (const p of game.police) assertOutsideBuildings(game, p, 18);
}

function advance(game, seconds, input = { x: 0, y: 0 }) {
  for (let left = seconds; left > 1e-8; left -= FRAME) frame(game, input, Math.min(FRAME, left));
}

function walk(game, x, y) {
  assert.equal(game.vehicle, null, 'Walking requires leaving the car');
  let ticks = 0;
  while (game.mode === 'playing' && distance(game.player, { x, y }) > .2) {
    assert.ok(ticks++ < 350, `A legal foot route must reach (${x},${y}) from (${game.player.x},${game.player.y})`);
    const dx = x - game.player.x, dy = y - game.player.y, d = Math.hypot(dx, dy);
    const strength = Math.min(1, d / (WALK_SPEED * FRAME));
    frame(game, { x: dx / d * strength, y: dy / d * strength });
  }
  assert.ok(game.mode === 'playing' || game.result?.won, 'A legal route must not end in an unexpected defeat');
}

// Joystick-only steering: cruise through intersections, brake to park near a
// mission. No coordinates, health, mission flags or clocks are changed here.
function drive(game, x, y, stop = true) {
  assert.ok(game.vehicle, 'Driving requires entering a car');
  let ticks = 0;
  while (game.mode === 'playing' && (stop ? distance(game.player, { x, y }) > 2 || game.vehicle.speed > 6 : distance(game.player, { x, y }) > 28)) {
    assert.ok(ticks++ < 800, `A legal car route must reach (${x},${y})`);
    const dx = x - game.player.x, dy = y - game.player.y, d = Math.hypot(dx, dy);
    const strength = stop ? Math.min(1, d * 2 / DRIVE_SPEED) : 1;
    frame(game, d > .05 ? { x: dx / d * strength, y: dy / d * strength } : { x: 0, y: 0 });
  }
  if (stop && game.mode === 'playing') advance(game, .5);
  assert.ok(game.mode === 'playing' || game.result?.won, `A legal drive to (${x},${y}) must not end in an unexpected defeat: ${JSON.stringify({ result: game.result, player: game.player, heat: game.heat })}`);
}

function waitForBlast(game) {
  let ticks = 0;
  while (game.mode === 'playing' && (game.bottles.length || game.blasts.length)) {
    assert.ok(ticks++ < 100, 'Automatic fuses and visible blasts must finish');
    frame(game);
  }
}

function firstMission(game) {
  walk(game, 310, 1142); walk(game, 310, 1070);
  assert.equal(game.plant(), true);
  walk(game, 310, 1142);
  waitForBlast(game);
}

function patrol(x, y, overrides = {}) {
  return { id: 'test-patrol', x, y, angle: 0, speed: 0, warn: 0, stun: 0, alert: false, path: [], pathTimer: 1, ...overrides };
}

test('the explicit synthetic street fixture isolates three missions, collision blocks and a safe starting car', () => {
  const world = createStreetGrid();
  assert.equal(world.width, 1500); assert.equal(world.height, 1400);
  assert.equal(world.roads.length, 6);
  assert.ok(world.buildings.length > 40, 'The city contains solid blocks beyond its three mission buildings');
  const targets = world.buildings.filter((b) => b.target);
  assert.equal(targets.length, 3);
  assert.equal(new Set(targets.map((b) => b.name)).size, 3);
  const { game } = running();
  assert.ok(distance(game.player, game.cars[0]) <= 32);
  assertOutsideBuildings(game, game.player, 7);
  for (const car of game.cars) assertOutsideBuildings(game, car, 18);
  for (const target of targets) {
    assertOutsideBuildings(game, target.approach, 7);
    const dx = Math.max(target.x - target.approach.x, target.approach.x - target.x - target.w, 0);
    const dy = Math.max(target.y - target.approach.y, target.approach.y - target.y - target.h, 0);
    assert.ok(Math.hypot(dx, dy) < BLAST_RADIUS, 'The indicated mission approach is within the fictional game radius');
  }
  assert.equal(game.objective.type, 'target');
  assert.equal(game.objective.id, 'port');
  near(game.timeLeft, DURATION);
});

test('title and tutorial freeze world traffic, time and all play actions', () => {
  const game = new Game({ world: createStreetGrid() });
  const initial = structuredClone({ player: game.player, cars: game.cars });
  game.update(10, { x: 1, y: 0 });
  assert.equal(game.mode, 'title'); assert.equal(game.elapsed, 0);
  assert.equal(game.plant(), false); assert.equal(game.interact(), false);
  assert.deepEqual(game.player, initial.player); assert.deepEqual(game.cars, initial.cars);
  game.start(); advance(game, 2, { x: 1, y: 0 });
  assert.equal(game.tutorial, true); assert.equal(game.elapsed, 0);
  assert.deepEqual(game.cars, initial.cars);
  assert.equal(game.plant(), false); assert.equal(game.interact(), false);
  game.dismissTutorial(); frame(game, { x: 1, y: 0 });
  assert.ok(game.player.x > initial.player.x);
  near(game.elapsed, FRAME);
});

test('walking accelerates promptly, normalizes diagonals, brakes on release and rejects invalid frames', () => {
  const { game } = running();
  game.player.x = 500; game.player.y = 1160; // An isolated collision-free physics fixture.
  frame(game, { x: 1, y: -1 });
  const initialDistance = distance(game.player, { x: 500, y: 1160 });
  assert.ok(initialDistance > WALK_SPEED * FRAME * .35 && initialDistance < WALK_SPEED * FRAME, 'A short acceleration makes movement responsive without instantaneous velocity jumps');
  const diagonal = { x: game.player.x, y: game.player.y };
  game.player.x = 500; game.player.y = 1160; game.player.vx = 0; game.player.vy = 0;
  frame(game, { x: 20, y: -20 });
  near(game.player.x, diagonal.x); near(game.player.y, diagonal.y);
  advance(game, .2, { x: .5, y: 0 });
  const before = { x: game.player.x, y: game.player.y, time: game.elapsed };
  frame(game, { x: .5, y: 0 }, 10);
  near(game.elapsed - before.time, .05);
  near(game.player.x - before.x, WALK_SPEED * .05 / 2);
  advance(game, .1);
  near(game.player.vx, 0); near(game.player.vy, 0);
  const stopped = structuredClone(game.player);
  game.update(-1, { x: 1, y: 0 });
  game.update(Number.NaN, { x: Infinity, y: Number.NaN });
  assert.deepEqual(game.player, stopped);
});

test('walking respects permanent buildings, world bounds and the physical shoreline', () => {
  const { game } = running();
  const house = game.world.buildings.find((b) => !b.target);
  game.player.x = house.x - 12; game.player.y = house.y + house.h / 2;
  advance(game, .8, { x: 1, y: 0 });
  assert.ok(game.player.x <= house.x - 7 + 1e-6);
  game.player.x = 12; game.player.y = 1160;
  advance(game, .8, { x: -1, y: 0 });
  assert.ok(game.player.x >= 7);
  game.player.x = 180; game.player.y = 1330;
  advance(game, .8, { x: 0, y: 1 });
  assert.ok(game.player.y <= 1333);
});

test('the initial car is immediately usable and every exit places the whole player safely', () => {
  const { game, events } = running();
  assert.equal(game.interact(), true);
  assert.equal(game.vehicleId, 'car-start');
  near(game.player.x, game.vehicle.x); near(game.player.y, game.vehicle.y);
  assert.equal(game.plant(), false, 'Bottles are an on-foot action');
  assert.equal(game.interact(), true);
  assert.equal(game.vehicle, null);
  assert.ok(game.canOccupy(game.player.x, game.player.y));
  assert.ok(distance(game.player, game.cars[0]) >= 25);
  assert.equal(events.filter((e) => e.name === 'car').length, 2);
  assert.equal(game.interact(), true, 'A safe exit remains close enough to re-enter');
});

test('cars accelerate with momentum, have a bounded top speed and brake on release', () => {
  const { game } = running();
  game.interact(); frame(game, { x: 1, y: 0 });
  assert.ok(game.vehicle.speed > 0 && game.vehicle.speed < DRIVE_SPEED / 4);
  advance(game, 1.2, { x: 1, y: 0 });
  near(game.vehicle.speed, DRIVE_SPEED);
  assert.ok(game.player.x > 400);
  const before = game.player.x;
  advance(game, .8);
  assert.ok(game.player.x > before, 'Momentum takes a short distance to stop');
  near(game.vehicle.speed, 0);
  const parked = { x: game.player.x, y: game.player.y };
  advance(game, .3);
  near(game.player.x, parked.x); near(game.player.y, parked.y);
});

test('a full-speed wall collision cannot tunnel through a depot, and exit still finds safe ground', () => {
  const { game, events } = running();
  game.interact(); drive(game, 390, 1168);
  for (let i = 0; i < 45; i++) frame(game, { x: 0, y: -1 });
  const port = game.world.buildings.find((b) => b.id === 'port');
  assert.ok(game.vehicle.y >= port.y + port.h + 18 - 1e-6);
  assert.ok(game.vehicle.speed < 30);
  const crashes = events.filter((e) => e.name === 'notice' && e.data.message.includes('carrosserie'));
  assert.ok(crashes.length >= 1 && crashes.length <= 3, 'Continuous contact should not flood notices');
  assert.equal(game.hearts, 3, 'The arcade wall collision slows the car');
  assert.equal(game.interact(), true);
  assert.ok(game.canOccupy(game.player.x, game.player.y));
  assertOutsideBuildings(game, game.player, 7);
});

test('a legal first mission auto-explodes, scores once and raises the pursuit heat', () => {
  const { game, events } = running();
  walk(game, 310, 1142); walk(game, 310, 1070);
  assert.equal(game.plant(), true);
  near(game.bottles[0].fuse, FUSE_DURATION);
  near(game.bottles[0].maxFuse, FUSE_DURATION);
  walk(game, 310, 1142);
  advance(game, 1.3);
  assert.equal(game.demolished, 0, 'The countdown stays visible before it finishes');
  waitForBlast(game);
  assert.equal(game.demolished, 1); assert.equal(game.score, 250);
  assert.equal(game.heat, 3); assert.equal(game.hearts, 3);
  assert.equal(game.world.buildings.find((b) => b.id === 'port').destroyed, true);
  assert.equal(game.world.buildings.filter((b) => b.target && !b.destroyed).length, 2);
  assert.equal(events.filter((e) => e.name === 'demolish').length, 1);
  assert.equal(events.find((e) => e.name === 'demolish').data.name, 'Dépôt du port');
  advance(game, .8);
  assert.ok(game.police.length > 0);
  assert.ok(game.police[0].warn > 0);
  assert.ok(distance(game.police[0], game.player) > 280);
  assert.ok(distance(game.police[0], game.player) < 600, 'A safe spawn still puts the pursuit within the playable district');
  assert.equal(game.score, 250);
});

test('bottle cooldown, minimum spacing and three-prop inventory limit all apply', () => {
  const { game } = running();
  game.player.x = 500; game.player.y = 1160;
  assert.equal(game.plant(), true); assert.equal(game.plant(), false);
  advance(game, .4);
  assert.equal(game.plant(), false, 'An expired cooldown does not permit overlapping props');
  walk(game, 528, 1160); assert.equal(game.plant(), true);
  walk(game, 556, 1160); assert.equal(game.plant(), true);
  walk(game, 584, 1160); assert.equal(game.plant(), false);
  assert.equal(game.bottles.length, MAX_BOTTLES);
  assert.equal(new Set(game.bottles.map((b) => b.id)).size, MAX_BOTTLES);
});

test('radial arcade damage reaches nearby missions while buildings outside the blast remain intact', () => {
  const { game } = running();
  game.player.x = 270; game.player.y = 1070;
  game.plant(); game.player.x = 270; game.player.y = 1142;
  waitForBlast(game);
  assert.equal(game.demolished, 0, 'A prop seventy pixels from the facade is outside its radius');
  assert.equal(game.score, 0);
  game.player.x = 310; game.player.y = 1070;
  game.plant(); game.player.x = 310; game.player.y = 1142;
  waitForBlast(game);
  assert.equal(game.demolished, 1);
  assert.ok(game.world.buildings.filter((b) => !b.target).every((b) => !b.destroyed));
  assert.ok(game.world.buildings.filter((b) => b.target && b.id !== 'port').every((b) => !b.destroyed));
});

test('a nearby prop keeps a visible short countdown when an earlier explosion chains it', () => {
  const { game, events } = running();
  game.player.x = 500; game.player.y = 1160;
  game.plant(); advance(game, .8); walk(game, 535, 1160); game.plant();
  game.player.x = 650; game.player.y = 1160;
  while (!events.some((e) => e.name === 'explosion')) frame(game);
  assert.equal(game.bottles.length, 1);
  assert.ok(game.bottles[0].fuse > .19 && game.bottles[0].fuse <= .25);
  advance(game, .15); assert.equal(game.bottles.length, 1);
  advance(game, .15); assert.equal(game.bottles.length, 0);
  assert.equal(events.filter((e) => e.name === 'explosion').length, 2);
  assert.equal(game.hearts, 3);
});

test('police A* takes connected streets around buildings and avoids parked cars', () => {
  const { game } = running();
  const from = { x: 1260, y: 220 }, to = { x: 310, y: 1070 };
  assert.equal(game.clearSegment(from, to), false, 'The direct chase line cuts through roofs');
  const path = game.streetPath(from, to);
  assert.ok(path.length > 15);
  for (let i = 0; i < path.length; i++) {
    assert.ok(game.world.roads.some((r) => path[i].x >= r.x && path[i].x <= r.x + r.w && path[i].y >= r.y && path[i].y <= r.y + r.h));
    assertOutsideBuildings(game, path[i], 18);
    assert.ok(game.canOccupy(path[i].x, path[i].y, 18), 'Street nodes used now must avoid parked cars');
    if (i) assert.equal(game.clearSegment(path[i - 1], path[i], 18, null, false), true);
  }
});

test('a spawned patrol announces itself before moving and then closes the distance without crossing roofs', () => {
  const { game } = running();
  firstMission(game); advance(game, .4);
  const p = game.police[0]; assert.ok(p && p.warn > 1);
  const arrival = { x: p.x, y: p.y }, initialDistance = distance(p, game.player);
  advance(game, 1);
  near(p.x, arrival.x); near(p.y, arrival.y); assert.equal(p.alert, false);
  advance(game, 2);
  assert.equal(p.alert, true);
  assert.ok(distance(p, game.player) < initialDistance - 60);
  assertOutsideBuildings(game, p, 18);
});

test('actual officer contact costs one heart, briefly stuns and grants cross-hazard immunity', () => {
  const { game, events } = running();
  game.player.x = 500; game.player.y = 1160;
  reportCrime(game, 'shot');
  const p = patrol(500, 1160), second = patrol(500, 1160, { id: 'second-patrol' });
  game.police = [p, second];
  frame(game);
  assert.equal(game.hearts, 2); assert.equal(game.lastCause, 'gendarme');
  assert.ok(p.stun > 1.7); assert.ok(game.player.invulnerable > 1.9);
  advance(game, .5); assert.equal(game.hearts, 2);
  game.hurt('blast'); assert.equal(game.hearts, 2);
  assert.equal(events.filter((e) => e.name === 'hurt').length, 1);
  game.police = []; advance(game, 1.6);
  game.hurt('blast'); assert.equal(game.hearts, 1);
});

test('an actual radial blast defeats a nearby active patrol while a distant player stays safe', () => {
  const { game } = running();
  game.player.x = 500; game.player.y = 1160; game.plant();
  game.player.x = 650; game.player.y = 1160;
  advance(game, 2.55);
  const p = patrol(535, 1160); game.police = [p];
  advance(game, .1); assert.equal(p.dead, true); assert.equal(game.eliminated.police, 1);
  const stopped = { x: p.x, y: p.y };
  advance(game, .5); near(p.x, stopped.x); near(p.y, stopped.y);
  assert.equal(game.hearts, 3);
});

test('pause freezes car motion, traffic, automatic fuses, patrols and the timer', () => {
  const { game, events } = running();
  game.plant(); game.interact(); frame(game, { x: 1, y: 0 });
  const frozen = structuredClone({ elapsed: game.elapsed, player: game.player, cars: game.cars, bottles: game.bottles, police: game.police });
  assert.equal(game.pause(), true);
  advance(game, 5, { x: 1, y: 0 });
  assert.equal(game.mode, 'paused');
  assert.deepEqual({ elapsed: game.elapsed, player: game.player, cars: game.cars, bottles: game.bottles, police: game.police }, frozen);
  assert.equal(game.plant(), false); assert.equal(game.interact(), false);
  game.resume(); frame(game, { x: 1, y: 0 });
  assert.ok(game.elapsed > frozen.elapsed);
  assert.ok(game.bottles[0].fuse < frozen.bottles[0].fuse);
  assert.ok(game.player.x > frozen.player.x);
  assert.deepEqual(events.filter((e) => ['pause', 'resume'].includes(e.name)).map((e) => e.name), ['pause', 'resume']);
});

test('decorative pedestrians move on short safe sidewalk segments and freeze on pause', () => {
  const { game } = running();
  const pedestrians = game.world.scenery.filter((p) => p.kind === 'pedestrian');
  assert.ok(pedestrians.length >= 20);
  const initial = pedestrians.map((p) => ({ x: p.x, y: p.y }));
  advance(game, 4);
  assert.ok(pedestrians.some((p, i) => distance(p, initial[i]) > 5), 'The visible town has moving pedestrians');
  for (const p of pedestrians) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.ok(Math.abs(p.x - p.homeX) <= 18 && Math.abs(p.y - p.homeY) <= 18);
    assertOutsideBuildings(game, p, 5);
    assert.ok(p.walk >= 0 && Number.isFinite(p.dir));
  }
  game.pause();
  const paused = structuredClone(pedestrians);
  advance(game, 2);
  assert.deepEqual(pedestrians, paused);
  game.resume(); advance(game, .5);
  assert.notDeepEqual(pedestrians, paused);
});

test('timeout has its own defeat cause and results freeze without duplicate loss events', () => {
  const { game, events } = running();
  advance(game, DURATION + .1);
  assert.equal(game.mode, 'result'); near(game.elapsed, DURATION);
  assert.equal(game.result.won, false); assert.equal(game.result.cause, 'time');
  assert.equal(game.hearts, 3);
  const result = structuredClone(game.result), player = structuredClone(game.player);
  advance(game, 2, { x: 1, y: 0 }); game.finish(false, 'blast');
  assert.deepEqual(game.result, result); assert.deepEqual(game.player, player);
  assert.equal(events.filter((e) => e.name === 'lose').length, 1);
});

test('three real automatic explosions exhaust hearts and preserve the blast defeat cause', () => {
  const events = [];
  const game = new Game({ world: syntheticWorld(), onEvent: (name, data) => events.push({ name, data }) });
  game.start(); game.dismissTutorial();
  for (let i = 0; i < 3; i++) {
    assert.equal(game.plant(), true);
    advance(game, 3.1);
    assert.equal(game.hearts, 2 - i);
  }
  assert.equal(game.result.won, false); assert.equal(game.result.cause, 'blast');
  assert.equal(events.filter((e) => e.name === 'hurt').length, 3);
  assert.equal(events.filter((e) => e.name === 'lose').length, 1);
});

test('a genuinely pursuing patrol can exhaust hearts without fabricated damage or a fake loss', () => {
  const { game } = running();
  firstMission(game);
  for (let i = 0; i < 600 && game.mode === 'playing'; i++) frame(game);
  assert.equal(game.mode, 'result');
  assert.equal(game.result.won, false); assert.equal(game.result.cause, 'gendarme');
  assert.equal(game.hearts, 0);
});

test('the citadel can be the first mission through a real drive and on-foot approach', () => {
  const { game, events } = running();
  assert.equal(game.interact(), true); drive(game, 240, 360);
  assert.equal(game.interact(), true); walk(game, 280, 360);
  assert.equal(game.plant(), true); walk(game, 280, 440); waitForBlast(game);
  assert.equal(game.demolished, 1); assert.equal(game.heat, 3);
  assert.equal(game.score, 250); assert.equal(game.hearts, 3);
  assert.equal(game.world.buildings.find((b) => b.id === 'port').destroyed, false);
  assert.deepEqual(events.filter((e) => e.name === 'demolish').map((e) => e.data.id), ['village']);
});

function playCity(game) {
  defendingFixtures.add(game);
  game.cycleWeapon();
  firstMission(game);
  walk(game, 270, 1138); assert.equal(game.interact(), true);
  // Leave the car outside the explosion radius now that vehicles have real
  // damage. These are ordinary joystick routes, not protected mission cars.
  drive(game, 750, 1160, false); drive(game, 750, 600);
  assert.equal(game.interact(), true); walk(game, 790, 600); walk(game, 790, 515);
  assert.equal(game.plant(), true); walk(game, 790, 600); waitForBlast(game);
  walk(game, 780, 600); assert.equal(game.interact(), true);
  drive(game, 750, 220, false); drive(game, 240, 220, false); drive(game, 240, 440);
  assert.equal(game.interact(), true); walk(game, 280, 440); walk(game, 280, 360);
  assert.equal(game.plant(), true); walk(game, 280, 440); waitForBlast(game);
  assert.equal(game.objective.type, 'escape');
  assert.equal(game.mode, 'playing', 'Three missions still require returning to the rendezvous');
  walk(game, 268, 440); assert.equal(game.interact(), true);
  drive(game, 240, 1160);
  defendingFixtures.delete(game);
}

// These fixtures exercise the future GIS input contract. They are deliberately
// synthetic geometry, not an OSM extraction or a claim about Calvi's streets.

test('free exploration keeps its elapsed clock beyond the mission deadline without a timeout', () => {
  const game = new Game({ world: syntheticWorld() });
  game.start({ mode: 'free' }); game.dismissTutorial();
  for (let left = DURATION + 1; left > 0; left -= FRAME) game.update(Math.min(FRAME, left));
  assert.equal(game.sessionMode, 'free'); assert.equal(game.mode, 'playing');
  assert.ok(game.elapsed > DURATION); assert.equal(game.timeLeft, Infinity); assert.equal(game.result, null);
  game.start(); assert.equal(game.sessionMode, 'mission'); assert.equal(game.timeLeft, DURATION);
});

test('finishing the optional missions in free exploration awards once and leaves the city playable', () => {
  const events = [], game = new Game({ world: createStreetGrid(), onEvent: (name, data) => events.push({ name, data }) });
  game.start({ mode: 'free' }); game.dismissTutorial();
  playCity(game);
  assert.equal(game.missionComplete, true); assert.equal(game.mode, 'playing'); assert.equal(game.result, null);
  assert.equal(game.objective.type, 'complete');
  assert.equal(events.filter((e) => e.name === 'missionComplete').length, 1);
  const before = { score: game.score, elapsed: game.elapsed };
  advance(game, .2);
  assert.equal(game.score, before.score); assert.ok(game.elapsed > before.elapsed);
  assert.equal(events.filter((e) => e.name === 'missionComplete').length, 1);
});

test('a supplied synthetic incline slows the uphill actor and vehicle without changing collision coordinates', () => {
  const incline = { status: 'ready', columns: 2, rows: 2, width: 400, height: 400, metresPerPixel: .25, values: [0, 40, 0, 40], bounds: { west: 0, east: 1, south: 0, north: 1 } };
  const actor = (terrain) => {
    const game = new Game({ world: syntheticWorld({ terrain, starts: { player: { x: 200, y: 200 }, cars: [], rendezvous: { x: 350, y: 350 }, patrolSpawns: [] } }) });
    game.start({ mode: 'free' }); game.dismissTutorial();
    for (let i = 0; i < 20; i++) game.update(FRAME, { x: 1, y: 0 });
    return game;
  };
  const level = actor(undefined), uphill = actor(incline);
  assert.ok(level.player.x - uphill.player.x > 25, 'The real gradient sampler changes uphill walking speed');
  near(level.player.y, 200); near(uphill.player.y, 200);
  const vehicle = (terrain) => {
    const game = new Game({ world: syntheticWorld({ terrain, starts: { player: { x: 100, y: 128 }, cars: [{ id: 'car-start', x: 100, y: 100, angle: 0, speed: 0, kind: 'parked' }], rendezvous: { x: 350, y: 350 }, patrolSpawns: [] } }) });
    game.start({ mode: 'free' }); game.dismissTutorial(); game.interact();
    for (let i = 0; i < 20; i++) game.update(FRAME, { x: 1, y: 0 });
    return game;
  };
  const flatCar = vehicle(undefined), uphillCar = vehicle(incline);
  assert.ok(uphillCar.vehicle.speed < flatCar.vehicle.speed * .8 && uphillCar.vehicle.x < flatCar.vehicle.x - 20);
  near(flatCar.vehicle.y, 100); near(uphillCar.vehicle.y, 100);
});

test('a second parked or occupied car can be stolen through movement and interaction, once per vehicle', () => {
  const events = [];
  const game = new Game({ world: syntheticWorld({ starts: {
    player: { x: 100, y: 128 },
    cars: [
      { id: 'owned-fixture', x: 100, y: 100, angle: 0, speed: 0, kind: 'parked', owned: true },
      { id: 'other-fixture', x: 300, y: 100, angle: 0, speed: 0, kind: 'parked', occupied: true },
    ], rendezvous: { x: 350, y: 350 }, patrolSpawns: [],
  } }), onEvent: (name, data) => events.push({ name, data }) });
  game.start({ mode: 'free' }); game.dismissTutorial();
  assert.equal(game.interact(), true); assert.equal(game.heat, 0); assert.equal(game.interact(), true);
  walk(game, 300, 128); assert.equal(game.interact(), true);
  assert.equal(game.vehicleId, 'other-fixture'); assert.equal(game.vehicle.stolen, true); assert.equal(game.vehicle.occupied, false);
  assert.equal(game.heat, 2); assert.equal(events.filter((e) => e.name === 'car' && e.data.stolen).length, 1);
  assert.equal(game.interact(), true); walk(game, 300, 128); assert.equal(game.interact(), true);
  assert.equal(game.heat, 2); assert.equal(events.filter((e) => e.name === 'car' && e.data.stolen).length, 1);
});

test('the dedicated brake stops a moving car faster than ordinary coasting', () => {
  const setup = () => {
    const game = new Game({ world: syntheticWorld({ starts: { player: { x: 100, y: 128 }, cars: [{ id: 'car-start', x: 100, y: 100, angle: 0, speed: 0, kind: 'parked' }], rendezvous: { x: 350, y: 350 }, patrolSpawns: [] } }) });
    game.start({ mode: 'free' }); game.dismissTutorial(); game.interact();
    for (let i = 0; i < 18; i++) game.update(FRAME, { x: 1, y: 0 });
    return game;
  };
  const coast = setup(), brake = setup(), startX = coast.vehicle.x;
  near(coast.vehicle.speed, DRIVE_SPEED); near(brake.vehicle.speed, DRIVE_SPEED);
  for (let i = 0; i < 6; i++) { coast.update(FRAME); brake.update(FRAME, { brake: true }); }
  near(brake.vehicle.speed, 0); assert.ok(coast.vehicle.speed > 70);
  assert.ok(brake.vehicle.x - startX < coast.vehicle.x - startX - 8, 'Braking saves real stopping distance');
});

test('held fire advances real projectiles and every combat action freezes during tutorial and pause', () => {
  const game = new Game({ world: syntheticWorld() });
  assert.equal(game.shoot(), false); assert.equal(game.cycleWeapon(), false);
  game.start({ mode: 'free' }); assert.equal(game.shoot(), false); game.dismissTutorial();
  game.update(FRAME, { shootHeld: true, aimAngle: 0 });
  assert.equal(game.shotsFired, 1); assert.ok(game.projectiles.length > 0);
  const projectileX = game.projectiles[0].x;
  game.update(FRAME, { aimAngle: 0 }); assert.ok(game.projectiles[0].x > projectileX);
  assert.equal(game.pause(), true);
  const frozen = structuredClone({ projectiles: game.projectiles, cooldown: game.fireCooldown, player: game.player, weaponIndex: game.weaponIndex, elapsed: game.elapsed });
  game.update(FRAME, { shootHeld: true, aimAngle: Math.PI });
  assert.equal(game.shoot(), false); assert.equal(game.cycleWeapon(), false);
  assert.deepEqual({ projectiles: game.projectiles, cooldown: game.fireCooldown, player: game.player, weaponIndex: game.weaponIndex, elapsed: game.elapsed }, frozen);
  game.resume(); assert.ok(game.cycleWeapon());
  const previousShots = game.shotsFired;
  for (let i = 0; i < 10; i++) game.update(FRAME, { shootHeld: true, aimAngle: 0 });
  assert.ok(game.shotsFired > previousShots);
});

test('the public six-weapon cycle and held pump fire work through Game.update and pause', () => {
  const game = new Game({ world: syntheticWorld() });
  game.start({ mode: 'free' }); game.dismissTutorial();
  const order = [game.weapon.id];
  for (let i = 0; i < 6; i++) order.push(game.cycleWeapon().id);
  assert.deepEqual(order, ['pistol', 'smg', 'launcher', 'shotgun', 'rifle', 'carbine', 'pistol']);
  for (let i = 0; i < 3; i++) game.cycleWeapon();
  game.update(FRAME, { shootHeld: true, aimAngle: 0 });
  assert.equal(game.shotsFired, 1); assert.equal(game.projectiles.length, 7);
  assert.ok(game.projectiles.every((p) => p.weapon === 'shotgun' && p.shotId === 1));
  const projectileX = game.projectiles[3].x;
  game.update(FRAME, { shootHeld: true, aimAngle: 0 });
  assert.equal(game.shotsFired, 1); assert.ok(game.projectiles[3].x > projectileX);
  assert.equal(game.pause(), true);
  const frozen = structuredClone({ projectiles: game.projectiles, cooldown: game.fireCooldown, shotsFired: game.shotsFired });
  game.update(1, { shootHeld: true, aimAngle: Math.PI });
  assert.equal(game.shoot(), false); assert.equal(game.cycleWeapon(), false);
  assert.deepEqual({ projectiles: game.projectiles, cooldown: game.fireCooldown, shotsFired: game.shotsFired }, frozen);
  game.resume();
  for (let i = 0; i < 15; i++) game.update(FRAME, { shootHeld: true, aimAngle: 0 });
  assert.equal(game.shotsFired, 2, 'Held fire repeats only after the slower pump recovery');
});

test('driving through an actual moving pedestrian applies the swept vehicle collision through Game.update', () => {
  const game = new Game({ world: syntheticWorld({
    scenery: [{ kind: 'pedestrian', id: 'crossing-fixture', x: 185, y: 100, axis: 'vertical' }],
    starts: { player: { x: 100, y: 128 }, cars: [{ id: 'car-start', x: 100, y: 100, angle: 0, speed: 0, kind: 'parked' }], rendezvous: { x: 350, y: 350 }, patrolSpawns: [] },
  }) });
  game.start({ mode: 'free' }); game.dismissTutorial(); assert.equal(game.interact(), true);
  for (let i = 0; i < 20; i++) game.update(FRAME, { x: 1, y: 0 });
  assert.equal(game.world.scenery[0].dead, true); assert.equal(game.eliminated.pedestrians, 1);
  assert.ok(game.heat > 0, 'Vehicle combat raises an actual pursuit');
  assert.equal(game.blood.length, 1); assert.equal(game.blood[0].cause, 'runover');
  const blood = structuredClone(game.blood);
  game.pause(); for (let i = 0; i < 10; i++) game.update(FRAME);
  assert.deepEqual(game.blood, blood, 'The public game pause freezes blood as well as actors');
  game.start({ mode: 'free' }); assert.equal(game.blood.length, 0);
});

test('synthetic polygon collision accepts a concave opening instead of treating its bounding box as solid', () => {
  const polygon = [[100, 100], [300, 100], [300, 130], [130, 130], [130, 300], [100, 300]];
  const game = new Game({ world: syntheticWorld({ buildings: [{ id: 'synthetic-L', x: 100, y: 100, w: 200, h: 200, polygon, destroyed: false, target: false }] }) });
  assert.equal(game.canOccupy(250, 250, 7), true, 'The empty inside corner is inside the bounds but outside the building');
  assert.equal(game.canOccupy(126, 160, 7), false);
  assert.equal(game.canOccupy(138, 160, 7), true);
  assert.equal(game.canOccupy(110, 200, 7), false);
  assert.equal(game.clearSegment({ x: 250, y: 250 }, { x: 140, y: 250 }, 7), true);
  assert.equal(game.clearSegment({ x: 250, y: 250 }, { x: 110, y: 250 }, 7), false);
});

test('synthetic courtyard holes are walkable while their actual inner walls stay solid', () => {
  const building = {
    id: 'synthetic-courtyard', x: 100, y: 100, w: 100, h: 100, target: false, destroyed: false,
    polygon: [[100, 100], [200, 100], [200, 200], [100, 200]],
    holes: [[[130, 130], [170, 130], [170, 170], [130, 170]]],
  };
  const game = new Game({ world: syntheticWorld({ buildings: [building] }) });
  assert.equal(game.canOccupy(150, 150, 7), true);
  assert.equal(game.canOccupy(134, 150, 7), false);
  assert.equal(game.canOccupy(138, 150, 7), true);
  assert.equal(game.canOccupy(120, 150, 7), false);
});

test('synthetic shoreline collision follows an inland bay and checks the whole body, not a fixed south cutoff', () => {
  const land = [[0, 0], [320, 0], [320, 320], [0, 320], [0, 220], [150, 220], [150, 130], [0, 130]];
  const game = new Game({ world: syntheticWorld({ width: 320, height: 320, landPolygons: [land] }) });
  assert.equal(game.canOccupy(50, 180, 7), false, 'The bay is inside world bounds and far above the south edge');
  assert.equal(game.canOccupy(180, 180, 7), true);
  assert.equal(game.canOccupy(153, 180, 7), false, 'A center on land does not permit the body to overhang the water');
  assert.equal(game.canOccupy(158, 180, 7), true);
  assert.equal(game.canOccupy(200, 300, 7), true);
  assert.equal(game.canOccupy(319, 40, 7), false);
  assert.equal(game.clearSegment({ x: 50, y: 180 }, { x: 180, y: 180 }, 7), false);
});

test('synthetic explicit water polygons exclude inland water even inside a surrounding land ring', () => {
  const game = new Game({ world: syntheticWorld({ seaPolygons: [[[30, 40], [90, 40], [90, 100], [30, 100]]] }) });
  assert.equal(game.canOccupy(50, 70, 7), false);
  assert.equal(game.canOccupy(94, 70, 7), false);
  assert.equal(game.canOccupy(100, 70, 7), true);
});

test('synthetic polyline crossings connect only through a shared source node, preserving grade-separated roads', () => {
  const roads = (shared) => [
    { id: 'synthetic-bridge', width: 40, type: 'road', layer: 1, bridge: true, points: [[40, 150], [150, 150], [260, 150]], nodeIds: ['west', shared ? 'junction' : 'bridge-crossing', 'east'] },
    { id: 'synthetic-ground', width: 40, type: 'road', layer: 0, points: [[150, 40], [150, 150], [150, 260]], nodeIds: ['north', shared ? 'junction' : 'ground-crossing', 'south'] },
  ];
  const disconnected = new Game({ world: syntheticWorld({ roads: roads(false) }) });
  assert.deepEqual(disconnected.streetPath({ x: 40, y: 150 }, { x: 150, y: 40 }), []);
  const connected = new Game({ world: syntheticWorld({ roads: roads(true) }) });
  const path = connected.streetPath({ x: 40, y: 150 }, { x: 150, y: 40 });
  assert.ok(path.length > 3);
  assert.deepEqual(path[0], { x: 40, y: 150 });
  assert.deepEqual(path.at(-1), { x: 150, y: 40 });
  near(path.slice(1).reduce((total, p, i) => total + distance(p, path[i]), 0), 220);
  assert.ok(path.every((p) => p.x === 150 || p.y === 150), 'Waypoints follow the supplied street axes');
});

test('synthetic oblique road routing uses real segment lengths and selects the shorter connected route', () => {
  const roads = [
    { id: 'synthetic-bend', width: 40, type: 'road', points: [[40, 100], [140, 200], [240, 100]], nodeIds: ['start', 'bend', 'end'] },
    { id: 'synthetic-shortcut', width: 40, type: 'road', points: [[40, 100], [140, 100], [240, 100]], nodeIds: ['start', 'middle', 'end'] },
  ];
  const game = new Game({ world: syntheticWorld({ roads }) });
  const path = game.streetPath({ x: 40, y: 100 }, { x: 240, y: 100 });
  assert.ok(path.length > 3);
  assert.ok(path.every((p) => p.y === 100));
  near(path.slice(1).reduce((total, p, i) => total + distance(p, path[i]), 0), 200);
});

test('synthetic world starts and replay use their own world dimensions and parked vehicles', () => {
  const world = syntheticWorld({
    width: 300, height: 300,
    landPolygons: [[[0, 0], [300, 0], [300, 300], [0, 300]]],
    starts: { player: { x: 80, y: 80 }, cars: [{ id: 'synthetic-car', x: 80, y: 108, angle: 0, speed: 0, kind: 'parked' }], rendezvous: { x: 80, y: 80, radius: 24 }, patrolSpawns: [] },
  });
  const game = new Game({ world }); game.start(); game.dismissTutorial();
  assert.equal(game.interact(), true);
  assert.equal(game.vehicleId, 'synthetic-car');
  game.update(.05, { x: 1, y: 0 });
  assert.ok(game.vehicle.x > 80);
  game.start();
  near(game.player.x, 80); near(game.player.y, 80);
  assert.equal(game.vehicleId, null);
  assert.equal(game.canOccupy(295, 80, 7), false);
  assert.equal(world.starts.cars[0].x, 80, 'Runtime movement must not mutate the supplied map template');
});

test('synthetic mission explosions test the actual polygon rather than damaging empty concave bounds', () => {
  const polygon = [[100, 100], [300, 100], [300, 130], [130, 130], [130, 300], [100, 300]];
  const game = new Game({ world: syntheticWorld({ buildings: [{ id: 'synthetic-target', name: 'Fixture uniquement', x: 100, y: 100, w: 200, h: 200, polygon, destroyed: false, hp: 1, target: true, approach: { x: 250, y: 250 } }] }) });
  game.start(); game.dismissTutorial(); assert.equal(game.plant(), true);
  // Follow public movement without the old rectangle-only invariant helper.
  for (let i = 0; i < 24; i++) game.update(.05, { x: 1, y: 1 });
  for (let i = 0; i < 40; i++) game.update(.05);
  assert.equal(game.demolished, 0);
  assert.equal(game.score, 0);
  assert.equal(game.hearts, 3);
  assert.equal(game.world.buildings[0].destroyed, false);
});

test('Calvi is the only production world and invalid source geometry never produces a replacement map', () => {
  assert.equal(CALVI_MAP.metadata.city, 'Calvi');
  assert.equal(CALVI_MAP.status, 'ready');
  assert.ok(CALVI_MAP.metadata.sourceUrl && CALVI_MAP.metadata.downloadedAt && CALVI_MAP.metadata.license);
  assert.ok(CALVI_MAP.roads.length > 0 && CALVI_MAP.buildings.length > 0 && CALVI_MAP.landPolygons.length > 0);
  assert.throws(() => createWorld({ map: 'fictional' }), RangeError);
  assert.throws(() => createWorld({ map: 'other' }), RangeError);
  assert.equal(createCalviWorld({ status: 'pending', roads: [], buildings: [] }), null);
  assert.equal(createCalviWorld({ status: 'ready', width: 400, height: 400, roads: [], buildings: [], landPolygons: [] }), null);
  // Simulate an unavailable local extract in memory, then always restore the
  // shipped data before any geographic or public-action validation runs.
  const sourceStatus = CALVI_MAP.status;
  try {
    CALVI_MAP.status = 'pending';
    assert.throws(() => createWorld(), (error) => error.code === 'CALVI_MAP_UNAVAILABLE');
    assert.throws(() => new Game(), (error) => error.code === 'CALVI_MAP_UNAVAILABLE');
  } finally { CALVI_MAP.status = sourceStatus; }
  const world = createWorld();
  assert.equal(world.metadata.city, 'Calvi'); assert.equal(world.mapSource, 'OpenStreetMap');
  assert.equal(world.width, CALVI_MAP.width); assert.equal(world.height, CALVI_MAP.height);
  const game = new Game(); game.start(); game.dismissTutorial();
  assert.equal(game.world.width, WORLD_WIDTH);
  assert.equal(game.world.height, WORLD_HEIGHT);
  assert.equal(game.world.metadata.city, 'Calvi'); assert.equal(game.world.mapSource, 'OpenStreetMap');
  assert.equal(game.world.buildings.filter((b) => b.target).length, 3);
  assert.equal(game.interact(), true);
});

test('the GIS builder supports an explicitly synthetic vector fixture and a genuine first mission', () => {
  const syntheticExtract = {
    status: 'ready', width: 800, height: 600,
    metadata: { city: 'SYNTHETIC TEST FIXTURE', source: null, attribution: 'Synthetic vectors only; no geographic claim.' },
    landPolygons: [[[0, 0], [800, 0], [800, 600], [0, 600], [0, 0]]],
    seaPolygons: [],
    roads: [{ id: 'synthetic-street', name: 'Synthetic axis', type: 'road', width: 50, points: [[40, 300], [760, 300]], nodeIds: ['synthetic-west', 'synthetic-east'] }],
    buildings: [
      { id: 'synthetic-west-house', polygon: [[100, 200], [160, 200], [160, 250], [100, 250], [100, 200]] },
      { id: 'synthetic-middle-house', polygon: [[330, 200], [390, 200], [390, 250], [330, 250], [330, 200]] },
      { id: 'synthetic-east-house', polygon: [[580, 350], [640, 350], [640, 400], [580, 400], [580, 350]] },
    ],
  };
  const world = buildCalviWorld(syntheticExtract);
  assert.ok(world);
  assert.equal(world.visualMeta.dataset.city, 'SYNTHETIC TEST FIXTURE');
  assert.equal(world.buildings.filter((b) => b.target).length, 3);
  assert.ok(world.buildings.every((b) => b.id.startsWith('synthetic-')));
  assert.equal(world.roads[0].nodeIds[0], 'synthetic-west');
  const game = new Game({ world }); game.start(); game.dismissTutorial();
  assert.ok(game.canOccupy(game.player.x, game.player.y));
  for (const car of game.cars) assert.ok(game.canOccupy(car.x, car.y, 18, car.id));
  const first = game.world.buildings.find((b) => b.id === 'synthetic-west-house');
  walk(game, first.approach.x, first.approach.y);
  assert.equal(game.plant(), true);
  walk(game, 200, first.approach.y); waitForBlast(game);
  assert.equal(game.demolished, 1); assert.equal(game.score, 250);
  assert.equal(game.hearts, 3); assert.equal(first.destroyed, true);
  assert.equal(game.world.buildings.filter((b) => b.target && !b.destroyed).length, 2);
  assert.equal(game.polylineNavigation, true);
  assert.ok(game.nav.size > 10);
});

test('a synthetic public-action rule run wins under pursuit and resets all state for replay', (t) => {
  const { game, events } = running();
  playCity(game);
  assert.equal(game.mode, 'result'); assert.equal(game.result.won, true);
  assert.equal(game.result.cause, 'complete'); assert.equal(game.demolished, 3);
  assert.ok(game.elapsed < DURATION); assert.ok(game.hearts > 0);
  assert.ok(game.score > 750); assert.ok(game.heat >= 3 && game.heat <= 6);
  assert.ok(game.police.length >= 3 && game.police.some((p) => !p.dead && p.alert), 'Live pursuit remains while defeated patrols can be replaced');
  assert.ok(distance(game.player, game.rendezvous) <= game.rendezvous.radius);
  assert.deepEqual(events.filter((e) => e.name === 'demolish').map((e) => e.data.id), ['port', 'market', 'village']);
  const heatEvents = events.filter((e) => e.name === 'heat').map((e) => e.data.heat);
  assert.ok(heatEvents.length >= 3 && heatEvents.at(-1) === game.heat && heatEvents.every((heat) => heat >= 0 && heat <= 6));
  assert.ok(events.some((e) => e.name === 'crime' && e.data.type === 'explosion'));
  assert.ok(events.some((e) => e.name === 'reinforcement' && e.data.type === 'roadblock'));
  assert.equal(events.filter((e) => e.name === 'win').length, 1);
  assert.ok(events.some((e) => e.name === 'car' && e.data.entered));
  assert.ok(events.some((e) => e.name === 'car' && !e.data.entered));
  t.diagnostic(`Synthetic rule-fixture public-action escape: ${game.elapsed.toFixed(3)} seconds, ${game.hearts} hearts, ${game.score} points, three missions; no teleportation or mission/health/timer edits.`);
  game.start();
  assert.equal(game.mode, 'playing'); assert.equal(game.tutorial, false);
  assert.equal(game.elapsed, 0); assert.equal(game.score, 0); assert.equal(game.hearts, 3);
  assert.equal(game.demolished, 0); assert.equal(game.heat, 0);
  assert.equal(game.vehicle, null); assert.equal(game.result, null);
  assert.equal(game.objective.type, 'target'); assert.equal(game.objective.id, 'port');
  for (const collection of ['bottles', 'blasts', 'police', 'particles', 'popups', 'blood', 'explosionEffects', 'destructionDust']) assert.equal(game[collection].length, 0);
  assert.equal(game.world.buildings.filter((b) => b.target && !b.destroyed && b.hp === b.maxHp && b.hp > 0).length, 3);
  near(game.player.x, 252); near(game.player.y, 1142);
  assert.equal(game.interact(), true);
});

// Capsule fixtures are synthetic narrow streets. They do not claim to model a
// particular Calvi alley; the real OSM extraction is exercised separately below.

test('a photo-sized car can be stolen and driven through a genuine narrow gap that excludes the original larger body', () => {
  const vehicle = { id: 'aerial-car-fixture', x: 120, y: 250, angle: 0, kind: 'parked', speed: 0, owned: false, collisionRadius: 4, collisionHalfLength: 5 };
  const world = capsuleWorld({ width: 1400, height: 500, landPolygons: [[[0, 0], [1400, 0], [1400, 500], [0, 500]]],
    buildings: [rectangleBuilding('upper-gap-wall', 50, 0, 1300, 245), rectangleBuilding('lower-gap-wall', 50, 255, 1300, 245)],
    starts: { player: { x: 100, y: 250 }, cars: [vehicle], rendezvous: { x: 100, y: 250, radius: 24 }, patrolSpawns: [] } });
  const game = new Game({ world }); game.start({ mode: 'free' }); game.dismissTutorial();
  assert.equal(game.canCarOccupy(120, 250, 0, vehicle.id, { staticOnly: true }), true);
  assert.equal(game.canCarOccupy(120, 250, 0, null, { staticOnly: true }), false);
  assert.equal(game.interact(), true); assert.equal(game.vehicle.stolen, true);
  for (let i = 0; i < 40; i++) game.update(.05, { x: 1, y: 0 });
  assert.ok(game.vehicle.x > 400); assert.equal(game.vehicle.y, 250);
  assert.equal(game.canCarOccupy(game.vehicle.x, game.vehicle.y, Math.PI / 2, vehicle.id), false);
});

test('street routing uses exact parked bodies and detours farther around a larger hull', () => {
  const world = capsuleWorld({ width: 800, height: 600, landPolygons: [[[0, 0], [800, 0], [800, 600], [0, 600]]],
    roads: [{ id: 'fixture-road', width: 40, points: [[50, 300], [400, 300], [750, 300]], nodeIds: ['west', 'middle', 'east'] }],
    starts: { player: { x: 100, y: 300 }, cars: [{ id: 'aerial-car-fixture', x: 400, y: 316, angle: 0, kind: 'parked', speed: 0, collisionRadius: 4, collisionHalfLength: 5 }], rendezvous: { x: 100, y: 300, radius: 24 }, patrolSpawns: [] } });
  const small = new Game({ world });
  const smallPath = small.streetPath({ x: 100, y: 300 }, { x: 700, y: 300 });
  assert.ok(smallPath.length > 2); assert.ok(smallPath.every(point => point.y === 300));
  delete world.starts.cars[0].collisionRadius; delete world.starts.cars[0].collisionHalfLength;
  const classic = new Game({ world });
  const classicPath = classic.streetPath({ x: 100, y: 300 }, { x: 700, y: 300 });
  assert.ok(classicPath.length > 2); assert.ok(classicPath.some(point => point.y !== 300));
  for (let i = 1; i < classicPath.length; i++) assert.ok(classic.clearSegment(classicPath[i - 1], classicPath[i], classic.navRadius, null, false), 'Every detour actually clears the larger parked body');
});

test('local vehicle collisions remain exact when a driven photo car crosses cells and the police fleet changes', () => {
  const world = capsuleWorld({ width: 1600, height: 600, landPolygons: [[[0, 0], [1600, 0], [1600, 600], [0, 600]]], starts: { player: { x: 92, y: 220 }, cars: [{ id: 'photo-moving', x: 110, y: 220, angle: 0, kind: 'parked', speed: 0, collisionRadius: 4, collisionHalfLength: 5, sourceImage: { annotationId: 'fixture-observation' } }], rendezvous: { x: 1500, y: 500 }, patrolSpawns: [] } });
  const game = new Game({ world }); game.start({ mode: 'free' }); game.dismissTutorial();
  assert.equal(game.canOccupy(127, 220, 9), false, 'A hull across a cell edge cannot disappear from a local query');
  assert.equal(game.interact(), true);
  for (let i = 0; i < 90; i++) game.update(FRAME, { x: 1, y: 0 });
  assert.ok(game.vehicle.x > 350, 'Public driving crosses several collision-index cell boundaries');
  assert.equal(game.canOccupy(110, 220, 4), true, 'The original photograph position becomes physically empty after driving');
  assert.equal(game.canOccupy(game.vehicle.x + Math.cos(game.vehicle.angle) * 8, game.vehicle.y + Math.sin(game.vehicle.angle) * 8, 4), false, 'The driven source hull collides in its new cell');
  const officer = { id: 'fixture-new-police-car', x: 1400, y: 350, angle: 0, kind: 'patrol' };
  game.cars.push(officer); assert.equal(game.canOccupy(1400, 350, 4), false);
  officer.x = 1500; assert.equal(game.canOccupy(1400, 350, 4), true); assert.equal(game.canOccupy(1500, 350, 4), false);
  game.cars = game.cars.filter(car => car !== officer); assert.equal(game.canOccupy(1500, 350, 4), true);
});

test('a mapped car fits lengthwise in a narrow street and refuses to rotate through its walls', () => {
  const game = new Game({ world: capsuleWorld({
    buildings: [rectangleBuilding('synthetic-north', 50, 50, 300, 90), rectangleBuilding('synthetic-south', 50, 160, 300, 90)],
    starts: { player: { x: 40, y: 150 }, cars: [{ id: 'synthetic-car', x: 70, y: 150, angle: 0, speed: 0, kind: 'parked' }], rendezvous: { x: 350, y: 350 }, patrolSpawns: [] },
  }) });
  assert.equal(game.canCarOccupy(200, 150, 0), true, 'Sixteen-pixel car width fits a twenty-pixel street');
  assert.equal(game.canCarOccupy(200, 150, Math.PI / 2), false, 'Thirty-pixel car length cannot turn across that street');
  game.start(); game.dismissTutorial(); assert.equal(game.interact(), true);
  for (let i = 0; i < 18; i++) game.update(FRAME, { x: 1, y: 0 });
  assert.ok(game.vehicle.x > 140, 'The corridor is genuinely drivable, not only a placement predicate');
  for (let i = 0; i < 30; i++) {
    game.update(FRAME, { x: 0, y: -1 });
    const c = game.vehicle, extent = 8 + 7 * Math.abs(Math.sin(c.angle));
    assert.ok(c.y - extent >= 140 - 1e-6 && c.y + extent <= 160 + 1e-6, 'Rotation and translation keep the whole car outside both walls');
  }
  assert.ok(Math.abs(game.vehicle.angle) < .4, 'Steering cannot commit the forbidden turn');
});

test('a mapped car reverses without an impossible turn and cannot tunnel through a thin wall', () => {
  const game = new Game({ world: capsuleWorld({
    buildings: [rectangleBuilding('synthetic-thin-wall', 260, 50, 1, 250)],
    starts: { player: { x: 100, y: 128 }, cars: [{ id: 'synthetic-car', x: 100, y: 100, angle: 0, speed: 0, kind: 'parked' }], rendezvous: { x: 350, y: 350 }, patrolSpawns: [] },
  }) });
  game.start(); game.dismissTutorial(); assert.equal(game.interact(), true);
  for (let i = 0; i < 8; i++) game.update(FRAME, { x: -1, y: 0 });
  assert.ok(game.vehicle.x < 90); near(game.vehicle.angle, 0);
  assert.ok(game.vehicle.speed < 0, 'Opposite input produces a lower-speed reverse gear');
  for (let i = 0; i < 80; i++) {
    game.update(FRAME, { x: 1, y: 0 });
    assert.ok(game.vehicle.x + 15 <= 260 + 1e-6, 'A one-pixel wall stops the full capsule even at cruise speed');
  }
  assert.ok(game.vehicle.x > 240 && game.vehicle.speed < 10);
  assert.equal(game.hearts, 3);
  assert.equal(game.interact(), true);
  assert.ok(game.player.x + 4 < 260 && game.canOccupy(game.player.x, game.player.y));
});

test('mapped shoreline and courtyards account for the whole oriented capsule', () => {
  const land = [[0, 0], [320, 0], [320, 320], [0, 320], [0, 220], [150, 220], [150, 130], [0, 130]];
  const game = new Game({ world: capsuleWorld({ width: 320, height: 320, landPolygons: [land] }) });
  assert.equal(game.canCarOccupy(160, 180, 0), false, 'The front or rear cannot overhang an inland bay');
  assert.equal(game.canCarOccupy(160, 180, Math.PI / 2), true, 'The same center is safe when the narrower side faces the shore');
  assert.equal(game.canCarOccupy(200, 310, 0), true);
  assert.equal(game.canCarOccupy(200, 310, Math.PI / 2), false);
  const courtyard = new Game({ world: capsuleWorld({ buildings: [{
    ...rectangleBuilding('synthetic-courtyard', 100, 100, 100, 100),
    holes: [[[125, 125], [175, 125], [175, 175], [125, 175]]],
  }] }) });
  assert.equal(courtyard.canCarOccupy(150, 150, .7), true);
  assert.equal(courtyard.canCarOccupy(165, 150, 0), false);
});

let actualCalviWorld;
function getActualCalviWorld() {
  actualCalviWorld ??= createCalviWorld();
  assert.ok(actualCalviWorld, 'The shipped Calvi dataset must produce its actual playable world');
  return actualCalviWorld;
}

test('the real Calvi extract preserves its source geometry and all three missions connect to the starting street', () => {
  const world = getActualCalviWorld();
  assert.equal(CALVI_MAP.status, 'ready');
  assert.equal(CALVI_MAP.metadata.city, 'Calvi');
  assert.equal(CALVI_MAP.metadata.source, 'OpenStreetMap');
  assert.equal(CALVI_MAP.metadata.license, 'ODbL-1.0');
  assert.match(CALVI_MAP.metadata.sha256, /^[a-f\d]{64}$/);
  assert.ok(Number.isFinite(Date.parse(CALVI_MAP.metadata.downloadedAt)));
  assert.match(CALVI_MAP.metadata.sourceUrl, /^https:\/\/api\.openstreetmap\.org\/api\/0\.6\/map\?bbox=/);
  assert.ok(CALVI_MAP.metadata.bounds.west > 8.7 && CALVI_MAP.metadata.bounds.east < 8.9);
  assert.ok(CALVI_MAP.metadata.bounds.south > 42.5 && CALVI_MAP.metadata.bounds.north < 42.6);
  assert.equal(CALVI_MAP.metadata.pixelsPerMetre, 4);
  assert.ok(CALVI_MAP.roads.length > 200 && CALVI_MAP.buildings.length > 400);
  assert.equal(world.mapSource, 'OpenStreetMap'); assert.equal(world.mapStatus, 'ready');
  const originals = new Map(CALVI_MAP.buildings.map((b) => [b.id, b]));
  for (const b of world.buildings) {
    assert.ok(originals.has(b.id)); assert.deepEqual(b.polygon, originals.get(b.id).polygon);
    assert.deepEqual(b.holes || [], originals.get(b.id).holes || []);
  }
  assert.deepEqual(world.roads.map((r) => ({ id: r.id, points: r.points, nodeIds: r.nodeIds })), CALVI_MAP.roads.map((r) => ({ id: r.id, points: r.points, nodeIds: r.nodeIds })));
  const game = new Game({ world }); game.start(); game.dismissTutorial();
  assert.equal(game.playerRadius, 4); assert.equal(game.navRadius, 10);
  assert.equal(game.world.physics.carShape, 'capsule');
  assert.ok(game.canOccupy(game.player.x, game.player.y));
  assert.ok(distance(game.player, game.cars[0]) <= 32);
  assert.equal(game.interact(), true, 'The actual port starting car is immediately usable');
  const targets = game.world.buildings.filter((b) => b.target);
  assert.equal(targets.length, 3);
  assert.deepEqual(new Set(targets.map((b) => b.missionId)), new Set(['port', 'village', 'market']));
  for (const target of targets) {
    assert.match(target.id, /^osm-building-\d+$/);
    assert.ok(game.canOccupy(target.approach.x, target.approach.y, game.playerRadius, null, { staticOnly: true }));
    assert.ok(game.canCarOccupy(target.parking.x, target.parking.y, target.parkingAngle || 0, game.vehicleId, { staticOnly: true }) || game.canOccupy(target.parking.x, target.parking.y, game.navRadius, game.vehicleId, { staticOnly: true }));
    const route = game.streetPath(game.player, target.parking);
    assert.ok(route.length > 2, `Actual street topology must reach ${target.missionId}`);
    for (let i = 1; i < route.length; i++) assert.ok(game.clearSegment(route[i - 1], route[i]), 'Every source-graph edge has physical clearance');
    assert.ok(game.clearSegment(route.at(-1), target.parking), 'The mission parking position connects physically to its street');
  }
  assert.ok(['port', 'village', 'market'].includes(game.objective.missionId));
});

// Independent point samples along the actual body contour supplement the
// engine predicate: a center on land is not sufficient. Sample the solid
// capsule ends and sides, and check nearby building vertices inside the body.
function containsPoint(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p.y) !== (b[1] > p.y) && p.x < (b[0] - a[0]) * (p.y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function assertMappedBodyClear(game, actor, vehicle = false) {
  const r = vehicle ? actor.collisionRadius || 8 : 4, shaft = vehicle ? actor.collisionHalfLength ?? 7 : 0, a = vehicle ? actor.angle : 0;
  const points = [{ x: actor.x, y: actor.y }];
  for (const along of shaft ? [-shaft, 0, shaft] : [0]) {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) points.push({ x: actor.x + Math.cos(a) * along + Math.cos(angle) * (r - .01), y: actor.y + Math.sin(a) * along + Math.sin(angle) * (r - .01) });
  }
  const buildings = game.world.buildings.filter((b) => !b.destroyed && b.x <= actor.x + 16 && b.x + b.w >= actor.x - 16 && b.y <= actor.y + 16 && b.y + b.h >= actor.y - 16);
  for (const p of points) {
    assert.ok(p.x >= 0 && p.x <= game.world.width && p.y >= 0 && p.y <= game.world.height);
    assert.ok(game.world.landPolygons.some((ring) => containsPoint(p, ring)), 'Body contour must remain on actual mapped land');
    if (!game.world.coastalSeaMask) assert.ok(!game.world.seaPolygons.some((ring) => containsPoint(p, ring)), 'Body contour must stay outside actual mapped water');
    if (game.world.municipalBoundary) assert.ok(game.world.municipalBoundary.polygons.some((region) => containsPoint(p, region.outer) && !region.holes.some((hole) => containsPoint(p, hole))), 'Every body contour sample remains inside the real commune and outside its holes');
    for (const b of buildings) assert.ok(!containsPoint(p, b.polygon) || b.holes?.some((hole) => containsPoint(p, hole)), `Body contour must stay outside ${b.id}`);
  }
  for (const b of buildings) for (const ring of [b.polygon, ...(b.holes || [])]) for (const [x, y] of ring) {
    const along = Math.max(-shaft, Math.min(shaft, (x - actor.x) * Math.cos(a) + (y - actor.y) * Math.sin(a)));
    const dx = x - actor.x - Math.cos(a) * along, dy = y - actor.y - Math.sin(a) * along;
    assert.ok(dx * dx + dy * dy >= (r - .01) ** 2, 'A building corner cannot lie inside the body between contour samples');
  }
  if (vehicle) assert.ok(game.canCarOccupy(actor.x, actor.y, actor.angle, actor.id, { staticOnly: true }));
  else assert.ok(game.canOccupy(actor.x, actor.y, r, null, { staticOnly: true }));
}

// This controller chooses legal paths from the shipped OSM graph and operates
// only update, interact, plant and cycleWeapon. Planning never mutates state;
// aiming and firing at the pursuing patrols uses the same held-fire controls
// exposed by the application.
function playActualCalvi(game, diagnostic = () => {}) {
  function tick(input = { x: 0, y: 0 }) {
    input = defensiveInput(game, input);
    game.update(FRAME, input);
    assertMappedBodyClear(game, game.vehicle || game.player, Boolean(game.vehicle));
    for (const officer of game.police) assertMappedBodyClear(game, officer, true);
  }
  function walkTo(to, { optional = false } = {}) {
    let ticks = 0, stalled = 0;
    while (game.mode === 'playing' && distance(game.player, to) > .3) {
      assert.ok(ticks++ < 400, 'A selected actual foot segment must be traversable');
      const before = { x: game.player.x, y: game.player.y };
      const dx = to.x - game.player.x, dy = to.y - game.player.y, d = Math.hypot(dx, dy), strength = Math.min(1, d / (WALK_SPEED * FRAME));
      tick({ x: dx / d * strength, y: dy / d * strength });
      stalled = distance(before, game.player) < .02 ? stalled + 1 : 0;
      if (optional && (stalled > 8 || !game.canOccupy(to.x, to.y, game.playerRadius))) return false;
    }
    return distance(game.player, to) <= .3;
  }

  function simplify(path) {
    const result = [path[0]]; let at = 0;
    while (at < path.length - 1) {
      let next = at + 1;
      for (let i = at + 2; i < path.length && i < at + 70; i++) if (game.clearSegment(path[at], path[i], game.navRadius, game.vehicleId, false)) next = i;
      result.push(path[next]); at = next;
    }
    return result;
  }
  function driveTo(to) {
    assert.ok(game.vehicle);
    // Plan the route through destructible police barriers, then actually stop
    // and fire until the real collision is cleared before traversing it.
    const futureClearance = new Set([game.vehicleId, ...game.cars.filter((car) => car.lawEnforcement).map((car) => car.id)]);
    const sourcePath = game.streetPath(game.player, to, { ignoreCars: futureClearance });
    assert.ok(sourcePath.length, 'An actual source-connected street path must exist');
    const path = simplify(sourcePath);
    if (game.clearSegment(path.at(-1), to, game.navRadius, game.vehicleId, false)) path.push(to);
    const goalAngle = Math.atan2(path[1].y - game.player.y, path[1].x - game.player.x);
    const deltaGoal = Math.atan2(Math.sin(goalAngle - game.vehicle.angle), Math.cos(goalAngle - game.vehicle.angle));
    if (Math.cos(deltaGoal) < -.7) {
      // Turn in a sufficiently open place; otherwise use the actual reverse
      // gear. Do not force the orientation through a mapped wall.
      let turnFits = true;
      for (let f = 0; f <= 1; f += .025) if (!game.canCarOccupy(game.vehicle.x, game.vehicle.y, game.vehicle.angle + deltaGoal * f, game.vehicle.id)) turnFits = false;
      if (turnFits) {
        const startAngle = game.vehicle.angle;
        for (const a of [startAngle + deltaGoal / 2, goalAngle]) {
          let ticks = 0;
          while (Math.abs(Math.atan2(Math.sin(a - game.vehicle.angle), Math.cos(a - game.vehicle.angle))) > .05 && ticks++ < 40) tick({ x: Math.cos(a) * .03, y: Math.sin(a) * .03 });
        }
        for (let i = 0; i < 3; i++) tick();
      }
    }
    let at = 1, ticks = 0, stalled = 0, last = { ...game.player };
    while (game.mode === 'playing' && (at < path.length || Math.abs(game.vehicle?.speed || 0) > 3)) {
      if (!game.vehicle) { recoverVehicle(); driveTo(to); return; }
      assert.ok(ticks++ < 2200, 'A legal mapped drive must fit the game clock');
      let target = path[Math.min(at, path.length - 1)], d = distance(game.player, target);
      const drivingBody = { radius: game.vehicle.collisionRadius || 8, halfLength: game.vehicle.collisionHalfLength ?? 7 };
      if (at < path.length - 1 && (d < 1 || d < 18 && game.canOccupy(game.player.x, game.player.y, drivingBody.radius + drivingBody.halfLength, futureClearance, { allowPiers: false }) && game.clearBodySegment(game.player, path[at + 1], drivingBody, futureClearance))) { target = path[++at]; d = distance(game.player, target); }
      else if (at === path.length - 1 && d < 2 && Math.abs(game.vehicle.speed) < 5) at++;
      const dx = target.x - game.player.x, dy = target.y - game.player.y, a = Math.atan2(dy, dx);
      let turn = Math.abs(Math.atan2(Math.sin(a - game.vehicle.angle), Math.cos(a - game.vehicle.angle)));
      if (Math.cos(turn) < -.7) turn = Math.PI - turn;
      let strength = at >= path.length - 1 ? Math.min(1, d * 2 / DRIVE_SPEED) : 1;
      if (turn > .4) strength = Math.min(strength, .35);
      if (turn > 1) strength = Math.min(strength, .2);
      if (at < path.length - 1) {
        const next = path[at + 1], nextAngle = Math.atan2(next.y - target.y, next.x - target.x);
        const corner = Math.abs(Math.atan2(Math.sin(nextAngle - a), Math.cos(nextAngle - a)));
        if (corner > .45 && d < 55) strength = Math.min(strength, Math.max(.05, d / 100));
      }
      tick(d > .1 ? { x: dx / d * strength, y: dy / d * strength } : { x: 0, y: 0 });
      if (distance(game.player, last) < .02) stalled++; else stalled = 0;
      assert.ok(stalled <= 80, `The controller cannot silently remain trapped against a wall: ${JSON.stringify({ player: game.player, angle: game.vehicle?.angle, to, at, target, next: path[at + 1], elapsed: game.elapsed })}`); last = { ...game.player };
    }
    for (let i = 0; i < 5 && game.mode === 'playing'; i++) tick();
  }
  function planFootRoute(from, to) {
    if (!game.canOccupy(to.x, to.y, game.playerRadius)) return null;
    if (game.clearSegment(from, to, game.playerRadius, null, false)) return [to];
    const player = from, candidates = [];
    // Small visibility graph round nearby real footprint vertices and parked
    // car corners, because a parked car can occupy the indicated approach.
    for (const b of game.world.buildings) {
      if (b.destroyed || Math.hypot(b.x + b.w / 2 - (player.x + to.x) / 2, b.y + b.h / 2 - (player.y + to.y) / 2) > 250) continue;
      for (const [x, y] of b.polygon) for (const [dx, dy] of [[8, 8], [8, -8], [-8, 8], [-8, -8]]) if (game.canOccupy(x + dx, y + dy, game.playerRadius)) candidates.push({ x: x + dx, y: y + dy });
    }
    for (const c of game.cars.filter((car) => !car.destroyed && !car.pendingRoadblock && distance(car, player) < 350)) for (const along of [-24, 24]) for (const side of [-18, 18]) {
      const p = { x: c.x + Math.cos(c.angle) * along - Math.sin(c.angle) * side, y: c.y + Math.sin(c.angle) * along + Math.cos(c.angle) * side };
      if (game.canOccupy(p.x, p.y, game.playerRadius)) candidates.push(p);
    }
    const points = [{ x: player.x, y: player.y }, to, ...candidates], queue = [{ index: 0, cost: 0 }], costs = new Map([[0, 0]]), parents = new Map();
    while (queue.length) {
      queue.sort((a, b) => a.cost - b.cost); const current = queue.shift();
      if (current.index === 1) break;
      for (let index = 0; index < points.length; index++) {
        const cost = current.cost + distance(points[current.index], points[index]);
        if (index === current.index || cost >= (costs.get(index) ?? Infinity) || !game.clearSegment(points[current.index], points[index], game.playerRadius, null, false)) continue;
        costs.set(index, cost); parents.set(index, current.index); queue.push({ index, cost });
      }
    }
    if (!parents.has(1)) return null;
    const route = [1]; let at = 1;
    while (parents.has(at)) { at = parents.get(at); route.push(at); }
    return route.reverse().slice(1).map((index) => points[index]);
  }
  function footRoute(to, { optional = false } = {}) {
    // Traffic and reinforcements keep moving while walking. Revalidate the
    // physical route instead of committing to a node occupied after planning.
    for (let attempt = 0; attempt < 3 && game.mode === 'playing'; attempt++) {
      const route = planFootRoute(game.player, to);
      if (!route) break;
      let completed = true;
      for (const point of route) {
        if (!walkTo(point, { optional: true })) { completed = false; break; }
        if (game.result?.won) return true;
      }
      if (game.result?.won) return true;
      if (completed && distance(game.player, to) <= .3) return true;
    }
    if (!optional) assert.fail(`A genuine foot route must remain reachable: ${JSON.stringify({ from: game.player, to, elapsed: game.elapsed, hearts: game.hearts })}`);
    return false;
  }

  function recoverVehicle() {
    // A real wreck forces a normal on-foot escape and theft of another car.
    // The available civilian population provides alternatives, not immunity.
    const recoveryFailures = [];
    const candidates = game.cars.filter((car) => !car.destroyed && !car.locked && !car.pendingRoadblock && car.kind !== 'traffic' && distance(car, game.player) < 1000)
      .sort((one, two) => distance(one, game.player) - distance(two, game.player));
    for (const car of candidates) {
      const normal = { x: -Math.sin(car.angle), y: Math.cos(car.angle) }, along = { x: Math.cos(car.angle), y: Math.sin(car.angle) };
      const approaches = [
        ...[-1, 1].map((side) => ({ x: car.x + normal.x * side * 26, y: car.y + normal.y * side * 26 })),
        ...[-1, 1].map((side) => ({ x: car.x + along.x * side * 35, y: car.y + along.y * side * 35 })),
      ].filter((point) => game.canOccupy(point.x, point.y, game.playerRadius) && game.clearSegment(point, car, game.playerRadius, car.id, false))
        .sort((one, two) => distance(one, game.player) - distance(two, game.player));
      for (const approach of approaches) {
        const street = game.streetPath(game.player, approach);
        const stops = [...street, approach], planned = [];
        let previous = { x: game.player.x, y: game.player.y }, reachable = true;
        // Prove every segment including the final door approach before moving.
        // A street endpoint near a car does not prove access to that car.
        for (const stop of stops) {
          const route = planFootRoute(previous, stop);
          if (!route) { recoveryFailures.push({ car: car.id, from: previous, stop }); reachable = false; break; }
          planned.push(...route); previous = stop;
        }
        if (!reachable) continue;
        for (const stop of planned) if (!footRoute(stop, { optional: true })) { reachable = false; break; }
        if (!reachable || car.destroyed || game.mode !== 'playing') continue;
        if (!game.interact()) continue;
        assert.ok(game.vehicle, 'Recovery must actually enter a live replacement car');
        return;
      }
    }
    assert.fail(`The real civilian population must provide a reachable replacement vehicle: ${JSON.stringify({ player: game.player, mode: game.mode, elapsed: game.elapsed, hearts: game.hearts, candidates: candidates.map((car) => ({ id: car.id, x: car.x, y: car.y, destroyed: car.destroyed })), blocked: recoveryFailures.slice(0, 8), nearbyLaw: game.cars.filter((car) => car.lawEnforcement && distance(car, game.player) < 200).map((car) => ({ id: car.id, x: car.x, y: car.y, destroyed: car.destroyed })) })}`);
  }
  assert.equal(game.interact(), true);
  assert.ok(game.cycleWeapon(), 'Select the burst weapon through a public action before driving');
  for (const missionId of ['village', 'market', 'port']) {
    assert.equal(game.mode, 'playing');
    const target = game.world.buildings.find((b) => b.target && b.missionId === missionId);
    // Cars can now be destroyed, so choose a real connected street parking
    // point outside the blast rather than making the original car immortal.
    const parkingChoices = [...game.nav.values()].filter((node) => {
      const d = distance(node, target.approach);
      return d >= 90 && d < 145 && game.canCarOccupy(node.x, node.y, target.parkingAngle || 0, game.vehicleId)
        && game.clearSegment(node, target.approach, game.playerRadius, game.vehicleId, false);
    }).sort((a, b) => {
      const civilianClearance = (node) => Math.min(...game.cars.filter((car) => !car.destroyed && !car.lawEnforcement && car.id !== game.vehicleId).map((car) => distance(car, node)));
      // Prefer a street parking point away from explosive photo parking rows.
      // Both choices still require the same actual foot and driving clearance.
      return civilianClearance(b) - civilianClearance(a) || distance(a, target.parking) - distance(b, target.parking);
    });
    const futureClearance = new Set([game.vehicleId, ...game.cars.filter((car) => car.lawEnforcement).map((car) => car.id)]);
    const safeParking = parkingChoices.find((node) => game.streetPath(game.player, node, { ignoreCars: futureClearance }).length);
    assert.ok(safeParking, 'A source-connected parking point must leave the car outside the bottle radius');
    driveTo(safeParking); const missionCar = game.vehicle;
    diagnostic(`${missionId} parking: ${JSON.stringify({ elapsed: game.elapsed, hearts: game.hearts, x: missionCar.x, y: missionCar.y, hp: missionCar.hp })}`);
    assert.equal(game.interact(), true, 'Each actual mission has a safe car exit');
    const spots = [target.approach];
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) spots.push({ x: target.approach.x + Math.cos(a) * 24, y: target.approach.y + Math.sin(a) * 24 });
    const legalSpots = spots.filter((p) => distance(p, missionCar) >= 85 && game.canOccupy(p.x, p.y, game.playerRadius) && circleHitsPolygon(p.x, p.y, BLAST_RADIUS, target.polygon, target.holes || []));
    legalSpots.sort((a, b) => distance(a, game.player) - distance(b, game.player));
    assert.ok(legalSpots.length); footRoute(legalSpots[0]);
    const escapes = [];
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const to = { x: game.player.x + Math.cos(a) * 85, y: game.player.y + Math.sin(a) * 85 };
      if (game.canOccupy(to.x, to.y, game.playerRadius) && game.clearSegment(game.player, to, game.playerRadius, null, false)) escapes.push(to);
    }
    assert.ok(escapes.length, 'A safe foot escape must exist before placing the prop');
    assert.equal(game.plant(), true);
    escapes.sort((a, b) => distance(a, missionCar) - distance(b, missionCar)); walkTo(escapes[0]);
    let waitTicks = 0;
    while (game.mode === 'playing' && (game.bottles.length || game.blasts.length)) { assert.ok(waitTicks++ < 100); tick(); }
    assert.equal(target.destroyed, true); assert.ok(game.hearts > 0);
    diagnostic(`${missionId} escape: ${JSON.stringify({ elapsed: game.elapsed, hearts: game.hearts, car: missionCar.id, hp: missionCar.hp, destroyed: missionCar.destroyed, cause: missionCar.destructionCause })}`);
    if (missionCar.destroyed) { recoverVehicle(); continue; }
    const car = missionCar, normal = { x: -Math.sin(car.angle), y: Math.cos(car.angle) };
    const reentry = [
      ...[-1, 1].map((side) => ({ x: car.x + normal.x * side * 24, y: car.y + normal.y * side * 24, priority: 0 })),
      ...Array.from({ length: 16 }, (_, i) => ({ x: car.x + Math.cos(i * Math.PI / 8) * 26, y: car.y + Math.sin(i * Math.PI / 8) * 26, priority: 1 })),
    ]
      .filter((p) => game.canOccupy(p.x, p.y, game.playerRadius) && game.clearSegment(p, car, game.playerRadius, car.id, false) && planFootRoute(game.player, p));
    reentry.sort((a, b) => a.priority - b.priority || distance(a, game.player) - distance(b, game.player));
    assert.ok(reentry.length, 'The actual parked body must have a reachable door approach');
    let entered = false;
    for (const approach of reentry) if (footRoute(approach, { optional: true }) && game.interact()) { entered = true; break; }
    if (!entered && car.destroyed && game.mode === 'playing') { recoverVehicle(); entered = Boolean(game.vehicle); }
    assert.equal(entered, true, `Public reentry after ${missionId}: ${JSON.stringify({ player: game.player, car: { x: car.x, y: car.y, hp: car.hp, destroyed: car.destroyed }, mode: game.mode })}`);
  }
  assert.equal(game.objective.type, 'escape'); assert.equal(game.mode, 'playing');
  // The port is a dense real parking area. Extraction permits walking, so
  // leave the live car at its safe mission parking and follow actual clear
  // foot passages rather than forcing a tight driving manoeuvre near the quay.
  assert.equal(game.interact(), true);
  const escapeStreet = game.streetPath(game.player, game.rendezvous, { ignoreCars: null, body: { radius: game.playerRadius, halfLength: 0 } });
  assert.ok(escapeStreet.length, 'The actual port must provide connected foot access to extraction');
  for (const point of [...escapeStreet, game.rendezvous]) {
    if (game.mode !== 'playing') break;
    footRoute(point);
  }
}

test('a real Calvi chain exceeding 64 explosions preserves its nearby initiating fireball and normal damage', () => {
  const events = [], game = new Game({ world: getActualCalviWorld(), onEvent: (name, data) => events.push({ name, data }) });
  game.start({ mode: 'free' }); game.dismissTutorial();
  const car = game.cars.find(vehicle => vehicle.id === 'car-start');
  const opening = { x: game.player.x, y: game.player.y };
  const sourcePositions = new Map(game.cars.filter(vehicle => vehicle.sourceImage).map(vehicle => [vehicle.id, [vehicle.x, vehicle.y, vehicle.angle]]));
  const angle = Math.atan2(car.y - game.player.y, car.x - game.player.x);
  let ticks = 0;
  while (!car.destroyed && game.active() && ticks++ < 1000) game.update(1 / 120, { shootHeld: true, aimAngle: angle });
  assert.equal(car.destructionCause, 'shot'); assert.equal(car.exploded, false); assert.ok(car.burnFuse > 0);
  assert.equal(game.shotsFired, 9); assert.equal(game.hearts, 3);
  game.pause(); const fuse = car.burnFuse;
  for (let i = 0; i < 20; i++) game.update(.05, {});
  assert.equal(car.burnFuse, fuse); assert.equal(car.exploded, false);
  game.resume(); ticks = 0;
  while (!car.exploded && game.active() && ticks++ < 200) game.update(1 / 120, {});
  const explosions = events.filter(event => event.name === 'vehicleExplosion');
  assert.ok(explosions.length > 64, 'The shipped dense photo fleet genuinely exceeds the visual budget in one chain');
  for (const effects of [game.blasts, game.explosionEffects]) {
    assert.ok(effects.length <= 64);
    assert.ok(effects.some(effect => effect.cause === 'secondary' && Math.hypot(effect.x - car.x, effect.y - car.y) < 1e-6 && effect.life > 0), 'The nearby initiating blast survives until its first rendered frame');
  }
  assert.equal(game.hearts, 2); assert.equal(game.mode, 'playing'); assert.equal(car.explosionCause, 'secondary');
  assert.deepEqual({ x: game.player.x, y: game.player.y }, opening);
  for (const vehicle of game.cars.filter(vehicle => sourcePositions.has(vehicle.id))) assert.deepEqual([vehicle.x, vehicle.y, vehicle.angle], sourcePositions.get(vehicle.id), 'Visual prioritisation never moves a photographed actor');
});

test('the real Calvi map supports three public-action missions, armed pursuit and extraction, then replay', (t) => {
  const events = [], world = getActualCalviWorld();
  const game = new Game({ world, onEvent: (name, data) => events.push({ name, data }) });
  const initial = structuredClone({ player: game.player, cars: game.cars });
  game.start(); game.update(FRAME, { x: 1, y: 0 });
  assert.equal(game.elapsed, 0); assert.deepEqual(game.player, initial.player); assert.deepEqual(game.cars, initial.cars);
  game.dismissTutorial(); assert.equal(game.pause(), true); game.update(FRAME, { x: 1, y: 1 });
  assert.equal(game.elapsed, 0); assert.deepEqual(game.cars, initial.cars); game.resume();
  playActualCalvi(game, (message) => t.diagnostic(message));
  assert.equal(game.result.won, true, `Actual Calvi extraction: ${JSON.stringify({ result: game.result, player: game.player, heat: game.heat, cars: game.cars.filter((car) => car.id === 'car-start') })}`); assert.equal(game.result.cause, 'complete');
  assert.equal(game.demolished, 3); assert.ok(game.elapsed < DURATION); assert.ok(game.hearts > 0);
  assert.ok(game.heat >= 3 && game.heat <= 6); assert.ok(game.police.length >= 3); assert.ok(game.police.some((p) => p.alert));
  assert.ok(game.score > 750); assert.ok(distance(game.player, game.rendezvous) <= game.rendezvous.radius);
  assert.deepEqual(events.filter((e) => e.name === 'demolish').map((e) => world.buildings.find((b) => b.id === e.data.id).missionId), ['village', 'market', 'port']);
  const heatEvents = events.filter((e) => e.name === 'heat').map((e) => e.data.heat);
  assert.ok(heatEvents.length >= 3 && heatEvents.at(-1) === game.heat && heatEvents.every((heat) => heat >= 0 && heat <= 6));
  assert.ok(events.some((e) => e.name === 'crime' && e.data.type === 'explosion'));
  assert.ok(events.some((e) => e.name === 'reinforcement' && e.data.type === 'roadblock'));
  assert.equal(events.filter((e) => e.name === 'win').length, 1);
  assert.ok(events.some((e) => e.name === 'kill' && e.data.type === 'police') && game.shotsFired > 0, 'The winning route uses genuine aimed shots against its live pursuers');
  assert.ok(game.world.buildings.every((b) => Number.isFinite(b.maxHp)), 'Every mapped building has finite resistance');
  assert.ok(world.buildings.every((b) => !b.destroyed), 'The supplied geographic template stays intact for replay');
  t.diagnostic(`Actual OSM Calvi public-action escape: ${game.elapsed.toFixed(3)} seconds, ${game.hearts} hearts, ${game.score} points; no teleportation, fabricated route or mission/health/timer edits.`);
  game.start(); assert.equal(game.mode, 'playing'); assert.equal(game.elapsed, 0); assert.equal(game.hearts, 3);
  assert.equal(game.demolished, 0); assert.equal(game.heat, 0); assert.equal(game.score, 0); assert.equal(game.vehicle, null);
  assert.equal(game.police.length, 0); assert.equal(game.bottles.length, 0); assert.equal(game.result, null);
  assert.equal(game.world.buildings.filter((b) => b.target && !b.destroyed).length, 3);
  near(game.player.x, initial.player.x); near(game.player.y, initial.player.y);
  assert.equal(game.interact(), true);
});
