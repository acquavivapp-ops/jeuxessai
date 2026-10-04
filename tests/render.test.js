import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraFor, worldToScreen, screenToWorld, buildingProfile, buildingOccludes, renderLighting, imageryMatches, renderCandidates, vehicleVisualLift, photoViewBounds, photographicSeaAt, waterSurfaceContains, foliageProfile, vegetationOccludes, foliageDepth } from '../render.js';
import { CALVI_ELEVATION } from '../data/calvi-elevation.js';
import { CALVI_LIDAR_ELEVATION } from '../data/calvi-lidar-elevation.js';
import { sampleElevation, attachTerrain } from '../terrain.js';
import { CALVI_AERIAL_OBJECTS } from '../data/calvi-aerial-objects.js';
import { photographicVehicleDimensions } from '../neon-art.js';
import { inscribedPhotoHullCapsule } from '../aerial-vehicles.js';

function calviPoint(grid, x, y) {
  // Stable GPS anchors survive a change from the port extract to the commune.
  const longitude = 8.7545 + x / 3443.49 * .0105, latitude = 42.57 - y / 4452.78 * .01;
  return { x: (longitude - grid.bounds.west) / (grid.bounds.east - grid.bounds.west) * grid.width,
    y: (grid.bounds.north - latitude) / (grid.bounds.north - grid.bounds.south) * grid.height };
}
function scene(x = 2084, y = 618, grid = CALVI_LIDAR_ELEVATION) {
  return {
    elapsed: 0, player: calviPoint(grid, x, y),
    world: attachTerrain({ width: grid.width, height: grid.height, metadata: { city: 'Calvi', bounds: grid.bounds } }, grid),
  };
}

test('viewport and ground projection keep the elevated actor centred after a screen resize', () => {
  const game = scene();
  assert.ok(sampleElevation(game.world, game.player.x, game.player.y) > 45);
  for (const canvas of [{ width: 269, height: 582 }, { width: 883, height: 552 }]) {
    const actor = worldToScreen(game, game.player.x, game.player.y, canvas);
    assert.ok(Math.abs(actor.x - canvas.width / 2) < .01);
    assert.ok(Math.abs(actor.y - canvas.height / 2) < .01);
    const camera = cameraFor(game, canvas);
    assert.equal(camera.width, canvas.width);
    assert.equal(camera.height, canvas.height);
    assert.ok(!Object.hasOwn(JSON.parse(JSON.stringify(camera)), 'world'));
  }
});

test('aiming remains reversible on the high municipal terrain and its source grid edges', () => {
  const grid = CALVI_LIDAR_ELEVATION, game = scene();
  const canvas = { width: 1312, height: 820, viewWidth: 656, viewHeight: 410, renderScale: 2 };
  let checked = 0;
  for (let row = 0; row < grid.rows; row += 27) for (let column = 0; column < grid.columns; column += 27) {
    const elevation = grid.values[row * grid.columns + column];
    if (!Number.isFinite(elevation) || elevation < 100) continue;
    game.player = { x: column / (grid.columns - 1) * grid.width, y: row / (grid.rows - 1) * grid.height };
    for (const [dx, dy] of [[0, 0], [80, 40], [-80, -40], [140, 80]]) {
      const target = { x: game.player.x + dx, y: game.player.y + dy };
      const projected = worldToScreen(game, target.x, target.y, canvas);
      const aim = screenToWorld(game, projected.x, projected.y, canvas);
      assert.ok(Math.hypot(aim.x - target.x, aim.y - target.y) < .02, `Mountain aim drifted at ${target.x}, ${target.y}`);
      checked++;
    }
  }
  assert.ok(checked > 100, 'Exercise actual mountainous coverage rather than a flat fixture');
});

test('mouse aiming reverses the real Calvi elevation projection at port, hill and coast', () => {
  const canvas = { width: 883, height: 552 };
  const points = [[744, 2237], [2084, 618], [686, 1113], [970, 2540], [1950, 880], [2250, 480]];
  for (let x = 1200; x <= 2400; x += 150) for (let y = 300; y <= 1600; y += 130) points.push([x, y]);
  for (const grid of [CALVI_LIDAR_ELEVATION, CALVI_ELEVATION]) {
    const game = scene(2084, 618, grid);
    for (const point of points) {
      const { x, y } = calviPoint(grid, ...point);
      const screen = worldToScreen(game, x, y, canvas), aim = screenToWorld(game, screen.x, screen.y, canvas);
      assert.ok(Math.hypot(aim.x - x, aim.y - y) < .02, `${grid.metadata.source}: aiming changed the ground point at ${x}, ${y}`);
    }
  }
});


test('high-density buffers preserve the playable viewport and mouse aiming coordinates', () => {
  const game = scene(), ordinary = { width: 883, height: 552 };
  const dense = { width: 1766, height: 1104, viewWidth: 883, viewHeight: 552, renderScale: 2 };
  const target = calviPoint(CALVI_LIDAR_ELEVATION, 1950, 300);
  const before = worldToScreen(game, target.x, target.y, ordinary), after = worldToScreen(game, target.x, target.y, dense);
  assert.deepEqual(after, before);
  const aim = screenToWorld(game, after.x, after.y, dense);
  assert.ok(Math.hypot(aim.x - target.x, aim.y - target.y) < .02);
  assert.equal(cameraFor(game, dense).width, 883);
  assert.equal(cameraFor(game, dense).height, 552);
});

test('close walking and driving viewports keep logical aim aligned while zoom changes', () => {
  const game = scene();
  for (const [width, height] of [[200, 433], [236, 512], [656, 410], [776, 485]]) {
    const canvas = { width: width * 2, height: height * 2, viewWidth: width, viewHeight: height, renderScale: 2 };
    const actor = worldToScreen(game, game.player.x, game.player.y, canvas);
    assert.ok(Math.abs(actor.x - width / 2) < .01 && Math.abs(actor.y - height / 2) < .01);
    const aim = screenToWorld(game, actor.x, actor.y, canvas);
    assert.ok(Math.hypot(aim.x - game.player.x, aim.y - game.player.y) < .02);
  }
});

test('the flying camera follows physical altitude while ground aiming stays reversible', () => {
  const game = scene();
  game.vehicle = { ...game.player, mobilityType: 'helicopter', altitude: 80, speed: 0, angle: 0 };
  const canvas = { width: 1280, height: 800, viewWidth: 1280 / 1.65, viewHeight: 800 / 1.65, renderScaleX: 1.65, renderScaleY: 1.65 };
  const ground = worldToScreen(game, game.vehicle.x, game.vehicle.y, canvas);
  assert.ok(Math.abs(ground.y - vehicleVisualLift(game.vehicle) - canvas.viewHeight / 2) < .01);
  const aim = screenToWorld(game, ground.x, ground.y, canvas);
  assert.ok(Math.hypot(aim.x - game.vehicle.x, aim.y - game.vehicle.y) < .02);
  assert.equal(vehicleVisualLift({ mobilityType: 'boat', altitude: 80 }), 0, 'Water vehicles never inherit a flying height');
  assert.equal(vehicleVisualLift({ mobilityType: 'plane', altitude: -1 }), 0);
});

test('the visible-entity index preserves large footprints and reads destruction without rebuilding', () => {
  const house = { x: 440, y: 400, w: 120, h: 140 }, distant = { x: 9000, y: 9000, w: 60, h: 70 };
  const lamp = { x: 520, y: 500, kind: 'lamppost' }, movingPedestrian = { x: 520, y: 500, kind: 'pedestrian' };
  const world = { buildings: [house, distant], scenery: [lamp, movingPedestrian] };
  const view = { x: 500, y: 450, w: 100, h: 120 };
  assert.deepEqual(renderCandidates(world, view), [house], 'A footprint crossing index cells must appear once');
  assert.deepEqual(renderCandidates(world, view, 'scenery'), [lamp], 'Moving pedestrians are handled outside the static index');
  house.destroyed = true;
  assert.equal(renderCandidates(world, view)[0].destroyed, true);
});

test('fine imagery requests follow the visible ground rather than a commune-wide mountain margin', () => {
  const game = scene(744, 2237), canvas = { width: 1280, height: 800, viewWidth: 656, viewHeight: 410 };
  const view = photoViewBounds(game, canvas);
  assert.ok(view.w < 700 && view.h < 500, 'The port must not request a thousand-pixel mountain gutter');
  for (const x of [0, 328, 656]) for (const y of [0, 205, 410]) {
    const ground = screenToWorld(game, x, y, canvas);
    assert.ok(ground.x >= view.x && ground.x <= view.x + view.w && ground.y >= view.y && ground.y <= view.y + view.h);
  }
});

test('photographic vegetation and persistent car masks use their own bounded spatial indexes', () => {
  const tree = { x: 515, y: 515, radius: 24, heightMeters: 6, kind: 'tree' }, far = { x: 9000, y: 9000, radius: 10, kind: 'tree' };
  const mask = { vehicleId: 'aerial-car-1', x: 530, y: 540, w: 10, h: 20, persistent: true };
  const world = { vegetation: [tree, far], visualMeta: { aerialVehicleMasks: [mask] } };
  assert.deepEqual(renderCandidates(world, { x: 490, y: 480, w: 12, h: 30 }, 'vegetation'), [tree], 'Raised crowns crossing cells remain visible');
  assert.deepEqual(renderCandidates(world, { x: 500, y: 500, w: 70, h: 70 }, 'masks'), [mask]);
  assert.deepEqual(renderCandidates(world, { x: 500, y: 500, w: 70, h: 70 }, 'masks'), [mask], 'The ground mask is independent of a moving car actor');
  tree.destroyed = true; assert.equal(renderCandidates(world, { x: 500, y: 500, w: 70, h: 70 }, 'vegetation')[0].destroyed, true);
});

test('a real port crown covers ground actors under its native and raised leaves but stays behind an actor in front', () => {
  const palm = CALVI_AERIAL_OBJECTS.vegetation.find(tree => tree.id === 'photo-palm-port-03');
  assert.ok(palm?.canopyPolygon?.length > 3, 'Exercise the photographed Calvi palm rather than an invented obstacle');
  const world = attachTerrain({ width: CALVI_LIDAR_ELEVATION.width, height: CALVI_LIDAR_ELEVATION.height,
    metadata: { city: 'Calvi', bounds: CALVI_LIDAR_ELEVATION.bounds } });
  const native = { x: palm.x, y: palm.y + 8, altitude: 0 };
  const behind = { x: palm.x, y: palm.y - 17, altitude: 0 };
  const front = { x: palm.x, y: palm.y + 40, altitude: 0 };
  assert.equal(vegetationOccludes(palm, native, world), true, 'Photographic leaves at ground-image height still hide the actor');
  assert.equal(vegetationOccludes(palm, behind, world), true, 'The raised crown also hides an actor behind it');
  assert.equal(vegetationOccludes(palm, front, world), false, 'Walking clearly in front stays visible');
  const depth = foliageDepth(palm, world, [native, behind, front]);
  const actorDepth = actor => actor.y - Math.max(0, sampleElevation(world, actor.x, actor.y)) * 1.4;
  assert.ok(depth > actorDepth(native) && depth > actorDepth(behind));
  assert.ok(depth < actorDepth(front));
  native.y = front.y;
  assert.equal(vegetationOccludes(palm, native, world), false, 'A moving actor must leave the cached canopy projection');
  native.y = palm.y + 8;
  assert.equal(vegetationOccludes(palm, native, world), true, 'Walking back under the source crown re-evaluates the moving projection');
  assert.equal(vegetationOccludes(palm, { ...native, altitude: 30 }, world), false, 'An airborne actor above the tree does not inherit ground occlusion');
});

test('low photographed scrub remains at ground level and occludes legs rather than an adult head', () => {
  const scrub = { x: 100, y: 100, radius: 12, heightMeters: 1.2, kind: 'scrub' };
  const profile = foliageProfile(scrub);
  assert.equal(profile.height, 0, 'The ground photographic patch must not float above its foot position');
  assert.equal(profile.legsOnly, true);
  assert.equal(vegetationOccludes(scrub, { x: 106, y: 102 }, {}), true);
  assert.equal(vegetationOccludes(scrub, { x: 88, y: 100, dir: 0 }, {}), false, 'A low bush touching the head but leaving both feet outside must not hide the actor');
  assert.equal(vegetationOccludes(scrub, { x: 150, y: 102 }, {}), false);
  assert.equal(foliageProfile({ ...scrub, kind: 'tree', heightMeters: 5 }).legsOnly, false);
});

test('the manually photographed dark square tree covers its lower native leaves after the lifted crown ends', () => {
  const tree = CALVI_AERIAL_OBJECTS.vegetation.find(tree => tree.id === 'photo-tree-square-19');
  assert.ok(tree?.canopyPolygon?.length > 3 && /^[a-f0-9]{64}$/.test(tree.sourcePlacement?.sha256), 'Use the newly verified dark canopy missed by colour detection');
  const world = attachTerrain({ width: CALVI_LIDAR_ELEVATION.width, height: CALVI_LIDAR_ELEVATION.height,
    metadata: { city: 'Calvi', bounds: CALVI_LIDAR_ELEVATION.bounds } });
  const underLowerLeaves = { x: tree.x, y: tree.y + 25, aimAngle: -Math.PI / 2, altitude: 0 };
  assert.equal(vegetationOccludes(tree, underLowerLeaves, world), true, 'Original photographed leaves below the raised crown must cover the walking actor');
  assert.equal(vegetationOccludes(tree, { ...underLowerLeaves, y: tree.y + 65 }, world), false, 'An actor beyond the real crown returns to the foreground');
});

test('photographic vehicle dimensions follow each physical type without shrinking a legacy car', () => {
  const car = { id: 'car-start', sourceImage: { width: 8, length: 18 }, collisionRadius: 4, collisionHalfLength: 5 };
  assert.deepEqual(photographicVehicleDimensions(car), { width: 8, length: 18, type: 'car' });
  assert.equal(photographicVehicleDimensions({ ...car, collisionRadius: 8, collisionHalfLength: 7 }), null);
  assert.deepEqual(photographicVehicleDimensions({ mobilityType: 'boat', sourceImage: { width: 14, length: 54 }, collisionRadius: 7, collisionHalfLength: 20 }), { width: 14, length: 54, type: 'boat' });
  assert.deepEqual(photographicVehicleDimensions({ mobilityType: 'plane', sourceImage: { width: 46, length: 50 }, collisionRadius: 25, collisionHalfLength: 2 }), { width: 46, length: 50, type: 'plane' }, 'Conservative wing clearance does not enlarge the photographed aircraft silhouette');
  assert.equal(photographicVehicleDimensions({ mobilityType: 'boat', sourceImage: { width: 14, length: 54 }, collisionRadius: 4, collisionHalfLength: 5 }), null, 'An incompatible physical body must not be presented as a normalized photographic craft');
});

test('a verified tapered photo boat retains its exterior dimensions around its smaller inscribed collider', () => {
  const observation = CALVI_AERIAL_OBJECTS.vehicles.find(item => item.mobilityType === 'boat' && item.bodyPolygonWorld?.length >= 3);
  assert.ok(observation, 'Use an observed native boat hull rather than a bounding-box fixture');
  const shape = inscribedPhotoHullCapsule(observation);
  assert.ok(shape && shape.radius * 2 < observation.width && (shape.radius + shape.halfLength) * 2 < observation.length);
  const boat = { mobilityType: 'boat', collisionRadius: shape.radius, collisionHalfLength: shape.halfLength,
    collisionShape: shape, sourceImage: { ...observation.sourcePlacement, annotationId: observation.id, width: observation.width, length: observation.length } };
  const expected = { width: observation.width, length: observation.length, type: 'boat' };
  assert.deepEqual(photographicVehicleDimensions(boat), expected, 'Render the exterior hull without enlarging its inscribed collision capsule');
  assert.equal(photographicVehicleDimensions({ ...boat, collisionShape: undefined }), null, 'A smaller arbitrary collider is not a verified inscribed hull');
  assert.equal(photographicVehicleDimensions({ ...boat, collisionRadius: shape.radius / 2 }), null, 'The provenance must describe the actual physical collider');
  assert.equal(photographicVehicleDimensions({ ...boat, sourceImage: { ...boat.sourceImage, sha256: '' } }), null);
});

test('sea animation respects actual shore rings and excludes land even inside a sea bounding box', () => {
  const world = { landPolygons: [[[20, 20], [80, 20], [80, 90], [20, 90]]], seaPolygons: [[[0, 0], [100, 0], [100, 100], [0, 100]]] };
  assert.equal(photographicSeaAt(world, 10, 50), true);
  assert.equal(photographicSeaAt(world, 50, 50), false);
  assert.equal(photographicSeaAt(world, 110, 50), false);
  assert.equal(photographicSeaAt(world, 50, 10), true);
});

test('photographic water bits refuse white fine cells even when a coarse blue cell covers them', () => {
  const bounds = { west: 8.7, south: 42.5, east: 8.8, north: 42.6 };
  const world = { width: 2048, height: 1024, metadata: { city: 'Calvi', bounds } };
  const surface = { status: 'ready', metadata: { worldWidth: 2048, worldHeight: 1024, boundsWGS84: bounds }, tiles: [
    { lod: 0, boundsWorld: { x: 0, y: 0, w: 2048, h: 1024 }, columns: 2, rows: 2, bitsHex: 'f0' },
    { lod: 1, boundsWorld: { x: 0, y: 0, w: 1024, h: 1024 }, columns: 2, rows: 2, bitsHex: '90' },
  ] };
  assert.equal(waterSurfaceContains(world, 100, 100, surface), true);
  assert.equal(waterSurfaceContains(world, 700, 100, surface), false, 'A white boat cell must not inherit coarse water permission');
  assert.equal(waterSurfaceContains(world, 700, 700, surface), true, 'MSB-first row-major bits preserve the bottom-right blue cell');
  assert.equal(waterSurfaceContains(world, 1500, 700, surface), true, 'Base data still serves places outside the fine region');
  assert.equal(waterSurfaceContains(world, 2500, 700, surface), false);
  assert.equal(waterSurfaceContains({ ...world, width: 4000 }, 100, 100, surface), false, 'Classification belongs to the exact photographic extent');
});

test('daylight controls artificial lights and solar shadows through the frozen simulation clock', () => {
  const day = renderLighting({ elapsed: 0, startClockMinutes: 720 });
  const night = renderLighting({ elapsed: 0, startClockMinutes: 0 });
  assert.ok(day.daylight > .99 && day.lamps < .01);
  assert.ok(night.daylight < .01 && night.lamps > .99);
  assert.notEqual(day.shadowX, night.shadowX);
  const morning = renderLighting({ elapsed: 0, startClockMinutes: 480 });
  const evening = renderLighting({ elapsed: 0, startClockMinutes: 1080 });
  assert.ok(morning.shadowX < 0 && evening.shadowX > 0, 'Solar shadows change direction over the day');
  const game = { elapsed: 30, startClockMinutes: 1110, mode: 'paused' };
  const twilight = renderLighting(game);
  assert.ok(twilight.lamps > 0 && twilight.lamps < 1);
  assert.deepEqual(renderLighting(game), twilight, 'Pause must freeze lighting and its shadow positions');
});

test('an orthophoto is drawn only on its matching geographic extent, at any verified image size', () => {
  const bounds = { west: 8.7545, south: 42.56, east: 8.765, north: 42.57 };
  const world = { width: 3443.49, height: 4452.78, metadata: { city: 'Calvi', bounds } };
  const photo = { status: 'ready', image: { width: 4096, height: 3550 }, boundsWGS84: { ...bounds }, georeferencing: { worldWidth: world.width, worldHeight: world.height } };
  assert.equal(imageryMatches(world, photo), true);
  assert.equal(imageryMatches({ ...world, width: world.width * 8 }, photo), false);
  assert.equal(imageryMatches({ ...world, metadata: { city: 'Calvi', bounds: { ...bounds, west: 8.7 } } }, photo), false);
  assert.equal(imageryMatches(world, { ...photo, georeferencing: {} }), false);
  assert.equal(imageryMatches(world, { ...photo, status: 'pending' }), false);
});

test('building volumes use available height tags and distinguish artistic fallback floors', () => {
  const house = { x: 100, y: 100, w: 80, h: 90, kind: 'house' };
  const art = buildingProfile(house);
  assert.equal(art.source, 'original game art');
  assert.ok(art.height >= 34 && art.height <= 48);
  const levels = buildingProfile({ ...house, construction: { floors: 4 } });
  assert.equal(levels.floors, 4); assert.equal(levels.height, 62); assert.equal(levels.source, 'OSM tags');
  const measured = buildingProfile({ ...house, construction: { height: 12 } });
  assert.equal(measured.height, 48); assert.equal(measured.source, 'OSM tags');
  const imperial = buildingProfile({ ...house, osmTags: { height: '10 feet' }, construction: { height: 10 } });
  assert.deepEqual(imperial, art, 'An unsupported height unit must not be treated as metres');
  const source = buildingProfile({ ...house, osmTags: { height: '10 feet' }, sourceHeight: { heightMeters: 18, source: 'IGN BD TOPO' } });
  assert.equal(source.height, 72); assert.equal(source.source, 'IGN BD TOPO');
  assert.equal(source.floors, 5, 'Decorative window rows follow sourced height when floor tags are absent');
  const lowSource = buildingProfile({ ...house, sourceHeight: { heightMeters: 1.6, source: 'IGN BD TOPO' } });
  assert.equal(lowSource.height, 6.4, 'A sourced low building must not be raised to the artistic minimum height');
  assert.ok(buildingProfile({ ...house, kind: 'depot' }).height < art.height);
});

test('roof occlusion identifies an outdoor actor behind the raised footprint', () => {
  const house = { x: 100, y: 100, w: 100, h: 100, visualHeight: 48 };
  assert.equal(buildingOccludes(house, { x: 160, y: 75 }), true);
  assert.equal(buildingOccludes(house, { x: 250, y: 75 }), false);
  assert.equal(buildingOccludes(house, { x: 160, y: 160 }), false);
  assert.equal(buildingOccludes({ ...house, destroyed: true }, { x: 160, y: 75 }), false);
});
