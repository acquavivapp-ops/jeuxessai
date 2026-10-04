// Fictional vehicles placed alongside the unchanged, source-connected OSM
// streets. These are game actors, not surveyed parking spaces or OSM POIs.
import { calviLandmarks } from './universe.js';
const CELL = 96;
const RADIUS = 8;
const HALF_SHAFT = 7;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const point = ([x, y]) => ({ x, y });
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const COLORS = ['#b99349', '#b15547', '#789692', '#ddd0aa', '#7c8bab', '#c0b7a3', '#556e54', '#b4a278'];
const LIMITS = Object.freeze({ parked: 32, traffic: 6, parkingSamples: 3200, trafficRoads: 100, routePoints: 600 });

function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a[1] > p.y) !== (b[1] > p.y) && p.x < (b[0] - a[0]) * (p.y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function pointSegmentSquared(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
  return (p[0] - a[0] - dx * t) ** 2 + (p[1] - a[1] - dy * t) ** 2;
}

function segmentSquared(a, b, c, d) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const overlap = Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0]))
    && Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]));
  if (overlap && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return 0;
  return Math.min(pointSegmentSquared(a, c, d), pointSegmentSquared(b, c, d), pointSegmentSquared(c, a, b), pointSegmentSquared(d, a, b));
}

function axis(p, shaft = HALF_SHAFT) {
  const dx = Math.cos(p.angle) * shaft, dy = Math.sin(p.angle) * shaft;
  return [[p.x - dx, p.y - dy], [p.x + dx, p.y + dy]];
}

function touchesRing(body, ring, radius = RADIUS) {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (segmentSquared(body[0], body[1], ring[j], ring[i]) < radius * radius) return true;
  return false;
}

function spatialIndex(items, bounds) {
  const cells = new Map();
  for (const item of items) {
    const b = bounds(item);
    for (let y = Math.floor(b.y / CELL); y <= Math.floor((b.y + b.h) / CELL); y++) for (let x = Math.floor(b.x / CELL); x <= Math.floor((b.x + b.w) / CELL); x++) {
      const key = `${x},${y}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(item);
    }
  }
  return (p) => cells.get(`${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`) || [];
}

/** Populate an imported city without blocking its original navigation lines. */
export function populateCalviVehicles(world, { startCar, driveSamples, reachableParking, driveRoads, bodyClear: importedBodyClear }) {
  const buildingsAt = importedBodyClear ? () => [] : spatialIndex(world.buildings, (b) => ({ x: b.x - 18, y: b.y - 18, w: b.w + 36, h: b.h + 36 }));
  const segments = driveRoads.flatMap((road) => road.points.slice(1).map((b, i) => ({ a: road.points[i], b, road })));
  const segmentsAt = spatialIndex(segments, ({ a, b }) => ({ x: Math.min(a[0], b[0]) - 44, y: Math.min(a[1], b[1]) - 44, w: Math.abs(a[0] - b[0]) + 88, h: Math.abs(a[1] - b[1]) + 88 }));
  const reachableAt = spatialIndex(reachableParking, (p) => ({ x: p.x - 34, y: p.y - 34, w: 68, h: 68 }));
  const reserved = [world.starts.player, world.starts.rendezvous, ...world.buildings.filter((b) => b.target).flatMap((b) => [b.approach, b.parking]).filter(Boolean)];
  const landmarks = calviLandmarks(world);
  const sourceParking = (world.scenery || []).filter(area => area.polygon?.length && (area.areaKind === 'parking' || area.kind === 'parking' || area.osmTags?.amenity === 'parking'));
  const parkingAt = spatialIndex(sourceParking, area => {
    const xs = area.polygon.map(p => p[0]), ys = area.polygon.map(p => p[1]);
    return { x: Math.min(...xs) - 44, y: Math.min(...ys) - 44, w: Math.max(...xs) - Math.min(...xs) + 88, h: Math.max(...ys) - Math.min(...ys) + 88 };
  });

  function bodyClear(p, radius = RADIUS, shaft = HALF_SHAFT) {
    if (importedBodyClear) return importedBodyClear(p, radius, shaft);
    const body = axis(p, shaft), locations = [p, ...body.map(point)];
    if (locations.some((q) => q.x <= radius || q.y <= radius || q.x >= world.width - radius || q.y >= world.height - radius)) return false;
    if (!world.landPolygons.some((ring) => locations.every((q) => inRing(q, ring)) && !touchesRing(body, ring, radius))) return false;
    if ((world.seaPolygons || []).some((ring) => locations.some((q) => inRing(q, ring)) || touchesRing(body, ring, radius))) return false;
    const municipal = world.municipalBoundary?.polygons;
    if (municipal?.length && !municipal.some(({ outer, holes = [] }) => locations.every(q => inRing(q, outer)) && !touchesRing(body, outer, radius)
      && !holes.some(ring => locations.some(q => inRing(q, ring)) || touchesRing(body, ring, radius)))) return false;
    return !buildingsAt(p).some((b) => locations.some((q) => inRing(q, b.polygon) && !(b.holes || []).some((hole) => inRing(q, hole)))
      || touchesRing(body, b.polygon, radius) || (b.holes || []).some((hole) => touchesRing(body, hole, radius)));
  }

  function connected(p) {
    return reachableAt(p).some((node) => {
      const d = distance(node, p);
      if (d >= 34) return false;
      const steps = Math.max(1, Math.ceil(d / 5));
      for (let i = 0; i <= steps; i++) if (!bodyClear({ x: p.x + (node.x - p.x) * i / steps, y: p.y + (node.y - p.y) * i / steps, angle: 0 }, world.physics.navigationRadius, 0)) return false;
      return true;
    });
  }

  function pathClear(from, to) {
    const steps = Math.max(1, Math.ceil(distance(from, to) / 5));
    for (let i = 0; i <= steps; i++) if (!bodyClear({ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps, angle: to.angle })) return false;
    return true;
  }

  function missionClear(p, radius = 80) {
    return reserved.every((q) => distance(p, q) >= radius);
  }

  const cars = [{ id: 'car-start', ...startCar, speed: 0, color: COLORS[0], kind: 'parked', hp: 260, maxHp: 260, owned: true, occupied: false, stolen: false, destroyed: false }];
  const candidates = [];
  const roadById = new Map(driveRoads.map((road) => [road.id, road]));
  // Preserve dense coverage around departure; elsewhere a fixed sample
  // budget prevents the municipal map from multiplying population costs.
  const samples = driveSamples.filter(sample => distance(sample, startCar) < 500).slice(0, 900);
  const included = new Set(samples);
  const parkingSamples = driveSamples.filter(sample => parkingAt(sample).length);
  for (let i = 0; i < Math.min(800, parkingSamples.length); i++) {
    const sample = parkingSamples[Math.floor(i * parkingSamples.length / Math.min(800, parkingSamples.length))];
    if (!included.has(sample)) { samples.push(sample); included.add(sample); }
  }
  const remoteBudget = LIMITS.parkingSamples - samples.length;
  for (let i = 0; i < remoteBudget && driveSamples.length; i++) {
    const sample = driveSamples[Math.min(driveSamples.length - 1, Math.floor(i * driveSamples.length / remoteBudget))];
    if (!included.has(sample)) { samples.push(sample); included.add(sample); }
  }
  for (const sample of samples) {
    if (!connected(sample)) continue;
    const road = roadById.get(sample.roadId);
    if (!road) continue;
    const nx = -Math.sin(sample.angle), ny = Math.cos(sample.angle);
    for (const side of [1, -1]) {
      for (const setback of [Math.max(22, road.width / 2 + 8), Math.max(30, road.width / 2 + 16), Math.max(38, road.width / 2 + 24)]) {
        const p = { x: sample.x + nx * setback * side, y: sample.y + ny * setback * side, angle: sample.angle, sourceRoadId: road.id, access: { x: sample.x, y: sample.y } };
        if (!missionClear(p) || !bodyClear(p) || !pathClear(sample, p)) continue;
        // A body fitting when parked is insufficient: reserve room to turn
        // into the genuine source street and drive out of the setback.
        if (!bodyClear(p, 16, 0) || !bodyClear(sample, 16, 0)
          || !pathClear(sample, { ...p, angle: Math.atan2(sample.y - p.y, sample.x - p.x) })) continue;
        // Leave the navigation capsule a continuous corridor on every nearby
        // source street, including intersections and adjoining source ways.
        const body = axis(p);
        if (segmentsAt(p).some(({ a, b }) => segmentSquared(body[0], body[1], a, b) < 30 ** 2)) continue;
        const parkingBody = axis(p), parkingLocations = [p, ...parkingBody.map(point)];
        const area = parkingAt(p).find(area => parkingLocations.every(location => inRing(location, area.polygon)) && !touchesRing(parkingBody, area.polygon)
          && !(area.holes || []).some(ring => parkingLocations.some(location => inRing(location, ring)) || touchesRing(parkingBody, ring)));
        if (area) Object.assign(p, { sourceParkingId: area.id, parkingPlacement: 'inside-imported-parking-area' });
        else p.parkingPlacement = 'fictional-clear-street-setback';
        candidates.push(p);
        break;
      }
    }
  }
  const choose = (candidate) => {
    if (cars.some((car) => distance(car, candidate) < 52)) return false;
    cars.push({ id: `calvi-car-${cars.length}`, ...candidate, speed: 0, color: COLORS[cars.length % COLORS.length], kind: 'parked', hp: 260, maxHp: 260, owned: false, occupied: false, stolen: false, destroyed: false });
    return true;
  };
  // Three alternatives near the port, then distribute the remaining parked
  // vehicles across the connected city instead of crowding its first street.
  candidates.sort((a, b) => distance(a, world.starts.player) - distance(b, world.starts.player));
  for (const p of candidates) {
    if (distance(p, world.starts.player) > 250 || cars.length >= 4) break;
    choose(p);
  }
  // Prefer actual parking surfaces around the named places, while retaining
  // the source-connected lane and clearance checks applied above.
  for (const landmark of landmarks) {
    let placed = 0;
    const local = candidates.filter(p => distance(p, landmark) < 1100)
      .sort((a, b) => Number(Boolean(b.sourceParkingId)) - Number(Boolean(a.sourceParkingId)) || distance(a, landmark) - distance(b, landmark));
    for (const candidate of local) {
      if (cars.length >= LIMITS.parked || placed >= 2) break;
      if (choose(candidate)) placed++;
    }
  }
  while (cars.length < LIMITS.parked) {
    let best = null, separation = 0;
    for (const candidate of candidates) {
      const nearest = Math.min(...cars.map((car) => distance(car, candidate)));
      if (nearest > Math.max(52, separation)) { best = candidate; separation = nearest; }
    }
    if (!best || !choose(best)) break;
  }

  const routeCandidates = [];
  const trafficRoads = driveRoads.filter(road => road.width >= 28)
    .sort((a, b) => {
      const priority = road => ['primary', 'secondary', 'tertiary'].includes(road.type) ? 0 : 1;
      return priority(a) - priority(b) || b.points.length - a.points.length;
    }).slice(0, LIMITS.trafficRoads);
  for (const road of trafficRoads) {
    let run = [];
    const save = () => {
      if (run.length > 1) {
        const length = run.slice(1).reduce((sum, p, i) => sum + distance(point(p), point(run[i])), 0);
        if (length >= 190) routeCandidates.push({ route: run, road, length, safety: Math.min(...run.map((p) => Math.min(...reserved.map((q) => distance(point(p), q))))) });
      }
      run = [];
    };
    for (let i = 1; i < road.points.length; i++) {
      const a = point(road.points[i - 1]), b = point(road.points[i]);
      const length = distance(a, b), steps = Math.max(1, Math.ceil(length / 10)), angle = Math.atan2(b.y - a.y, b.x - a.x);
      for (let step = 0; step <= steps; step++) {
        const p = { x: a.x + (b.x - a.x) * step / steps, y: a.y + (b.y - a.y) * step / steps, angle };
        if (!connected(p) || !missionClear(p, 180) || !bodyClear(p) || cars.some((car) => distance(car, p) < 24)) { save(); continue; }
        const last = run.at(-1);
        if (!last || distance(point(last), p) > .01) run.push([p.x, p.y]);
        if (run.length >= LIMITS.routePoints) save();
      }
    }
    save();
  }
  routeCandidates.sort((a, b) => b.safety - a.safety || b.length - a.length);
  const usedRoads = new Set();
  for (const candidate of routeCandidates) {
    if (usedRoads.has(candidate.road.id) || cars.filter((car) => car.kind === 'traffic').length >= LIMITS.traffic) continue;
    const p = point(candidate.route[Math.floor(candidate.route.length / 2)]);
    if (cars.some((car) => distance(car, p) < 80)) continue;
    const at = Math.floor(candidate.route.length / 2), next = point(candidate.route[at + 1]);
    const number = cars.filter((car) => car.kind === 'traffic').length;
    cars.push({ id: `calvi-traffic-${number + 1}`, ...p, angle: Math.atan2(next.y - p.y, next.x - p.x), speed: 0, color: COLORS[(number + 4) % COLORS.length], kind: 'traffic', route: candidate.route, roadIds: [candidate.road.id], sourceRoadId: candidate.road.id, routeIndex: at + 1, direction: 1, cruise: 34 + number * 2, hp: 260, maxHp: 260, owned: false, occupied: true, stolen: false, destroyed: false, driver: { kind: 'civilian', variant: number + 1 } });
    usedRoads.add(candidate.road.id);
  }
  world.starts.cars = cars;
  world.visualMeta.vehiclePlacement = { fictional: true, revision: 'calvi-municipal-street-population-v2', parked: cars.filter((car) => car.kind === 'parked').length, traffic: cars.filter((car) => car.kind === 'traffic').length, roadNavigationClearance: 30, limits: LIMITS, examinedParkingSamples: samples.length, sourceParkingCount: cars.filter(car => car.sourceParkingId).length };
  return world;
}
