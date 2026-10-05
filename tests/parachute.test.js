import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine.js';
import { applyExplosion, shoot as combatShoot } from '../combat.js';
import { sampleElevation } from '../terrain.js';
import { capsuleWorld, rectangleBuilding } from './fixtures/worlds.js';

const rectangle = (width, height) => [[0, 0], [width, 0], [width, height], [0, height]];

function scene(type = 'helicopter', { world: worldOverrides = {}, cars = [] } = {}) {
  const aircraft = { id: `fixture-${type}`, mobilityType: type, model: type, kind: 'parked', x: 320, y: 500, angle: 0, speed: 0, owned: true, hp: 260, maxHp: 260 };
  const world = capsuleWorld({ width: 8000, height: 2000, landPolygons: [rectangle(8000, 2000)], ...worldOverrides,
    starts: { player: { x: 300, y: 500 }, cars: [aircraft, ...cars], rendezvous: { x: 300, y: 500, radius: 24 }, patrolSpawns: [] } });
  const events = [];
  const game = new Game({ world, onEvent: (name, data) => events.push({ name, data }) });
  game.start({ mode: 'free' }); game.dismissTutorial();
  return { game, events };
}

function advance(game, seconds, input = {}) {
  for (let left = seconds; left > 1e-8; left -= .05) game.update(Math.min(.05, left), input);
}

function takeoff(game, type = 'helicopter') {
  assert.equal(game.interact(), true);
  assert.equal(game.vehicleAction(), true);
  advance(game, type === 'plane' ? 6 : 4, type === 'plane' ? { x: 1 } : {});
  assert.equal(game.vehicle.altitude, type === 'plane' ? 95 : 80);
  return game.vehicle;
}

function jump(game) {
  const point = { x: game.player.x, y: game.player.y, altitude: game.player.altitude };
  assert.equal(game.interact(), true);
  assert.equal(game.vehicleId, null);
  assert.equal(game.player.airborneMode, 'freefall');
  assert.equal(game.player.altitude, point.altitude);
  assert.equal(game.player.x, point.x); assert.equal(game.player.y, point.y);
  return point;
}

function glideToImpact(game, input = {}) {
  assert.equal(game.deployParachute(), true);
  for (let count = 0; count < 800 && game.active() && game.player.airborneMode; count++) game.update(.05, input);
}

test('E jumps from both real aircraft flights at their current altitude and never opens a parachute automatically', () => {
  for (const type of ['helicopter', 'plane']) {
    const { game } = scene(type);
    takeoff(game, type); const origin = jump(game);
    advance(game, .8, { x: .3 });
    assert.equal(game.player.airborneMode, 'freefall');
    assert.ok(game.player.altitude > 0 && game.player.altitude < origin.altitude);
    assert.ok(game.player.verticalSpeed < 0);
    assert.equal(game.player.parachuteInflation, 0);
  }
});

test('E can jump during takeoff as soon as the aircraft has left the ground', () => {
  const { game } = scene();
  assert.equal(game.interact(), true); assert.equal(game.vehicleAction(), true);
  advance(game, .05);
  assert.ok(game.vehicle.altitude > 0 && game.vehicle.altitude < 8);
  jump(game);
});

test('manual parachute deployment inflates progressively, slows the fall and accepts the vehicle action control', () => {
  for (const control of ['deployParachute', 'vehicleAction']) {
    const { game } = scene(); takeoff(game); jump(game); advance(game, 1);
    const before = game.player.verticalSpeed;
    assert.equal(game[control](), true);
    assert.equal(game.player.airborneMode, 'parachute');
    advance(game, .3);
    assert.ok(game.player.parachuteInflation > 0 && game.player.parachuteInflation < 1);
    assert.ok(game.player.verticalSpeed < 0);
    advance(game, .4);
    assert.equal(game.player.parachuteInflation, 1);
    assert.ok(game.player.verticalSpeed < 0 && game.player.verticalSpeed > before);
    assert.equal(game.deployParachute(), false, 'An open canopy cannot be restarted');
  }
});

test('a deployed parachute steers in both map axes and lands at the actual clear point without teleporting', () => {
  const { game } = scene(); takeoff(game); const origin = jump(game);
  assert.equal(game.deployParachute(), true);
  advance(game, 1.5, { x: 1, y: 1 });
  assert.ok(game.player.x > origin.x + 15 && game.player.y > origin.y + 15);
  advance(game, 1.5);
  let previous;
  for (let count = 0; count < 700 && game.active() && game.player.airborneMode; count++) {
    previous = { x: game.player.x, y: game.player.y };
    game.update(.05);
  }
  assert.equal(game.mode, 'playing'); assert.equal(game.hearts, 3);
  assert.equal(game.player.airborneMode, null); assert.equal(game.player.altitude, 0);
  assert.equal(game.player.verticalSpeed, 0);
  assert.ok(Math.hypot(game.player.x - previous.x, game.player.y - previous.y) < 8, 'Touchdown cannot search for or teleport to a nearby safe point');
  assert.ok(game.player.x > origin.x + 15 && game.player.y > origin.y + 15);
  assert.equal(game.playerRadius, 4); assert.equal(game.canOccupy(game.player.x, game.player.y, 4), true);
  assert.equal(game.deployParachute(), false);
});

test('a parachutist can land on a real narrow pier that could not support the aircraft', () => {
  const land = rectangle(420, 1000);
  const { game } = scene('helicopter', { world: { width: 1200, height: 1000, landPolygons: [land], coastalSeaMask: true,
    municipalBoundary: { polygons: [{ outer: land, holes: [] }] }, piers: [{ id: 'fixture-pier', points: [[410, 500], [700, 500]], width: 10 }] } });
  takeoff(game); advance(game, 1.4, { x: 1 }); advance(game, 1.5);
  assert.ok(game.player.x > 500 && game.player.x < 680);
  assert.equal(game.canOccupy(game.player.x, game.player.y, 4), true);
  assert.equal(game.canOccupy(game.player.x, game.player.y, 12, null, { allowPiers: false }), false);
  const point = jump(game); glideToImpact(game);
  assert.equal(game.mode, 'playing'); assert.equal(game.player.airborneMode, null);
  assert.equal(game.player.altitude, 0); assert.equal(game.hearts, 3);
  assert.ok(Math.abs(game.player.x - point.x) < 1 && Math.abs(game.player.y - point.y) < 1);
  assert.ok(game.player.x > 500, 'Landing on the actual deck cannot return the actor to shore');
});

test('a narrow pier does not accept touchdown when part of the player body is over water', () => {
  const { game } = scene('helicopter', { world: { width: 1200, height: 1000, landPolygons: [rectangle(420, 1000)], coastalSeaMask: true,
    piers: [{ id: 'fixture-pier', points: [[410, 500], [700, 500]], width: 10 }] } });
  takeoff(game); jump(game); assert.equal(game.deployParachute(), true); advance(game, .7);
  // Isolate the final footprint, after entering flight and opening through controls.
  Object.assign(game.player, { x: 550, y: 502, vx: 0, vy: 0, altitude: .02, airborneElevation: .02, verticalSpeed: -5.5 });
  game.update(.05);
  assert.equal(game.mode, 'result'); assert.equal(game.result.cause, 'water');
  assert.equal(game.player.x, 550); assert.equal(game.player.y, 502);
});

test('a full-height fall without a canopy ends the flight with the fall cause', () => {
  const { game } = scene(); takeoff(game); const point = jump(game);
  advance(game, 8);
  assert.equal(game.mode, 'result'); assert.equal(game.result.won, false); assert.equal(game.result.cause, 'fall');
  assert.equal(game.player.x, point.x); assert.equal(game.player.y, point.y); assert.equal(game.player.altitude, 0);
});

test('opening a canopy just above impact cannot erase existing dangerous downward speed', () => {
  const { game } = scene(); takeoff(game); jump(game);
  while (game.active() && game.player.altitude > 1.5) game.update(.01);
  assert.ok(game.player.altitude > 0 && game.player.verticalSpeed < -25);
  assert.equal(game.deployParachute(), true);
  advance(game, .3);
  assert.equal(game.mode, 'result'); assert.equal(game.result.cause, 'fall');
});

test('a short uncontrolled fall hurts once on valid ground without teleporting or ending a healthy run', () => {
  const { game } = scene();
  game.interact(); game.vehicleAction(); advance(game, .4);
  assert.ok(game.vehicle.altitude > 8 && game.vehicle.altitude < 9);
  const point = jump(game); advance(game, 2);
  assert.equal(game.mode, 'playing'); assert.equal(game.hearts, 2); assert.equal(game.lastCause, 'fall');
  assert.equal(game.player.airborneMode, null); assert.equal(game.player.altitude, 0);
  assert.equal(game.player.x, point.x); assert.equal(game.player.y, point.y);
});

test('steering above rising surveyed terrain preserves world height and shortens actual ground clearance', () => {
  const sloped = scene('helicopter', { world: { terrain: { status: 'ready', width: 8000, height: 2000, columns: 2, rows: 2, metresPerPixel: 1, values: [0, 800, 0, 800] } } }).game;
  const flat = scene().game;
  for (const game of [sloped, flat]) { takeoff(game); jump(game); game.deployParachute(); }
  const initialDifference = sloped.player.airborneElevation - flat.player.airborneElevation;
  for (const game of [sloped, flat]) advance(game, 4, { x: 1 });
  assert.equal(sloped.player.x, flat.player.x);
  assert.ok(Math.abs(sloped.player.airborneElevation - flat.player.airborneElevation - initialDifference) < 1e-7);
  assert.ok(sloped.player.altitude < flat.player.altitude - 20, 'Climbing terrain cannot follow the parachutist up or grant additional height');
  assert.ok(Math.abs(sloped.player.airborneElevation - sampleElevation(sloped.world, sloped.player.x, sloped.player.y) - sloped.player.altitude) < 1e-7);
  for (let count = 0; count < 400 && sloped.player.airborneMode; count++) sloped.update(.05, { x: 1 });
  assert.equal(sloped.mode, 'playing'); assert.equal(sloped.player.airborneMode, null); assert.equal(sloped.player.altitude, 0);
  assert.equal(sloped.canOccupy(sloped.player.x, sloped.player.y), true);
});

test('a gentle parachute descent into the sea ends in water at the actual offshore point', () => {
  const { game } = scene('helicopter', { world: { width: 1400, height: 1000, landPolygons: [rectangle(600, 1000)], coastalSeaMask: true } });
  takeoff(game); advance(game, 2.2, { x: 1 }); advance(game, 1.5);
  assert.ok(game.player.x > 700);
  const point = jump(game); glideToImpact(game);
  assert.equal(game.mode, 'result'); assert.equal(game.result.cause, 'water');
  assert.ok(Math.abs(game.player.x - point.x) < 1 && game.player.x > 700);
});

test('descending onto an intact building hits its roof before ground and never searches for a nearby exit', () => {
  const roof = { ...rectangleBuilding('fixture-roof', 550, 440, 300, 120), construction: { height: 24, floors: 8 } };
  const { game } = scene('helicopter', { world: { buildings: [roof] } });
  takeoff(game); advance(game, 1.4, { x: 1 }); advance(game, 1.5);
  assert.ok(game.player.x > 550 && game.player.x < 850);
  const point = jump(game); glideToImpact(game);
  assert.equal(game.mode, 'result'); assert.equal(game.result.cause, 'obstacle');
  assert.ok(game.player.altitude > 0, 'The roof is a collision at its surveyed height');
  assert.ok(Math.abs(game.player.x - point.x) < 1 && Math.abs(game.player.y - point.y) < 1);
});

test('touchdown on land outside the commune ends in boundary at the current location', () => {
  const { game } = scene('helicopter', { world: { municipalBoundary: { polygons: [{ outer: rectangle(600, 2000), holes: [] }] } } });
  takeoff(game); advance(game, 2.2, { x: 1 }); advance(game, 1.5);
  assert.ok(game.player.x > 700);
  const point = jump(game); glideToImpact(game);
  assert.equal(game.mode, 'result'); assert.equal(game.result.cause, 'boundary');
  assert.ok(Math.abs(game.player.x - point.x) < 1 && game.player.x > 700);
});

test('a blocked ground footprint fails landing instead of teleporting out of a parked vehicle', () => {
  const car = { id: 'fixture-ground-car', kind: 'parked', x: 900, y: 500, angle: 0, speed: 0, owned: true };
  const { game } = scene('helicopter', { cars: [car] });
  takeoff(game); jump(game); assert.equal(game.deployParachute(), true); advance(game, .7);
  // Position a gentle final contact specifically on the obstructed ground body.
  Object.assign(game.player, { x: 900, y: 500, vx: 0, vy: 0, altitude: .02, airborneElevation: .02, verticalSpeed: -5.5 });
  game.update(.05);
  assert.equal(game.mode, 'result'); assert.equal(game.result.cause, 'landing');
  assert.equal(game.player.x, 900); assert.equal(game.player.y, 500);
});

test('an airborne actor cannot board, plant or shoot and ground police and blasts cannot hurt them high above', () => {
  const car = { id: 'fixture-near-car', kind: 'parked', x: 320, y: 525, angle: 0, speed: 0, owned: true };
  const { game } = scene('helicopter', { cars: [car] });
  takeoff(game); jump(game);
  for (const deploy of [false, true]) {
    if (deploy) assert.equal(game.deployParachute(), true);
    assert.equal(game.interactionTarget(), null); assert.equal(game.interact(), false);
    assert.equal(game.plant(), false); assert.equal(game.bottles.length, 0);
    assert.equal(game.shoot({ angle: 0 }), false);
    assert.equal(combatShoot(game, { angle: 0 }), false, 'The exported combat API also refuses ground shooting in the air');
    game.cycleWeapon(); game.cycleWeapon();
    assert.equal(game.shoot({ angle: 0 }), false);
    game.hurt('gendarme'); game.hurt('blast', { altitude: 0 });
    applyExplosion(game, game.player.x, game.player.y, 40, 180, 'blast', { hurtPlayer: true, altitude: 0 });
    advance(game, .05, { shootHeld: true });
    assert.equal(game.hearts, 3); assert.equal(game.projectiles.length, 0); assert.equal(game.shotsFired, 0);
  }
});

test('pause, tutorial and result freeze falling, canopy inflation and actions; replay clears all flight state', () => {
  for (const mode of ['paused', 'tutorial', 'result']) {
    const { game } = scene(); takeoff(game); jump(game); assert.equal(game.deployParachute(), true); advance(game, .2);
    if (mode === 'paused') game.pause();
    else if (mode === 'tutorial') game.tutorial = true;
    else game.finish(false, 'fall');
    const player = structuredClone(game.player), aircraft = structuredClone(game.cars[0]), elapsed = game.elapsed;
    assert.equal(game.interact(), false); assert.equal(game.vehicleAction(), false); assert.equal(game.deployParachute(), false);
    advance(game, 1, { x: 1, y: 1 });
    assert.deepEqual(game.player, player); assert.deepEqual(game.cars[0], aircraft); assert.equal(game.elapsed, elapsed);
    game.start({ mode: 'free' }); game.dismissTutorial();
    assert.equal(game.vehicleId, null); assert.equal(game.player.airborneMode, null);
    assert.equal(game.player.altitude, 0); assert.equal(game.player.verticalSpeed, 0); assert.equal(game.player.parachuteInflation, 0);
    assert.equal(game.player.vx, 0); assert.equal(game.player.vy, 0); assert.equal(game.cars[0].altitude, 0);
  }
});

test('abandoned aircraft remain aloft while the plane flies forward and the helicopter decelerates into hover', () => {
  for (const type of ['helicopter', 'plane']) {
    const { game } = scene(type); const aircraft = takeoff(game, type);
    if (type === 'helicopter') advance(game, 1, { x: 1 });
    const before = { x: aircraft.x, y: aircraft.y, altitude: aircraft.altitude, speed: aircraft.speed };
    jump(game); assert.equal(game.deployParachute(), true);
    advance(game, .7, { y: 1 });
    assert.equal(aircraft.altitude, before.altitude);
    assert.ok(game.player.altitude < aircraft.altitude && game.player.altitude > 0);
    assert.equal(game.vehicleId, null);
    if (type === 'plane') {
      assert.ok(aircraft.x > before.x + 100 && aircraft.speed > 100);
      assert.ok(game.player.y > aircraft.y + 5, 'The parachutist steers separately from the abandoned plane');
    } else {
      assert.ok(aircraft.x > before.x && aircraft.speed < before.speed);
      advance(game, 1.2);
      assert.equal(aircraft.speed, 0); assert.equal(aircraft.altitude, 80);
    }
  }
});

test('an abandoned airplane blocked by the map edge cannot issue driving instructions to the parachutist', () => {
  const { game, events } = scene('plane', { world: { width: 2400, landPolygons: [rectangle(2400, 2000)] } });
  takeoff(game, 'plane'); advance(game, 3, { x: 1 });
  assert.ok(game.vehicle.x > 2300);
  jump(game); game.deployParachute();
  const noticeCount = events.filter(event => event.name === 'notice').length;
  advance(game, 9, { x: -1 });
  assert.ok(game.player.x < 2200 && game.player.altitude > 0);
  assert.equal(events.filter(event => event.name === 'notice').length, noticeCount);
  assert.equal(game.crashCooldown, 0, 'The unoccupied aircraft cannot consume the player’s collision cooldown');
});
