import { CALVI_MAP } from './data/calvi-map.js';
import { MISSIONS } from './universe.js';
import { decorateCalviWorld } from './calvi-detail.js';
import { populateCalviVehicles } from './street-life.js';
import { attachTerrain } from './terrain.js';
import { attachBuildingHeights, buildingHeightInfo } from './building-height.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const point = ([x, y]) => ({ x, y });
const WALLS = ['#dfcda8', '#cbb68e', '#e3d3af', '#bfb9a3'];
const ROOFS = ['#b96849', '#c17a50', '#a45d45', '#c49163'];
const SHUTTERS = ['#406d72', '#617249', '#824f42', '#58758a'];
// Gameplay places retain their real geographic positions when the map expands.
// Mission identities remain fictional; these coordinates are placement anchors.
export const CALVI_ANCHORS = Object.freeze({
  player: { lon: 8.756770179469406, lat: 42.56497621095051 },
  car: { lon: 8.756698313339083, lat: 42.56500579413311 },
  missions: [
    { id: 'port', osmId: 622063897, lon: 8.756109201711055, lat: 42.5643104981607 },
    { id: 'village', osmId: 244740312, lon: 8.759372261136232, lat: 42.56711500455895 },
    { id: 'market', osmId: 244739077, lon: 8.756197507470619, lat: 42.562566003710046 },
  ],
});

function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[j];
    if ((ay > p.y) !== (by > p.y) && p.x < (bx - ax) * (p.y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function closestOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / denominator)) : 0;
  return { x: a.x + dx * t, y: a.y + dy * t };
}

function closestOnLine(p, line) {
  let best = null;
  for (let i = 1; i < line.length; i++) {
    const candidate = closestOnSegment(p, point(line[i - 1]), point(line[i]));
    if (!best || distance(p, candidate) < distance(p, best)) best = candidate;
  }
  return best;
}

function hitsBuilding(p, radius, building) {
  if (p.x + radius < building.x || p.x - radius > building.x + building.w || p.y + radius < building.y || p.y - radius > building.y + building.h) return false;
  const inside = inRing(p, building.polygon) && !(building.holes || []).some((hole) => inRing(p, hole));
  if (inside) return true;
  return [building.polygon, ...(building.holes || [])].some((ring) => {
    const edge = closestOnLine(p, ring);
    return edge && distance(edge, p) < radius;
  });
}

function boxIndex(items, cellSize = 256) {
  const cells = new Map();
  for (const item of items) for (let x = Math.floor(item.x / cellSize); x <= Math.floor((item.x + item.w) / cellSize); x++) for (let y = Math.floor(item.y / cellSize); y <= Math.floor((item.y + item.h) / cellSize); y++) {
    const key = `${x},${y}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(item);
  }
  return (p, radius) => {
    const result = new Set();
    for (let x = Math.floor((p.x - radius) / cellSize); x <= Math.floor((p.x + radius) / cellSize); x++) for (let y = Math.floor((p.y - radius) / cellSize); y <= Math.floor((p.y + radius) / cellSize); y++) {
      for (const item of cells.get(`${x},${y}`) || []) if (item.x <= p.x + radius && item.x + item.w >= p.x - radius && item.y <= p.y + radius && item.y + item.h >= p.y - radius) result.add(item);
    }
    return [...result];
  };
}

function ringProfile(ring) {
  const buckets = new Map();
  for (let i = 1; i < ring.length; i++) {
    const edge = { a: point(ring[i - 1]), b: point(ring[i]) };
    edge.left = Math.min(edge.a.x, edge.b.x); edge.right = Math.max(edge.a.x, edge.b.x);
    for (let y = Math.floor(Math.min(edge.a.y, edge.b.y) / 256); y <= Math.floor(Math.max(edge.a.y, edge.b.y) / 256); y++) {
      if (!buckets.has(y)) buckets.set(y, []);
      buckets.get(y).push(edge);
    }
  }
  return { buckets };
}

function indexedInside(p, profile) {
  let inside = false;
  for (const { a, b } of profile.buckets.get(Math.floor(p.y / 256)) || []) {
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentDistance(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return 0;
  return Math.min(distance(a, closestOnSegment(a, c, d)), distance(b, closestOnSegment(b, c, d)), distance(c, closestOnSegment(c, a, b)), distance(d, closestOnSegment(d, a, b)));
}

function profileClear(profile, a, b, radius) {
  const left = Math.min(a.x, b.x) - radius, right = Math.max(a.x, b.x) + radius;
  const edges = new Set();
  for (let y = Math.floor((Math.min(a.y, b.y) - radius) / 256); y <= Math.floor((Math.max(a.y, b.y) + radius) / 256); y++) for (const edge of profile.buckets.get(y) || []) {
    if (edge.right >= left && edge.left <= right) edges.add(edge);
  }
  return [...edges].every(({ a: c, b: d }) => segmentDistance(a, b, c, d) >= radius);
}

function ringIsValid(ring) {
  return Array.isArray(ring) && ring.length >= 4 && ring.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))
    && Math.hypot(ring[0][0] - ring.at(-1)[0], ring[0][1] - ring.at(-1)[1]) < .03;
}

function mapIsReady(data) {
  return data?.status === 'ready' && Number.isFinite(data.width) && data.width > 0 && Number.isFinite(data.height) && data.height > 0
    && Array.isArray(data.roads) && data.roads.length && data.roads.every((road) => Array.isArray(road.points) && road.points.length > 1 && road.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)))
    && Array.isArray(data.buildings) && data.buildings.length > 2 && data.buildings.every((b) => ringIsValid(b.polygon) && (b.holes || []).every(ringIsValid))
    && Array.isArray(data.landPolygons) && data.landPolygons.length && data.landPolygons.every(ringIsValid);
}

/** Pending or invalid extracts are rejected; the game has no replacement town. */
export function createCalviWorld(data = CALVI_MAP) {
  if (!mapIsReady(data)) return null;
  return buildCalviWorld(data);
}

/** Build gameplay data from projected vectors; also accepts explicit test fixtures. */
export function buildCalviWorld(data) {
  if (!mapIsReady(data)) return null;
  const footRadius = 4, navRadius = 10, vehicleRadius = 8, vehicleHalfShaft = 7;
  const roads = data.roads.map((road) => ({ ...road, points: road.points.map((p) => [...p]), nodeIds: [...(road.nodeIds || [])] }));
  const buildings = data.buildings.map((building, index) => {
    const polygon = building.polygon.map((p) => [...p]);
    const xs = polygon.map((p) => p[0]), ys = polygon.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    const tags = building.osmTags || {};
    const numericTag = (name) => {
      const value = Number.parseFloat(tags[name]);
      return Number.isFinite(value) && value > 0 ? value : null;
    };
    return {
      ...building, polygon, holes: (building.holes || []).map((ring) => ring.map((p) => [...p])),
      x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y,
      kind: tags.shop || tags.amenity === 'cafe' ? 'shop' : 'house',
      name: 'Bâtiment du décor', target: false, hp: Infinity, destroyed: false,
      wallTone: WALLS[index % WALLS.length], roofTone: ROOFS[index % ROOFS.length], shutterTone: SHUTTERS[index % SHUTTERS.length],
      roof: index % 4, roofDetails: { antenna: index % 3 === 1, chimney: index % 3 === 0 },
      district: 'calvi', style: 'town-house',
      // Source tags are optional and are not surveyed heights or invented
      // elevation. Gameplay durability is initialized by the combat module.
      construction: { material: tags['building:material'] || tags.material || null, floors: numericTag('building:levels'), height: numericTag('height'), source: 'OpenStreetMap tags' },
    };
  });
  const buildingQuery = boxIndex(buildings);
  const landProfiles = data.landPolygons.map(ringProfile);
  const municipalProfiles = data.municipalBoundary?.polygons?.map((polygon) => ({ outer: ringProfile(polygon.outer), holes: (polygon.holes || []).map(ringProfile) }));
  const permitted = (p, a, b, radius) => p.x > radius && p.y > radius && p.x < data.width - radius && p.y < data.height - radius
    && landProfiles.some((profile) => indexedInside(p, profile) && profileClear(profile, a, b, radius))
    && (!municipalProfiles || municipalProfiles.some(({ outer, holes }) => indexedInside(p, outer) && profileClear(outer, a, b, radius)
      && holes.every((hole) => !indexedInside(p, hole) && profileClear(hole, a, b, radius))));
  const walkable = (p, radius = footRadius) => permitted(p, p, p, radius) && !buildingQuery(p, radius).some((b) => hitsBuilding(p, radius, b));
  const bodyClear = (p, radius = vehicleRadius, halfShaft = vehicleHalfShaft) => {
    const angle = p.angle || 0, dx = Math.cos(angle) * halfShaft, dy = Math.sin(angle) * halfShaft;
    const a = { x: p.x - dx, y: p.y - dy }, b = { x: p.x + dx, y: p.y + dy };
    if (!permitted(p, a, b, radius) || [a, b].some((v) => v.x <= radius || v.y <= radius || v.x >= data.width - radius || v.y >= data.height - radius)) return false;
    return !buildingQuery(p, radius + halfShaft).some((building) => {
      if ([a, p, b].some((v) => inRing(v, building.polygon) && !(building.holes || []).some((hole) => inRing(v, hole)))) return true;
      return [building.polygon, ...(building.holes || [])].some((ring) => ring.slice(1).some((vertex, i) => segmentDistance(a, b, point(ring[i]), point(vertex)) < radius));
    });
  };
  const geographic = data.metadata?.city === 'Calvi' && data.metadata.bounds && ['west', 'south', 'east', 'north'].every((key) => Number.isFinite(data.metadata.bounds[key]));
  const projectGps = ({ lon, lat }) => ({ x: (lon - data.metadata.bounds.west) / (data.metadata.bounds.east - data.metadata.bounds.west) * data.width,
    y: (data.metadata.bounds.north - lat) / (data.metadata.bounds.north - data.metadata.bounds.south) * data.height });
  const driveRoads = roads.filter((road) => !road.pedestrian && road.type !== 'steps' && Number(road.layer || 0) === 0 && road.tunnel !== 'yes');
  const driveSamples = [];
  for (const road of driveRoads) for (let i = 1; i < road.points.length; i++) {
    const a = point(road.points[i - 1]), b = point(road.points[i]);
    const length = distance(a, b), steps = Math.max(1, Math.ceil(length / 32));
    for (let j = 0; j <= steps; j++) {
      const t = j / steps, p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (walkable(p, navRadius) && bodyClear({ ...p, angle })) driveSamples.push({ ...p, angle, roadId: road.id });
    }
  }
  if (!driveSamples.length) return null;
  const clearCarSegment = (a, b) => {
    const steps = Math.max(1, Math.ceil(distance(a, b) / 5));
    for (let i = 1; i <= steps; i++) if (!walkable({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }, navRadius)) return false;
    return true;
  };
  // Pick mission parking within the connected car-clearance component of the
  // port start. An individually valid point across a narrow alley is not enough.
  const streetNodes = new Map();
  const addNode = (key, p) => {
    if (!walkable(p, navRadius)) return null;
    if (!streetNodes.has(key)) streetNodes.set(key, { ...p, key, neighbors: new Set() });
    return streetNodes.get(key);
  };
  for (const road of driveRoads) for (let i = 1; i < road.points.length; i++) {
    const a = point(road.points[i - 1]), b = point(road.points[i]);
    const steps = Math.max(1, Math.ceil(distance(a, b) / 20));
    const sourceKey = (index) => road.nodeIds?.[index] != null ? `source-node:${road.nodeIds[index]}` : `${road.id}:vertex:${index}`;
    let previous = addNode(sourceKey(i - 1), a);
    for (let step = 1; step <= steps; step++) {
      const p = { x: a.x + (b.x - a.x) * step / steps, y: a.y + (b.y - a.y) * step / steps };
      const key = step === steps ? sourceKey(i) : `${road.id}:segment:${i}:sample:${step}`;
      const next = addNode(key, p);
      if (previous && next && clearCarSegment(previous, next)) { previous.neighbors.add(next.key); next.neighbors.add(previous.key); }
      previous = next;
    }
  }
  const preferredPort = geographic ? projectGps(CALVI_ANCHORS.car) : { x: data.width * .31, y: data.height * .54 };
  const startOptions = [...driveSamples].sort((a, b) => distance(a, preferredPort) - distance(b, preferredPort));
  if (geographic && startOptions.length && walkable(preferredPort, navRadius) && bodyClear({ ...preferredPort, angle: startOptions[0].angle })) startOptions.unshift({ ...startOptions[0], ...preferredPort });
  let startCar = null, start = null, startNode = null;
  for (const sample of startOptions) {
    const nearby = [...streetNodes.values()].filter((node) => distance(node, sample) < 50).sort((a, b) => distance(a, sample) - distance(b, sample)).find((node) => clearCarSegment(sample, node));
    if (!nearby) continue;
    if (geographic) {
      const preferredPlayer = projectGps(CALVI_ANCHORS.player);
      if (distance(sample, preferredPlayer) >= 23 && distance(sample, preferredPlayer) <= 60 && walkable(preferredPlayer)) {
        start = preferredPlayer; startCar = sample; startNode = nearby; break;
      }
    }
    for (const offset of [{ x: -Math.sin(sample.angle) * 27, y: Math.cos(sample.angle) * 27 }, { x: Math.sin(sample.angle) * 27, y: -Math.cos(sample.angle) * 27 }, { x: -Math.cos(sample.angle) * 27, y: -Math.sin(sample.angle) * 27 }]) {
      const p = { x: sample.x + offset.x, y: sample.y + offset.y };
      if (walkable(p)) { start = p; startCar = sample; startNode = nearby; break; }
    }
    if (start) break;
  }
  if (!start) return null;
  const connected = new Map([[startNode.key, startNode]]), queue = [startNode];
  for (let i = 0; i < queue.length; i++) for (const key of queue[i].neighbors) {
    if (!connected.has(key)) { const node = streetNodes.get(key); connected.set(key, node); queue.push(node); }
  }
  const reachableParking = [...connected.values()];
  const parkingQuery = boxIndex(reachableParking.map((p) => ({ ...p, w: 0, h: 0 })));
  const roadQuery = boxIndex(roads.map((road) => {
    const xs = road.points.map((p) => p[0]), ys = road.points.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { road, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }));
  // These are fictional game depots, using anonymized stylized footprints.
  // These three mission depots are fictional and use anonymous footprints;
  // free-play destruction is initialized separately for every building.
  const excluded = new Set(['police', 'hospital', 'school', 'college', 'university', 'townhall', 'place_of_worship', 'fire_station']);
  const candidates = [];
  const districtCentres = geographic ? CALVI_ANCHORS.missions.map(projectGps) : [
    { x: data.width * .28, y: data.height * .57 }, { x: data.width * .60, y: data.height * .28 }, { x: data.width * .16, y: data.height * .78 },
  ];
  const missionCandidates = geographic ? buildings.filter((building) => districtCentres.some((centre) => distance(centre, { x: building.x + building.w / 2, y: building.y + building.h / 2 }) < 600)) : buildings;
  for (const building of missionCandidates) {
    const tags = building.osmTags || {};
    if (tags.name || tags.historic || tags.amenity || tags.tourism || tags.wall === 'no' || tags.access === 'no' || excluded.has(tags.amenity) || tags.religion || tags.office === 'government' || tags.military) continue;
    if (building.x < 1 || building.y < 1 || building.x + building.w > data.width - 1 || building.y + building.h > data.height - 1) continue;
    const centre = { x: building.x + building.w / 2, y: building.y + building.h / 2 };
    let choice = null;
    for (const { road } of roadQuery(centre, Math.max(building.w, building.h) / 2 + 100)) {
      const onRoad = closestOnLine(centre, road.points);
      if (!onRoad) continue;
      const facade = closestOnLine(onRoad, building.polygon);
      if (!facade) continue;
      const separation = distance(onRoad, facade);
      if (separation < 9 || separation > 90) continue;
      const approach = { x: facade.x + (onRoad.x - facade.x) / separation * 12, y: facade.y + (onRoad.y - facade.y) / separation * 12 };
      if (!walkable(approach, footRadius)) continue;
      const options = parkingQuery(approach, 160);
      if (!options.length) continue;
      const parking = options.reduce((best, p) => distance(p, approach) < distance(best, approach) ? p : best);
      if (distance(parking, approach) > 160) continue;
      if (!choice || distance(parking, approach) < choice.distance) choice = { building, approach, parking: { x: parking.x, y: parking.y }, distance: distance(parking, approach) };
    }
    if (choice) candidates.push(choice);
  }
  const selected = [];
  for (const [index, centre] of districtCentres.entries()) {
    const matching = geographic ? candidates.find((candidate) => candidate.building.osmId === CALVI_ANCHORS.missions[index].osmId) : null;
    const candidate = matching || candidates.filter((c) => selected.every((other) => distance(c.approach, other.approach) > Math.min(220, data.width / 4)))
      .sort((a, b) => distance(a.approach, centre) + a.distance - distance(b.approach, centre) - b.distance)[0];
    if (candidate) selected.push(candidate);
  }
  if (selected.length < 3) for (const candidate of candidates) {
    if (!selected.includes(candidate)) selected.push(candidate);
    if (selected.length === 3) break;
  }
  if (selected.length !== 3) return null;
  selected.forEach((candidate, index) => Object.assign(candidate.building, {
    // Preserve osmId/polygon separately from the deliberately fictional mission.
    missionId: MISSIONS[index].id, missionNumber: index + 1, kind: 'depot', style: 'depot',
    name: MISSIONS[index].title, sign: `DÉPÔT ${index + 1}`, target: true,
    hp: 1, approach: candidate.approach, parking: candidate.parking,
  }));
  const scenery = [];
  // Marina boundaries include water basins. They are not land polygons and
  // must never become a paved island merely because they are leisure areas.
  for (const area of data.areas || []) if (area.kind !== 'marina') scenery.push({ ...area, areaKind: area.kind, ground: true, kind: area.kind === 'beach' ? 'beach' : area.kind === 'wood' || area.kind === 'scrub' ? 'maquis' : 'courtyard' });
  const port = { x: start.x, y: start.y };
  const world = {
    width: data.width, height: data.height, roads, buildings, scenery,
    physics: { playerRadius: footRadius, vehicleRadius, vehicleHalfShaft, navigationRadius: navRadius },
    metadata: { ...data.metadata },
    mapSource: data.metadata?.source || null,
    mapStatus: 'ready',
    coastalSeaMask: data.coastalSeaMask === true,
    landPolygons: data.landPolygons.map((ring) => ring.map((p) => [...p])),
    municipalBoundary: data.municipalBoundary ? structuredClone(data.municipalBoundary) : null,
    places: (data.places || []).map((place) => ({ ...place, osmTags: { ...(place.osmTags || {}) } })),
    seaPolygons: (data.seaPolygons || []).map((ring) => ring.map((p) => [...p])),
    shorelines: (data.shorelines || []).map((ring) => ring.map((p) => [...p])),
    districts: [{ name: 'QUAI DU PORT', ...districtCentres[0] }, { name: 'CITADELLE', ...districtCentres[1] }, { name: 'LA GARE', ...districtCentres[2] }],
    starts: { player: { ...start, dir: startCar.angle }, cars: [], rendezvous: { ...port, radius: 36 }, patrolSpawns: reachableParking.filter((p) => distance(p, start) > 280).filter((_, i) => i % 8 === 0).map(({ x, y }) => ({ x, y, angle: 0 })) },
    visualMeta: { artRevision: 'calvi-vector-2.5d-v1', year: 1994, setting: 'Calvi stylisée, missions et bâtiments scénarisés fictifs', dataset: data.metadata, attribution: data.metadata?.source === 'OpenStreetMap' ? data.metadata.attribution || '© OpenStreetMap contributors' : null },
  };
  populateCalviVehicles(world, { startCar, driveSamples, reachableParking, driveRoads, bodyClear });
  attachBuildingHeights(attachTerrain(decorateCalviWorld(world, { bodyClear })));
  for (const building of world.buildings) {
    const info = buildingHeightInfo(world, building);
    building.sourceHeight = info;
    building.construction.height = info.heightMeters;
    building.construction.heightSource = info.source;
  }
  return world;
}
