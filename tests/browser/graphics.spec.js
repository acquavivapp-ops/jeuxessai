import { test, expect } from '@playwright/test';
import { chooseGameMode, chooseStartingTime, drivingKey, canvasDigest, walkTo } from './helpers.js';

const loaded = (image) => image.evaluate(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
const painted = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test('the arcade title has an accessible name and fits both supported phone sizes', async ({ page }) => {
  for (const [width, height] of [[320, 568], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const logo = page.getByRole('img', { name: 'Blue Night', exact: true });
    await expect(logo).toBeVisible();
    await expect.poll(() => loaded(logo)).toBe(true);
    const imageBox = await logo.boundingBox();
    const cardBox = await page.locator('.menu-card').boundingBox();
    expect(imageBox.x).toBeGreaterThanOrEqual(cardBox.x);
    expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
    expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(height);
    const playBox = await page.getByRole('button', { name: 'JOUER', exact: false }).boundingBox();
    expect(playBox.y + playBox.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('fine local photographic tiles stay within their resident budget and decode after an offline reload', async ({ page, context }) => {
  const visited = new Set();
  page.on('response', response => {
    if (/\/assets\/aerial\/calvi-(?:detail-(?:urban|airport)-)?c\d+-r\d+\.jpg$/.test(response.url()) && response.ok()) visited.add(response.url());
  });
  await page.goto('/');
  await page.evaluate(async () => await (await import('/render.js')).artReady);
  await expect.poll(async () => (await page.evaluate(() => window.blueNight.snapshot())).imagery.resident).toBeGreaterThan(0);
  await expect.poll(async () => (await page.evaluate(() => window.blueNight.snapshot())).imagery.pending).toBe(0);
  const cacheStats = (await page.evaluate(() => window.blueNight.snapshot())).imagery;
  expect(cacheStats.status).toBe('ready'); expect(cacheStats.baseAvailable).toBe(288);
  expect(cacheStats.detailAvailable).toBeGreaterThan(0); expect(cacheStats.detailResident).toBeGreaterThan(0);
  expect(cacheStats.bestMetresPerPixel.x).toBeCloseTo(.25, 2); expect(cacheStats.bestMetresPerPixel.y).toBeCloseTo(.25, 2);
  expect(cacheStats.failed).toBe(0); expect(cacheStats.resident).toBeLessThanOrEqual(cacheStats.maximumResident);
  expect(cacheStats.decodedBytes + cacheStats.reservedDecodeBytes).toBeLessThanOrEqual(cacheStats.maximumBytes); expect(cacheStats.overviewReady).toBe(true);
  expect(visited.size).toBeGreaterThan(0);
  const fineURL = [...visited].find(url => /calvi-detail-/.test(url));
  expect(fineURL).toBeDefined();
  expect([...visited].every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  await expect.poll(() => page.evaluate(async url => Boolean(await caches.match(url)), fineURL)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  const logo = page.getByRole('img', { name: 'Blue Night', exact: true });
  await expect(logo).toBeVisible();
  await expect.poll(() => loaded(logo)).toBe(true);
  const sizes = await page.evaluate(async tile => {
    return Promise.all(['assets/blue-night-logo.svg', 'assets/victory.svg', 'assets/defeat.svg', 'assets/corsica-textures.png', 'assets/calvi-orthophoto.jpg', 'assets/aerial/calvi-overview.jpg', tile].map(async src => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return { src, width: img.naturalWidth, height: img.naturalHeight };
    }));
  }, fineURL);
  for (const size of sizes) {
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  }
  const imagery = await page.evaluate(async () => {
    const response = await fetch('data/calvi-imagery-provenance.json');
    return { ok: response.ok, provenance: await response.json() };
  });
  expect(imagery.ok).toBe(true); expect(imagery.provenance.status).toBe('ready');
  expect(imagery.provenance.attribution).toContain('IGN');
  const orthophoto = sizes.find(size => size.src === imagery.provenance.asset);
  expect(orthophoto).toBeDefined();
  expect(orthophoto.width).toBe(imagery.provenance.image.width);
  expect(orthophoto.height).toBe(imagery.provenance.image.height);
  const tiles = await page.evaluate(async tileURL => {
    const response = await fetch('data/calvi-imagery-tiles.json'), manifest = await response.json();
    return { ok: response.ok, baseCount: manifest.tiles.length, detailCount: manifest.detailTiles.length, detailMetresPerPixel: manifest.detailMetresPerPixel, tile: [...manifest.tiles, ...manifest.detailTiles].find(tile => new URL(tile.url, location.href).href === tileURL) };
  }, fineURL);
  expect(tiles.ok).toBe(true); expect(tiles.baseCount).toBe(288); expect(tiles.detailCount).toBeGreaterThan(0); expect(tiles.tile).toBeDefined();
  expect(cacheStats.available).toBe(tiles.baseCount + tiles.detailCount);
  expect(tiles.detailMetresPerPixel.x).toBeCloseTo(.25, 2); expect(tiles.detailMetresPerPixel.y).toBeCloseTo(.25, 2);
  const tileImage = sizes.find(size => size.src === fineURL);
  expect(tileImage.width).toBe(tiles.tile.width); expect(tileImage.height).toBe(tiles.tile.height);
  await expect.poll(async () => (await page.evaluate(() => window.blueNight.snapshot())).imagery.resident).toBeGreaterThan(0);
  await expect.poll(async () => (await page.evaluate(() => window.blueNight.snapshot())).imagery.pending).toBe(0);
  const offlineStats = (await page.evaluate(() => window.blueNight.snapshot())).imagery;
  expect(offlineStats.failed).toBe(0); expect(offlineStats.detailResident).toBeGreaterThan(0);
  expect(offlineStats.bestMetresPerPixel.x).toBeCloseTo(.25, 2); expect(offlineStats.bestMetresPerPixel.y).toBeCloseTo(.25, 2);
  await context.setOffline(false);
});

for (const bitmap of ['absent', 'rejecting']) {
  test(`HTML image fallback with ${bitmap} bitmap API retains photographs, aiming and frozen pause frames`, async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(bitmap => {
    Object.defineProperty(window, 'createImageBitmap', { configurable: true, value: bitmap === 'absent' ? undefined : async () => { throw new Error('Bitmap decoder unavailable'); } });
    Object.defineProperty(window, 'OffscreenCanvas', { configurable: true, value: undefined });
  }, bitmap);
  await page.goto('/'); await chooseStartingTime(page, 720);
  await page.getByRole('button', { name: 'JOUER', exact: false }).click();
  await page.getByRole('button', { name: "C'EST PARTI !", exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.blueNight.snapshot())).imagery.resident).toBeGreaterThan(0);
  await expect.poll(async () => (await page.evaluate(() => window.blueNight.snapshot())).imagery.pending).toBe(0);
  const loaded = await page.evaluate(() => window.blueNight.snapshot());
  expect(loaded.imagery.failed).toBe(0); expect(loaded.imagery.overviewReady).toBe(true);
  const car = loaded.cars.find(car => car.id === 'car-start');
  const aim = await page.evaluate(car => window.blueNight.screenPoint(car.x, car.y), car);
  await page.mouse.move(aim.x, aim.y); await page.keyboard.down('f');
  try { await expect.poll(async () => (await page.evaluate(() => window.blueNight.snapshot())).cars.find(car => car.id === 'car-start').hp).toBeLessThan(car.hp); }
  finally { await page.keyboard.up('f'); }
  await page.keyboard.press('Escape');
  const frozenImage = await canvasDigest(page), paused = await page.evaluate(() => window.blueNight.snapshot());
  await page.waitForTimeout(250);
  expect(await canvasDigest(page)).toBe(frozenImage);
  expect((await page.evaluate(() => window.blueNight.snapshot())).timeOfDay).toEqual(paused.timeOfDay);
  expect(errors).toEqual([]);
  });
}

test.describe('delayed image delivery', () => {
  // Browser routing cannot gate requests handled inside a service worker.
  // This case isolates photo arrival; the separate reload case covers its SW.
  test.use({ serviceWorkers: 'block' });
  test('photographic tiles arriving during pause leave the canvas unchanged until resume', async ({ page }) => {
  let releaseTiles, requested = 0;
  const gate = new Promise(resolve => { releaseTiles = resolve; });
  await page.route(/\/assets\/aerial\/calvi-(?:detail-(?:urban|airport)-)?c\d+-r\d+\.jpg$/, async route => {
    requested++; await gate; await route.continue();
  });
  await page.goto('/');
  await expect.poll(() => requested).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'JOUER', exact: false }).click();
  await page.getByRole('button', { name: "C'EST PARTI !", exact: true }).click();
  await page.keyboard.press('Escape');
  const frozen = await canvasDigest(page), paused = await page.evaluate(() => window.blueNight.snapshot());
  expect(paused.mode).toBe('paused'); expect(paused.imagery.pending).toBeGreaterThan(0);
  releaseTiles();
  await expect.poll(async () => (await page.evaluate(() => window.blueNight.snapshot())).imagery.resident).toBeGreaterThan(0);
  await expect.poll(async () => (await page.evaluate(() => window.blueNight.snapshot())).imagery.pending).toBe(0);
  expect(await canvasDigest(page)).toBe(frozen);
  expect((await page.evaluate(() => window.blueNight.snapshot())).elapsed).toBe(paused.elapsed);
  await page.getByRole('button', { name: 'REPRENDRE', exact: true }).click();
  await expect.poll(async () => await canvasDigest(page)).not.toBe(frozen);
  });
});

test('the drawn city freezes during pause and resumes with vehicle movement', async ({ page }) => {
  await page.goto('/');
  // Wait for the actual renderer atlas so a delayed image load cannot be
  // mistaken for a paused animation changing the picture.
  await page.evaluate(async () => await (await import('/render.js')).artReady);
  await chooseGameMode(page, 'missions');
  await chooseStartingTime(page, 0);
  await page.getByRole('button', { name: 'JOUER', exact: false }).click();
  await page.getByRole('button', { name: "C'EST PARTI !", exact: true }).click();
  const onFoot = await page.evaluate(() => window.blueNight.snapshot());
  const backingBuffer = await page.locator('#game').evaluate(canvas => ({ width: canvas.width, height: canvas.height }));
  expect(onFoot.timeOfDay.hour).toBe(0);
  expect(onFoot.timeOfDay.phase).toBe('nuit');
  await page.keyboard.press('Space');
  await page.keyboard.press('e');
  const start = await page.evaluate(() => window.blueNight.snapshot()), key = drivingKey(start.vehicle);
  expect(start.camera.zoom).toBeLessThan(onFoot.camera.zoom);
  expect(await page.locator('#game').evaluate(canvas => ({ width: canvas.width, height: canvas.height }))).toEqual(backingBuffer);
  await page.keyboard.down(key); await page.waitForTimeout(250); await page.keyboard.up(key);
  await page.keyboard.press('Escape');
  const paused = await page.evaluate(() => window.blueNight.snapshot());
  expect(paused.mode).toBe('paused');
  expect(paused.vehicleId).not.toBeNull();
  expect(paused.bottles).toHaveLength(1);
  expect(paused.bottles[0].fuse).toBeGreaterThan(0);
  await painted(page);
  const frozenImage = await canvasDigest(page);
  await page.waitForTimeout(250);
  expect(await canvasDigest(page)).toBe(frozenImage);
  expect((await page.evaluate(() => window.blueNight.snapshot())).timeOfDay).toEqual(paused.timeOfDay);
  await expect(page.locator('#game-clock')).toHaveText(paused.timeOfDay.label);
  await expect(page.locator('#time-phase')).toHaveText('NUIT');
  await page.getByRole('button', { name: 'REPRENDRE', exact: true }).click();
  await page.keyboard.down(key); await page.waitForTimeout(200); await page.keyboard.up(key);
  await painted(page);
  const resumed = await page.evaluate(() => window.blueNight.snapshot());
  expect(Math.hypot(resumed.player.x - paused.player.x, resumed.player.y - paused.player.y)).toBeGreaterThan(5);
  expect(resumed.bottles[0].fuse).toBeLessThan(paused.bottles[0].fuse);
  expect(await canvasDigest(page)).not.toBe(frozenImage);
});

test('only the real Calvi map is offered, with its geographic credits and a drivable first car', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Ville', exact: true })).toHaveCount(0);
  await expect(page.locator('#map-choice')).toHaveCount(0);
  await expect(page.locator('.edition-pills')).toContainText('CALVI · COMMUNE ENTIÈRE');
  const testFixture = await page.request.get('/tests/fixtures/street-grid.js');
  expect(testFixture.status()).toBe(403);
  await page.locator('.dossier-open:visible').first().click();
  await expect(page.locator('#map-credit')).toBeVisible();
  await expect(page.locator('#map-credit')).toContainText('IGN');
  await expect(page.locator('#map-credit')).toContainText('BD ORTHO');
  await expect(page.locator('#map-credit')).toContainText('BD TOPO');
  await expect(page.getByRole('link', { name: 'OpenStreetMap contributors', exact: true }))
    .toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
  await page.getByRole('button', { name: 'RETOUR AU JEU', exact: true }).click();
  const geography = await page.evaluate(async () => {
    const { CALVI_MAP } = await import('/data/calvi-map.js'), boundary = CALVI_MAP.municipalBoundary;
    return { mapBounds: CALVI_MAP.metadata.bounds, boundary: boundary && {
      insee: boundary.insee, name: boundary.name, sourceId: boundary.sourceId, source: boundary.source,
      bounds: boundary.bounds, areaSquareKm: boundary.areaSquareKm, polygons: boundary.polygons.length,
    } };
  });
  expect(geography.boundary).toMatchObject({ insee: '2B050', name: 'Calvi', sourceId: 1151255, source: 'OpenStreetMap administrative boundary' });
  expect(geography.boundary.polygons).toBeGreaterThan(0);
  expect(geography.boundary.areaSquareKm).toBeGreaterThan(20);
  // The playable extract must contain the entire imported administrative
  // boundary, rather than merely reporting a larger decorative minimap.
  expect(geography.mapBounds.west).toBeLessThanOrEqual(geography.boundary.bounds.west);
  expect(geography.mapBounds.south).toBeLessThanOrEqual(geography.boundary.bounds.south);
  expect(geography.mapBounds.east).toBeGreaterThanOrEqual(geography.boundary.bounds.east);
  expect(geography.mapBounds.north).toBeGreaterThanOrEqual(geography.boundary.bounds.north);
  await page.evaluate(async () => await (await import('/render.js')).artReady);
  await page.getByRole('button', { name: 'JOUER', exact: false }).click();
  await page.getByRole('button', { name: "C'EST PARTI !", exact: true }).click();
  await expect(page.locator('#location')).toContainText('CALVI');
  await expect(page.locator('#minimap')).toBeVisible();
  await page.keyboard.press('e');
  const entered = await page.evaluate(() => window.blueNight.snapshot());
  expect(entered.map).toMatchObject({ city: 'Calvi', source: 'OpenStreetMap', status: 'ready' });
  expect(entered.map.bounds).toEqual(geography.mapBounds);
  expect(entered.vehicleId).toBe('car-start');
  expect(entered.vehicle).not.toBeNull();
  // Follow the nearest cardinal direction to the parked car's actual heading;
  // no coordinates or imported geometry are injected into the running game.
  const dx = Math.cos(entered.vehicle.angle), dy = Math.sin(entered.vehicle.angle);
  const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : (dy > 0 ? 'ArrowDown' : 'ArrowUp');
  await page.keyboard.down(key); await page.waitForTimeout(350); await page.keyboard.up(key);
  const driven = await page.evaluate(() => window.blueNight.snapshot());
  expect(Math.hypot(driven.player.x - entered.player.x, driven.player.y - entered.player.y)).toBeGreaterThan(6);
  expect(driven.hearts).toBe(3);
  await page.keyboard.press('Escape'); await painted(page);
  const frozenImage = await canvasDigest(page);
  await page.waitForTimeout(150);
  expect(await canvasDigest(page)).toBe(frozenImage);
});

test('a player can walk along the Calvi quay and steal another parked car', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'JOUER', exact: false }).click();
  await page.getByRole('button', { name: "C'EST PARTI !", exact: true }).click();
  const snapshot = () => page.evaluate(() => window.blueNight.snapshot());
  const start = await snapshot();
  expect(start.sessionMode).toBe('free'); expect(start.cars.length).toBeGreaterThanOrEqual(10);
  const target = start.cars.find(car => car.id === 'calvi-car-1');
  expect(target).toBeDefined();
  expect(target.owned).toBe(false); expect(target.mobilityType).toBeUndefined();
  // The larger observed fleet occupies the old aisle. Follow the free route
  // west of it and stand beside this second car's actual heading.
  for (const goal of [{ x: 16512, y: 8700 }, { x: 16460, y: 8708 }, { x: 16444, y: 8724 },
    { x: target.x - Math.sin(target.angle) * 17, y: target.y + Math.cos(target.angle) * 17 }]) await walkTo(page, goal, { radius: 1 });
  const approach = await snapshot();
  expect(Math.hypot(approach.player.x - target.x, approach.player.y - target.y)).toBeLessThan(25);
  expect(approach.vehicleId).toBeNull();
  expect(approach.interactionTarget?.id).toBe(target.id);
  await expect(page.locator('#boom')).toHaveAccessibleName(/voler une voiture/i);
  await page.keyboard.press('e');
  const stolen = await snapshot();
  expect(stolen.vehicleId).not.toBeNull(); expect(stolen.vehicleId).not.toBe('car-start');
  expect(stolen.vehicleId).toBe(target.id);
  expect(stolen.vehicle.stolen).toBe(true); expect(stolen.heat).toBeGreaterThanOrEqual(2);
  expect(stolen.hearts).toBeGreaterThan(0);
  expect(stolen.wanted.level).toBe(stolen.heat); expect(stolen.wanted.points).toBeGreaterThanOrEqual(12);
  expect(['pursuit', 'search']).toContain(stolen.wanted.state);
  await expect(page.locator('#boom')).toHaveAccessibleName(/sortir/i);
  await page.keyboard.press('e');
  expect((await snapshot()).vehicleId).toBeNull();
});
