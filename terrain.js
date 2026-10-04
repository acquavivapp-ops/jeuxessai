import { CALVI_ELEVATION } from './data/calvi-elevation.js';
import { CALVI_LIDAR_ELEVATION } from './data/calvi-lidar-elevation.js';
import { CALVI_LIDAR_URBAN_ELEVATION } from './data/calvi-lidar-urban-elevation.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const flatGradient = () => ({ x: 0, y: 0, slope: 0 });
const boundsMatch = (a, b) => a && b && ['west', 'south', 'east', 'north'].every((key) => Number.isFinite(a[key]) && Math.abs(a[key] - b[key]) < 1e-7);

/** A geographic height grid must be complete; missing data never invents hills. */
export function terrainIsReady(data) {
  return data?.status === 'ready' && Number.isInteger(data.columns) && data.columns >= 2
    && Number.isInteger(data.rows) && data.rows >= 2 && Number.isFinite(data.width) && data.width > 0
    && Number.isFinite(data.height) && data.height > 0 && Number.isFinite(data.metresPerPixel) && data.metresPerPixel > 0
    && Array.isArray(data.values) && data.values.length === data.columns * data.rows
    && data.values.every((value) => Number.isFinite(value) || value === null && data.metadata?.coverage?.landGridCoverageVerified === true && data.metadata.coverage.missingLandNodeCount === 0)
    && data.bounds && ['west', 'south', 'east', 'north'].every((key) => Number.isFinite(data.bounds[key]))
    && data.bounds.east > data.bounds.west && data.bounds.north > data.bounds.south;
}

/** Attach a surveyed grid only to its own map, never to the fictional town. */
export function attachTerrain(world, data = terrainIsReady(CALVI_LIDAR_ELEVATION) ? CALVI_LIDAR_ELEVATION : CALVI_ELEVATION) {
  const compatible = world?.metadata?.city === 'Calvi' && boundsMatch(world.metadata.bounds, data?.bounds)
    && Math.abs(world.width - data.width) < .05 && Math.abs(world.height - data.height) < .05;
  if (world) {
    world.terrain = terrainIsReady(data) && compatible ? data : { status: 'pending', metadata: { reason: 'No matching verified elevation grid' } };
    const patch = CALVI_LIDAR_URBAN_ELEVATION;
    const hasUrbanDetail = world.terrain.status === 'ready' && data.metadata?.source === 'IGN LiDAR HD MNT' && terrainIsReady(patch)
      && data.bounds.west <= patch.bounds.west && data.bounds.south <= patch.bounds.south && data.bounds.east >= patch.bounds.east && data.bounds.north >= patch.bounds.north
      && !boundsMatch(data.bounds, patch.bounds);
    if (hasUrbanDetail) world.terrain = { ...data, patches: [patch], patchTransitionMetres: 40,
      metadata: { ...data.metadata, urbanDetail: { source: patch.metadata.source, bounds: patch.bounds, columns: patch.columns, rows: patch.rows,
        gridSpacingMetres: patch.metadata.gridSpacingMetres, sourceArchive: patch.metadata.sourceArchive, sha256: patch.metadata.sha256,
        transitionMetres: 40, note: 'The archived ~5m urban source retains its own WGS84 coordinates. A 40m interpolation band joins it to the municipal grid; it is never stretched.' } } };
  }
  return world;
}

function gridFor(world) {
  // Validation happens on attachment. Fixtures can also provide a ready grid
  // directly; check dimensions cheaply here because render calls are frequent.
  const data = world?.terrain;
  return data?.status === 'ready' && data.columns >= 2 && data.rows >= 2 && data.width > 0 && data.height > 0
    && data.values?.length === data.columns * data.rows ? data : null;
}

function sampleGrid(data, x, y) {
  const column = clamp(x / data.width, 0, 1) * (data.columns - 1);
  const row = clamp(y / data.height, 0, 1) * (data.rows - 1);
  const left = Math.min(data.columns - 2, Math.floor(column)), top = Math.min(data.rows - 2, Math.floor(row));
  const u = column - left, v = row - top, offset = top * data.columns + left;
  const a = data.values[offset], b = data.values[offset + 1], c = data.values[offset + data.columns], d = data.values[offset + data.columns + 1];
  const corners = [[a, (1 - u) * (1 - v)], [b, u * (1 - v)], [c, (1 - u) * v], [d, u * v]];
  let sum = 0, weight = 0;
  for (const [value, portion] of corners) if (Number.isFinite(value)) { sum += value * portion; weight += portion; }
  // At coastal edges, interpolate only actual source samples. Null offshore
  // cells remain unknown in the dataset, rather than masquerading as 0m DEM.
  return weight > 1e-12 ? sum / weight : 0;
}

function patchAt(data, x, y) {
  if (!data.patches?.length) return null;
  const lon = data.bounds.west + x / data.width * (data.bounds.east - data.bounds.west);
  const lat = data.bounds.north - y / data.height * (data.bounds.north - data.bounds.south);
  for (const patch of data.patches) {
    if (lon < patch.bounds.west || lon > patch.bounds.east || lat < patch.bounds.south || lat > patch.bounds.north) continue;
    return { patch, x: (lon - patch.bounds.west) / (patch.bounds.east - patch.bounds.west) * patch.width,
      y: (patch.bounds.north - lat) / (patch.bounds.north - patch.bounds.south) * patch.height };
  }
  return null;
}

/** Bilinear source height in metres, with geographically anchored urban detail. */
export function sampleElevation(world, x, y) {
  const data = gridFor(world);
  if (!data || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
  const base = sampleGrid(data, x, y), detail = patchAt(data, x, y);
  if (!detail) return base;
  const { patch, x: px, y: py } = detail;
  const distanceToEdge = Math.min(px, py, patch.width - px, patch.height - py) * patch.metresPerPixel;
  const weight = clamp(distanceToEdge / (data.patchTransitionMetres || 40), 0, 1);
  return base * (1 - weight) + sampleGrid(patch, px, py) * weight;
}

/** Physical slope (metres/metre), positive x east and positive y south. */
export function terrainGradient(world, x, y) {
  const data = gridFor(world);
  if (!data || !Number.isFinite(x) || !Number.isFinite(y) || !(data.metresPerPixel > 0)) return flatGradient();
  const detail = patchAt(data, x, y);
  const dx = detail ? data.width * (detail.patch.bounds.east - detail.patch.bounds.west) / (data.bounds.east - data.bounds.west) / (detail.patch.columns - 1) / 2 : data.width / (data.columns - 1) / 2;
  const dy = detail ? data.height * (detail.patch.bounds.north - detail.patch.bounds.south) / (data.bounds.north - data.bounds.south) / (detail.patch.rows - 1) / 2 : data.height / (data.rows - 1) / 2;
  const left = clamp(x - dx, 0, data.width), right = clamp(x + dx, 0, data.width);
  const top = clamp(y - dy, 0, data.height), bottom = clamp(y + dy, 0, data.height);
  const gx = right > left ? (sampleElevation(world, right, y) - sampleElevation(world, left, y)) / ((right - left) * data.metresPerPixel) : 0;
  const gy = bottom > top ? (sampleElevation(world, x, bottom) - sampleElevation(world, x, top)) / ((bottom - top) * data.metresPerPixel) : 0;
  return { x: gx, y: gy, slope: Math.hypot(gx, gy) };
}
