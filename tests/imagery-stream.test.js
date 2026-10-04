import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageryStream, validImageryManifest, imageryManifestMatches } from '../imagery-stream.js';

const bounds = { west: 8.7, south: 42.5, east: 8.8, north: 42.6 };
const world = { width: 1000, height: 500, metadata: { city: 'Calvi', bounds } };
function manifest() {
  return { status: 'ready', boundsWGS84: bounds, worldWidth: 1000, worldHeight: 500,
    tiles: Array.from({ length: 4 }, (_, i) => ({ id: `tile-${i}`, url: `./assets/aerial/calvi-c${i}-r0.jpg`,
      width: 1024, height: 1024, boundsWorld: { x: i * 250, y: 0, w: 250, h: 500 } })) };
}
const turn = () => new Promise(resolve => setImmediate(resolve));
async function settle(stream) { while (stream.pending.size) await Promise.all([...stream.pending.values()]); }

test('streaming rejects remote assets, malformed geography and a different map extent', () => {
  const data = manifest();
  assert.equal(validImageryManifest(data), true);
  assert.equal(imageryManifestMatches(world, data), true);
  assert.equal(imageryManifestMatches({ ...world, width: 2000 }, data), false);
  assert.equal(validImageryManifest({ ...data, tiles: [{ ...data.tiles[0], url: 'https://example.com/tile.jpg' }] }), false);
  assert.equal(validImageryManifest({ ...data, tiles: [{ ...data.tiles[0], boundsWorld: { x: 950, y: 0, w: 250, h: 500 } }] }), false);
  let loads = 0;
  const stream = new ImageryStream({ loadImage: async () => { loads++; return { width: 1024, height: 1024 }; } });
  stream.install(data); stream.request({ ...world, metadata: { city: 'Calvi', bounds: { ...bounds, west: 8.6 } } }, { x: 0, y: 0, w: 1000, h: 500 });
  assert.equal(loads, 0); assert.equal(stream.stats().pending, 0);
});

test('visible imagery decodes asynchronously with at most two concurrent jobs', async () => {
  const completions = []; let active = 0, peak = 0;
  const stream = new ImageryStream({ loadImage: () => new Promise(resolve => {
    peak = Math.max(peak, ++active);
    completions.push(() => { active--; resolve({ width: 1024, height: 1024 }); });
  }) });
  stream.install(manifest()); stream.request(world, { x: 0, y: 0, w: 1000, h: 500 });
  assert.equal(active, 0, 'Requesting a frame must not perform synchronous decoding');
  await turn(); assert.equal(active, 2);
  completions.splice(0).forEach(complete => complete()); await turn(); assert.equal(active, 2);
  completions.splice(0).forEach(complete => complete()); await settle(stream);
  assert.equal(peak, 2); assert.equal(stream.stats().resident, 4);
  assert.equal(stream.stats().decodedBytes, 16 * 1024 * 1024);
});

test('moving to another tile releases the old decoded image within the memory budget', async () => {
  const images = [];
  const stream = new ImageryStream({ maximumBytes: 4 * 1024 * 1024, loadImage: async () => {
    const image = { width: 1024, height: 1024, closed: false, close() { this.closed = true; } }; images.push(image); return image;
  } });
  stream.install(manifest()); stream.request(world, { x: 0, y: 0, w: 200, h: 500 }); await settle(stream);
  const signature = stream.signature(world, { x: 0, y: 0, w: 200, h: 500 });
  assert.ok(signature); assert.equal(stream.stats().resident, 1);
  stream.request(world, { x: 500, y: 0, w: 200, h: 500 }); await settle(stream);
  assert.equal(images[0].closed, true); assert.equal(stream.stats().resident, 1);
  assert.equal(stream.stats().decodedBytes, 4 * 1024 * 1024);
  assert.equal(stream.signature(world, { x: 0, y: 0, w: 200, h: 500 }), '');
});

test('a decoded tile is cropped to its geographic overlap rather than stretched across the view', async () => {
  const stream = new ImageryStream({ loadImage: async () => ({ width: 1024, height: 1024 }) });
  stream.install(manifest()); stream.request(world, { x: 0, y: 0, w: 200, h: 500 }); await settle(stream);
  const calls = [], ctx = { drawImage: (...args) => calls.push(args) };
  stream.draw(ctx, world, { x: 125, y: 250, w: 100, h: 100 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(1), [512, 512, 409.6, 204.8, 125, 250, 100, 100]);
});

test('bad local image dimensions preserve the fallback and are not retried every frame', async () => {
  let closed = 0, loads = 0;
  const stream = new ImageryStream({ loadImage: async () => { loads++; return { width: 500, height: 500, close() { closed++; } }; } });
  stream.install(manifest()); stream.request(world, { x: 0, y: 0, w: 200, h: 500 }); await settle(stream);
  stream.request(world, { x: 0, y: 0, w: 200, h: 500 }); await settle(stream);
  assert.equal(loads, 1); assert.equal(closed, 1);
  assert.equal(stream.stats().resident, 0); assert.equal(stream.stats().failed, 1);
});

test('an offline tile resumes after reconnecting without retries on every frame', async () => {
  let clock = 0, attempts = 0;
  const stream = new ImageryStream({ now: () => clock, loadImage: async () => {
    if (++attempts === 1) throw new TypeError('Offline fetch');
    return { width: 1024, height: 1024 };
  } });
  stream.install(manifest()); const view = { x: 0, y: 0, w: 200, h: 500 };
  stream.request(world, view); await settle(stream);
  assert.equal(stream.stats().failed, 1);
  for (let frame = 0; frame < 60; frame++) stream.request(world, view);
  assert.equal(attempts, 1, 'An offline frame must not flood the local cache');
  clock = 1000;
  stream.request(world, view); await settle(stream);
  assert.equal(attempts, 2); assert.equal(stream.stats().resident, 1); assert.equal(stream.stats().failed, 0);
});

test('fine photographs take priority at close range and share the base decode budget', async () => {
  const data = manifest();
  data.metresPerPixel = { x: .5, y: .5 }; data.detailMetresPerPixel = { x: .25, y: .25 };
  data.detailTiles = [{ ...data.tiles[0], id: 'detail-urban-c0-r0', url: './assets/aerial/calvi-detail-urban-c0-r0.jpg' }];
  const loaded = [], completions = [];
  const stream = new ImageryStream({ maximumBytes: 4 * 1024 * 1024, loadImage: url => new Promise(resolve => {
    loaded.push(url); completions.push(() => resolve({ width: 1024, height: 1024 }));
  }) });
  assert.equal(stream.install(data), true);
  stream.request(world, { x: 0, y: 0, w: 200, h: 500 }); await turn();
  assert.equal(stream.stats().available, 5); assert.equal(stream.stats().detailPending, 1);
  assert.equal(stream.stats().reservedDecodeBytes, 4 * 1024 * 1024);
  assert.ok(stream.stats().decodedBytes + stream.stats().reservedDecodeBytes <= stream.stats().maximumBytes);
  assert.match(loaded[0], /calvi-detail-urban/);
  completions[0](); await settle(stream);
  assert.equal(stream.stats().detailResident, 1); assert.deepEqual(stream.stats().bestMetresPerPixel, { x: .25, y: .25 });
});

test('an existing coarse resident image is drawn below a fine image after LRU touches', async () => {
  const data = manifest();
  data.detailTiles = [{ ...data.tiles[0], boundsWorld: { x: 0, y: 0, w: 125, h: 500 }, id: 'detail-urban-c0-r0', url: './assets/aerial/calvi-detail-urban-c0-r0.jpg' }];
  const stream = new ImageryStream({ loadImage: async url => ({ width: 1024, height: 1024, url }) });
  stream.install(data);
  stream.request(world, { x: 0, y: 0, w: 200, h: 500 }); await settle(stream);
  const calls = []; stream.draw({ drawImage: image => calls.push(image.url) }, world, { x: 0, y: 0, w: 200, h: 500 });
  assert.equal(calls.length, 2); assert.match(calls[0], /calvi-c0/); assert.match(calls[1], /calvi-detail/);
});

test('coarse tiles covered by fine images are not decoded, but failed fine images fall back', async () => {
  const data = manifest();
  data.detailTiles = [{ ...data.tiles[0], id: 'detail-urban-c0-r0', url: './assets/aerial/calvi-detail-urban-c0-r0.jpg' }];
  const loaded = [];
  const stream = new ImageryStream({ loadImage: async url => { loaded.push(url); return { width: 1024, height: 1024 }; } });
  stream.install(data); const view = { x: 0, y: 0, w: 200, h: 500 };
  stream.request(world, view); await settle(stream);
  assert.equal(loaded.length, 1, 'A hidden base image must not consume another four MiB');
  assert.match(loaded[0], /calvi-detail/);
  const fallback = new ImageryStream({ now: () => 0, loadImage: async url => {
    if (url.includes('detail')) throw new TypeError('Missing fine tile offline');
    return { width: 1024, height: 1024 };
  } });
  fallback.install(data); fallback.request(world, view); await settle(fallback);
  fallback.request(world, view); await settle(fallback);
  assert.equal(fallback.stats().detailResident, 0); assert.equal(fallback.stats().resident, 1);
});

test('reconnection restores a fine tile even when its backoff temporarily requested the base layer', async () => {
  const data = manifest(); data.detailTiles = [{ ...data.tiles[0], id: 'detail-urban-c0-r0', url: './assets/aerial/calvi-detail-urban-c0-r0.jpg' }];
  let online = false;
  const stream = new ImageryStream({ now: () => 0, loadImage: async url => {
    if (!online && url.includes('detail')) throw new TypeError('Offline');
    return { width: 1024, height: 1024 };
  } });
  stream.install(data); const view = { x: 0, y: 0, w: 200, h: 500 };
  stream.request(world, view); await settle(stream); stream.request(world, view); await settle(stream);
  assert.equal(stream.stats().detailResident, 0); assert.equal(stream.stats().resident, 1);
  online = true; stream.retryTransient(); await settle(stream);
  assert.equal(stream.stats().detailResident, 1); assert.equal(stream.stats().failed, 0);
});

test('moving between four fine images reserves room before their replacements decode', async () => {
  const data = manifest();
  data.detailTiles = data.tiles.map(tile => ({ ...tile, id: `detail-${tile.id}`, url: tile.url.replace('calvi-', 'calvi-detail-urban-') }));
  const completions = [];
  let hold = false;
  const stream = new ImageryStream({ loadImage: url => hold ? new Promise(resolve => completions.push(() => resolve({ width: 1024, height: 1024, url }))) : Promise.resolve({ width: 1024, height: 1024, url }) });
  stream.install(data); stream.request(world, { x: 0, y: 0, w: 1000, h: 500 }); await settle(stream);
  assert.equal(stream.stats().decodedBytes, stream.stats().maximumBytes);
  hold = true;
  const other = structuredClone(data); other.detailTiles = other.detailTiles.map(tile => ({ ...tile, id: `${tile.id}-new`, url: tile.url.replace('.jpg', '-new.jpg') }));
  stream.install(other); stream.request(world, { x: 0, y: 0, w: 1000, h: 500 }); await turn();
  assert.equal(stream.stats().pending, 2);
  assert.ok(stream.stats().decodedBytes + stream.stats().reservedDecodeBytes <= stream.stats().maximumBytes);
  completions.splice(0).forEach(complete => complete()); await turn();
  assert.ok(stream.stats().decodedBytes + stream.stats().reservedDecodeBytes <= stream.stats().maximumBytes);
  completions.splice(0).forEach(complete => complete()); await settle(stream);
  assert.equal(stream.stats().detailResident, 4); assert.equal(stream.stats().reservedDecodeBytes, 0);
});
