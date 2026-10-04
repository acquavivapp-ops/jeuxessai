import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine.js';
import { attachVegetation } from '../vegetation.js';
import { canLandVehicle } from '../mobility.js';
import { capsuleWorld } from './fixtures/worlds.js';

const tree = (x, y, radius = 20) => ({ id: `fixture-tree-${x}-${y}`, kind: 'tree', x, y, radius, heightMeters: 12, color: '#567546' });
function scene(vegetation, overrides = {}) {
  const world = capsuleWorld({ width: 1200, height: 900, landPolygons: [[[0, 0], [1200, 0], [1200, 900], [0, 900]]], vegetation, ...overrides,
    starts: { player: { x: 100, y: 250 }, cars: [], rendezvous: { x: 100, y: 250, radius: 24 }, patrolSpawns: [], ...overrides.starts } });
  const game = new Game({ world }); game.start({ mode: 'free' }); game.dismissTutorial(); return game;
}
function advance(game, seconds, input = {}) {
  for (let left = seconds; left > 1e-8 && game.active(); left -= .05) game.update(Math.min(left, .05), input);
}

test('a foot body collides with a trunk across a cell boundary while its canopy remains walkable', () => {
  const game = scene([tree(128.2, 100, 25)]);
  assert.equal(game.canOccupy(122.6, 100), false, 'The trunk crosses into the neighbouring 128px cell');
  assert.equal(game.canOccupy(120, 100), true, 'A canopy is larger than its small gameplay trunk');
  assert.equal(game.canOccupy(136.5, 100), true);
});

test('normal walking stops at a trunk and can continue around it; scrub is traversable', () => {
  const game = scene([tree(180, 250)]);
  advance(game, 2, { x: 1, y: 0 }); assert.ok(game.player.x < 174 && game.player.x > 168);
  advance(game, .3, { x: 0, y: 1 }); advance(game, 1, { x: 1, y: 0 });
  assert.ok(game.player.x > 240); assert.equal(game.canOccupy(game.player.x, game.player.y), true);
  const scrub = scene([{ ...tree(180, 250, 40), kind: 'scrub', heightMeters: 1.2 }]), clear = scene([]);
  advance(scrub, 2, { x: 1, y: 0 }); advance(clear, 2, { x: 1, y: 0 });
  assert.ok(scrub.player.x > 225, 'Low maquis can genuinely be crossed');
  assert.ok(clear.player.x - scrub.player.x > 25, 'Low maquis does not feel like paved ground');
});

test('the complete oriented car capsule stops at a trunk and can turn past its canopy', () => {
  const game = scene([tree(220, 250)], { starts: { cars: [{ id: 'car-start', x: 120, y: 250, angle: 0, kind: 'parked', speed: 0, owned: true }] } });
  assert.equal(game.canCarOccupy(205, 250, 0, 'car-start'), false);
  assert.equal(game.canCarOccupy(205, 250, Math.PI / 2, 'car-start'), true);
  assert.equal(game.interact(), true); advance(game, 1.5, { x: 1, y: 0 });
  assert.ok(game.vehicle.x < 203 && game.vehicle.x > 197);
  const before = structuredClone(game.vehicle); game.pause(); advance(game, 1, { x: 0, y: 1 }); assert.deepEqual(game.vehicle, before);
  game.resume(); advance(game, 1, { x: 0, y: 1 }); advance(game, 1, { x: 1, y: 0 });
  assert.ok(game.vehicle.x > 260 && game.vehicle.y > 280);
  assert.equal(game.canCarOccupy(game.vehicle.x, game.vehicle.y, game.vehicle.angle, game.vehicle.id), true);
});

test('a trunk stops a ground projectile and blocks the same sight line in both directions', () => {
  const game = scene([tree(150, 250)], { scenery: [{ id: 'fixture-person', kind: 'pedestrian', x: 210, y: 250 }] });
  assert.equal(game.clearSegment({ x: 100, y: 250 }, { x: 210, y: 250 }, 1), false);
  assert.equal(game.clearSegment({ x: 210, y: 250 }, { x: 100, y: 250 }, 1), false);
  assert.equal(game.shoot({ angle: 0 }), true); advance(game, .3);
  assert.equal(game.projectiles.length, 0); assert.equal(game.pedestrians[0].dead, false);
  assert.equal(game.eliminated.pedestrians, 0); assert.equal(game.blood.length, 0);
});

test('a helicopter overflies a trunk but must leave its footprint before landing; an airplane needs a clear approach', () => {
  const helicopter = { id: 'fixture-helicopter', mobilityType: 'helicopter', model: 'helicopter', x: 320, y: 500, angle: 0, kind: 'parked', owned: true };
  const game = scene([tree(450, 500, 30)], { starts: { player: { x: 300, y: 500 }, cars: [helicopter] } });
  assert.equal(game.canVehicleOccupy({ ...helicopter, altitude: 8 }, 450, 500), true);
  assert.equal(game.interact(), true); game.vehicleAction(); advance(game, 4);
  advance(game, 3.27, { x: .2, y: 0 }); advance(game, 1);
  assert.ok(Math.abs(game.vehicle.x - 450) < 10);
  assert.equal(game.canOccupy(game.vehicle.x, game.vehicle.y, 12, game.vehicle.id), false);
  game.vehicleAction(); advance(game, 1); assert.equal(game.vehicle.altitude, 80);
  advance(game, 1.2, { x: -.2, y: 0 }); advance(game, 6);
  assert.equal(game.vehicle.altitude, 0); assert.equal(game.interact(), true);
  const plane = scene([tree(440, 500)], { starts: { player: { x: 300, y: 500 }, cars: [{ ...helicopter, id: 'fixture-plane', mobilityType: 'plane', model: 'plane' }] } });
  assert.equal(plane.canOccupy(320, 500, 18, 'fixture-plane'), true);
  assert.equal(canLandVehicle(plane, plane.cars[0]), false);
});

test('a trunk between a safe quay and a boat blocks boarding instead of allowing a crossing through it', () => {
  const game = scene([tree(418, 450, 8)], { landPolygons: [[[0, 0], [420, 0], [420, 900], [0, 900]]], coastalSeaMask: true,
    starts: { player: { x: 410, y: 450 }, cars: [{ id: 'fixture-boat', mobilityType: 'boat', model: 'boat', x: 445, y: 450, angle: 0, kind: 'parked', boarding: { x: 410, y: 450 }, owned: true }] } });
  assert.equal(game.canOccupy(410, 450), true); assert.equal(game.canBoatOccupy(445, 450, 9, 'fixture-boat'), true);
  assert.equal(game.interact(), false); assert.equal(game.vehicleId, null);
});

test('only matching photographic geography attaches and source-derived placement metadata stays intact', () => {
  const bounds = { west: 8.7, south: 42.5, east: 8.8, north: 42.6 }, source = { tileId: 'fixture-photo', pixelX: 20, pixelY: 30, method: 'explicit test annotation' };
  const data = { metadata: { status: 'ready', boundsWGS84: bounds }, vegetation: [{ id: 'fixture-annotation', type: 'tree', x: 200, y: 300, radius: 20, heightMeters: 12, sourcePlacement: source }] };
  const world = { width: 1200, height: 900, metadata: { city: 'Calvi', bounds } };
  attachVegetation(world, data); assert.equal(world.vegetation.length, 1);
  assert.equal(world.vegetation[0].kind, 'tree'); assert.deepEqual(world.vegetation[0].source, source);
  const wrong = { width: 1200, height: 900, metadata: { city: 'Calvi', bounds: { ...bounds, east: 8.9 } } };
  attachVegetation(wrong, data); assert.equal(wrong.vegetation.length, 0);
});

test('a swept foot body cannot skip a narrow trunk even when both endpoints are free', () => {
  const game = scene([tree(180, 250, 8)]);
  assert.equal(game.canOccupy(160, 250), true); assert.equal(game.canOccupy(200, 250), true);
  assert.equal(game.canMoveGroundCircle({ x: 160, y: 250 }, { x: 200, y: 250 }, 4), false);
  assert.equal(game.clearSegment({ x: 160, y: 250 }, { x: 200, y: 250 }, 1), false);
  assert.equal(game.canMoveGroundCircle({ x: 160, y: 260 }, { x: 200, y: 260 }, 4), true);
});

test('tall scrub blocks its solid base while low maquis stays crossable', () => {
  const game = scene([{ ...tree(180, 250, 18), kind: 'scrub', heightMeters: 2.1 }]);
  advance(game, 2, { x: 1, y: 0 }); assert.ok(game.player.x <= 167);
  advance(game, .4, { x: 0, y: 1 }); advance(game, 1, { x: 1, y: 0 });
  assert.ok(game.player.x > 230); assert.equal(game.canOccupy(game.player.x, game.player.y), true);
});

test('visible illustrated trees collide but hidden legacy accents never become invisible photo obstacles', () => {
  const legacy = [{ id: 'legacy-tree', kind: 'tree', x: 180, y: 250, scale: 1 }];
  const game = scene([], { scenery: legacy }); advance(game, 2, { x: 1, y: 0 }); assert.ok(game.player.x < 175);
  const photo = scene([tree(400, 500)], { scenery: legacy }); advance(photo, 2, { x: 1, y: 0 }); assert.ok(photo.player.x > 275);
});

test('a decorative pedestrian starts clear and follows a genuine route round a trunk, then freezes on pause', () => {
  const scenery = [{ id: 'walker', kind: 'pedestrian', x: 100, y: 250, axis: 'horizontal' }, { id: 'overlapping-walker', kind: 'pedestrian', x: 110, y: 250 }];
  const game = scene([tree(110, 250, 8)], { scenery });
  const walker = game.pedestrians[0];
  assert.ok(game.pedestrians.every(p => game.canOccupy(p.x, p.y, 5)), 'Fictional pedestrians cannot spawn in a real trunk');
  let side = 0, far = 0;
  for (let i = 0; i < 100; i++) {
    game.update(.05); side = Math.max(side, Math.abs(walker.y - 250)); far = Math.max(far, walker.x);
    assert.ok(game.pedestrians.every(p => game.canOccupy(p.x, p.y, 5)), 'No movement sample penetrates a trunk');
  }
  assert.ok(side > 5 && far > 117, 'The walker reaches the other side rather than reversing at the obstacle');
  const before = structuredClone(game.pedestrians); game.pause(); game.update(.05); assert.deepEqual(game.pedestrians, before);
});
