// Photo-annotated vehicle conversion. Only accepted, physically valid actors
// receive a persistent photographic removal mask.
import { CALVI_AERIAL_OBJECTS } from './data/calvi-aerial-objects.js';
import { createWorldVegetationIndexes, capsuleTouchesVegetation } from './vegetation.js';
import { createPierIndex, circleFitsPier, capsuleTouchesPier } from './piers.js';
export const AERIAL_VEHICLE_CELL_SIZE = 512;
const RADIUS = 4;
const SHAFT = 5;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const PHOTO_CELL = 128;
const HULL_CAPSULES = new WeakMap();

// The photograph's bounding rectangle includes tapered bows and rigging. A
// circumscribed capsule therefore overlaps neighbouring moored hulls. Retain
// that rectangle for drawing, but fit the largest centred capsule *inside*
// the undilated, observed convex hull. For each inward edge distance d and
// heading projection c, an inscribed capsule satisfies r + c*s <= d.
export function inscribedPhotoHullCapsule(annotation) {
  if (HULL_CAPSULES.has(annotation)) return HULL_CAPSULES.get(annotation);
  const ring = annotation.bodyPolygonWorld;
  if (!Array.isArray(ring) || ring.length < 3 || !ring.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) return null;
  const points = ring.map(([x, y]) => [x - annotation.x, y - annotation.y]);
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const signedArea = points.reduce((sum, a, i) => sum + cross(a, points[(i + 1) % points.length]), 0) / 2;
  if (!Number.isFinite(signedArea) || Math.abs(signedArea) < 1e-6) return null;
  const orientation = Math.sign(signedArea), heading = [Math.cos(annotation.angle), Math.sin(annotation.angle)], edges = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], edge = [b[0] - a[0], b[1] - a[1]], length = Math.hypot(...edge);
    if (!length) continue;
    const d = orientation * cross(edge, [-a[0], -a[1]]) / length;
    if (d <= 0 || points.some(p => orientation * cross(edge, [p[0] - a[0], p[1] - a[1]]) < -1e-6)) return null;
    edges.push({ d, c: Math.abs(cross(edge, heading)) / length });
  }
  if (edges.length < 3) return null;
  const maxShaft = Math.min(...edges.filter(edge => edge.c > 1e-10).map(edge => edge.d / edge.c));
  const candidates = [0, maxShaft];
  // The limiting radius is piecewise linear. Area is quadratic on each
  // piece, so its maximum is an edge intersection or a stationary point.
  for (let i = 0; i < edges.length; i++) {
    const { d, c } = edges[i];
    if (c > 1e-10) candidates.push(d * (4 - 2 * Math.PI * c) / (8 * c - 2 * Math.PI * c * c));
    for (let j = 0; j < i; j++) if (Math.abs(c - edges[j].c) > 1e-10) candidates.push((d - edges[j].d) / (c - edges[j].c));
  }
  let best = null;
  for (const halfLength of candidates) {
    if (!Number.isFinite(halfLength) || halfLength < 0 || halfLength > maxShaft) continue;
    const radius = Math.min(...edges.map(({ d, c }) => d - c * halfLength)) - 1e-7;
    if (radius <= 0) continue;
    const capsuleArea = 4 * radius * halfLength + Math.PI * radius * radius;
    if (!best || capsuleArea > best.capsuleArea) best = { radius, halfLength, capsuleArea };
  }
  if (!best) return null;
  const result = { ...best, method: 'maximum-area centered capsule inscribed in native photo hull',
    sourceHullPointCount: ring.length, hullArea: Math.abs(signedArea), coverageRatio: best.capsuleArea / Math.abs(signedArea),
    arcadeCollisionApproximation: true };
  HULL_CAPSULES.set(annotation, result);
  return result;
}

function dimensions(p) {
  if (p.mobilityType === 'boat' && !Number.isFinite(p.collisionRadius)) {
    const inscribed = inscribedPhotoHullCapsule(p);
    if (inscribed) return inscribed;
  }
  const radius = p.collisionRadius ?? (Number.isFinite(p.width) ? p.width / 2 : RADIUS);
  const halfLength = p.collisionHalfLength ?? (Number.isFinite(p.length) ? Math.max(0, (p.length - radius * 2) / 2) : SHAFT);
  return { radius, halfLength };
}

function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a[1] > p.y) !== (b[1] > p.y) && p.x < (b[0] - a[0]) * (p.y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function pointDistanceSquared(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], span = dx * dx + dy * dy;
  const t = span ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / span)) : 0;
  return (p[0] - a[0] - dx * t) ** 2 + (p[1] - a[1] - dy * t) ** 2;
}

function segmentDistanceSquared(a, b, c, d) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const overlap = Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0]))
    && Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]));
  if (overlap && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return 0;
  return Math.min(pointDistanceSquared(a, c, d), pointDistanceSquared(b, c, d), pointDistanceSquared(c, a, b), pointDistanceSquared(d, a, b));
}

function axis(p, shaft = dimensions(p).halfLength) {
  const dx = Math.cos(p.angle || 0) * shaft, dy = Math.sin(p.angle || 0) * shaft;
  return [[p.x - dx, p.y - dy], [p.x + dx, p.y + dy]];
}

function touches(body, ring, radius) {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (segmentDistanceSquared(body[0], body[1], ring[j], ring[i]) < radius * radius) return true;
  }
  return false;
}

function fits(p, body, polygon, radius) {
  const ring = polygon.outer || polygon.polygon || polygon;
  const points = [p, ...body.map(([x, y]) => ({ x, y }))];
  return points.every(q => inRing(q, ring)) && !touches(body, ring, radius)
    && !(polygon.holes || []).some(hole => points.some(q => inRing(q, hole)) || touches(body, hole, radius));
}

function bodyClear(world, p, radius = dimensions(p).radius, shaft = dimensions(p).halfLength, context = null) {
  const body = axis(p, shaft), ex = radius + Math.abs(Math.cos(p.angle || 0) * shaft), ey = radius + Math.abs(Math.sin(p.angle || 0) * shaft);
  if (p.x < ex || p.y < ey || p.x > world.width - ex || p.y > world.height - ey
    || !world.landPolygons.some(ring => fits(p, body, ring, radius))
    || !world.municipalBoundary.polygons.some(polygon => fits(p, body, polygon, radius))
    || capsuleTouchesVegetation(context?.vegetation, body, radius)) return false;
  const candidates = context ? nearbyBuildings(context.buildings, p.x - ex, p.y - ey, p.x + ex, p.y + ey) : world.buildings;
  return !candidates.some(building => {
    if (building.destroyed) return false;
    if (p.x + ex < building.x || p.x - ex > building.x + building.w || p.y + ey < building.y || p.y - ey > building.y + building.h) return false;
    return [p, ...body.map(([x, y]) => ({ x, y }))].some(q => inRing(q, building.polygon) && !(building.holes || []).some(hole => inRing(q, hole)))
      || touches(body, building.polygon, radius) || (building.holes || []).some(hole => touches(body, hole, radius));
  });
}

function waterBodyClear(world, p, radius, shaft, context) {
  const body = axis(p, shaft), ex = radius + Math.abs(Math.cos(p.angle) * shaft), ey = radius + Math.abs(Math.sin(p.angle) * shaft);
  if (p.x < ex || p.y < ey || p.x > world.width - ex || p.y > world.height - ey || capsuleTouchesVegetation(context.vegetation, body, radius)) return false;
  return !capsuleTouchesPier(context.piers, body, radius)
    && !world.landPolygons.some(ring => [p, ...body.map(([x, y]) => ({ x, y }))].some(point => inRing(point, ring)) || touches(body, ring, radius));
}

function actorsClear(world, p, cars, ignoreId = null) {
  const body = axis(p), ownRadius = dimensions(p).radius;
  if (world.scenery.some(actor => actor.kind === 'pedestrian' && !actor.dead && pointDistanceSquared([actor.x, actor.y], ...body) < (ownRadius + 4) ** 2)) return false;
  return cars.every(car => {
    if (car.id === ignoreId || car.destroyed) return true;
    if (car.mobilityType && !Number.isFinite(car.collisionHalfLength)) {
      const radius = car.mobilityType === 'plane' ? 18 : car.mobilityType === 'helicopter' ? 12 : car.mobilityType === 'boat' ? 9 : 5;
      return pointDistanceSquared([car.x, car.y], ...body) >= (ownRadius + radius) ** 2;
    }
    const otherRadius = car.collisionRadius ?? 8, otherShaft = car.collisionHalfLength ?? 7;
    return segmentDistanceSquared(...body, ...axis(car, otherShaft)) >= (ownRadius + otherRadius) ** 2;
  });
}

function nearbyBuildings(index, minX, minY, maxX, maxY) {
  const found = new Set();
  for (let cy = Math.floor(minY / PHOTO_CELL); cy <= Math.floor(maxY / PHOTO_CELL); cy++) {
    for (let cx = Math.floor(minX / PHOTO_CELL); cx <= Math.floor(maxX / PHOTO_CELL); cx++) for (const building of index.get(`${cx},${cy}`) || []) found.add(building);
  }
  return [...found];
}

function geometryContext(world) {
  const buildings = new Map();
  for (const building of world.buildings) for (let cy = Math.floor(building.y / PHOTO_CELL); cy <= Math.floor((building.y + building.h) / PHOTO_CELL); cy++) {
    for (let cx = Math.floor(building.x / PHOTO_CELL); cx <= Math.floor((building.x + building.w) / PHOTO_CELL); cx++) {
      const key = `${cx},${cy}`;
      if (!buildings.has(key)) buildings.set(key, []);
      buildings.get(key).push(building);
    }
  }
  return { buildings, vegetation: createWorldVegetationIndexes(world).collision, piers: createPierIndex(world), footCache: new Map() };
}

function maskFor(annotation, vehicleId) {
  const polygon = annotation.maskPolygon.map(point => [...point]);
  const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { vehicleId, annotationId: annotation.id, polygon, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y,
    groundPatch: structuredClone(annotation.groundPatch || {}), groundColor: annotation.groundPatch?.color || annotation.groundColor || '#66685f',
    sourceImage: structuredClone(annotation.sourcePlacement), persistent: true,
    surface: annotation.mobilityType === 'boat' ? 'water' : 'land', mobilityType: annotation.mobilityType || 'car' };
}

function validAnnotation(annotation, world) {
  const ring = annotation?.maskPolygon;
  const type = annotation?.mobilityType;
  const maskLimit = type === 'plane' ? 360 : type === 'boat' ? 260 : 80;
  const source = annotation?.sourcePlacement, bounds = source?.sourceBoundsWorld, centre = source?.centerPixel;
  const sourcePositionMatches = bounds && [bounds.x, bounds.y, bounds.w, bounds.h, source.sourceImageWidth, source.sourceImageHeight].every(Number.isFinite)
    && bounds.w > 0 && bounds.h > 0 && source.sourceImageWidth > 0 && source.sourceImageHeight > 0
    && Array.isArray(centre) && centre.length === 2 && centre.every(Number.isFinite)
    && centre[0] >= 0 && centre[1] >= 0 && centre[0] <= source.sourceImageWidth && centre[1] <= source.sourceImageHeight
    && Math.abs(bounds.x + centre[0] / source.sourceImageWidth * bounds.w - annotation.x) <= .05
    && Math.abs(bounds.y + centre[1] / source.sourceImageHeight * bounds.h - annotation.y) <= .05;
  return annotation?.id && [annotation.x, annotation.y, annotation.angle, annotation.width, annotation.length].every(Number.isFinite)
    && [undefined, 'boat', 'plane'].includes(type)
    && annotation.width > 0 && annotation.length > 0 && annotation.width <= (type ? 220 : 40) && annotation.length <= (type ? 300 : 60)
    && Array.isArray(ring) && ring.length >= 4 && ring.length <= 24 && ring.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
      && p[0] >= 0 && p[1] >= 0 && p[0] <= world.width && p[1] <= world.height)
    && Math.max(...ring.map(p => p[0])) - Math.min(...ring.map(p => p[0])) <= maskLimit
    && Math.max(...ring.map(p => p[1])) - Math.min(...ring.map(p => p[1])) <= maskLimit
    && inRing(annotation, ring) && sourcePositionMatches && source?.tileId && /^[a-f0-9]{64}$/i.test(source?.sha256 || '')
    && (type !== 'boat' || Boolean(inscribedPhotoHullCapsule(annotation)));
}

function sourceMatchesWorld(world, dataset) {
  const b = world?.metadata?.bounds, metadata = dataset?.metadata;
  return world?.mapStatus === 'ready' && world.metadata?.city === 'Calvi' && world.municipalBoundary?.insee === '2B050'
    && world.landPolygons?.length && world.roads?.length && world.buildings?.length && world.scenery?.length
    && world.starts?.player && metadata?.status === 'ready' && metadata.worldWidth === world.width && metadata.worldHeight === world.height
    && b && ['west', 'south', 'east', 'north'].every(key => metadata.boundsWGS84?.[key] === b[key]) && Array.isArray(dataset.vehicles);
}

function clearFootPoint(world, p, radius, cars, ignoredId, context) {
  const key = `${p.x},${p.y},${radius}`;
  let staticClear = context.footCache.get(key);
  if (staticClear === undefined) {
    staticClear = bodyClear(world, p, radius, 0, context) || circleFitsPier(context.piers, p.x, p.y, radius);
    context.footCache.set(key, staticClear);
  }
  if (!staticClear) return false;
  return cars.every(car => {
    if (car.id === ignoredId || car.destroyed) return true;
    if (car.mobilityType && !Number.isFinite(car.collisionHalfLength)) {
      const otherRadius = car.mobilityType === 'plane' ? 18 : car.mobilityType === 'helicopter' ? 12 : car.mobilityType === 'boat' ? 9 : 5;
      return distance(car, p) >= radius + otherRadius;
    }
    return pointDistanceSquared([p.x, p.y], ...axis(car, car.collisionHalfLength ?? 7)) >= (radius + (car.collisionRadius || 8)) ** 2;
  });
}

function clearFootSegment(world, from, to, radius, cars, ignoredId, context) {
  const body = [[from.x, from.y], [to.x, to.y]];
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, angle: Math.atan2(to.y - from.y, to.x - from.x) };
  if (!bodyClear(world, mid, radius, distance(from, to) / 2, context)) {
    const steps = Math.max(1, Math.ceil(distance(from, to) / 2));
    for (let i = 0; i <= steps; i++) {
      const point = { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps };
      if (!bodyClear(world, point, radius, 0, context) && !circleFitsPier(context.piers, point.x, point.y, radius)) return false;
    }
  }
  return cars.every(car => {
    if (car.id === ignoredId || car.destroyed) return true;
    const round = car.mobilityType && !Number.isFinite(car.collisionHalfLength);
    const other = round ? [[car.x, car.y], [car.x, car.y]] : axis(car, car.collisionHalfLength ?? 7);
    const otherRadius = round ? (car.collisionRadius || (car.mobilityType === 'plane' ? 18 : car.mobilityType === 'helicopter' ? 12 : car.mobilityType === 'boat' ? 9 : 5)) : car.collisionRadius || 8;
    return segmentDistanceSquared(...body, ...other) >= (radius + otherRadius) ** 2;
  });
}

function streetSegments(world) {
  const segments = [], index = new Map();
  for (const road of world.roads) {
    if (road.type === 'steps' || Number(road.layer || 0) !== 0 || road.tunnel === 'yes') continue;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], segment = { a, b, road };
      segments.push(segment);
      for (let cy = Math.floor(Math.min(a[1], b[1]) / AERIAL_VEHICLE_CELL_SIZE); cy <= Math.floor(Math.max(a[1], b[1]) / AERIAL_VEHICLE_CELL_SIZE); cy++) {
        for (let cx = Math.floor(Math.min(a[0], b[0]) / AERIAL_VEHICLE_CELL_SIZE); cx <= Math.floor(Math.max(a[0], b[0]) / AERIAL_VEHICLE_CELL_SIZE); cx++) {
          const key = `${cx},${cy}`;
          if (!index.has(key)) index.set(key, []);
          index.get(key).push(segment);
        }
      }
    }
  }
  return { segments, index };
}

function project(p, segment) {
  const { a, b } = segment, dx = b[0] - a[0], dy = b[1] - a[1], span = dx * dx + dy * dy;
  const t = span ? Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / span)) : 0;
  const access = { x: a[0] + dx * t, y: a[1] + dy * t };
  return { ...segment, access, gap: distance(p, access) };
}

function nearbyStreets(p, streets, range = 768) {
  const found = new Set();
  for (let cy = Math.floor((p.y - range) / AERIAL_VEHICLE_CELL_SIZE); cy <= Math.floor((p.y + range) / AERIAL_VEHICLE_CELL_SIZE); cy++) {
    for (let cx = Math.floor((p.x - range) / AERIAL_VEHICLE_CELL_SIZE); cx <= Math.floor((p.x + range) / AERIAL_VEHICLE_CELL_SIZE); cx++) for (const segment of streets.index.get(`${cx},${cy}`) || []) found.add(segment);
  }
  return [...found].map(segment => project(p, segment)).filter(item => item.gap <= range).sort((a, b) => a.gap - b.gap).slice(0, 32);
}

function entryCandidates(annotation, footRadius) {
  const shape = dimensions(annotation), along = shape.halfLength + shape.radius + footRadius + .5, side = shape.radius + footRadius + .5;
  const candidates = [];
  // Side doors first, then free space near the bumper when tightly parked.
  for (const offset of [Math.PI / 2, -Math.PI / 2, 0, Math.PI, Math.PI / 4, -Math.PI / 4, 3 * Math.PI / 4, -3 * Math.PI / 4]) {
    const angle = annotation.angle + offset, reach = Math.abs(Math.cos(offset)) < .1 ? side : along;
    candidates.push({ x: annotation.x + Math.cos(angle) * reach, y: annotation.y + Math.sin(angle) * reach });
  }
  return candidates;
}

function pedestrianAccess(world, annotation, cars, context, streets) {
  const footRadius = world.physics?.playerRadius || 4, nearby = nearbyStreets(annotation, streets);
  const id = annotation.id, candidates = entryCandidates(annotation, footRadius).filter(entry =>
    clearFootPoint(world, entry, footRadius, cars, id, context) && clearFootSegment(world, entry, annotation, footRadius, cars, id, context));
  for (const entry of candidates) for (const item of nearby) {
    if (clearFootSegment(world, item.access, entry, footRadius, cars, id, context)) {
      return { sourceRoadId: item.road.id, access: item.access, entryPoint: entry, entryPath: [item.access, entry] };
    }
  }
  if (!candidates.length || !nearby.length) return null;
  // Search actual free land around the observation. This adds no road or
  // imaginary parking aisle; every edge is a swept physical foot capsule.
  const step = 6, limit = 600, maxNodes = 14000;
  const goalSegments = nearby.filter(item => item.gap <= limit);
  for (const entry of candidates) {
    const start = { x: Math.round(entry.x / step) * step, y: Math.round(entry.y / step) * step };
    if (!clearFootSegment(world, entry, start, footRadius, cars, id, context)) continue;
    const key = p => `${p.x},${p.y}`, queue = [start], visited = new Map([[key(start), { point: start, previous: null }]]);
    for (let head = 0; head < queue.length && head < maxNodes; head++) {
      const point = queue[head];
      for (const segment of goalSegments) {
        const item = project(point, segment);
        if (item.gap > 12 || !clearFootSegment(world, point, item.access, footRadius, cars, id, context)) continue;
        const path = [];
        for (let node = visited.get(key(point)); node; node = node.previous) path.push(node.point);
        return { sourceRoadId: item.road.id, access: item.access, entryPoint: entry, entryPath: [item.access, ...path, entry] };
      }
      for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, step], [step, -step], [-step, -step]]) {
        const next = { x: point.x + dx, y: point.y + dy }, nextKey = key(next);
        if (visited.has(nextKey) || Math.abs(next.x - annotation.x) > limit || Math.abs(next.y - annotation.y) > limit
          || !clearFootPoint(world, next, footRadius, cars, id, context) || !clearFootSegment(world, point, next, footRadius, cars, id, context)) continue;
        visited.set(nextKey, { point: next, previous: visited.get(key(point)) }); queue.push(next);
      }
    }
  }
  return null;
}

function clearActorSegment(from, to, radius, cars, ignoredId) {
  return cars.every(car => {
    if (car.id === ignoredId || car.destroyed) return true;
    const round = car.mobilityType && !Number.isFinite(car.collisionHalfLength);
    const other = round ? [[car.x, car.y], [car.x, car.y]] : axis(car, car.collisionHalfLength ?? 7);
    const otherRadius = round ? (car.mobilityType === 'plane' ? 18 : car.mobilityType === 'helicopter' ? 12 : car.mobilityType === 'boat' ? 9 : 5) : car.collisionRadius ?? 8;
    return segmentDistanceSquared([from.x, from.y], [to.x, to.y], ...other) >= (radius + otherRadius) ** 2;
  });
}

function openingCoastBoarding(world, annotation, cars, context) {
  // A nearby observed hull can face the genuine solid quay rather than the
  // nearest OSM pier. Derive a foot position from the unchanged coastline;
  // this is an estimated interaction point, never a new strip of land.
  if (distance(annotation, world.starts.player) > 160) return null;
  const footRadius = world.physics?.playerRadius || 4, shape = dimensions(annotation), candidates = [];
  for (let polygonIndex = 0; polygonIndex < world.landPolygons.length; polygonIndex++) {
    const ring = world.landPolygons[polygonIndex];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dy = b[1] - a[1], span = Math.hypot(dx, dy);
      if (!span || pointDistanceSquared([annotation.x, annotation.y], a, b) > (shape.radius + shape.halfLength + 32 + footRadius) ** 2) continue;
      const t = Math.max(0, Math.min(1, ((annotation.x - a[0]) * dx + (annotation.y - a[1]) * dy) / (span * span)));
      for (const along of [0, -4, 4, -8, 8, -12, 12, -20, 20]) for (const sign of [-1, 1]) {
        const point = { x: a[0] + dx * t + dx / span * along - dy / span * (footRadius + .5) * sign,
          y: a[1] + dy * t + dy / span * along + dx / span * (footRadius + .5) * sign };
        const gap = Math.sqrt(pointDistanceSquared([point.x, point.y], ...axis(annotation))) - shape.radius;
        if (gap < footRadius || gap > 28 || !bodyClear(world, point, footRadius, 0, context)
          || !clearFootPoint(world, point, footRadius, cars, annotation.id, context)
          || !clearActorSegment(point, annotation, footRadius, cars, annotation.id)
          || capsuleTouchesVegetation(context.vegetation, [[point.x, point.y], [annotation.x, annotation.y]], 2)) continue;
        const line = [[point.x, point.y], [annotation.x, annotation.y]];
        if (nearbyBuildings(context.buildings, Math.min(point.x, annotation.x) - 2, Math.min(point.y, annotation.y) - 2,
          Math.max(point.x, annotation.x) + 2, Math.max(point.y, annotation.y) + 2).some(building => !building.destroyed
          && (inRing(point, building.polygon) || touches(line, building.polygon, 2)))) continue;
        candidates.push({ point, polygonIndex, edgeIndex: i });
      }
    }
  }
  candidates.sort((a, b) => distance(a.point, world.starts.player) - distance(b.point, world.starts.player));
  const candidate = candidates[0];
  return candidate ? { accessMode: 'coast-boarding', boarding: { ...candidate.point }, entryPoint: { ...candidate.point },
    boardingPlacement: { provider: 'OpenStreetMap', geometry: 'unchanged mapped coastline', positionEstimated: true,
      landPolygonIndex: candidate.polygonIndex, edgeIndex: candidate.edgeIndex, maximumHullGap: 28 } } : null;
}

function boatAccess(world, annotation, cars, context) {
  const boarding = annotation.boarding;
  if (!boarding) return { accessMode: 'water-transfer' };
  if (![boarding.x, boarding.y].every(Number.isFinite)) return null;
  const footRadius = world.physics?.playerRadius || 4, shape = dimensions(annotation);
  const gap = Math.max(0, Math.sqrt(pointDistanceSquared([boarding.x, boarding.y], ...axis(annotation))) - shape.radius);
  // A source pier can be the nearest real quay without being within boarding
  // reach of this particular mooring. Such boats are approached on the water;
  // never publish a distant point that would imply teleporting to their hull.
  const waterAccess = reason => openingCoastBoarding(world, annotation, cars, context) || { accessMode: 'water-transfer', boardingUnavailableReason: reason };
  if (gap > 28) return waterAccess('observed-pier-beyond-physical-boarding-reach');
  if (!clearFootPoint(world, boarding, footRadius, cars, annotation.id, context)) return waterAccess('observed-pier-entry-obstructed');
  const sourcePierId = annotation.sourcePierId || boarding.sourcePierId;
  if (sourcePierId) {
    const pier = world.piers?.find(pier => pier.id === sourcePierId || pier.sourceId === sourcePierId);
    if (!pier || !pier.points.slice(1).some((b, i) => pointDistanceSquared([boarding.x, boarding.y], pier.points[i], b) <= (pier.width / 2 - footRadius) ** 2)) return waterAccess('observed-pier-entry-outside-physical-walkway');
  }
  return { accessMode: 'pier-boarding', boarding: { ...boarding }, entryPoint: { x: boarding.x, y: boarding.y }, ...(sourcePierId ? { sourcePierId } : {}) };
}

/** Replace only the opening actor with a validated, observed nearby car. */
export function createAerialStarter(world, existingCars = [], dataset = CALVI_AERIAL_OBJECTS, openingPoint = world.starts?.player) {
  if (!sourceMatchesWorld(world, dataset)) return null;
  const original = existingCars.find(car => car.id === 'car-start');
  const annotation = dataset.vehicles.find(item => item.id === 'photo-car-port-04');
  if (!original || !annotation || !openingPoint || !validAnnotation(annotation, world) || distance(annotation, openingPoint) > 36) return null;
  const context = geometryContext(world), shape = dimensions(annotation);
  if (!bodyClear(world, annotation, shape.radius, shape.halfLength, context) || !actorsClear(world, annotation, existingCars, original.id)) return null;
  const player = openingPoint, footRadius = world.physics?.playerRadius || 4;
  if (pointDistanceSquared([player.x, player.y], ...axis(annotation)) < (shape.radius + footRadius) ** 2) return null;
  const reserved = world.buildings.filter(building => building.target).flatMap(building => [building.approach, building.parking]).filter(Boolean);
  if (reserved.some(p => distance(p, annotation) < 80)) return null;
  const steps = Math.max(1, Math.ceil(distance(player, annotation) / 4));
  for (let i = 0; i <= steps; i++) {
    const p = { x: player.x + (annotation.x - player.x) * i / steps, y: player.y + (annotation.y - player.y) * i / steps };
    if (!clearFootPoint(world, p, footRadius, existingCars, original.id, context)) return null;
  }
  const parking = world.scenery.find(area => area.ground && area.areaKind === 'parking' && area.polygon?.length && fits(annotation, axis(annotation), area, shape.radius));
  if (!parking) return null;
  return { ...structuredClone(original), x: annotation.x, y: annotation.y, angle: annotation.angle, color: annotation.color,
    collisionRadius: shape.radius, collisionHalfLength: shape.halfLength, owned: true, occupied: false, stolen: false, destroyed: false,
    sourceParkingId: parking.id, sourceRoadId: original.sourceRoadId || original.roadId,
    parkingPlacement: 'verified-aerial-opening-car-exact-source-position',
    sourceImage: { ...structuredClone(annotation.sourcePlacement), annotationId: annotation.id, width: annotation.width, length: annotation.length,
      actorState: 'fictional-opening-vehicle-at-observed-photo-position', sourceImageEpochUnknown: true },
  };
}

/** Read-only conversion; no photo patch is produced for a rejected actor. */
export function createAerialVehicles(world, existingCars = [], dataset = CALVI_AERIAL_OBJECTS) {
  const vehicles = [], masks = [], rejected = [], aliases = [];
  if (!sourceMatchesWorld(world, dataset)) return { vehicles, masks, rejected, aliases };
  const context = geometryContext(world), streets = streetSegments(world);
  const parking = world.scenery.filter(area => area.ground && area.areaKind === 'parking' && area.polygon?.length);
  const valid = dataset.vehicles.filter(annotation => validAnnotation(annotation, world) && !annotation.aliasOf);
  const exactMatch = annotation => existingCars.find(car => car.sourceImage?.annotationId === annotation.id
    && car.x === annotation.x && car.y === annotation.y && car.angle === annotation.angle && !car.destroyed);
  // Include future observed cars in the access search, so a path cannot cross
  // a neighbour merely because that annotation comes later in the source list.
  const collisionActors = existingCars.filter(car => !car.sourceImage?.annotationId).concat(valid.map(annotation => {
    const shape = dimensions(annotation);
    return { ...annotation, id: annotation.id, collisionRadius: shape.radius, collisionHalfLength: shape.halfLength };
  }));
  const seen = new Set();
  for (const annotation of dataset.vehicles) {
    const reject = reason => rejected.push({ annotationId: annotation?.id || null, reason });
    if (!validAnnotation(annotation, world) || seen.has(annotation.id)) { reject('invalid-or-duplicate-source-annotation'); continue; }
    seen.add(annotation.id);
    if (annotation.aliasOf) {
      aliases.push({ annotationId: annotation.id, canonicalAnnotationId: annotation.aliasOf });
      continue;
    }
    const shape = dimensions(annotation), overlap = exactMatch(annotation);
    const onWater = annotation.mobilityType === 'boat';
    if (onWater ? !waterBodyClear(world, annotation, shape.radius, shape.halfLength, context) : !bodyClear(world, annotation, shape.radius, shape.halfLength, context)) {
      reject(onWater ? 'boat-hull-over-land-or-pier' : 'outside-clear-municipal-land-or-static-obstruction'); continue;
    }
    if (!actorsClear(world, annotation, collisionActors, annotation.id)) { reject('vehicle-or-pedestrian-overlap'); continue; }
    const accessible = onWater ? boatAccess(world, annotation, collisionActors, context) : pedestrianAccess(world, annotation, collisionActors, context, streets);
    if (!accessible) { reject('no-physical-pedestrian-entry'); continue; }
    if (overlap) {
      masks.push(maskFor(annotation, overlap.id));
      continue;
    }
    const area = parking.find(area => inRing(annotation, area.polygon) && !(area.holes || []).some(hole => inRing(annotation, hole)));
    const hp = annotation.mobilityType === 'plane' ? 340 : 260;
    const car = { id: `aerial-${annotation.mobilityType || 'car'}-${annotation.id}`, x: annotation.x, y: annotation.y, angle: annotation.angle,
      speed: 0, kind: 'parked', color: annotation.color || '#a8aaa4', hp, maxHp: hp,
      collisionRadius: shape.radius, collisionHalfLength: shape.halfLength,
      ...(onWater ? { collisionShape: { ...shape } } : {}),
      owned: false, occupied: false, stolen: false, destroyed: false, locked: false,
      ...accessible, activationCell: `${Math.floor(annotation.x / AERIAL_VEHICLE_CELL_SIZE)},${Math.floor(annotation.y / AERIAL_VEHICLE_CELL_SIZE)}`,
      ...(annotation.mobilityType ? { mobilityType: annotation.mobilityType, model: annotation.mobilityType,
        mobilityMode: onWater ? 'water' : 'ground', altitude: 0 } : {}),
      ...(area ? { sourceParkingId: area.id } : {}), parkingPlacement: 'verified-aerial-car-exact-source-position',
      sourceImage: { ...structuredClone(annotation.sourcePlacement), annotationId: annotation.id, width: annotation.width, length: annotation.length,
        actorState: 'fictional-playable-vehicle-at-observed-photo-position', sourceImageEpochUnknown: true },
    };
    vehicles.push(car); masks.push(maskFor(annotation, car.id));
  }
  const byType = { car: { observed: 0, converted: 0, rejected: 0 }, boat: { observed: 0, converted: 0, rejected: 0 }, plane: { observed: 0, converted: 0, rejected: 0 } };
  const annotationById = new Map(dataset.vehicles.map(annotation => [annotation?.id, annotation]));
  const typeOf = annotation => ['boat', 'plane'].includes(annotation?.mobilityType) ? annotation.mobilityType : 'car';
  for (const annotation of dataset.vehicles) byType[typeOf(annotation)].observed++;
  for (const mask of masks) byType[typeOf(annotationById.get(mask.annotationId))].converted++;
  for (const item of rejected) {
    const type = typeOf(annotationById.get(item.annotationId));
    if (byType[type]) byType[type].rejected++;
  }
  const coverage = { status: 'ready', observed: dataset.vehicles.length, converted: masks.length,
    rejected: rejected.map(item => ({ ...item })), aliases: aliases.map(item => ({ ...item })), byType,
    outOfScope: structuredClone(dataset.excludedObservations || []),
    coverageRegions: structuredClone(dataset.metadata.coverageRegions || []), activationCellSize: AERIAL_VEHICLE_CELL_SIZE };
  return { vehicles, masks, rejected, aliases, coverage, population: {
    observationCount: coverage.observed, convertedCount: coverage.converted, rejectedCount: rejected.length,
    activationCellSize: AERIAL_VEHICLE_CELL_SIZE,
  } };
}
