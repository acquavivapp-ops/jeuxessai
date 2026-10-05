import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { CALVI_MAP } from '../data/calvi-map.js';
import { CALVI_ARCHITECTURE_METADATA, CALVI_LANDMARKS, fortificationsFor, airportSurfacesFor } from '../data/calvi-architecture.js';
import { CALVI_ROOF_OBSERVATIONS, roofObservationFor } from '../data/calvi-roof-observations.js';

const world = { width: CALVI_MAP.width, height: CALVI_MAP.height, metadata: CALVI_MAP.metadata };

test('citadel perimeter retains every archived OSM node in the existing Calvi projection', () => {
  const xml = gunzipSync(readFileSync(new URL('../data/calvi-osm.xml.gz', import.meta.url))).toString();
  const source = CALVI_ARCHITECTURE_METADATA.source;
  assert.equal(createHash('sha256').update(xml).digest('hex'), CALVI_MAP.metadata.sha256);
  const [wall] = fortificationsFor(world);
  assert.ok(wall && wall.points.length === wall.nodeIds.length && wall.points.length > 60);
  const way = new RegExp(`<way\\b[^>]*\\bid="${wall.osmId}"[^>]*>([\\s\\S]*?)</way>`).exec(xml)?.[1];
  assert.ok(way, 'The perimeter must come from a real archived way');
  assert.deepEqual([...way.matchAll(/<nd\b[^>]*\bref="(\d+)"/g)].map(match => Number(match[1])), wall.nodeIds);
  const nodes = new Map();
  const required = new Set(wall.nodeIds);
  for (const match of xml.matchAll(/<node\b([^>]*)>/g)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w:]+)="([^"]*)"/g)].map(item => [item[1], item[2]]));
    if (required.has(Number(attrs.id))) nodes.set(Number(attrs.id), attrs);
  }
  const projection = source.projection, round = value => Math.round(value * 100) / 100;
  const expected = wall.nodeIds.map(id => {
    const node = nodes.get(id); assert.ok(node, `Missing source node ${id}`);
    return [round((Number(node.lon) - projection.boundsWGS84.west) * projection.metresPerDegreeX * projection.pixelsPerMetre),
      round((projection.boundsWGS84.north - Number(node.lat)) * projection.metresPerDegreeY * projection.pixelsPerMetre)];
  });
  assert.deepEqual(wall.points, expected);
  assert.deepEqual(wall.points[0], wall.points.at(-1));
  assert.equal(wall.heightEstimated, true);
  assert.equal(wall.widthEstimated, true);
});

test('source architecture refuses unrelated worlds and retains the existing building footprints', () => {
  assert.equal(fortificationsFor({ ...world, width: world.width + 1 }).length, 0);
  assert.equal(fortificationsFor({ ...world, metadata: { bounds: { ...world.metadata.bounds, west: 0 } } }).length, 0);
  assert.equal(fortificationsFor({ width: 330, height: 390 }).length, 0);
  const buildings = new Map(CALVI_MAP.buildings.map(building => [building.id, building]));
  for (const landmark of CALVI_LANDMARKS) {
    const building = buildings.get(landmark.id); assert.ok(building, landmark.id);
    const xs = building.polygon.map(point => point[0]), ys = building.polygon.map(point => point[1]);
    const round = value => Math.round(value * 100) / 100;
    assert.deepEqual(landmark.bounds, { x: Math.min(...xs), y: Math.min(...ys), w: round(Math.max(...xs) - Math.min(...xs)), h: round(Math.max(...ys) - Math.min(...ys)) });
  }
});

test('roof palettes reference real source buildings without inferring roof shape or mutating them', () => {
  const buildings = new Map(CALVI_MAP.buildings.map(building => [String(building.osmId), building]));
  const ids = new Set();
  for (const [id, colour, family, confidence] of CALVI_ROOF_OBSERVATIONS.rows) {
    const building = buildings.get(String(id)); assert.ok(building, String(id));
    assert.ok(!ids.has(id)); ids.add(id);
    assert.match(colour, /^#[0-9a-f]{6}$/i);
    assert.ok(['terracotta', 'neutral', 'unknown'].includes(family));
    assert.ok(['high', 'medium'].includes(confidence));
    const before = JSON.stringify(building), observed = roofObservationFor(building);
    assert.equal(observed.colour, colour);
    assert.equal(observed.colourFamily, family);
    assert.equal(Object.hasOwn(observed, 'roofShape'), false);
    assert.equal(JSON.stringify(building), before);
  }
  assert.equal(ids.size, 3219);
  assert.equal(roofObservationFor({ id: 'fictional-building-180992553' }), null);
  assert.equal(roofObservationFor({ id: 'osm-building-0' }), null);
});

test('airport surfaces use archived ways and preserve missing dimensions as unknown', () => {
  const xml = gunzipSync(readFileSync(new URL('../data/calvi-osm.xml.gz', import.meta.url))).toString();
  const surfaces = airportSurfacesFor(world);
  assert.equal(surfaces.length, 30);
  assert.equal(airportSurfacesFor({ width: 330, height: 390 }).length, 0);
  const required = new Set(surfaces.flatMap(surface => surface.nodeIds)), nodes = new Map();
  for (const match of xml.matchAll(/<node\b([^>]*)>/g)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w:]+)="([^"]*)"/g)].map(item => [item[1], item[2]]));
    if (required.has(Number(attrs.id))) nodes.set(Number(attrs.id), attrs);
  }
  const projection = CALVI_ARCHITECTURE_METADATA.source.projection, round = value => Math.round(value * 100) / 100;
  for (const surface of surfaces) {
    const way = new RegExp(`<way\\b[^>]*\\bid="${surface.osmId}"[^>]*>([\\s\\S]*?)</way>`).exec(xml)?.[1];
    assert.ok(way, surface.id);
    assert.deepEqual([...way.matchAll(/<nd\b[^>]*\bref="(\d+)"/g)].map(match => Number(match[1])), surface.nodeIds);
    assert.equal(surface.points.length, surface.nodeIds.length);
    assert.deepEqual(surface.points, surface.nodeIds.map(id => {
      const node = nodes.get(id); assert.ok(node, `Missing source node ${id}`);
      return [round((Number(node.lon) - projection.boundsWGS84.west) * projection.metresPerDegreeX * projection.pixelsPerMetre),
        round((projection.boundsWGS84.north - Number(node.lat)) * projection.metresPerDegreeY * projection.pixelsPerMetre)];
    }));
    if (surface.tags.width === undefined) assert.equal(surface.sourceDimensions.widthWorld, null);
    else assert.equal(surface.sourceDimensions.widthWorld, Number(surface.tags.width) * 4);
    if (surface.geometryType === 'polygon') assert.deepEqual(surface.points[0], surface.points.at(-1));
  }
  assert.equal(surfaces.find(surface => surface.osmId === 8113537).sourceDimensions.widthMetres, 45);
});
