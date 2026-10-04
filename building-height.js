import { CALVI_BUILDING_HEIGHTS } from './data/calvi-building-heights.js';

const sameBounds = (a, b) => a && b && ['west', 'south', 'east', 'north'].every((key) => Number.isFinite(a[key]) && Number.isFinite(b[key]) && Math.abs(a[key] - b[key]) < 1e-7);
const finiteHeight = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 500;
const sameFootprint = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
  && a.every((point, i) => Array.isArray(point) && Array.isArray(b[i]) && point.length === 2 && b[i].length === 2
    && point.every((value, j) => Number.isFinite(value) && Number.isFinite(b[i][j]) && Math.abs(value - b[i][j]) <= .05));

/** OSM height is an explicitly reported dimension; floors never imply metres. */
export function osmHeightMeters(tags = {}) {
  const text = String(tags.height ?? '').trim();
  if (!/^\d+(?:\.\d+)?\s*(?:m)?$/.test(text)) return null;
  const height = Number.parseFloat(text);
  return finiteHeight(height) ? height : null;
}

function unknown(building, reason = 'No source height in metres') {
  const levelsText = String(building?.osmTags?.['building:levels'] ?? '').trim();
  const levels = /^\d+(?:\.\d+)?$/.test(levelsText) && Number(levelsText) > 0 ? Number(levelsText) : null;
  return { heightMeters: null, status: 'unknown', source: null, levels, reason };
}

/** Return a source height, never a visual gabarit or a floors-to-metres guess. */
export function buildingHeightInfo(world, building) {
  if (!building) return unknown(null);
  const entry = world?.buildingHeights?.byOsmId?.get(String(building.osmId));
  if (entry && finiteHeight(entry.heightMeters) && sameFootprint(entry.footprint, building.polygon)) {
    return { heightMeters: entry.heightMeters, status: 'source', source: 'IGN BD TOPO', sourceId: entry.sourceId,
      method: entry.method, sourceDate: entry.sourceDate ?? null, sourceRecordDate: entry.sourceRecordDate ?? null,
      acquisitionMethod: entry.acquisitionMethod ?? null, verticalAccuracyMeters: entry.verticalAccuracyMeters ?? null,
      match: entry.match, levels: unknown(building).levels,
      groundMinMeters: entry.groundMinMeters ?? null, groundMaxMeters: entry.groundMaxMeters ?? null,
      roofMinMeters: entry.roofMinMeters ?? null, roofMaxMeters: entry.roofMaxMeters ?? null };
  }
  const height = osmHeightMeters(building.osmTags);
  if (height !== null) return { heightMeters: height, status: 'reported', source: 'OpenStreetMap height tag', levels: unknown(building).levels, reason: 'Survey accuracy is not specified by the tag' };
  return unknown(building, entry ? 'The imported footprint no longer matches this building' : undefined);
}

export function buildingHeightMeters(world, building) {
  return buildingHeightInfo(world, building).heightMeters;
}

/** Attach only the matching Calvi extract; unknown buildings remain explicit. */
export function attachBuildingHeights(world, data = CALVI_BUILDING_HEIGHTS) {
  if (!world) return world;
  const compatible = world.metadata?.city === 'Calvi' && sameBounds(world.metadata.bounds, data?.bounds)
    && Math.abs(world.width - data.width) < .05 && Math.abs(world.height - data.height) < .05;
  const byOsmId = new Map();
  if (compatible && data.status === 'ready' && Array.isArray(data.entries)) {
    const duplicates = new Set();
    for (const entry of data.entries) {
      const key = String(entry?.osmId ?? '');
      if (!key || !finiteHeight(entry.heightMeters) || !entry.sourceId || !Array.isArray(entry.footprint)
        || !['hauteur', 'roof-max-minus-ground-min'].includes(entry.method)
        || entry.match?.method !== 'mutual-footprint-overlap' || !(entry.match?.iou >= .7)) continue;
      if (byOsmId.has(key)) duplicates.add(key);
      else byOsmId.set(key, entry);
    }
    for (const key of duplicates) byOsmId.delete(key);
  }
  world.buildingHeights = { status: compatible ? data.status : 'pending', metadata: compatible ? data.metadata : { reason: 'No matching verified building-height extract' }, byOsmId,
    sourceCount: 0, reportedCount: 0, unknownCount: 0, levelsTaggedCount: 0 };
  for (const building of world.buildings || []) {
    const info = buildingHeightInfo(world, building);
    if (info.status === 'source') world.buildingHeights.sourceCount++;
    else if (info.status === 'reported') world.buildingHeights.reportedCount++;
    else world.buildingHeights.unknownCount++;
    if (info.levels !== null) world.buildingHeights.levelsTaggedCount++;
  }
  return world;
}
