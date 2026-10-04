// Original game vehicles on the real, unchanged Calvi geography. These are
// fictional placements, not surveyed parking bays, helipads or aircraft.
// Airport apron 200335795 below is copied without simplification from the
// archived OSM way in data/calvi-osm-parts/part-1.osm.xml.gz (ODbL 1.0).
// Decompressed source SHA-256:
// 7194eadacb0ec06dc06091367e9e5a11e9c964ca7900a9b81d7498b7c477a6e8.
const AIRPORT_APRON = [
  [8.7905328,42.5264403],[8.7917953,42.5264404],[8.7917895,42.5260934],[8.7912932,42.5257144],
  [8.791311,42.5242143],[8.7917451,42.523903],[8.7917482,42.5238109],[8.7919019,42.5238101],
  [8.7920185,42.5236282],[8.7920352,42.5226402],[8.7921121,42.5225098],[8.7918056,42.5223063],
  [8.7918117,42.521827],[8.7914516,42.5218268],[8.7913993,42.5217872],[8.7914079,42.5216692],
  [8.791139,42.5215578],[8.7912847,42.5213448],[8.7911635,42.5211281],[8.7910162,42.5210729],
  [8.7903218,42.521991],[8.7899534,42.5226896],[8.7901902,42.5227184],[8.790271,42.5228021],
  [8.7908881,42.5228003],[8.7908925,42.5227097],[8.7909647,42.5227083],[8.790958,42.5233558],
  [8.7909432,42.5234121],[8.7909226,42.5234478],[8.7908793,42.5234875],[8.7908176,42.5235225],
  [8.7907536,42.523544],[8.7906681,42.5235516],[8.7904589,42.5235563],[8.7901368,42.5237243],
  [8.7901225,42.5237529],[8.7901123,42.5244148],[8.7904479,42.5244162],[8.7905061,42.5244419],
  [8.7905409,42.5244407],[8.7905421,42.5244176],[8.7905877,42.5244194],[8.7905876,42.5245519],
  [8.7905405,42.5245516],[8.790539,42.5249121],[8.7905839,42.5249124],[8.7906271,42.5249418],
  [8.7906259,42.5249961],[8.7905844,42.525028],[8.7905385,42.5250265],[8.7905371,42.5253899],
  [8.7905825,42.5253894],[8.7906302,42.5254211],[8.7906284,42.525472],[8.7905778,42.5255084],
  [8.7905366,42.525512],[8.7905351,42.5258677],[8.7905817,42.5258667],[8.7906243,42.5258931],
  [8.7906305,42.5260328],[8.7905828,42.5260643],[8.7905343,42.5260657],[8.7905328,42.5264403],
];
const SPECS = [
  { id: 'calvi-motorcycle-port', mobilityType: 'motorcycle', name: 'Moto du cousin', color: '#cf755e',
    longitude: 8.756674512443182, latitude: 42.5648695373825, angle: -1.061062528873713,
    radius: 5, sourceParkingId: 'osm-area-1511492156', sourceRoadId: 'osm-road-1511492157-0',
    placement: 'fictional motorcycle inside source parking, clear of its street and footway' },
  { id: 'calvi-boat-port', mobilityType: 'boat', name: 'La Face B', color: '#6eafae',
    longitude: 8.756901776853217, latitude: 42.565060429405676, angle: -2.286562187,
    radius: 9, sourceRoadId: 'osm-road-622063896-0',
    boarding: { longitude: 8.756818888599577, latitude: 42.565007406339 },
    placement: 'fictional boat in actual source sea, boarding on the land side of the port coastline' },
  { id: 'calvi-helicopter-port', mobilityType: 'helicopter', name: 'Hélico Maquis FM', color: '#bcbdad',
    longitude: 8.755055524074546, latitude: 42.564823498718084, angle: -.38,
    radius: 12, sourceParkingId: 'osm-area-654565870', sourceRoadId: 'osm-road-622117795-0',
    placement: 'fictional helicopter on a clear source parking surface near the port; not a surveyed helipad' },
  { id: 'calvi-plane-airport', mobilityType: 'plane', name: 'Le Dernier Départ', color: '#cdc7a6',
    longitude: 8.790680340665155, latitude: 42.52634303552752, angle: 0,
    radius: 18, sourceAreaId: 'osm-area-42019349', sourceApronId: 200335795,
    sourceRoadId: 'osm-road-583428622-0', sourceRunwayId: 8113537,
    placement: 'fictional small aircraft inside the actual terminal apron, facing its clear eastward taxi area' },
];

function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a[1] > p.y) !== (b[1] > p.y) && p.x < (b[0] - a[0]) * (p.y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function edgeDistanceSquared(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], span = dx * dx + dy * dy;
  const t = span ? Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / span)) : 0;
  return (p.x - a[0] - dx * t) ** 2 + (p.y - a[1] - dy * t) ** 2;
}

function ringClear(p, ring, radius) {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (edgeDistanceSquared(p, ring[j], ring[i]) < radius * radius) return false;
  }
  return true;
}

function fits(p, polygon, radius) {
  const outer = polygon.outer || polygon.polygon || polygon;
  return inRing(p, outer) && ringClear(p, outer, radius)
    && (polygon.holes || []).every(hole => !inRing(p, hole) && ringClear(p, hole, radius));
}

function project(world, longitude, latitude) {
  const b = world.metadata.bounds;
  return { x: (longitude - b.west) / (b.east - b.west) * world.width,
    y: (b.north - latitude) / (b.north - b.south) * world.height };
}

function inBounds(world, p, radius) {
  return p.x >= radius && p.y >= radius && p.x <= world.width - radius && p.y <= world.height - radius;
}

function buildingClear(world, p, radius) {
  return !world.buildings.some(building => {
    if (p.x + radius < building.x || p.x - radius > building.x + building.w || p.y + radius < building.y || p.y - radius > building.y + building.h) return false;
    const holes = building.holes || [];
    return (inRing(p, building.polygon) && !holes.some(hole => inRing(p, hole)))
      || !ringClear(p, building.polygon, radius) || holes.some(hole => !ringClear(p, hole, radius));
  });
}

function groundClear(world, p, radius) {
  return inBounds(world, p, radius) && world.landPolygons.some(ring => fits(p, ring, radius))
    && world.municipalBoundary.polygons.some(polygon => fits(p, polygon, radius)) && buildingClear(world, p, radius);
}

function actorsClear(world, p, radius, extra = []) {
  if (world.scenery.some(actor => actor.kind === 'pedestrian' && Math.hypot(actor.x - p.x, actor.y - p.y) < radius + 8)) return false;
  return [...world.starts.cars, ...extra].every(car => {
    const carRadius = car.mobilityType === 'plane' ? 18 : car.mobilityType === 'helicopter' ? 12 : car.mobilityType === 'boat' ? 9 : car.mobilityType === 'motorcycle' ? 5 : 8;
    const shaft = car.mobilityType ? 0 : 7;
    const dx = Math.cos(car.angle || 0) * shaft, dy = Math.sin(car.angle || 0) * shaft;
    return edgeDistanceSquared(p, [car.x - dx, car.y - dy], [car.x + dx, car.y + dy]) >= (radius + carRadius) ** 2;
  });
}

function clearSegment(world, from, to, radius, extra = []) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 5));
  for (let i = 0; i <= steps; i++) {
    const p = { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps };
    if (!groundClear(world, p, radius) || !actorsClear(world, p, radius, extra)) return false;
  }
  return true;
}

/** Four bounded, validated actors; invalid source placement is omitted. */
export function createMobilityVehicles(world) {
  const b = world?.metadata?.bounds;
  if (world?.mapStatus !== 'ready' || world.metadata?.city !== 'Calvi' || world.municipalBoundary?.insee !== '2B050'
    || !b || !(b.east > b.west) || !(b.north > b.south) || !world.landPolygons?.length || !world.seaPolygons?.length
    || !world.roads?.length || !world.buildings?.length || !world.starts?.cars || !world.scenery?.length) return [];
  const result = [];
  for (const spec of SPECS) {
    if (!world.roads.some(road => road.id === spec.sourceRoadId)) continue;
    const p = project(world, spec.longitude, spec.latitude);
    if (!actorsClear(world, p, spec.radius, result)) continue;
    const parking = spec.sourceParkingId && world.scenery.find(area => area.id === spec.sourceParkingId && area.ground && area.polygon?.length);
    if (spec.sourceParkingId && (!parking || !fits(p, parking, spec.radius))) continue;
    let boarding = null;
    if (spec.mobilityType === 'boat') {
      // The administrative coastline excludes water. Sailing uses the actual
      // source sea inside this map rectangle; boarding stays on municipal land.
      if (!inBounds(world, p, spec.radius) || !world.seaPolygons.some(ring => fits(p, ring, spec.radius))
        || world.landPolygons.some(ring => inRing(p, ring) || !ringClear(p, ring, spec.radius))) continue;
      boarding = project(world, spec.boarding.longitude, spec.boarding.latitude);
      if (Math.hypot(boarding.x - p.x, boarding.y - p.y) > 44 || !groundClear(world, boarding, 4)
        || !actorsClear(world, boarding, 4, result) || !clearSegment(world, world.starts.player, boarding, 4, result)) continue;
    } else {
      if (!groundClear(world, p, spec.radius)) continue;
      // Each grounded vehicle has an actual, unobstructed place to get out.
      if (![0, Math.PI / 2, Math.PI, Math.PI * 1.5].some(angle => {
        const exit = { x: p.x + Math.cos(angle) * 28, y: p.y + Math.sin(angle) * 28 };
        return groundClear(world, exit, 4) && actorsClear(world, exit, 4, result);
      })) continue;
      if (spec.mobilityType === 'plane') {
        const airport = world.scenery.find(area => area.id === spec.sourceAreaId && area.ground && area.polygon?.length);
        const apron = AIRPORT_APRON.map(([lon, lat]) => { const q = project(world, lon, lat); return [q.x, q.y]; });
        const forward = { x: p.x + 200, y: p.y };
        if (!airport || !fits(p, airport, spec.radius) || !fits(p, apron, spec.radius)
          || !fits(forward, apron, spec.radius) || !clearSegment(world, p, forward, spec.radius, result)) continue;
      }
    }
    const accessRoad = world.roads.find(road => road.id === spec.sourceRoadId);
    const access = spec.mobilityType === 'plane' ? { x: accessRoad.points.at(-1)[0], y: accessRoad.points.at(-1)[1] } : null;
    if (access && !clearSegment(world, access, p, 4, result)) continue;
    result.push({
      id: spec.id, x: p.x, y: p.y, angle: spec.angle, mobilityType: spec.mobilityType, model: spec.mobilityType,
      mobilityMode: spec.mobilityType === 'boat' ? 'water' : 'ground', altitude: 0, name: spec.name,
      kind: 'parked', speed: 0, color: spec.color, hp: spec.mobilityType === 'plane' ? 340 : 260,
      maxHp: spec.mobilityType === 'plane' ? 340 : 260, locked: false, owned: false, occupied: false, stolen: false, destroyed: false,
      sourceRoadId: spec.sourceRoadId, ...(spec.sourceParkingId ? { sourceParkingId: spec.sourceParkingId } : {}),
      ...(spec.sourceAreaId ? { sourceAreaId: spec.sourceAreaId, sourceApronId: spec.sourceApronId, sourceRunwayId: spec.sourceRunwayId, access } : {}),
      ...(boarding ? { boarding } : {}),
      sourcePlacement: { provider: 'OpenStreetMap', fictionalVehicle: true, surveyedVehiclePosition: false,
        longitude: spec.longitude, latitude: spec.latitude, method: spec.placement },
    });
  }
  return result;
}
