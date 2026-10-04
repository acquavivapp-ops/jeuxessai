import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine.js';
import { reportCrime, spawnPolice, wantedLevel, CRIME_POINTS, POLICE_LIMITS } from '../police.js';
import { damageCar } from '../combat.js';
import { capsuleWorld, rectangleBuilding } from './fixtures/worlds.js';

function scene(overrides = {}) {
  const events = [];
  const world = capsuleWorld({
    width: 2400, height: 1800,
    landPolygons: [[[0, 0], [2400, 0], [2400, 1800], [0, 1800]]],
    roads: [
      { id: 'fixture-east-west', width: 56, drivable: true, points: [[50, 900], [1200, 900], [2350, 900]], nodeIds: ['west', 'cross', 'east'] },
      { id: 'fixture-north-south', width: 56, drivable: true, points: [[1200, 50], [1200, 900], [1200, 1750]], nodeIds: ['north', 'cross', 'south'] },
    ],
    starts: { player: { x: 1200, y: 900, dir: 0 }, cars: [], rendezvous: { x: 1200, y: 900, radius: 24 }, patrolSpawns: [] },
    ...overrides,
  });
  const game = new Game({ world, onEvent: (name, data) => events.push({ name, data }) });
  game.start({ mode: 'free' }); game.dismissTutorial();
  return { game, events };
}
function advance(game, seconds, input = {}) {
  for (let left = seconds; left > 1e-8 && game.active(); left -= .05) game.update(Math.min(.05, left), input);
}
function reachSix(game) {
  for (let i = 0; i < 4; i++) reportCrime(game, 'policeKill', { sourceId: `fixture-victim-${i}` });
  assert.equal(game.wanted.level, 6);
}

test('severity distinguishes a shot, theft, injury, death and a killed officer', () => {
  const levels = {};
  for (const type of Object.keys(CRIME_POINTS)) {
    const { game } = scene();
    assert.equal(reportCrime(game, type, { sourceId: 'fixture-incident' }), true);
    levels[type] = game.wanted.level;
    assert.equal(game.wanted.points, CRIME_POINTS[type]);
    assert.equal(game.heat, wantedLevel(CRIME_POINTS[type]));
    assert.equal(game.wanted.lastCrime, 0);
  }
  assert.ok(levels.shot < levels.vehicleTheft);
  assert.ok(levels.injury < levels.kill && levels.kill <= levels.policeKill);
  const { game } = scene(); reachSix(game);
  assert.equal(game.wanted.points, 200);
  reportCrime(game, 'kill', { sourceId: 'additional-victim' });
  assert.equal(game.wanted.points, 220); assert.equal(game.heat, 6);
});

test('crime bursts and repeated explosion incidents are deduplicated; another victim counts', () => {
  const { game, events } = scene();
  assert.equal(game.shoot({ angle: 0 }), true);
  advance(game, .3); assert.equal(game.shoot({ angle: 0 }), true);
  assert.equal(game.wanted.points, 2, 'A rapid burst is one reported firearm incident');
  reportCrime(game, 'explosion', { incidentId: 'one-blast' });
  const before = game.wanted.points;
  assert.equal(reportCrime(game, 'explosion', { incidentId: 'one-blast' }), false);
  assert.equal(game.wanted.points, before);
  reportCrime(game, 'injury', { sourceId: 'victim-a' });
  assert.equal(reportCrime(game, 'injury', { sourceId: 'victim-a' }), false);
  assert.equal(reportCrime(game, 'injury', { sourceId: 'victim-b' }), true);
  assert.equal(events.filter((e) => e.name === 'crime' && e.data.type === 'shot').length, 1);
});

test('a local patrol arrives on a connected street with warning and cannot damage immediately', () => {
  const { game, events } = scene();
  game.shoot({ angle: 0 });
  advance(game, 1);
  assert.equal(game.police.length, 1);
  const patrol = game.police[0];
  assert.equal(patrol.kind, 'patrol'); assert.ok(patrol.warn > 0);
  assert.ok(game.canCarOccupy(patrol.x, patrol.y, patrol.angle, null, { staticOnly: true }));
  assert.ok(game.streetPath(patrol, game.player).length);
  assert.equal(game.hearts, 3); assert.equal(game.policeProjectiles.length, 0);
  assert.ok(events.some((e) => e.name === 'reinforcement' && e.data.type === 'patrol'));
});

test('roadblocks have a physical warning, block a road, and can be destroyed by normal damage', () => {
  const { game } = scene();
  reportCrime(game, 'kill', { sourceId: 'civilian' });
  // Follow ordinary movement away from the search centre during dispatch.
  advance(game, 7.2, { x: .7, y: .7 });
  assert.equal(game.mode, 'playing');
  const block = game.roadblocks[0]; assert.ok(block && block.warn > 0);
  const car = game.cars.find((c) => block.carIds.includes(c.id));
  assert.equal(car.pendingRoadblock, true);
  assert.equal(game.canCarOccupy(car.x, car.y, car.angle), true, 'The announced car has not materialized yet');
  advance(game, 3.6, { x: .1, y: .1 });
  assert.equal(block.active, true); assert.equal(car.pendingRoadblock, false);
  assert.equal(game.canCarOccupy(car.x, car.y, car.angle), false);
  assert.ok(game.canCarOccupy(car.x, car.y, car.angle, car.id, { staticOnly: true }));
  assert.equal(damageCar(game, car, 310, 'launcher'), true);
  assert.equal(car.destroyed, true);
  assert.equal(game.canCarOccupy(car.x, car.y, car.angle), true);
});

test('high severity dispatches a tracking helicopter, damageable heavy unit and military vehicle within caps', () => {
  const { game, events } = scene(); reachSix(game);
  advance(game, 10.5, { x: .7, y: .7 });
  assert.equal(game.mode, 'playing');
  assert.ok(game.helicopter?.active);
  assert.ok(Number.isFinite(game.helicopter.searchlight.x) && game.helicopter.rotor > 0);
  const heavy = game.police.find((p) => p.kind === 'heavy');
  const military = game.police.find((p) => p.kind === 'military');
  assert.ok(heavy && military);
  for (const p of [heavy, military]) {
    const car = game.cars.find((c) => c.id === p.vehicleId);
    assert.ok(car?.lawEnforcement && Number.isFinite(car.maxHp));
    const previous = car.hp;
    assert.equal(damageCar(game, car, 32, 'shot'), true);
    advance(game, .05); assert.equal(p.hp, previous - 32);
    assert.equal(damageCar(game, car, 1000, 'launcher'), true);
    advance(game, .05); assert.equal(p.dead, true);
  }
  assert.ok(game.police.filter((p) => !p.dead).length <= POLICE_LIMITS.units);
  assert.ok(game.roadblocks.length <= POLICE_LIMITS.roadblocks);
  assert.ok(events.some((e) => e.name === 'reinforcement' && e.data.type === 'military'));
});

test('quiet escape outside police view clears wanted points; a new crime resets the cooling period', () => {
  const { game } = scene({ roads: [] });
  reportCrime(game, 'vehicleTheft', { sourceId: 'fixture-car' });
  advance(game, 13);
  assert.equal(game.wanted.state, 'cooling');
  assert.ok(game.wanted.points < 12 && game.heat < 2);
  reportCrime(game, 'shot');
  assert.equal(game.wanted.state, 'pursuit'); assert.equal(game.wanted.quietTime, 0);
  advance(game, 18);
  assert.equal(game.wanted.points, 0); assert.equal(game.heat, 0); assert.equal(game.wanted.state, 'clear');
});

test('ordinary movement escapes a dispatched local patrol and clears the pursuit without state edits', () => {
  const { game, events } = scene();
  const start = { x: game.player.x, y: game.player.y };
  assert.equal(game.shoot({ angle: Math.PI / 4 }), true);
  advance(game, 15, { x: 1, y: 0 });
  assert.equal(game.mode, 'playing'); assert.equal(game.hearts, 3);
  assert.ok(game.player.x - start.x > 1000);
  assert.ok(events.some((e) => e.name === 'reinforcement' && e.data.type === 'patrol'));
  assert.equal(game.heat, 0); assert.equal(game.wanted.state, 'clear');
  assert.ok(events.some((e) => e.name === 'heat' && e.data.heat === 0));
});

test('police sight maintains a pursuit while actual building cover allows cooling', () => {
  const { game } = scene({ roads: [], buildings: [rectangleBuilding('cover', 1220, 730, 35, 350)] });
  reportCrime(game, 'shot');
  // These two fixed responders form a unit-test sight-line fixture. No public
  // route or mission completion is claimed by assigning their starting state.
  game.police.push({ id: 101, x: 1300, y: 900, angle: 0, hp: 80, maxHp: 80, kind: 'patrol', warn: 0, stun: 0, path: [], pathTimer: 100, fireCooldown: 100 });
  advance(game, 14);
  assert.equal(game.wanted.points, 0, 'The intact wall prevents seeing and firing through cover');
  const { game: exposed } = scene({ roads: [] });
  reportCrime(exposed, 'shot');
  exposed.police.push({ id: 102, x: 1370, y: 900, angle: 0, hp: 80, maxHp: 80, kind: 'patrol', warn: 0, stun: 100, path: [], pathTimer: 100, fireCooldown: 100 });
  advance(exposed, 14);
  assert.equal(exposed.wanted.level, 1); assert.equal(exposed.wanted.state, 'pursuit');
  assert.ok(exposed.wanted.lastSeen > 13);
});

test('armed patrols telegraph real shots, miss a moving target, and never fire through buildings', () => {
  const { game, events } = scene({ roads: [] });
  reportCrime(game, 'vehicleTheft', { sourceId: 'fixture-car' });
  game.police.push({ id: 103, x: 1340, y: 900, angle: Math.PI, hp: 80, maxHp: 80, kind: 'patrol', warn: 0, stun: 0, path: [], pathTimer: 100, fireCooldown: 0 });
  advance(game, .1); assert.ok(game.police[0].fireWindup > 1);
  assert.equal(game.hearts, 3);
  advance(game, 1.8, { x: 0, y: -1 });
  assert.equal(game.hearts, 3, 'Ordinary foot movement dodges the recorded aim point');
  assert.ok(events.some((e) => e.name === 'policeShot'));
  const wall = scene({ roads: [], buildings: [rectangleBuilding('cover', 1250, 750, 35, 300)] });
  reportCrime(wall.game, 'vehicleTheft', { sourceId: 'car' });
  wall.game.police.push({ id: 104, x: 1340, y: 900, angle: Math.PI, hp: 80, maxHp: 80, kind: 'patrol', warn: 0, stun: 0, path: [], pathTimer: 100, fireCooldown: 0 });
  advance(wall.game, 2);
  assert.equal(wall.game.hearts, 3); assert.equal(wall.events.some((e) => e.name === 'policeShot'), false);
  const stationary = scene({ roads: [] });
  reportCrime(stationary.game, 'vehicleTheft', { sourceId: 'car' });
  stationary.game.police.push({ id: 105, x: 1340, y: 900, angle: Math.PI, hp: 80, maxHp: 80, kind: 'patrol', warn: 0, stun: 0, path: [], pathTimer: 100, fireCooldown: 0 });
  advance(stationary.game, 1.9);
  assert.equal(stationary.game.hearts, 2, 'The telegraphed shot actually damages an exposed stationary target');
  assert.ok(stationary.events.some((e) => e.name === 'hurt' && e.data.cause === 'gendarme'));
});

test('pause and tutorial freeze crime reporting, pursuit, projectiles and all reinforcement clocks', () => {
  const { game } = scene(); reachSix(game);
  advance(game, 8, { x: .7, y: .7 });
  assert.equal(game.pause(), true);
  const before = structuredClone({ wanted: game.wanted, police: game.police, roadblocks: game.roadblocks, helicopter: game.helicopter, projectiles: game.policeProjectiles, clocks: game._policeClock });
  game.update(.05, { shootHeld: true });
  assert.equal(reportCrime(game, 'policeKill', { sourceId: 'paused' }), false);
  assert.deepEqual({ wanted: game.wanted, police: game.police, roadblocks: game.roadblocks, helicopter: game.helicopter, projectiles: game.policeProjectiles, clocks: game._policeClock }, before);
  game.resume(); advance(game, .1, { x: .1, y: .1 });
  assert.ok(game.helicopter.rotor > before.helicopter.rotor);
  game.start({ mode: 'free' }); game.tutorial = true;
  assert.equal(reportCrime(game, 'shot'), false); game.update(.05);
  assert.equal(game.elapsed, 0); assert.equal(game.heat, 0); assert.equal(game.police.length, 0);
});

test('municipal exterior and interior holes constrain complete foot and vehicle bodies', () => {
  const outer = [[500, 300], [1900, 300], [1900, 1500], [500, 1500], [500, 300]];
  const hole = [[1600, 1100], [1700, 1100], [1700, 1200], [1600, 1200], [1600, 1100]];
  const { game } = scene({ municipalBoundary: { insee: 'fixture-only', polygons: [{ outer, holes: [hole] }] } });
  assert.equal(game.canOccupy(499, 900), false);
  assert.equal(game.canOccupy(502, 900), false, 'Player centre inside is insufficient when its radius crosses the border');
  assert.equal(game.canCarOccupy(507, 900, Math.PI / 2), false);
  assert.equal(game.canCarOccupy(516, 900, 0), true);
  assert.equal(game.canOccupy(1650, 1150), false);
  assert.equal(game.canOccupy(1598, 1150), false);
  assert.equal(game.canCarOccupy(1590, 1150, 0), false);
  assert.ok([...game.nav.values()].every((p) => p.x > 500 && p.x < 1900 && p.y > 300 && p.y < 1500));
});

test('coastal sea masks preserve real land islands while explicit inland water remains solid', () => {
  const outer = [[500, 300], [1900, 300], [1900, 1500], [500, 1500], [500, 300]];
  const { game } = scene({
    coastalSeaMask: true,
    municipalBoundary: { insee: 'fixture-only', polygons: [{ outer, holes: [] }] },
    landPolygons: [outer], seaPolygons: [[[0, 0], [2400, 0], [2400, 1800], [0, 1800], [0, 0]]],
  });
  assert.equal(game.canOccupy(1200, 900), true);
  assert.equal(game.canCarOccupy(1200, 900, 0), true);
  assert.equal(game.canOccupy(400, 900), false, 'The marine ring does not invent land outside the island');
  const { game: inlandWater } = scene({ roads: [], seaPolygons: [[[1400, 900], [1500, 900], [1500, 1000], [1400, 1000], [1400, 900]]] });
  assert.equal(inlandWater.canOccupy(1450, 950), false);
});

test('a responder on foot walks around a real trunk instead of using a car-sized body or crossing it', () => {
  const { game } = scene({ roads: [], vegetation: [{ id: 'cover-tree', kind: 'tree', x: 1250, y: 900, radius: 12, heightMeters: 8 }] });
  reportCrime(game, 'shot');
  const officer = { id: 201, kind: 'gendarme', onFoot: true, x: 1300, y: 900, angle: Math.PI, hp: 80, maxHp: 80, warn: 0, stun: 0, path: [], pathTimer: 0, fireCooldown: 100 };
  game.police.push(officer);
  let deviation = 0;
  for (let i = 0; i < 38; i++) {
    game.update(.05); deviation = Math.max(deviation, Math.abs(officer.y - 900));
    assert.ok(game.canOccupy(officer.x, officer.y, 5));
  }
  assert.ok(deviation > 5 && officer.x < 1242, 'The foot responder genuinely crosses to the far side around the tree');
});
