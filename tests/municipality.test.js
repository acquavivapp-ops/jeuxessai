import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { CALVI_MAP } from '../data/calvi-map.js';
import { CALVI_ANCHORS, createCalviWorld } from '../calvi-world.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} should match ${b}`);

test('the playable extent follows the archived complete Calvi administrative relation', () => {
  const boundary = CALVI_MAP.municipalBoundary;
  const geographic = readJson('../data/calvi-boundary.geojson');
  const raw = gunzipSync(readFileSync(new URL('../data/calvi-boundary-source.osm.xml.gz', import.meta.url)));
  assert.equal(boundary.insee, '2B050');
  assert.equal(boundary.sourceId, 1151255);
  assert.equal(boundary.source, 'OpenStreetMap administrative boundary');
  assert.equal(createHash('sha256').update(raw).digest('hex'), boundary.metadata.sha256);
  assert.match(raw.toString(), /ref:INSEE.*2B050/);
  assert.equal(boundary.polygons.length, 5);
  assert.ok(boundary.areaSquareKm > 31 && boundary.areaSquareKm < 32);
  assert.equal(CALVI_MAP.metadata.pixelsPerMetre, 4);
  const points = geographic.geometry.coordinates.flatMap((polygon) => polygon[0]);
  const actualBounds = { west: Math.min(...points.map((p) => p[0])), east: Math.max(...points.map((p) => p[0])),
    south: Math.min(...points.map((p) => p[1])), north: Math.max(...points.map((p) => p[1])) };
  assert.deepEqual(CALVI_MAP.metadata.bounds, actualBounds);
  assert.deepEqual(boundary.bounds, actualBounds);
  for (const [index, polygon] of boundary.polygons.entries()) {
    assert.equal(polygon.outer.length, geographic.geometry.coordinates[index][0].length);
    for (const [j, [x, y]] of polygon.outer.entries()) {
      const [lon, lat] = geographic.geometry.coordinates[index][0][j];
      near(x / CALVI_MAP.width * (actualBounds.east - actualBounds.west) + actualBounds.west, lon);
      near(actualBounds.north - y / CALVI_MAP.height * (actualBounds.north - actualBounds.south), lat);
    }
  }
});

test('all four bounded OSM responses and the assembled real extract keep their original fingerprints', () => {
  const provenance = readJson('../data/calvi-osm-download-provenance.json');
  assert.equal(provenance.requests.length, 4);
  assert.deepEqual(CALVI_MAP.metadata.sourceRequests, provenance.requests.map((request) => request.url));
  for (const request of provenance.requests) {
    const raw = gunzipSync(readFileSync(new URL(`../data/calvi-osm-parts/${request.name}`, import.meta.url)));
    assert.equal(createHash('sha256').update(raw).digest('hex'), request.sha256);
    assert.equal(raw.length, request.rawBytes);
  }
  const combined = gunzipSync(readFileSync(new URL('../data/calvi-osm.xml.gz', import.meta.url)));
  assert.equal(createHash('sha256').update(combined).digest('hex'), CALVI_MAP.metadata.sha256);
  assert.equal(provenance.sha256, CALVI_MAP.metadata.sha256);
  assert.equal(CALVI_MAP.roads.length, 1552);
  assert.equal(CALVI_MAP.buildings.length, 3893);
  assert.ok(CALVI_MAP.places.some((place) => place.osmId === 59740284 && place.osmTags.railway === 'station'));
  assert.ok(CALVI_MAP.places.some((place) => place.osmId === 674985173 && place.osmTags.natural === 'cape'));
  assert.ok(CALVI_MAP.places.some((place) => place.osmId === 42019349 && place.osmTags.aeroway === 'aerodrome'));
});

test('the new aerial image was actually requested for the whole extent rather than stretching the former town image', () => {
  const photo = readJson('../data/calvi-imagery-provenance.json');
  assert.equal(photo.status, 'ready');
  assert.deepEqual(photo.boundsWGS84, CALVI_MAP.metadata.bounds);
  assert.equal(photo.georeferencing.worldWidth, CALVI_MAP.width);
  assert.equal(photo.georeferencing.worldHeight, CALVI_MAP.height);
  assert.equal(photo.image.width, 4096);
  assert.equal(photo.image.height, 3542);
  const query = new URL(photo.sourceUrl).searchParams;
  assert.equal(query.get('WIDTH'), '4096');
  const b = CALVI_MAP.metadata.bounds;
  assert.equal(query.get('BBOX'), `${b.south},${b.west},${b.north},${b.east}`);
  const actual = readFileSync(new URL('../assets/calvi-orthophoto.jpg', import.meta.url));
  assert.equal(createHash('sha256').update(actual).digest('hex'), photo.image.sha256);
});

test('expanding to the municipality preserves the port spawn GPS and the three former source mission footprints', () => {
  const world = createCalviWorld(), b = world.metadata.bounds;
  const toGps = ({ x, y }) => ({ lon: b.west + x / world.width * (b.east - b.west), lat: b.north - y / world.height * (b.north - b.south) });
  const start = toGps(world.starts.player), car = toGps(world.starts.cars.find((vehicle) => vehicle.id === 'car-start'));
  near(start.lon, CALVI_ANCHORS.player.lon); near(start.lat, CALVI_ANCHORS.player.lat);
  near(car.lon, CALVI_ANCHORS.car.lon); near(car.lat, CALVI_ANCHORS.car.lat);
  assert.deepEqual(world.buildings.filter((building) => building.target).map((building) => [building.missionId, building.osmId]).sort(), CALVI_ANCHORS.missions.map(({ id, osmId }) => [id, osmId]).sort());
  assert.equal(world.coastalSeaMask, true);
  assert.doesNotThrow(() => structuredClone(world), 'No clearance callback is stored in the world');
});
