import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalviWorld } from '../calvi-world.js';
import { Game, WALK_SPEED, distanceToSegmentSquared, segmentDistanceSquared, pointInPolygon } from '../engine.js';
import { calviPoint, districtFor } from '../universe.js';
import { MOBILITY } from '../mobility.js';
import { createMobilityVehicles } from '../mobility-spawns.js';
import { createAerialVehicles, inscribedPhotoHullCapsule } from '../aerial-vehicles.js';
import { CALVI_AERIAL_OBJECTS } from '../data/calvi-aerial-objects.js';

const world = createCalviWorld();
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const driveRoads = world.roads.filter((road) => !road.pedestrian && road.type !== 'steps' && Number(road.layer || 0) === 0 && road.tunnel !== 'yes');
const game = new Game({ world });
const roadCars = run => run.cars.filter(car => !car.mobilityType && !car.id.startsWith('aerial-car-'));
const bodyAxis = (car) => {
  const halfLength = car.collisionHalfLength ?? 7;
  return [[car.x - Math.cos(car.angle) * halfLength, car.y - Math.sin(car.angle) * halfLength], [car.x + Math.cos(car.angle) * halfLength, car.y + Math.sin(car.angle) * halfLength]];
};

// Planning uses only runtime collision queries. The replay below still walks
// with normal input; no planned position is ever assigned to the player.
function planPhysicalWalk(run, to, { step = 2, margin = .4, reach = 400, maxVisited = 100000, origin = run.player } = {}) {
  const from = { x: origin.x, y: origin.y }, radius = run.playerRadius + margin;
  if (!run.canOccupy(from.x, from.y, run.playerRadius) || !run.canOccupy(to.x, to.y, run.playerRadius)) return [];
  const key = (x, y) => `${x},${y}`, point = (ix, iy) => ({ x: from.x + ix * step, y: from.y + iy * step });
  const root = { ix: 0, iy: 0, g: 0, f: distance(from, to), parent: null };
  const open = [root], costs = new Map([[key(0, 0), 0]]), free = new Map();
  for (let visited = 0; open.length && visited < maxVisited; visited++) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[best].f) best = i;
    const node = open.splice(best, 1)[0], p = point(node.ix, node.iy);
    if (node.g !== costs.get(key(node.ix, node.iy))) continue;
    if (distance(p, to) <= 12 && run.clearSegment(p, to, run.playerRadius, null, false)) {
      const raw = [];
      for (let previous = node; previous; previous = previous.parent) raw.push(point(previous.ix, previous.iy));
      raw.reverse();
      const path = [raw[0]];
      for (let i = 0; i < raw.length - 1;) {
        let far = i + 1;
        for (let j = i + 2; j < raw.length; j++) if (run.clearSegment(raw[i], raw[j], radius, null, false)) far = j;
        path.push(raw[far]); i = far;
      }
      path.push({ ...to }); return path;
    }
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const ix = node.ix + dx, iy = node.iy + dy;
      if (Math.abs(ix * step) > reach || Math.abs(iy * step) > reach) continue;
      const k = key(ix, iy), next = point(ix, iy);
      let clear = free.get(k);
      if (clear === undefined) { clear = run.canOccupy(next.x, next.y, radius); free.set(k, clear); }
      if (!clear || !run.clearSegment(p, next, radius, null, false)) continue;
      const g = node.g + step * Math.hypot(dx, dy);
      if (g >= (costs.get(k) ?? Infinity)) continue;
      costs.set(k, g); open.push({ ix, iy, g, f: g + distance(next, to), parent: node });
    }
  }
  return [];
}

test('Calvi has accessible alternative cars and every spawned vehicle fits its physical body', () => {
  const parked = roadCars(game).filter(car => car.kind === 'parked').length;
  const traffic = roadCars(game).filter(car => car.kind === 'traffic').length;
  assert.ok(parked >= 21 && parked <= 32, 'A municipal map stays populated without scaling vehicles with its area');
  assert.ok(traffic >= 4 && traffic <= 6, 'Traffic remains deliberately bounded');
  assert.equal(game.cars[0].id, 'car-start');
  assert.equal(game.cars[0].owned, true);
  assert.ok(roadCars(game).filter((car) => !car.owned && distance(car, game.player) < WALK_SPEED * 3).length >= 3, 'The opening port offers three cars within three walking seconds of distance');
  for (const car of roadCars(game)) {
    assert.ok(game.canCarOccupy(car.x, car.y, car.angle, car.id), `${car.id} must be clear of mapped land, water, buildings and every other car`);
    assert.ok(car.hp >= 260 && car.maxHp >= 260);
    if (car.id !== 'car-start') assert.equal(car.owned, false);
  }
});

test('parked vehicles preserve continuous clear corridors on the original Calvi street geometry', () => {
  const parked = roadCars(game).filter((car) => car.kind === 'parked' && car.id !== 'car-start');
  const reserved = [game.player, game.rendezvous, ...game.world.buildings.filter((b) => b.target).flatMap((b) => [b.approach, b.parking])];
  for (const car of parked) {
    const axis = bodyAxis(car);
    for (const road of driveRoads) for (let i = 1; i < road.points.length; i++) {
      assert.ok(segmentDistanceSquared(axis[0], axis[1], road.points[i - 1], road.points[i]) >= 30 ** 2 - 1e-7, `${car.id} cannot block any source road or adjoining intersection`);
    }
    for (const p of reserved) assert.ok(distance(car, p) >= 80, 'Mission approaches, mission parking and the departure remain open');
  }
  game.start(); game.dismissTutorial();
  assert.equal(game.interact(), true);
  for (const mission of game.world.buildings.filter((b) => b.target)) {
    assert.ok(game.streetPath(game.player, mission.parking).length > 2, `The real source graph still reaches ${mission.missionId} with every initial vehicle present`);
  }
});

test('each parked car has a connected street access and an unobstructed exit on foot', () => {
  // Traffic can temporarily stop a narrow street; isolate permanent parked
  // geometry here rather than treating a moving actor as a missing OSM link.
  const parkedWorld = { ...world, starts: { ...world.starts, cars: world.starts.cars.filter((car) => car.kind === 'parked') } };
  const parkedGame = new Game({ world: parkedWorld });
  parkedGame.start(); parkedGame.dismissTutorial(); assert.equal(parkedGame.interact(), true);
  for (const car of roadCars(parkedGame).filter((car) => car.id !== 'car-start')) {
    assert.ok(driveRoads.some((road) => road.id === car.sourceRoadId));
    assert.ok(parkedGame.streetPath(parkedGame.player, car.access).length > 1, `${car.id} remains in the actual starting street component`);
    const source = driveRoads.find((road) => road.id === car.sourceRoadId);
    assert.ok(source.points.slice(1).some((b, i) => distanceToSegmentSquared(car.access.x, car.access.y, source.points[i], b) < 1e-7));
    const normal = { x: -Math.sin(car.angle), y: Math.cos(car.angle) };
    assert.ok([1, -1].some((side) => parkedGame.canOccupy(car.x + normal.x * side * 28, car.y + normal.y * side * 28)), `${car.id} must permit getting out after entry`);
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) {
      assert.ok(parkedGame.canCarOccupy(car.x, car.y, angle, car.id, { staticOnly: true }), 'A stolen parked car needs room to turn');
      assert.ok(parkedGame.canCarOccupy(car.access.x, car.access.y, angle, car.id, { staticOnly: true }), 'The street access needs room to turn into its actual lane');
    }
  }
});

test('traffic routes follow existing OSM polylines and preserve actual building and coastline clearance', () => {
  for (const car of game.cars.filter((car) => car.kind === 'traffic')) {
    assert.equal(car.occupied, true);
    const roads = driveRoads.filter((road) => car.roadIds.includes(road.id));
    assert.ok(roads.length);
    assert.ok(car.route.length > 10);
    for (let i = 0; i < car.route.length; i++) {
      const [x, y] = car.route[i];
      assert.ok(roads.some((road) => road.points.slice(1).some((b, j) => distanceToSegmentSquared(x, y, road.points[j], b) < 1e-7)), 'A traffic route cannot invent a street or cut a curve');
      const next = car.route[Math.min(i + 1, car.route.length - 1)], previous = car.route[Math.max(0, i - 1)];
      const angle = Math.atan2(next[1] - previous[1], next[0] - previous[0]);
      assert.ok(game.canCarOccupy(x, y, angle, car.id, { staticOnly: true }), 'The traffic body must clear genuine buildings and mapped water along its route');
    }
  }
});

test('new vehicles do not spawn over Calvi pedestrians', () => {
  const pedestrians = game.world.scenery.filter((p) => p.kind === 'pedestrian');
  assert.ok(pedestrians.length >= 45);
  assert.ok(pedestrians.length <= 80, 'The enlarged territory cannot multiply active foot actors');
  for (const pedestrian of pedestrians) for (const car of roadCars(game)) {
    assert.ok(distanceToSegmentSquared(pedestrian.x, pedestrian.y, ...bodyAxis(car)) >= 13 ** 2, 'The first frame cannot place a civilian inside a vehicle');
  }
});

test('Calvi landmarks keep their genuine geographic locations and original place identities', () => {
  const landmarks = world.visualMeta.landmarks;
  const station = landmarks.find(place => place.id === 'station');
  assert.equal(station.osmId, 59740284);
  assert.equal(station.osmType, 'node');
  const expected = calviPoint(world, 8.7559822, 42.5646305);
  assert.ok(distance(station, expected) < .2, 'Enlarging the map must not move the actual Calvi station');
  assert.equal(districtFor(world, station.x, station.y).id, 'station');
  for (const landmark of landmarks) {
    assert.equal(landmark.source, 'OpenStreetMap');
    assert.ok(landmark.osmId, 'A real landmark retains its source object');
    const projected = calviPoint(world, landmark.longitude, landmark.latitude);
    assert.ok(projected, 'Labels remain within the actual imported municipal extent');
    assert.ok(distance(projected, landmark) < .2, 'A label cannot advertise two different source locations');
  }
  for (const scene of world.visualMeta.afterhoursScenes) {
    assert.equal(scene.fictional, true);
    assert.ok(world.buildings.some(building => building.id === scene.buildingId), 'Original businesses decorate existing source footprints');
  }
});

test('expanded Calvi decoration is bounded and sourced vegetation and parking stay within their source areas', () => {
  const counts = world.visualMeta.detailCounts;
  assert.ok(Object.values(counts).reduce((sum, count) => sum + count, 0) <= 1112);
  assert.ok((counts.tree || 0) <= 140);
  assert.ok((counts.lamppost || 0) <= 240);
  for (const tree of world.scenery.filter(item => item.sourceAreaId)) {
    const source = world.scenery.find(area => area.id === tree.sourceAreaId);
    assert.ok(source?.ground && source.polygon?.length);
    assert.ok(pointInPolygon(tree.x, tree.y, source.polygon));
    assert.ok(!(source.holes || []).some(ring => pointInPolygon(tree.x, tree.y, ring)));
  }
  for (const car of roadCars(game).filter(car => car.sourceParkingId)) {
    const source = world.scenery.find(area => area.id === car.sourceParkingId);
    assert.ok(source?.polygon?.length, 'Source parking is an actual imported polygon');
    const axis = bodyAxis(car);
    const radius = car.collisionRadius || 8;
    for (const [x, y] of axis) assert.ok(pointInPolygon(x, y, source.polygon));
    for (let i = 0, j = source.polygon.length - 1; i < source.polygon.length; j = i++) {
      assert.ok(segmentDistanceSquared(axis[0], axis[1], source.polygon[j], source.polygon[i]) >= radius ** 2 - 1e-7);
    }
  }
  assert.ok(world.visualMeta.vehiclePlacement.examinedParkingSamples <= 3200);
});

test('the full Calvi municipal population includes the genuine coastal extension and respects its administrative contour', () => {
  assert.equal(world.municipalBoundary?.insee, '2B050');
  assert.ok(world.municipalBoundary.polygons.length);
  const landmarks = world.visualMeta.landmarks;
  assert.ok(landmarks.some(place => place.id === 'beach'));
  assert.ok(landmarks.some(place => place.id === 'pine' && place.osmId === 40323298));
  assert.ok(landmarks.some(place => place.id === 'revellata' && place.osmId === 674985173));
  assert.ok(landmarks.some(place => place.id === 'airport' && place.osmId === 42019349));
  const contained = item => world.municipalBoundary.polygons.some(({ outer, holes = [] }) => pointInPolygon(item.x, item.y, outer)
    && !holes.some(ring => pointInPolygon(item.x, item.y, ring)));
  for (const actor of [...game.cars.filter(car => car.mobilityType !== 'boat'), ...world.scenery.filter(item => item.decorativeOnly && item.kind !== 'boat')]) {
    const centre = actor.clearanceCenter || actor;
    assert.ok(contained(centre), `${actor.id} cannot populate another commune`);
  }
  assert.ok(game.cars.some(car => car.sourceParkingId), 'The enlarged town uses a genuine imported parking surface');
});

test('Calvi provides four source-anchored pilotable vehicles with complete physical clearance and actual access', () => {
  const mobility = game.cars.filter(car => car.mobilityType && !car.sourceImage);
  assert.deepEqual(mobility.map(car => car.mobilityType).sort(), ['boat', 'helicopter', 'motorcycle', 'plane']);
  for (const vehicle of mobility) {
    assert.equal(vehicle.locked, false);
    assert.equal(vehicle.owned, false);
    assert.equal(vehicle.sourcePlacement.provider, 'OpenStreetMap');
    assert.equal(vehicle.sourcePlacement.fictionalVehicle, true);
    assert.equal(vehicle.sourcePlacement.surveyedVehiclePosition, false);
    assert.ok(game.canVehicleOccupy(vehicle, vehicle.x, vehicle.y, vehicle.angle), `${vehicle.id} fits its actual body on its proper surface`);
    assert.ok(world.roads.some(road => road.id === vehicle.sourceRoadId), 'Source access cannot introduce a new street');
    const radius = MOBILITY[vehicle.mobilityType].radius;
    if (vehicle.sourceParkingId) {
      const area = world.scenery.find(area => area.id === vehicle.sourceParkingId);
      assert.ok(area?.ground && area.areaKind === 'parking');
      assert.ok(pointInPolygon(vehicle.x, vehicle.y, area.polygon));
      for (let i = 0, j = area.polygon.length - 1; i < area.polygon.length; j = i++) {
        assert.ok(distanceToSegmentSquared(vehicle.x, vehicle.y, area.polygon[j], area.polygon[i]) >= radius ** 2, 'The complete body remains inside genuine parking geometry');
      }
    }
    for (const pedestrian of world.scenery.filter(actor => actor.kind === 'pedestrian')) {
      assert.ok(distance(pedestrian, vehicle) >= radius + 8, 'Initial pilotable vehicles cannot overlap a passer-by');
    }
  }
  const motorcycle = mobility.find(car => car.mobilityType === 'motorcycle');
  const departure = game.world.starts.player;
  assert.ok(distance(motorcycle, departure) < WALK_SPEED, 'A motorcycle is within one walking second at the opening port');
  assert.ok(game.clearSegment(departure, motorcycle, game.playerRadius, motorcycle.id, false));
  const boat = mobility.find(car => car.mobilityType === 'boat');
  assert.ok(game.canWaterOccupy(boat.x, boat.y, 9, boat.id));
  assert.ok(!game.canOccupy(boat.x, boat.y, 4, boat.id), 'The boat hull is in real water, not on an invented road or quay');
  assert.ok(distance(boat, boat.boarding) <= 44);
  assert.ok(game.canOccupy(boat.boarding.x, boat.boarding.y, game.playerRadius));
  assert.ok(planPhysicalWalk(game, boat.boarding, { origin: departure }).length >= 2, 'The real quay is reachable around the observed cars from the physically clear departure');
  const helicopter = mobility.find(car => car.mobilityType === 'helicopter');
  assert.ok(game.streetPath(game.player, helicopter).length > 2, 'The opening vehicle reaches the helicopter parking on the original street graph');
  const plane = mobility.find(car => car.mobilityType === 'plane');
  assert.equal(plane.sourceApronId, 200335795);
  assert.equal(plane.sourceRunwayId, 8113537);
  assert.ok(world.places.some(place => place.osmId === 42019349), 'The aircraft remains beside the actual Calvi airport');
  assert.ok(game.clearSegment(plane.access, plane, 4, plane.id, false), 'The source airport service access reaches the apron on foot');
  assert.ok(game.clearSegment(plane, { x: plane.x + 200, y: plane.y }, MOBILITY.plane.radius, plane.id, false), 'The aircraft has a clear physical takeoff run');
});

test('source mobility placement refuses another town, a landlocked boat, and an obstructed airport approach', () => {
  assert.deepEqual(createMobilityVehicles({ ...world, metadata: { ...world.metadata, city: 'Another town' } }), []);
  assert.deepEqual(createMobilityVehicles({ ...world, seaPolygons: [] }), []);
  const plane = createMobilityVehicles(world).find(vehicle => vehicle.mobilityType === 'plane');
  const obstruction = { id: 'explicit-test-wall', x: plane.x + 90, y: plane.y - 25, w: 40, h: 50,
    polygon: [[plane.x + 90, plane.y - 25], [plane.x + 130, plane.y - 25], [plane.x + 130, plane.y + 25], [plane.x + 90, plane.y + 25], [plane.x + 90, plane.y - 25]], holes: [] };
  const blocked = createMobilityVehicles({ ...world, buildings: [...world.buildings, obstruction] });
  assert.ok(!blocked.some(vehicle => vehicle.mobilityType === 'plane'), 'A source marker cannot override an actual obstruction in the takeoff run');
  assert.ok(blocked.some(vehicle => vehicle.mobilityType === 'boat'), 'A local airport obstruction leaves independently valid coastal vehicles available');
});

test('photographic vehicles keep their exact observed positions, real access and one persistent mask per playable vehicle', () => {
  const photoCars = game.cars.filter(car => car.sourceImage && car.id !== 'car-start');
  assert.ok(photoCars.length >= 59, 'Actual observations are converted rather than discarded by the former 48-car budget');
  const annotations = new Map(CALVI_AERIAL_OBJECTS.vehicles.map(annotation => [annotation.id, annotation]));
  const masks = game.world.visualMeta.aerialVehicleMasks;
  assert.equal(masks.length, CALVI_AERIAL_OBJECTS.vehicles.filter(annotation => !annotation.aliasOf).length, 'Every verified unique observation has one usable actor');
  const coverage = game.world.visualMeta.aerialVehicleCoverage;
  assert.equal(coverage.observed, CALVI_AERIAL_OBJECTS.vehicles.length);
  assert.equal(coverage.converted, masks.length);
  assert.deepEqual(coverage.rejected, [], 'Coverage keeps every actual rejection visible, without silently dropping parked observations');
  assert.equal(new Set(masks.map(mask => mask.vehicleId)).size, masks.length, 'Two observed images cannot create duplicate actors over one vehicle');
  for (const mask of masks) {
    const vehicle = game.cars.find(car => car.id === mask.vehicleId);
    const annotation = annotations.get(mask.annotationId);
    assert.ok(vehicle && annotation, 'A photo is removed only when a corresponding real playable actor exists');
    assert.deepEqual(mask.polygon, annotation.maskPolygon);
    assert.deepEqual(mask.groundPatch, annotation.groundPatch);
    assert.equal(mask.sourceImage.sha256, annotation.sourcePlacement.sha256);
    assert.equal(mask.persistent, true);
    const limit = annotation.mobilityType === 'plane' ? 360 : annotation.mobilityType === 'boat' ? 260 : 80;
    assert.ok(mask.w <= limit && mask.h <= limit, 'Only the annotated body and shadow are covered');
    assert.equal(mask.surface, annotation.mobilityType === 'boat' ? 'water' : 'land');
  }
  for (const car of photoCars) {
    const annotation = annotations.get(car.sourceImage.annotationId);
    assert.ok(annotation);
    assert.equal(car.x, annotation.x); assert.equal(car.y, annotation.y); assert.equal(car.angle, annotation.angle);
    if (car.mobilityType === 'boat') {
      const shape = car.collisionShape, ring = annotation.bodyPolygonWorld;
      assert.equal(shape.method, 'maximum-area centered capsule inscribed in native photo hull');
      assert.equal(shape.arcadeCollisionApproximation, true);
      assert.equal(shape.sourceHullPointCount, ring.length);
      assert.ok(shape.coverageRatio > .5 && shape.coverageRatio <= 1, 'Collision keeps a substantial measured interior rather than using an arbitrary tiny radius');
      assert.equal(car.collisionRadius, shape.radius); assert.equal(car.collisionHalfLength, shape.halfLength);
      const local = ring.map(([x, y]) => [x - car.x, y - car.y]);
      const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
      const sign = Math.sign(local.reduce((sum, p, i) => sum + cross(p, local[(i + 1) % local.length]), 0));
      for (let i = 0; i < local.length; i++) {
        const a = local[i], b = local[(i + 1) % local.length], edge = [b[0] - a[0], b[1] - a[1]], span = Math.hypot(...edge);
        if (!span) continue;
        const clearance = sign * cross(edge, [-a[0], -a[1]]) / span;
        const headingProjection = Math.abs(cross(edge, [Math.cos(car.angle), Math.sin(car.angle)])) / span;
        assert.ok(car.collisionRadius + car.collisionHalfLength * headingProjection <= clearance + 1e-7, 'The entire physical capsule is inside every undilated native hull edge');
      }
    } else {
      assert.equal(car.collisionRadius, annotation.width / 2);
      assert.equal(car.collisionHalfLength, Math.max(0, (annotation.length - annotation.width) / 2));
    }
    assert.equal(car.sourceImage.width, annotation.width); assert.equal(car.sourceImage.length, annotation.length);
    assert.equal(car.owned, false); assert.equal(car.locked, false);
    assert.ok(Number.isFinite(car.hp) && car.hp >= 260);
    assert.ok(car.mobilityType ? game.canVehicleOccupy(car, car.x, car.y, car.angle) : game.canCarOccupy(car.x, car.y, car.angle, car.id), `${car.id} clears buildings, shore, trees, piers and every initial vehicle`);
    assert.equal(car.activationCell, `${Math.floor(car.x / 512)},${Math.floor(car.y / 512)}`);
    if (car.mobilityType === 'boat') {
      assert.ok(['pier-boarding', 'coast-boarding', 'water-transfer'].includes(car.accessMode));
      if (car.boarding) assert.ok(game.canOccupy(car.boarding.x, car.boarding.y, game.playerRadius, car.id));
      else assert.ok(game.cars.some(vehicle => vehicle.mobilityType === 'boat' && !vehicle.sourceImage && vehicle.boarding), 'A boat away from the quay can be approached from a playable boat');
    } else {
      assert.ok(world.roads.some(road => road.id === car.sourceRoadId));
      assert.ok(game.canOccupy(car.entryPoint.x, car.entryPoint.y, game.playerRadius, car.id), 'The entry point is physically clear, outside every actual body');
      assert.ok(game.clearSegment(car.entryPoint, car, game.playerRadius, car.id, false), 'Normal entry reaches the observed car from its real approach');
      assert.ok(car.entryPath.length >= 2);
      for (let i = 1; i < car.entryPath.length; i++) assert.ok(game.clearSegment(car.entryPath[i - 1], car.entryPath[i], game.playerRadius, car.id, false), 'The approach follows swept free land, not a path through parked cars or trunks');
    }
    const parking = car.sourceParkingId && world.scenery.find(area => area.id === car.sourceParkingId);
    if (parking) assert.ok(pointInPolygon(car.x, car.y, parking.polygon));
  }
  const starter = game.cars.find(car => car.id === 'car-start');
  const openingAnnotation = annotations.get('photo-car-port-04');
  assert.equal(starter.sourceImage.annotationId, openingAnnotation.id);
  assert.equal(starter.x, openingAnnotation.x); assert.equal(starter.y, openingAnnotation.y); assert.equal(starter.angle, openingAnnotation.angle);
  assert.equal(starter.collisionRadius, 4); assert.equal(starter.collisionHalfLength, 5);
  assert.equal(starter.owned, true);
  assert.equal(masks.filter(mask => mask.vehicleId === 'car-start').length, 1, 'The opening photo uses the existing actor ID, not a duplicate new car');
  assert.ok(distance(starter, game.world.starts.player) <= 36, 'The observed opening car remains within the normal entry radius');
  assert.ok(game.canOccupy(game.world.starts.player.x, game.world.starts.player.y, game.playerRadius), 'The player does not begin inside an observed car');
  assert.ok(game.clearSegment(game.world.starts.player, starter, game.playerRadius, starter.id, false));
  assert.equal(game.cars.filter(car => car.mobilityType && !car.sourceImage).length, 4);

  // Verify the observed opening vehicle through the same public actions as a
  // player, including a real departure rather than a position assignment.
  game.start(); game.dismissTutorial();
  const openingMask = structuredClone(game.world.visualMeta.aerialVehicleMasks.find(mask => mask.vehicleId === 'car-start'));
  assert.equal(game.interact(), true);
  assert.equal(game.vehicleId, 'car-start', 'Normal entry selects the nearby photographed car');
  const driven = game.vehicle, before = { x: driven.x, y: driven.y };
  const mission = game.world.buildings.find(building => building.target);
  const route = game.streetPath(game.player, mission.parking);
  assert.ok(route.length > 2);
  const angle = Math.atan2(route[1].y - driven.y, route[1].x - driven.x);
  for (let frame = 0; frame < 80; frame++) {
    const strength = frame < 24 ? .03 : .5;
    game.update(1 / 60, { x: Math.cos(angle) * strength, y: Math.sin(angle) * strength });
    assert.ok(game.canCarOccupy(driven.x, driven.y, driven.angle, driven.id, { staticOnly: true }), 'Public steering cannot drive the photo car through the real shoreline or a building');
  }
  assert.ok(distance(before, driven) > 40, 'The photographed opening car genuinely leaves its source parking position');
  assert.deepEqual(game.world.visualMeta.aerialVehicleMasks.find(mask => mask.vehicleId === 'car-start'), openingMask, 'Driving away keeps the original photograph covered at its observed position');
});

test('invalid aerial placement, mismatched geography and a trunk obstruction never remove a source photo without a vehicle', () => {
  const rectangle = { x: 0, y: 0, angle: 0, bodyPolygonWorld: [[-10, -3], [10, -3], [10, 3], [-10, 3]] };
  const measured = inscribedPhotoHullCapsule(rectangle);
  assert.ok(Math.abs(measured.radius - 3) < 1e-6 && Math.abs(measured.halfLength - 7) < 1e-6, 'The exact maximum-area capsule in a known rectangle is determined by its contour');
  assert.equal(inscribedPhotoHullCapsule({ ...rectangle, x: 11 }), null, 'A centre outside the source hull cannot be made valid with a smaller arbitrary capsule');
  const baseCars = [...world.starts.cars, ...createMobilityVehicles(world)];
  const valid = createAerialVehicles(game.world, baseCars);
  assert.ok(valid.vehicles.length);
  const annotation = CALVI_AERIAL_OBJECTS.vehicles.find(item => item.id === valid.vehicles[0].sourceImage.annotationId);
  const wrongBounds = { ...CALVI_AERIAL_OBJECTS, metadata: { ...CALVI_AERIAL_OBJECTS.metadata,
    boundsWGS84: { ...CALVI_AERIAL_OBJECTS.metadata.boundsWGS84, west: 8 } } };
  assert.deepEqual(createAerialVehicles(game.world, baseCars, wrongBounds).masks, []);
  const tooLargeMask = { ...annotation, maskPolygon: [[annotation.x - 100, annotation.y - 100], [annotation.x + 100, annotation.y - 100],
    [annotation.x + 100, annotation.y + 100], [annotation.x - 100, annotation.y + 100], [annotation.x - 100, annotation.y - 100]] };
  const source = { ...CALVI_AERIAL_OBJECTS, vehicles: [tooLargeMask] };
  const invalid = createAerialVehicles(game.world, baseCars, source);
  assert.equal(invalid.vehicles.length, 0); assert.equal(invalid.masks.length, 0); assert.equal(invalid.rejected.length, 1);
  const shiftedSource = { ...annotation, sourcePlacement: { ...annotation.sourcePlacement,
    centerPixel: [annotation.sourcePlacement.centerPixel[0] + 1, annotation.sourcePlacement.centerPixel[1]] } };
  const shifted = createAerialVehicles(game.world, baseCars, { ...CALVI_AERIAL_OBJECTS, vehicles: [shiftedSource] });
  assert.equal(shifted.vehicles.length, 0); assert.equal(shifted.masks.length, 0);
  assert.equal(shifted.rejected[0].reason, 'invalid-or-duplicate-source-annotation', 'A photo location cannot drift from its source pixel coordinate');
  const blockedWorld = { ...game.world, vegetation: [...(game.world.vegetation || []),
    { id: 'explicit-test-tree', x: annotation.x, y: annotation.y, kind: 'tree', trunkRadius: 2 }] };
  const blocked = createAerialVehicles(blockedWorld, baseCars, { ...CALVI_AERIAL_OBJECTS, vehicles: [annotation] });
  assert.equal(blocked.vehicles.length, 0); assert.equal(blocked.masks.length, 0);
  assert.equal(blocked.rejected[0].reason, 'outside-clear-municipal-land-or-static-obstruction');
});

test('a real walk from Calvi port can steal an observed photo car and drive it out of its parking', () => {
  const run = new Game({ world });
  run.start(); run.dismissTutorial();
  const car = run.cars.find(c => c.sourceImage?.annotationId === 'photo-car-port-02');
  assert.ok(car, 'The actual port parking observation survives the former arbitrary road-clearance rejection');
  const entry = car.entryPoint;
  const route = planPhysicalWalk(run, entry);
  assert.ok(route.length >= 2, 'Native physical queries find a real walk around all source vehicles');
  for (const waypoint of route.slice(1)) {
    assert.ok(run.canOccupy(waypoint.x, waypoint.y) && run.clearSegment(run.player, waypoint, run.playerRadius, car.id, false), 'Walking around the observed neighbouring car uses free mapped land');
    for (let ticks = 0; distance(run.player, waypoint) > .04; ticks++) {
      assert.ok(ticks < 400);
      const dx = waypoint.x - run.player.x, dy = waypoint.y - run.player.y, d = Math.hypot(dx, dy);
      const strength = Math.min(1, d / (WALK_SPEED / 120));
      run.update(1 / 120, { x: dx / d * strength, y: dy / d * strength });
      assert.ok(run.canOccupy(run.player.x, run.player.y, run.playerRadius), 'Walking input cannot clip through a photographed vehicle, trunk or building');
    }
  }
  assert.equal(run.interact(), true);
  assert.equal(run.vehicleId, car.id);
  assert.equal(car.stolen, true);
  assert.ok(run.heat >= 1, 'Stealing a source-placed vehicle triggers police attention');
  const angle = Math.atan2(car.access.y - car.y, car.access.x - car.x), before = { x: car.x, y: car.y };
  const originalMask = structuredClone(run.world.visualMeta.aerialVehicleMasks.find(mask => mask.vehicleId === car.id));
  for (let frame = 0; frame < 40; frame++) {
    const strength = frame < 24 ? .03 : .5;
    run.update(1 / 60, { x: Math.cos(angle) * strength, y: Math.sin(angle) * strength });
    assert.ok(run.canCarOccupy(car.x, car.y, car.angle, car.id, { staticOnly: true }), 'The driven vehicle must never cross a mapped building or shoreline');
  }
  assert.ok(distance(before, car) > 8, 'Actual steering and acceleration must get the stolen car moving');
  assert.deepEqual(run.world.visualMeta.aerialVehicleMasks.find(mask => mask.vehicleId === car.id), originalMask, 'Stealing the observed vehicle never restores the baked photograph beneath it');
});

test('a genuine quay walk boards an observed boat and normal steering sails its source hull into real water', () => {
  const run = new Game({ world });
  run.start(); run.dismissTutorial();
  const boat = run.cars.find(vehicle => vehicle.sourceImage?.annotationId === 'photo-boat-port-016-01');
  assert.ok(boat && boat.accessMode === 'coast-boarding');
  assert.equal(boat.boardingPlacement.geometry, 'unchanged mapped coastline');
  assert.equal(boat.boardingPlacement.positionEstimated, true);
  const route = planPhysicalWalk(run, boat.boarding);
  assert.ok(route.length >= 2, 'The existing solid quay has a real walking approach to the observed hull');
  for (const waypoint of route.slice(1)) for (let ticks = 0; distance(run.player, waypoint) > .04; ticks++) {
    assert.ok(ticks < 400);
    const dx = waypoint.x - run.player.x, dy = waypoint.y - run.player.y, span = Math.hypot(dx, dy);
    const strength = Math.min(1, span / (WALK_SPEED / 120));
    run.update(1 / 120, { x: dx / span * strength, y: dy / span * strength });
    assert.ok(run.canOccupy(run.player.x, run.player.y, run.playerRadius));
  }
  assert.equal(run.interactionTarget()?.id, boat.id, 'HUD selection and E refer to the same reachable photographed boat');
  assert.equal(run.interact(), true); assert.equal(run.vehicleId, boat.id); assert.equal(boat.stolen, true);
  const before = { x: boat.x, y: boat.y }, angle = boat.angle;
  const mask = structuredClone(run.world.visualMeta.aerialVehicleMasks.find(item => item.vehicleId === boat.id));
  for (let frame = 0; frame < 120; frame++) {
    run.update(1 / 120, { x: Math.cos(angle) * .5, y: Math.sin(angle) * .5 });
    assert.ok(run.canVehicleOccupy(boat, boat.x, boat.y, boat.angle), 'Actual boating input cannot cross land, piers, trees or another measured hull');
  }
  assert.ok(distance(before, boat) > 40, 'The photographed boat leaves its mooring through ordinary acceleration and steering');
  assert.deepEqual(run.world.visualMeta.aerialVehicleMasks.find(item => item.vehicleId === boat.id), mask, 'The original mooring stays masked after sailing away');
});
