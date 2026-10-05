import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine.js';
import { canLandVehicle, canTransferBoats, mobilityExitPoint } from '../mobility.js';
import { damageCar } from '../combat.js';
import { capsuleWorld, rectangleBuilding } from './fixtures/worlds.js';

function scene(type, overrides = {}) {
  const events = [];
  const vehicle = { id: `fixture-${type}`, mobilityType: type, model: type, kind: 'parked', x: 320, y: 500, angle: 0, speed: 0, owned: true, hp: 260, maxHp: 260, ...overrides.vehicle };
  const world = capsuleWorld({ width: 8000, height: 2000, landPolygons: [[[0, 0], [8000, 0], [8000, 2000], [0, 2000]]], ...overrides.world,
    starts: { player: { x: 300, y: 500 }, cars: [vehicle], rendezvous: { x: 300, y: 500, radius: 24 }, patrolSpawns: [], ...overrides.starts } });
  const game = new Game({ world, onEvent: (name, data) => events.push({ name, data }) });
  game.start({ mode: 'free' }); game.dismissTutorial();
  return { game, events };
}
function advance(game, seconds, input = {}) {
  for (let left = seconds; left > 1e-8 && game.active(); left -= .05) game.update(Math.min(left, .05), input);
}

test('real pier corridors support the complete foot body but cannot become a road or aircraft landing pad', () => {
  const land = [[0, 0], [420, 0], [420, 900], [0, 900]], pier = { id: 'fixture-osm-pier', points: [[410, 450], [650, 450]], width: 10 };
  const { game } = scene('helicopter', { vehicle: { x: 300, y: 300 }, world: { width: 1200, height: 900, landPolygons: [land], coastalSeaMask: true, municipalBoundary: { polygons: [{ outer: land, holes: [] }] }, piers: [pier] }, starts: { player: { x: 400, y: 450 } } });
  advance(game, 1, { x: 1, y: 0 }); assert.ok(game.player.x > 475);
  assert.equal(game.canOccupy(500, 450, 4), true); assert.equal(game.canOccupy(500, 452, 4), false);
  assert.equal(game.canOccupy(500, 450, 4, null, { allowPiers: false }), false);
  assert.equal(game.canVehicleOccupy({ id: 'bike', mobilityType: 'motorcycle', altitude: 0, angle: 0 }, 500, 450), false);
  assert.equal(canLandVehicle(game, { id: 'air', mobilityType: 'helicopter', altitude: 80, angle: 0 }, 500, 450), false);
  assert.equal(game.canBoatOccupy(500, 450), false, 'A deck is a real obstruction to a hull');
  const diagonal = { ...pier, points: [[410, 450], [650, 710]] };
  const angled = scene('helicopter', { vehicle: { x: 300, y: 300 }, world: { width: 1200, height: 900, landPolygons: [land], coastalSeaMask: true, municipalBoundary: { polygons: [{ outer: land, holes: [] }] }, piers: [diagonal] }, starts: { player: { x: 410, y: 450 } } }).game;
  for (let i = 0; i < 30; i++) {
    angled.update(.05, { x: .66, y: .8 });
    assert.ok(angled.canOccupy(angled.player.x, angled.player.y, angled.playerRadius), 'Slightly off-axis stick input cannot put any part of the body off the real deck');
  }
  assert.ok(angled.player.x > 450 && angled.player.y > 495, 'Axis sliding makes genuine progress along the diagonal deck without widening it');
});

test('a long photographic hull boards at its near edge and its complete body must clear the shoreline', () => {
  const land = [[0, 0], [420, 0], [420, 900], [0, 900]];
  const { game } = scene('boat', { vehicle: { x: 480, y: 450, collisionRadius: 6, collisionHalfLength: 35, boarding: { x: 416, y: 450 } }, world: { width: 1200, height: 900, landPolygons: [land], coastalSeaMask: true }, starts: { player: { x: 410, y: 450 } } });
  game.cars.push({ id: 'near-owned-car', x: 400, y: 470, angle: 0, kind: 'parked', speed: 0, owned: true, hp: 260, maxHp: 260 });
  assert.equal(game.canBoatOccupy(480, 450, 6, 'fixture-boat'), true);
  assert.equal(game.canBoatOccupy(455, 450, 6, 'fixture-boat'), false, 'A clear centre cannot hide the bow overlapping land');
  assert.equal(game.interactionTarget()?.id, 'fixture-boat', 'The actual nearby boarding point takes priority over a car farther from its entry'); assert.equal(game.interact(), true);
  assert.equal(game.vehicleId, 'fixture-boat'); assert.equal(game.interact(), true, 'The same actual near-edge quay remains a safe exit');
  assert.equal(game.player.x, 416);
});

test('public steering cannot rotate a long moored hull through the shoreline', () => {
  const land = [[0, 0], [420, 0], [420, 900], [0, 900]];
  const { game } = scene('boat', { vehicle: { x: 444, y: 450, angle: Math.PI / 2, collisionRadius: 6, collisionHalfLength: 35, boarding: { x: 416, y: 450 } }, world: { width: 1200, height: 900, landPolygons: [land], coastalSeaMask: true }, starts: { player: { x: 410, y: 450 } } });
  assert.equal(game.interact(), true);
  assert.equal(game.canVehicleOccupy(game.vehicle, game.vehicle.x, game.vehicle.y, 0), false, 'A read-only orientation query checks the proposed bow instead of the current one');
  for (let i = 0; i < 20; i++) {
    game.update(.05, { x: 1, y: 0, brake: true });
    assert.ok(game.canVehicleOccupy(game.vehicle, game.vehicle.x, game.vehicle.y, game.vehicle.angle), 'Every accepted steering angle keeps the complete long body clear');
  }
  assert.ok(game.vehicle.angle > .9, 'The visually attempted quarter-turn is refused before its bow reaches land');
  assert.equal(game.vehicle.x, 444); assert.equal(game.vehicle.y, 450);
});

test('E transfers only between slow boats with a nearby unobstructed hull gap while ordinary movement removes distant docking access', () => {
  const land = [[0, 0], [420, 0], [420, 900], [0, 900]];
  const one = { id: 'near-boat', mobilityType: 'boat', x: 480, y: 450, angle: 0, collisionRadius: 6, collisionHalfLength: 35, boarding: { x: 416, y: 450 }, owned: true };
  const two = { id: 'other-boat', mobilityType: 'boat', x: 480, y: 486, angle: 0, collisionRadius: 6, collisionHalfLength: 35, owned: false };
  const { game, events } = scene('boat', { world: { width: 1200, height: 900, landPolygons: [land], coastalSeaMask: true }, starts: { player: { x: 410, y: 450 }, cars: [one, two] } });
  assert.equal(game.interact(), true); assert.equal(game.vehicleId, 'near-boat');
  advance(game, 1, { x: 1, y: 0 }); assert.equal(game.interactionTarget(), null, 'Fast sailing cannot allow stepping between hulls');
  advance(game, .4, { brake: true }); assert.equal(game.interactionTarget()?.id, 'other-boat');
  assert.equal(game.interact(), true); assert.equal(game.vehicleId, 'other-boat'); assert.equal(game.vehicle.stolen, true);
  assert.ok(events.some(e => e.name === 'car' && e.data.transferred));
  assert.equal(canTransferBoats(game, game.vehicle, { ...game.vehicle, id: 'distant', x: 900 }), false);
  assert.equal(canTransferBoats(game, game.vehicle, { ...game.vehicle, id: 'fast', y: 510, speed: 30 }), false);
});

test('a photographed airplane uses its entire source body for ground clearance, landing and flight bounds', () => {
  const { game } = scene('plane', { vehicle: { collisionRadius: 7, collisionHalfLength: 30 }, world: { buildings: [rectangleBuilding('bow-obstacle', 350, 490, 25, 20)] } });
  assert.equal(game.canOccupy(320, 500, 7, 'fixture-plane'), true);
  assert.equal(canLandVehicle(game, game.cars[0]), false, 'The real nose cannot enter a building during landing');
  assert.equal(game.canVehicleOccupy({ ...game.cars[0], altitude: 40 }, 7980, 800), false, 'The entire flying body must remain inside the supplied map');
});

test('a motorcycle actually drives through a narrow ground passage, brakes and exits safely', () => {
  const { game } = scene('motorcycle', { world: { buildings: [rectangleBuilding('north', 100, 0, 1400, 493), rectangleBuilding('south', 100, 507, 1400, 1493)] } });
  assert.equal(game.canCarOccupy(320, 500, 0, 'fixture-motorcycle'), false, 'A car cannot fit in the same 14px gap');
  assert.equal(game.interact(), true);
  advance(game, 1, { x: 1, y: 0 });
  assert.ok(game.player.x > 450); assert.equal(game.vehicle.mobilityMode, 'ground');
  assert.equal(game.interact(), false, 'A moving rider must brake before stepping off');
  advance(game, .5, { brake: true });
  assert.ok(Math.abs(game.vehicle.speed) < 1);
  assert.equal(game.interact(), true);
  assert.equal(game.vehicleId, null); assert.equal(game.canOccupy(game.player.x, game.player.y), true);
});

test('a boat boards from a real land-water edge, respects shoreline and returns to land without a sea exit', () => {
  const land = [[0, 0], [420, 0], [420, 900], [0, 900]];
  const { game } = scene('boat', { vehicle: { x: 445, y: 450, boarding: { x: 410, y: 450 } },
    world: { width: 1200, height: 900, landPolygons: [land], seaPolygons: [[[420, 0], [1200, 0], [1200, 900], [420, 900]]], coastalSeaMask: true, municipalBoundary: { polygons: [{ outer: land, holes: [] }] } },
    starts: { player: { x: 408, y: 450 }, rendezvous: { x: 408, y: 450, radius: 24 } } });
  assert.equal(game.canBoatOccupy(445, 450, 9, 'fixture-boat'), true, 'Sea navigation does not require a land administrative polygon');
  assert.equal(game.canBoatOccupy(425, 450, 9, 'fixture-boat'), false, 'The whole hull must clear the true shore');
  assert.equal(game.canBoatOccupy(1195, 450, 9, 'fixture-boat'), false);
  assert.equal(game.interact(), true);
  advance(game, 1.2, { x: 1, y: 0 }); advance(game, .4, { brake: true });
  assert.ok(game.vehicle.x > 540); assert.equal(game.interact(), false);
  const id = game.vehicleId;
  for (let i = 0; i < 240 && game.vehicle.x > 435; i++) game.update(.05, { x: -1, y: 0 });
  advance(game, .5, { brake: true });
  assert.ok(game.vehicle.x >= 429, 'Normal reverse controls cannot cross onto land');
  assert.equal(game.interact(), true);
  assert.equal(game.canOccupy(game.player.x, game.player.y), true);
  assert.equal(game.cars.find((v) => v.id === id).mobilityMode, 'water');
});

test('a helicopter takes off, overflies a solid building, rejects its roof and completes a ground exit after landing', () => {
  const { game } = scene('helicopter', { world: { buildings: [rectangleBuilding('roof', 580, 440, 180, 120)] } });
  assert.equal(game.interact(), true); assert.equal(game.vehicleAction(), true);
  advance(game, 4); assert.equal(game.vehicle.altitude, 80);
  advance(game, 1.9, { x: 1, y: 0 }); advance(game, 1.2);
  assert.ok(game.player.x > 580 && game.player.x < 760);
  assert.equal(game.canOccupy(game.player.x, game.player.y), false);
  assert.equal(mobilityExitPoint(game, game.vehicle), null, 'Flight cannot offer a walking exit or a roof landing');
  assert.equal(game.vehicleAction(), true); advance(game, 1);
  assert.equal(game.vehicle.altitude, 80, 'A building is not an allowed landing pad');
  advance(game, 2.1, { x: -1, y: 0 }); advance(game, 6);
  assert.equal(game.vehicle.altitude, 0); assert.equal(game.vehicle.mobilityMode, 'ground');
  assert.equal(game.interact(), true); assert.equal(game.canOccupy(game.player.x, game.player.y), true);
});

test('a helicopter cannot land over the sea and cannot fly outside the map rectangle', () => {
  const { game } = scene('helicopter', { world: { width: 1500, height: 1000, landPolygons: [[[0, 0], [600, 0], [600, 1000], [0, 1000]]], coastalSeaMask: true } });
  game.interact(); game.vehicleAction(); advance(game, 4);
  advance(game, 2.8, { x: 1, y: 0 }); advance(game, 1.2);
  assert.ok(game.player.x > 700); game.vehicleAction(); advance(game, 5);
  assert.equal(game.vehicle.altitude, 80); assert.equal(mobilityExitPoint(game, game.vehicle), null);
  advance(game, 10, { x: 1, y: 0 });
  assert.ok(game.vehicle.x <= 1488 && game.vehicle.x >= 1485);
  assert.equal(game.hearts, 3);
});

test('an airplane requires a real acceleration run, keeps forward flight, lands through a clear approach and brakes', () => {
  const { game } = scene('plane');
  assert.equal(game.interact(), true);
  advance(game, .5, { x: 1, y: 0 });
  assert.equal(game.vehicle.altitude, 0, 'Ordinary ground taxi does not silently take off');
  assert.equal(game.vehicleAction(), true);
  advance(game, .3, { x: 1, y: 0 }); assert.equal(game.vehicle.altitude, 0, 'An armed airplane still needs takeoff speed');
  advance(game, 5, { x: 1, y: 0 }); assert.equal(game.vehicle.altitude, 95);
  const x = game.player.x; advance(game, 1);
  assert.ok(game.player.x > x + 150, 'Releasing directional input does not stop a flying airplane');
  assert.equal(mobilityExitPoint(game, game.vehicle), null, 'An in-flight jump is distinct from a safe ground exit');
  game.vehicleAction(); advance(game, 8, { x: 1, y: 0 });
  assert.equal(game.vehicle.altitude, 0); assert.equal(game.vehicle.mobilityMode, 'ground');
  advance(game, 1, { brake: true });
  assert.equal(game.interact(), true); assert.equal(game.canOccupy(game.player.x, game.player.y), true);
});

test('a clear landing approach checks buildings and its full length, not just the aircraft centre', () => {
  const { game } = scene('plane', { world: { buildings: [rectangleBuilding('approach-wall', 390, 470, 20, 60)] } });
  assert.equal(game.canOccupy(320, 500, 18, 'fixture-plane'), true);
  assert.equal(canLandVehicle(game, game.cars[0]), false);
  game.interact(); assert.equal(game.vehicleAction(), false);
});

test('an airplane rejects a steep surveyed approach even if its own parking point is flat', () => {
  const row = Array.from({ length: 41 }, (_, column) => Math.max(0, column * 20 - 380) * .3);
  const { game } = scene('plane', { world: { width: 800, height: 1000, landPolygons: [[[0, 0], [800, 0], [800, 1000], [0, 1000]]],
    terrain: { status: 'ready', width: 800, height: 1000, columns: 41, rows: 2, metresPerPixel: 1, values: [...row, ...row] } } });
  assert.equal(game.surfaceSlope(320, 500), 0);
  assert.ok(game.surfaceSlope(440, 500) > .2);
  assert.equal(game.interact(), true); assert.equal(game.vehicleAction(), false);
  assert.equal(game.vehicle.takeoffRequested, false);
});

test('a flying airplane can turn away from the world limit, return and complete a real landing', () => {
  const { game } = scene('plane', { world: { width: 2400, height: 2000, landPolygons: [[[0, 0], [2400, 0], [2400, 2000], [0, 2000]]] } });
  game.interact(); game.vehicleAction(); advance(game, 12, { x: 1, y: 0 });
  assert.equal(game.vehicle.altitude, 95); assert.ok(game.vehicle.x <= 2382);
  const edgeX = game.vehicle.x;
  advance(game, 4, { x: -1, y: 0 });
  assert.ok(game.vehicle.x < edgeX - 150); assert.ok(game.vehicle.speed > 150);
  game.vehicleAction(); advance(game, 7, { x: -1, y: 0 }); advance(game, 1, { brake: true });
  assert.equal(game.vehicle.altitude, 0); assert.equal(game.interact(), true);
  assert.equal(game.canOccupy(game.player.x, game.player.y), true);
});

test('landing at another shoreline updates boarding so the same boat can be entered again', () => {
  const { game } = scene('boat', { vehicle: { x: 445, y: 450, boarding: { x: 410, y: 450 } },
    world: { width: 1800, height: 1800, landPolygons: [[[0, 0], [420, 0], [420, 1800], [0, 1800]]], coastalSeaMask: true },
    starts: { player: { x: 408, y: 450 } } });
  game.interact(); advance(game, 1.8, { x: 0, y: 1 });
  for (let i = 0; i < 120 && game.vehicle.x > 438; i++) game.update(.05, { x: -1, y: 0 });
  advance(game, .5, { brake: true });
  assert.ok(game.vehicle.y > 550);
  const boat = game.vehicle;
  assert.equal(game.interact(), true);
  assert.equal(boat.boarding.x, game.player.x); assert.equal(boat.boarding.y, game.player.y);
  assert.equal(game.interact(), true); assert.equal(game.vehicleId, boat.id);
});

test('ordinary launcher controls destroy a boat safely at shore and produce a crash when no land exit exists', () => {
  for (const offshore of [false, true]) {
    const wall = { ...rectangleBuilding('shore-wall', 395, 430, 10, 40), maxHp: 680 };
    const { game } = scene('boat', { vehicle: { x: 445, y: 450, boarding: { x: 410, y: 450 } },
      world: { width: 1600, height: 900, buildings: [wall], landPolygons: [[[0, 0], [420, 0], [420, 900], [0, 900]]], coastalSeaMask: true }, starts: { player: { x: 410, y: 450 } } });
    assert.equal(game.interact(), true);
    if (offshore) { advance(game, .65, { x: 1, y: 0 }); advance(game, .4, { brake: true }); }
    const boat = game.vehicle;
    game.cycleWeapon(); game.cycleWeapon();
    for (let i = 0; i < 3 && !boat.destroyed; i++) { assert.equal(game.shoot({ angle: Math.PI }), true); advance(game, 1); }
    assert.equal(boat.destroyed, true);
    if (offshore) {
      assert.equal(game.mode, 'result'); assert.equal(game.result.cause, 'crash');
      assert.equal(game.player.x, boat.x, 'A crash never returns the player to an old boarding point');
    } else {
      assert.equal(game.mode, 'playing'); assert.equal(game.vehicleId, null);
      assert.equal(game.canOccupy(game.player.x, game.player.y), true);
    }
  }
});

test('destroying an airborne occupied aircraft produces a crash rather than a foot actor on a roof', () => {
  const { game } = scene('helicopter', { world: { buildings: [rectangleBuilding('roof', 580, 440, 180, 120)] } });
  game.interact(); game.vehicleAction(); advance(game, 4); advance(game, 1.9, { x: 1, y: 0 }); advance(game, 1.2);
  const aircraft = game.vehicle, point = { x: aircraft.x, y: aircraft.y };
  // The damage API isolates destruction itself; the approach and flight above
  // the roof used actual controls, without editing position or vehicle health.
  assert.equal(damageCar(game, aircraft, 310, 'launcher'), true);
  assert.equal(game.result.cause, 'crash'); assert.equal(game.mode, 'result');
  assert.equal(game.vehicleId, null); assert.equal(game.player.x, point.x); assert.equal(game.player.y, point.y);
  assert.equal(game.player.altitude, 80);
});

test('tutorial and pause freeze every mobility action, vertical motion and momentum; replay resets flight', () => {
  for (const type of ['motorcycle', 'boat', 'helicopter', 'plane']) {
    const fixture = type === 'boat' ? { vehicle: { x: 445, y: 500, boarding: { x: 410, y: 500 } }, world: { landPolygons: [[[0, 0], [420, 0], [420, 2000], [0, 2000]]] }, starts: { player: { x: 408, y: 500 } } } : {};
    const { game } = scene(type, fixture);
    game.tutorial = true;
    assert.equal(game.interact(), false); assert.equal(game.vehicleAction(), false);
    advance(game, 1, { x: 1 }); assert.equal(game.elapsed, 0);
    game.dismissTutorial(); assert.equal(game.interact(), true);
    game.vehicleAction(); advance(game, .5, { x: 1, y: 0 });
    const before = structuredClone(game.vehicle), elapsed = game.elapsed;
    game.pause(); assert.equal(game.vehicleAction(), false); assert.equal(game.interact(), false);
    advance(game, 1, { x: 1, y: 0 }); assert.deepEqual(game.vehicle, before); assert.equal(game.elapsed, elapsed);
    game.resume(); advance(game, .5, { x: 1, y: 0 }); assert.ok(game.elapsed > elapsed);
    game.start({ mode: 'free' });
    assert.equal(game.vehicleId, null); assert.equal(game.cars[0].altitude, 0); assert.equal(game.cars[0].takeoffRequested, false);
    assert.equal(game.cars[0].speed, 0);
  }
});
