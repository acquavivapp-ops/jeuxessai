import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { CALVI_MAP } from '../data/calvi-map.js';
import { CALVI_BUILDING_HEIGHTS } from '../data/calvi-building-heights.js';
import { attachBuildingHeights, buildingHeightInfo, buildingHeightMeters, osmHeightMeters } from '../building-height.js';

const FOOTPRINT = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const fixture = () => ({ width: 100, height: 100, metadata: { city: 'Calvi', bounds: { west: 8, south: 42, east: 9, north: 43 } }, buildings: [{ osmId: 7, polygon: FOOTPRINT, osmTags: { 'building:levels': '4' } }] });
const SYNTHETIC_SOURCE = {
  status: 'ready', width: 100, height: 100, bounds: fixture().metadata.bounds,
  metadata: { source: 'SYNTHETIC TEST ONLY' },
  entries: [{ osmId: 7, sourceId: 'SYNTHETIC TEST ONLY', heightMeters: 12.5, method: 'hauteur', footprint: FOOTPRINT, match: { method: 'mutual-footprint-overlap', iou: .95 } }],
};

test('the shipped Calvi heights are archived genuine IGN data; unknown heights and floors stay separate', () => {
  const world = attachBuildingHeights({ width: CALVI_MAP.width, height: CALVI_MAP.height, metadata: CALVI_MAP.metadata, buildings: CALVI_MAP.buildings });
  assert.equal(CALVI_BUILDING_HEIGHTS.status, 'ready');
  assert.equal(CALVI_BUILDING_HEIGHTS.entries.length, 1355);
  const raw = gunzipSync(readFileSync(new URL('../data/calvi-building-heights-source.geojson.gz', import.meta.url)));
  assert.equal(createHash('sha256').update(raw).digest('hex'), CALVI_BUILDING_HEIGHTS.metadata.sha256);
  assert.equal(JSON.parse(raw).features.length, 5147);
  assert.equal(CALVI_BUILDING_HEIGHTS.metadata.license.identifier, 'Licence Ouverte / Open Licence');
  assert.equal(CALVI_BUILDING_HEIGHTS.metadata.license.version, null);
  assert.equal(world.buildingHeights.sourceCount, 1355);
  assert.equal(world.buildingHeights.reportedCount, 0);
  assert.equal(world.buildingHeights.unknownCount, 2538);
  assert.equal(world.buildingHeights.levelsTaggedCount, 24);
  assert.equal(world.buildings.filter((building) => buildingHeightMeters(world, building) === null).length, 2538);
  assert.ok(CALVI_BUILDING_HEIGHTS.entries.every((entry) => entry.method === 'hauteur' && entry.sourceDate === null));
});

test('a pending manifest preserves unknown heights and never modifies buildings', () => {
  const world = fixture(), before = structuredClone(world.buildings);
  attachBuildingHeights(world, { ...SYNTHETIC_SOURCE, status: 'pending', entries: [] });
  assert.equal(world.buildingHeights.status, 'pending');
  assert.equal(buildingHeightMeters(world, world.buildings[0]), null);
  assert.deepEqual(world.buildings, before);
});

test('only explicit positive OSM metre heights can supply a reported dimension', () => {
  assert.equal(osmHeightMeters({ height: '12.5 m' }), 12.5);
  assert.equal(osmHeightMeters({ height: '12' }), 12);
  for (const tags of [{ 'building:levels': '4' }, { height: '40 ft' }, { height: '12;14' }, { height: '-1' }, { height: 'NaN' }, { height: '501' }]) assert.equal(osmHeightMeters(tags), null);
  const world = fixture();
  world.buildings[0].osmTags.height = '13';
  const info = buildingHeightInfo(world, world.buildings[0]);
  assert.equal(info.status, 'reported');
  assert.equal(info.heightMeters, 13);
  assert.equal(info.levels, 4);
});

test('an imported source height retains its source and leaves geometry and durability untouched', () => {
  const world = fixture(), before = structuredClone(world.buildings);
  attachBuildingHeights(world, SYNTHETIC_SOURCE);
  assert.equal(buildingHeightMeters(world, world.buildings[0]), 12.5);
  assert.equal(buildingHeightInfo(world, world.buildings[0]).sourceId, 'SYNTHETIC TEST ONLY');
  assert.equal(world.buildingHeights.sourceCount, 1);
  assert.deepEqual(world.buildings, before);
});

test('foreign maps and subsequently changed footprints cannot inherit a source height', () => {
  for (const change of [(world) => { world.metadata.city = 'Portu Neru'; }, (world) => { world.metadata.bounds.west = 8.1; }, (world) => { world.width += 1; }]) {
    const world = fixture(); change(world);
    attachBuildingHeights(world, SYNTHETIC_SOURCE);
    assert.equal(buildingHeightMeters(world, world.buildings[0]), null);
  }
  const world = attachBuildingHeights(fixture(), SYNTHETIC_SOURCE);
  world.buildings[0].polygon = FOOTPRINT.map(([x, y]) => [x + 1, y]);
  assert.equal(buildingHeightMeters(world, world.buildings[0]), null);
});

test('duplicate or weak imported matches remain unknown', () => {
  for (const entries of [
    [...SYNTHETIC_SOURCE.entries, ...SYNTHETIC_SOURCE.entries],
    [{ ...SYNTHETIC_SOURCE.entries[0], match: { method: 'mutual-footprint-overlap', iou: .69 } }],
    [{ ...SYNTHETIC_SOURCE.entries[0], heightMeters: NaN }],
    [{ ...SYNTHETIC_SOURCE.entries[0], method: 'guessed-from-floors' }],
  ]) {
    const world = attachBuildingHeights(fixture(), { ...SYNTHETIC_SOURCE, entries });
    assert.equal(buildingHeightMeters(world, world.buildings[0]), null);
    assert.equal(world.buildingHeights.sourceCount, 0);
  }
});
