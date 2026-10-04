import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CALVI_ELEVATION } from '../data/calvi-elevation.js';
import { CALVI_LIDAR_ELEVATION } from '../data/calvi-lidar-elevation.js';
import { CALVI_LIDAR_URBAN_ELEVATION } from '../data/calvi-lidar-urban-elevation.js';
import { attachTerrain, sampleElevation, terrainGradient, terrainIsReady } from '../terrain.js';

// Deliberately synthetic plane for interpolation/physical-unit checks.
const SYNTHETIC_PLANE = {
  status: 'ready', columns: 2, rows: 2, width: 200, height: 100, metresPerPixel: .25,
  bounds: { west: 8, south: 42, east: 9, north: 43 }, values: [0, 50, 100, 150],
  metadata: { source: 'SYNTHETIC TEST ONLY' },
};
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`);
const syntheticWorld = () => ({ width: 200, height: 100, metadata: { city: 'Calvi', bounds: { ...SYNTHETIC_PLANE.bounds } } });

test('bilinear interpolation preserves a synthetic north-up plane', () => {
  const world = attachTerrain(syntheticWorld(), SYNTHETIC_PLANE);
  near(sampleElevation(world, 100, 50), 75);
  near(sampleElevation(world, 50, 25), 37.5);
  near(sampleElevation(world, 0, 0), 0);
  near(sampleElevation(world, 0, 100), 100);
});

test('gradient reports physical metres/metre, including grid boundaries', () => {
  const world = attachTerrain(syntheticWorld(), SYNTHETIC_PLANE);
  for (const [x, y] of [[100, 50], [0, 0], [200, 100]]) {
    const gradient = terrainGradient(world, x, y);
    near(gradient.x, 1); near(gradient.y, 4); near(gradient.slope, Math.sqrt(17));
  }
});

test('missing or pending terrain remains flat and finite', () => {
  for (const world of [{}, { terrain: { status: 'pending' } }, { terrain: { status: 'ready', rows: 1, columns: 1, values: [0] } }]) {
    assert.equal(sampleElevation(world, 10, 10), 0);
    assert.deepEqual(terrainGradient(world, 10, 10), { x: 0, y: 0, slope: 0 });
  }
  const world = attachTerrain(syntheticWorld(), SYNTHETIC_PLANE);
  assert.equal(sampleElevation(world, NaN, 10), 0);
  assert.deepEqual(terrainGradient(world, 10, Infinity), { x: 0, y: 0, slope: 0 });
});

test('a geographic grid is never attached to another map or to the fictional city', () => {
  for (const world of [
    { ...syntheticWorld(), metadata: { ...syntheticWorld().metadata, city: 'Portu Neru' } },
    { ...syntheticWorld(), width: 201 },
    { ...syntheticWorld(), metadata: { city: 'Calvi', bounds: { ...SYNTHETIC_PLANE.bounds, west: 8.1 } } },
  ]) {
    attachTerrain(world, SYNTHETIC_PLANE);
    assert.equal(world.terrain.status, 'pending');
    assert.equal(sampleElevation(world, 50, 50), 0);
  }
});

test('incomplete and invalid grids are rejected before attachment', () => {
  assert.equal(terrainIsReady(SYNTHETIC_PLANE), true);
  for (const data of [
    { ...SYNTHETIC_PLANE, values: [0, 1] },
    { ...SYNTHETIC_PLANE, values: [0, 1, NaN, 2] },
    { ...SYNTHETIC_PLANE, metresPerPixel: 0 },
    { ...SYNTHETIC_PLANE, bounds: { ...SYNTHETIC_PLANE.bounds, east: 7 } },
  ]) assert.equal(terrainIsReady(data), false);
});

test('real Calvi DEM is archived with a reproducible source fingerprint', () => {
  assert.equal(terrainIsReady(CALVI_ELEVATION), true);
  assert.equal(CALVI_ELEVATION.metadata.source, 'SRTM GL1');
  assert.match(CALVI_ELEVATION.metadata.sourceUrl, /fd7a14a17517ab31798b7ace0a5d1fe8a8416433/);
  const source = readFileSync(new URL('../data/calvi-source-N42E008.tif', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), CALVI_ELEVATION.metadata.sha256);
  assert.equal(CALVI_ELEVATION.columns, 394);
  assert.equal(CALVI_ELEVATION.rows, 252);
  assert.ok(CALVI_ELEVATION.metadata.gridSpacingMetres.eastWest < 24);
  assert.ok(CALVI_ELEVATION.metadata.gridSpacingMetres.northSouth < 32);
});

test('the actual SRTM grid separates Calvi citadel elevation from its port', () => {
  const data = CALVI_ELEVATION;
  const world = attachTerrain({ width: data.width, height: data.height, metadata: { city: 'Calvi', bounds: data.bounds } }, data);
  const at = (longitude, latitude) => sampleElevation(world,
    (longitude - data.bounds.west) / (data.bounds.east - data.bounds.west) * data.width,
    (data.bounds.north - latitude) / (data.bounds.north - data.bounds.south) * data.height);
  const citadel = at(8.7609, 42.5683), port = at(8.7588, 42.5648);
  assert.ok(citadel > 50 && citadel < 65, `Real citadel radar height: ${citadel}`);
  assert.ok(Math.abs(port) < 6, `Real port radar height: ${port}`);
  assert.ok(citadel - port > 45);
});

test('the entire commune uses authentic IGN MNT at about 20m with only outside-land cells masked', () => {
  const data = CALVI_LIDAR_ELEVATION;
  assert.equal(terrainIsReady(data), true);
  const world = attachTerrain({ width: data.width, height: data.height, metadata: { city: 'Calvi', bounds: data.bounds } });
  assert.equal(world.terrain.metadata.source, 'IGN LiDAR HD MNT');
  assert.equal(world.terrain.columns, 449);
  assert.equal(world.terrain.rows, 388);
  assert.equal(world.terrain.values.length, 174212);
  const raw = readFileSync(new URL('../data/calvi-source-lidar-mnt.bil', import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'), data.metadata.sha256);
  assert.ok(data.metadata.gridSpacingMetres.eastWest < 20.1);
  assert.ok(data.metadata.gridSpacingMetres.northSouth < 20.1);
  assert.equal(data.metadata.license.identifier, 'Licence Ouverte / Open Licence');
  assert.equal(data.metadata.license.version, null);
  assert.equal(data.metadata.observationDate, null);
  assert.equal(data.values.filter(Number.isFinite).length, 79276);
  assert.equal(data.values.filter((value) => value === null).length, 94936);
  assert.equal(data.metadata.coverage.missingLandNodeCount, 0);
  // Actual required land nodes preserve source byte order and numeric values.
  for (const index of [data.values.findIndex(Number.isFinite), 100000, 110000].filter((i) => Number.isFinite(data.values[i]))) near(data.values[index], Math.round(raw.readFloatLE(index * 4) * 1000) / 1000, .000001);
});

test('the LiDAR grid keeps its half-pixel geographic alignment and real port/citadel difference', () => {
  const data = CALVI_LIDAR_ELEVATION, requested = data.metadata.sourceRequestBounds;
  const dx = (requested.east - requested.west) / data.columns, dy = (requested.north - requested.south) / data.rows;
  near(requested.west + dx / 2, data.bounds.west);
  near(requested.east - dx / 2, data.bounds.east);
  near(requested.north - dy / 2, data.bounds.north);
  near(requested.south + dy / 2, data.bounds.south);
  const world = attachTerrain({ width: data.width, height: data.height, metadata: { city: 'Calvi', bounds: data.bounds } });
  const at = (longitude, latitude) => sampleElevation(world,
    (longitude - data.bounds.west) / (data.bounds.east - data.bounds.west) * data.width,
    (data.bounds.north - latitude) / (data.bounds.north - data.bounds.south) * data.height);
  const citadel = at(8.7609, 42.5683), port = at(8.7588, 42.5648);
  assert.ok(citadel > 50 && citadel < 66, `Real IGN ground altitude: ${citadel}`);
  assert.ok(Math.abs(port) < 6, `Real IGN port altitude: ${port}`);
  assert.ok(citadel - port > 45);
});

test('the original five-metre urban DEM stays on its own GPS coordinates inside the larger map', () => {
  const base = CALVI_LIDAR_ELEVATION, urban = CALVI_LIDAR_URBAN_ELEVATION;
  const world = attachTerrain({ width: base.width, height: base.height, metadata: { city: 'Calvi', bounds: base.bounds } });
  assert.equal(world.terrain.patches.length, 1);
  assert.equal(world.terrain.patches[0], urban);
  const raw = readFileSync(new URL('../data/calvi-source-lidar-urban-mnt.bil', import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'), urban.metadata.sha256);
  const oldWorld = { terrain: urban };
  const at = (data, lon, lat) => [(lon - data.bounds.west) / (data.bounds.east - data.bounds.west) * data.width,
    (data.bounds.north - lat) / (data.bounds.north - data.bounds.south) * data.height];
  for (const [lon, lat] of [[8.7588, 42.5648], [8.7609, 42.5683], [8.7575, 42.5625]]) {
    near(sampleElevation(world, ...at(base, lon, lat)), sampleElevation(oldWorld, ...at(urban, lon, lat)), .000001);
    const gradient = terrainGradient(world, ...at(base, lon, lat));
    assert.ok([gradient.x, gradient.y, gradient.slope].every(Number.isFinite));
  }
  // At the patch boundary, the transition is continuous with the coarse grid.
  const edge = at(base, urban.bounds.west, 42.565);
  near(sampleElevation(world, ...edge), sampleElevation({ terrain: base }, ...edge), .000001);
});

test('masked offshore samples remain unknown and never become fictitious zero-metre grid entries', () => {
  const masked = { ...SYNTHETIC_PLANE, values: [10, null, 20, 30], metadata: { source: 'SYNTHETIC TEST ONLY', coverage: { landGridCoverageVerified: true, missingLandNodeCount: 0 } } };
  const world = attachTerrain(syntheticWorld(), masked);
  near(sampleElevation(world, 100, 50), 20);
  assert.equal(masked.values[1], null);
  assert.equal(terrainIsReady({ ...masked, metadata: {} }), false);
  assert.equal(terrainIsReady({ ...masked, metadata: { coverage: { landGridCoverageVerified: true, missingLandNodeCount: 1 } } }), false);
});
