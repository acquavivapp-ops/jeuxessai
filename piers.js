// Real OSM pier axes, with explicitly estimated photographic widths. This
// deck supports feet without changing the municipal boundary or coastline.
const CELL = 128;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function pointDistance(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  const t = length ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / length, 0, 1) : 0;
  return (x - a[0] - dx * t) ** 2 + (y - a[1] - dy * t) ** 2;
}
function segmentDistance(a, b, c, d) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const overlap = Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0]))
    && Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]));
  if (overlap && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return 0;
  return Math.min(pointDistance(...a, c, d), pointDistance(...b, c, d), pointDistance(...c, a, b), pointDistance(...d, a, b));
}
export function createPierIndex(world) {
  const index = new Map();
  for (const pier of world.piers || []) {
    const width = pier.width ?? (pier.widthMeters || 0) * 4;
    if (!(width > 0) || !Array.isArray(pier.points)) continue;
    for (let i = 1; i < pier.points.length; i++) {
      const a = pier.points[i - 1], b = pier.points[i], radius = width / 2;
      const segment = { a, b, radius, pier };
      for (let cy = Math.floor((Math.min(a[1], b[1]) - radius) / CELL); cy <= Math.floor((Math.max(a[1], b[1]) + radius) / CELL); cy++) {
        for (let cx = Math.floor((Math.min(a[0], b[0]) - radius) / CELL); cx <= Math.floor((Math.max(a[0], b[0]) + radius) / CELL); cx++) {
          const key = `${cx},${cy}`;
          if (!index.has(key)) index.set(key, []);
          index.get(key).push(segment);
        }
      }
    }
  }
  return index;
}
export function circleFitsPier(index, x, y, radius) {
  for (const segment of index?.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) || []) {
    if (segment.radius >= radius && pointDistance(x, y, segment.a, segment.b) <= (segment.radius - radius) ** 2) return true;
  }
  return false;
}
export function capsuleTouchesPier(index, axis, radius) {
  if (!index?.size) return false;
  const [a, b] = axis;
  for (let cy = Math.floor((Math.min(a[1], b[1]) - radius) / CELL); cy <= Math.floor((Math.max(a[1], b[1]) + radius) / CELL); cy++) {
    for (let cx = Math.floor((Math.min(a[0], b[0]) - radius) / CELL); cx <= Math.floor((Math.max(a[0], b[0]) + radius) / CELL); cx++) {
      for (const segment of index.get(`${cx},${cy}`) || []) if (segmentDistance(a, b, segment.a, segment.b) < (radius + segment.radius) ** 2) return true;
    }
  }
  return false;
}
