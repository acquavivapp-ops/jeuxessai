import { test, expect } from '@playwright/test';
import { chooseStartingTime, canvasDigest, walkTo, expectIllustrated } from './helpers.js';

const snapshot = page => page.evaluate(() => window.blueNight.snapshot());
async function begin(page) {
  await page.goto('/'); await chooseStartingTime(page, 720);
  await page.getByRole('button', { name: 'JOUER', exact: false }).click();
  await page.getByRole('button', { name: "C'EST PARTI !", exact: true }).click();
  await expectIllustrated(page);
}
const patchDigest = (page, worldPoint) => page.locator('#game').evaluate(async (canvas, point) => {
  const screen = window.blueNight.screenPoint(point.x, point.y), box = canvas.getBoundingClientRect();
  const cx = (screen.x - box.x) * canvas.width / box.width, cy = (screen.y - box.y) * canvas.height / box.height;
  const radius = 80;
  if (cx - radius < 0 || cy - radius < 0 || cx + radius >= canvas.width || cy + radius >= canvas.height) throw new Error('The sea sample must be inside the real viewport');
  const rgba = canvas.getContext('2d').getImageData(Math.round(cx - radius), Math.round(cy - radius), radius * 2, radius * 2).data;
  const hash = await crypto.subtle.digest('SHA-256', rgba);
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}, worldPoint);

test('photo-derived trees keep source coordinates and the sea moves only while the game is active', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 }); await begin(page);
  const initial = await snapshot(page);
  const source = await page.evaluate(async () => {
    const { CALVI_AERIAL_OBJECTS: objects } = await import('/data/calvi-aerial-objects.js');
    const manifest = await (await fetch('/data/calvi-imagery-tiles.json')).json();
    const state = window.blueNight.snapshot();
    const tiles = [...manifest.sourceTiles, ...manifest.detailSourceTiles];
    const trees = objects.vegetation.filter(object => object.type === 'tree').sort((a, b) => Math.hypot(a.x - state.player.x, a.y - state.player.y) - Math.hypot(b.x - state.player.x, b.y - state.player.y)).slice(0, 3);
    return { status: objects.metadata.status, count: objects.vegetation.length,
      observedVehicleIds: objects.vehicles.map(vehicle => vehicle.id).sort(), samples: trees.map(tree => {
      const provenance = tree.sourcePlacement, tile = tiles.find(tile => tile.id === provenance.tileId);
      const expected = provenance.centerPixel
        ? { x: provenance.sourceBoundsWorld.x + provenance.centerPixel[0] / provenance.sourceImageWidth * provenance.sourceBoundsWorld.w,
          y: provenance.sourceBoundsWorld.y + provenance.centerPixel[1] / provenance.sourceImageHeight * provenance.sourceBoundsWorld.h }
        : { x: provenance.pixelX / manifest.image.width * manifest.worldWidth,
          y: provenance.pixelY / manifest.image.height * manifest.worldHeight };
      return { x: tree.x, y: tree.y, expected, estimatedHeight: tree.estimatedHeight, heightSource: tree.heightSource, sha256: provenance.sha256, tileSha256: tile?.sha256 };
    }) };
  });
  expect(source.status).toBe('ready'); expect(source.count).toBeGreaterThan(1000);
  expect(initial.aerial.vegetationCount).toBe(source.count); expect(source.samples).toHaveLength(3);
  // Every verified photo body is a real, unlocked actor in the running city,
  // including the boats and aircraft, rather than a painted decoration.
  const photoActors = initial.cars.filter(vehicle => vehicle.sourceImage?.annotationId);
  expect(photoActors.map(vehicle => vehicle.sourceImage.annotationId).sort()).toEqual(source.observedVehicleIds);
  expect(photoActors.every(vehicle => !vehicle.locked && !vehicle.destroyed)).toBe(true);
  expect(initial.aerial.vehicleMasks.map(mask => mask.annotationId).sort()).toEqual(source.observedVehicleIds);
  expect(initial.aerial.vehicleCoverage.converted).toBe(source.observedVehicleIds.length);
  expect(initial.aerial.vehicleCoverage.rejected).toEqual([]);
  for (const tree of source.samples) {
    expect(tree.sha256).toMatch(/^[a-f0-9]{64}$/); expect(tree.sha256).toBe(tree.tileSha256);
    expect(tree.x).toBeCloseTo(tree.expected.x, 2); expect(tree.y).toBeCloseTo(tree.expected.y, 2);
    expect(tree.estimatedHeight).toBe(true); expect(tree.heightSource).toContain('estimate');
  }
  await expect.poll(async () => (await snapshot(page)).renderer.vegetationVisible).toBeGreaterThan(0);
  await expect.poll(async () => (await snapshot(page)).renderer.seaRippleCount).toBeGreaterThan(0);
  // The sample lies in open port water, away from the player and game actors.
  const water = { x: initial.player.x + 160, y: initial.player.y };
  const before = await patchDigest(page, water); await page.waitForTimeout(400);
  expect(await patchDigest(page, water)).not.toBe(before);
  await page.keyboard.press('Escape'); const paused = await snapshot(page), frozen = await canvasDigest(page);
  const frozenWater = await patchDigest(page, water); await page.waitForTimeout(300);
  expect(await canvasDigest(page)).toBe(frozen); expect(await patchDigest(page, water)).toBe(frozenWater);
  expect((await snapshot(page)).elapsed).toBe(paused.elapsed);
  await page.getByRole('button', { name: 'REPRENDRE', exact: true }).click(); await page.waitForTimeout(400);
  expect(await patchDigest(page, water)).not.toBe(frozenWater);
});

const centreColour = (page, point) => page.locator('#game').evaluate((canvas, point) => {
  const screen = window.blueNight.screenPoint(point.x, point.y), box = canvas.getBoundingClientRect();
  const x = Math.round((screen.x - box.x) * canvas.width / box.width), y = Math.round((screen.y - box.y) * canvas.height / box.height);
  const pixels = canvas.getContext('2d').getImageData(x - 4, y - 4, 9, 9).data, rgb = [0, 0, 0];
  for (let i = 0; i < pixels.length; i += 4) for (let channel = 0; channel < 3; channel++) rgb[channel] += pixels[i + channel];
  return rgb.map(value => value / (pixels.length / 4));
}, point);

const painted = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test('the illustrated source crown obscures the hood, retains its contour and keeps its trunk collision', async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 800 }); await begin(page);
  const tree = await page.evaluate(async () => {
    const { CALVI_AERIAL_OBJECTS: objects } = await import('/data/calvi-aerial-objects.js');
    const manifest = await (await fetch('/data/calvi-imagery-tiles.json')).json();
    const tree = objects.vegetation.find(tree => tree.id === 'photo-tree-square-19');
    const source = [...manifest.sourceTiles, ...manifest.detailSourceTiles].find(source => source.id === tree.sourcePlacement.tileId);
    return { id: tree.id, x: tree.x, y: tree.y, radius: tree.radius, canopy: tree.canopyPolygon,
      sha256: tree.sourcePlacement.sha256, sourceSha256: source.sha256, method: tree.sourcePlacement.method };
  });
  expect(tree.sha256).toBe(tree.sourceSha256); expect(tree.method).toContain('manually verified photo crown');
  expect(tree.canopy.length).toBeGreaterThanOrEqual(8);
  // This footpath passes the real parked cars and newly solid square trees.
  // The running game receives normal input; its factory, player position,
  // health and clock remain untouched by the route and diagnostic fixture.
  for (const goal of [{ x: 16480, y: 8736 }, { x: 16464, y: 8768 }, { x: 16376, y: 8864 },
    { x: tree.x, y: tree.y + 65 }, { x: 16280, y: 8970 }]) await walkTo(page, goal, { radius: 2.5, timeout: 12000 });
  await painted(page);
  expect((await snapshot(page)).renderer.playerUnderCanopy).toBe(false);
  const visiblePose = (await snapshot(page)).player;
  await walkTo(page, { x: tree.x, y: tree.y + 65 }, { radius: 2.5 });
  await walkTo(page, { x: tree.x, y: tree.y + 25 }, { radius: 2.5 });
  await painted(page);
  expect((await snapshot(page)).renderer.playerUnderCanopy).toBe(true);
  await page.keyboard.down('ArrowUp');
  try {
    await page.waitForFunction(tree => window.blueNight.snapshot().player.y < tree.y + 8, tree);
    const contact = await snapshot(page);
    await page.waitForFunction(elapsed => window.blueNight.snapshot().elapsed - elapsed > .45, contact.elapsed);
    const blocked = await snapshot(page);
    expect(blocked.player.y).toBeGreaterThan(tree.y + 6.5);
    expect(Math.hypot(blocked.player.x - contact.player.x, blocked.player.y - contact.player.y)).toBeLessThan(1.5);
    expect(blocked.vehicleId).toBeNull(); expect(blocked.mode).toBe('playing');
  } finally { await page.keyboard.up('ArrowUp'); }
  // Step back from contact before passing beside the trunk; a tangent
  // shortcut would cut through its physical circle.
  await walkTo(page, { x: tree.x, y: tree.y + 11 }, { radius: 2.5 });
  const backedAway = (await snapshot(page)).player;
  const coveredPose = backedAway;
  await walkTo(page, { x: tree.x - 16, y: backedAway.y }, { radius: 2.5 });
  await walkTo(page, { x: tree.x - 16, y: tree.y - 17 }, { radius: 2.5 });
  await walkTo(page, { x: tree.x, y: tree.y - 17 }, { radius: 2.5 });
  await painted(page);
  const around = await snapshot(page);
  expect(around.player.y).toBeLessThan(tree.y - 12); expect(around.renderer.playerUnderCanopy).toBe(true);
  expect(around.hearts).toBe(3); expect(errors).toEqual([]);
  const publicCapture = testInfo.outputPath('source-crown-public.png');
  await page.screenshot({ path: publicCapture });
  await testInfo.attach('Source crown after the public foot and collision route', { path: publicCapture, contentType: 'image/png' });
  // A separate render fixture holds each recorded pose still. The same sprite
  // is opaque or blinking; this avoids assumptions about leaf and hood colours.
  const fixtureContext = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const fixture = await fixtureContext.newPage();
    await fixture.route('**/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas id="sample" width="1280" height="1280"></canvas>' }));
    await fixture.goto(new URL('/', page.url()).href);
    const proof = await fixture.evaluate(async poses => {
      const [{ Game }, renderer] = await Promise.all([import('/engine.js'), import('/render.js')]);
      await renderer.artReady;
      const game = new Game(), canvas = document.getElementById('sample');
      Object.assign(canvas, { viewWidth: 320, viewHeight: 320, renderScale: 4, renderScaleX: 4, renderScaleY: 4 });
      game.startClockMinutes = 720; game.elapsed = 0;
      const ctx = canvas.getContext('2d'), results = [];
      for (const pose of poses) {
        Object.assign(game.player, pose);
        const angle = pose.aimAngle ?? pose.dir;
        const head = renderer.worldToScreen(game, pose.x + Math.cos(angle) * 2.05 + Math.sin(angle) * .05,
          pose.y + Math.sin(angle) * 2.05 - Math.cos(angle) * .05, canvas);
        const patch = () => Array.from(ctx.getImageData(Math.round(head.x * 4) - 3, Math.round(head.y * 4) - 3, 7, 7).data);
        game.player.invulnerable = 0; renderer.render(ctx, game); const opaque = patch();
        const underCanopy = renderer.rendererStats().playerUnderCanopy;
        game.player.invulnerable = 1; renderer.render(ctx, game); const blinking = patch();
        const channelDifferences = opaque.map((value, index) => index % 4 === 3 ? 0 : Math.abs(value - blinking[index]));
        results.push({ underCanopy, meanDifference: channelDifferences.reduce((sum, value) => sum + value, 0) / (49 * 3),
          changedPixels: Array.from({ length: 49 }, (_, pixel) => channelDifferences.slice(pixel * 4, pixel * 4 + 3).some(value => value > 0)).filter(Boolean).length });
      }
      return { liveGameAbsent: typeof window.blueNight === 'undefined', outside: results[0], covered: results[1] };
    }, [visiblePose, coveredPose]);
    expect(proof.liveGameAbsent).toBe(true);
    await testInfo.attach('Same-position opaque/blinking head pixel proof (isolated fixture)', { body: JSON.stringify(proof, null, 2), contentType: 'application/json' });
    expect(proof.outside.underCanopy).toBe(false); expect(proof.covered.underCanopy).toBe(true);
    expect(proof.outside.changedPixels).toBeGreaterThan(40);
    expect(proof.outside.meanDifference).toBeGreaterThan(10);
    expect(proof.covered.changedPixels).toBe(0); expect(proof.covered.meanDifference).toBe(0);
  } finally { await fixtureContext.close(); }
});

test('a source-positioned car can be stolen and driven away revealing the illustrated pavement without photographic patches', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 }); await begin(page);
  const initial = await snapshot(page), origin = initial.cars.find(car => car.sourceImage?.annotationId === 'photo-car-port-03');
  expect(origin).toBeDefined(); expect(origin.owned).toBe(false); expect(origin.stolen).toBe(false);
  expect(origin.id).not.toBe('car-start');
  const mask = initial.aerial.vehicleMasks.find(mask => mask.vehicleId === origin.id);
  expect(mask).toBeDefined(); expect(mask.persistent).toBe(true);
  expect(mask.annotationId).toBe(origin.sourceImage.annotationId);
  const observed = await page.evaluate(async id => {
    const { CALVI_AERIAL_OBJECTS: objects } = await import('/data/calvi-aerial-objects.js');
    const manifest = await (await fetch('/data/calvi-imagery-tiles.json')).json();
    const car = objects.vehicles.find(car => car.id === id), source = [...manifest.sourceTiles, ...manifest.detailSourceTiles].find(tile => tile.id === car.sourcePlacement.tileId);
    return { x: car.x, y: car.y, sha256: car.sourcePlacement.sha256, sourceSha256: source.sha256 };
  }, origin.sourceImage.annotationId);
  expect(origin.x).toBe(observed.x); expect(origin.y).toBe(observed.y);
  expect(observed.sha256).toBe(observed.sourceSha256); expect(origin.sourceImage.sha256).toBe(observed.sha256);
  expect(initial.renderer.appliedVehicleMasks).toBe(0); expect(initial.renderer.maskSignature).toBe('');
  // Follow the real aisle around the starter and adjacent photographed cars;
  // the target is the formerly non-interactive body, rather than the owned car.
  expect(origin.entryPoint).toBeDefined();
  for (const goal of [{ x: 16527.689, y: 8689.178 }, { x: 16519.689, y: 8721.178 },
    { x: 16523.689, y: 8733.178 }, { x: 16519.689, y: 8739.178 }, origin.entryPoint]) await walkTo(page, goal);
  const reachable = await snapshot(page);
  expect(reachable.interactionTarget?.id).toBe(origin.id);
  await expect(page.locator('#boom')).toHaveAccessibleName(/voler/i);
  const parkedColour = await centreColour(page, origin);
  await page.keyboard.press('e'); expect((await snapshot(page)).vehicleId).toBe(origin.id);
  // Drive north through the parking aisle; reversing west would hit the bike.
  await page.keyboard.down('ArrowUp');
  try {
    await expect.poll(async () => {
      const player = (await snapshot(page)).player; return Math.hypot(player.x - origin.x, player.y - origin.y);
    }, { intervals: [20], timeout: 4000 }).toBeGreaterThan(30);
  } finally { await page.keyboard.up('ArrowUp'); }
  await page.keyboard.down('Space');
  try { await expect.poll(async () => Math.abs((await snapshot(page)).vehicle.speed), { intervals: [20] }).toBeLessThan(5); }
  finally { await page.keyboard.up('Space'); }
  const moved = await snapshot(page);
  expect(moved.vehicle.owned).toBe(false); expect(moved.vehicle.stolen).toBe(true);
  expect(moved.wanted.level).toBeGreaterThanOrEqual(2); expect(moved.wanted.points).toBeGreaterThanOrEqual(12);
  expect(moved.aerial.vehicleMasks.find(candidate => candidate.vehicleId === origin.id)).toEqual(mask);
  expect(moved.renderer.appliedVehicleMasks).toBe(0); expect(moved.renderer.maskSignature).toBe('');
  const pavement = await centreColour(page, origin);
  // The observed vehicle leaves the actual source parking, exposing the drawn
  // ground underneath it. A photographic removal colour is no longer applied.
  expect(Math.hypot(...pavement.map((value, channel) => value - parkedColour[channel]))).toBeGreaterThan(30);
  expect(moved.hearts).toBe(3);
  await page.keyboard.press('Escape'); const frozen = await canvasDigest(page); await page.waitForTimeout(250);
  expect(await canvasDigest(page)).toBe(frozen);
});
