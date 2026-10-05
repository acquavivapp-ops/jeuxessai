import { test, expect } from '@playwright/test';

// This document renders independent production-world fixtures. It does not
// load app.js or alter the running game's player, clock, health or missions.
test.describe('isolated illustrated municipality render', () => {
  test.use({ serviceWorkers: 'block' });
  test('port, citadel, beach and airport use the same illustrated world without changing any source geometry', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const photographicRequests = [], errors = [];
    page.on('request', request => {
      if (/\/assets\/(?:aerial\/.*\.jpe?g|calvi-orthophoto\.jpg)(?:\?|$)/.test(request.url())) photographicRequests.push(request.url());
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('**/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0"><canvas id="sector" width="1280" height="800"></canvas></body></html>' }));
    await page.goto('/');
    const initial = await page.evaluate(async () => {
      const [{ Game }, renderer] = await Promise.all([import('/engine.js'), import('/render.js')]);
      await renderer.artReady;
      const game = new Game(), world = game.world;
      const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
      const shape = () => ({
        width: world.width, height: world.height, bounds: world.metadata.bounds,
        roads: world.roads.map(r => ({ id: r.id, points: r.points, width: r.width, type: r.type })),
        buildings: world.buildings.map(b => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, polygon: b.polygon, holes: b.holes, heightMeters: b.heightMeters })),
        land: world.landPolygons, sea: world.seaPolygons,
        vegetation: world.vegetation.map(t => ({ id: t.id, x: t.x, y: t.y, radius: t.radius, canopyPolygon: t.canopyPolygon, trunk: t.trunk })),
        piers: world.piers,
      });
      const vehicleShape = () => game.cars.filter(c => c.sourceImage).map(c => ({ id: c.id, x: c.x, y: c.y, angle: c.angle, sourceImage: c.sourceImage }));
      window.sectorFixture = { game, renderer, digest, shape, vehicleShape };
      return { liveGameAbsent: typeof window.blueNight === 'undefined', geometry: await digest(shape()), vehicles: await digest(vehicleShape()),
        fingerprint: renderer.worldGeometryFingerprint(world), width: world.width, height: world.height, bounds: world.metadata.bounds,
        counts: [world.roads.length, world.buildings.length, world.vegetation.length, world.piers.length] };
    });
    expect(initial.liveGameAbsent).toBe(true);
    expect(initial.geometry).toBe('bde3e54d6455fc8507077bf0e5772abfd02bca271450bca33b21e28e837db891');
    expect(initial.vehicles).toBe('06fa7ae5236cccc8ac10c7dafff7c0958680dda9f12b4d0b41c7c613e9356440');
    expect(initial.fingerprint).toBe('11f0e5b971f8f605');
    expect(initial.counts).toEqual([1552, 3893, 12000, 6]);
    expect([initial.width, initial.height]).toEqual([35766.74, 30930.25]);
    expect(initial.bounds).toEqual({ west: 8.7063593, south: 42.5150237, east: 8.8153936, north: 42.5844865 });
    const frames = [];
    for (const sector of [
      { name: 'port', x: 16510, y: 8734 },
      { name: 'citadel', x: 17723.87, y: 7184.87 },
      { name: 'beach', x: 22329.4, y: 12695.42 },
      { name: 'airport', x: 27508.09, y: 26382.85 },
    ]) for (const lighting of [{ name: 'day', minutes: 720 }, { name: 'night', minutes: 0 }]) {
      const frame = await page.evaluate(async ({ sector, lighting }) => {
        const { game, renderer, digest, shape, vehicleShape } = window.sectorFixture;
        // Fixture camera anchors only; production source geometry is untouched.
        Object.assign(game.player, { x: sector.x, y: sector.y });
        game.startClockMinutes = lighting.minutes;
        const canvas = document.getElementById('sector'), ctx = canvas.getContext('2d');
        renderer.render(ctx, game);
        const firstFrameStats = renderer.rendererStats();
        renderer.render(ctx, game); renderer.render(ctx, game);
        const projected = renderer.worldToScreen(game, sector.x, sector.y, canvas);
        const recovered = renderer.screenToWorld(game, projected.x, projected.y, canvas);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const colours = new Set();
        for (let i = 0; i < pixels.length; i += 128) colours.add([pixels[i], pixels[i + 1], pixels[i + 2]].join(','));
        return { stats: renderer.rendererStats(), firstFrameStats, imagery: renderer.imageryStats(), projected, recovered,
          geometry: await digest(shape()), vehicles: await digest(vehicleShape()), fingerprint: renderer.worldGeometryFingerprint(game.world),
          pixels: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)), byte => byte.toString(16).padStart(2, '0')).join(''), distinctColours: colours.size };
      }, { sector, lighting });
      expect(frame.stats).toMatchObject({ artMode: 'illustrated', photoMode: false, materialsReady: true, sourceMapSha256: '0ba6530cd231d4eb22749450014d9e6ab103359899c22cfeccc276f65bfa6baf', appliedVehicleMasks: 0, maskSignature: '' });
      expect(frame.imagery).toMatchObject({ status: 'disabled', requests: 0, resident: 0, pending: 0, decodedBytes: 0 });
      expect(frame.geometry).toBe(initial.geometry); expect(frame.vehicles).toBe(initial.vehicles);
      expect(frame.fingerprint).toBe(initial.fingerprint);
      for (const prefix of ['ground', 'roof', 'foliage']) {
        expect(Number.isInteger(frame.stats[`${prefix}PaintCount`])).toBe(true);
        expect(Number.isInteger(frame.stats[`${prefix}CacheMisses`])).toBe(true);
        expect(Number.isInteger(frame.stats[`${prefix}VisibleEvictions`])).toBe(true);
        expect(frame.stats[`${prefix}PaintCount`], `Warm ${prefix} surfaces repaint`).toBe(frame.firstFrameStats[`${prefix}PaintCount`]);
        expect(frame.stats[`${prefix}CacheMisses`], `Warm ${prefix} cache misses`).toBe(frame.firstFrameStats[`${prefix}CacheMisses`]);
        expect(frame.stats[`${prefix}VisibleEvictions`], `Visible ${prefix} surfaces evicted`).toBe(0);
      }
      expect(frame.projected.x).toBeCloseTo(640, 5); expect(frame.projected.y).toBeCloseTo(400, 5);
      expect(frame.recovered.x).toBeCloseTo(sector.x, 5); expect(frame.recovered.y).toBeCloseTo(sector.y, 5);
      expect(frame.distinctColours).toBeGreaterThan(1000);
      for (const prefix of ['ground', 'roof', 'foliage']) expect(frame.stats[`${prefix}Bytes`]).toBeLessThanOrEqual(frame.stats[`maximum${prefix[0].toUpperCase() + prefix.slice(1)}Bytes`]);
      const capture = testInfo.outputPath(`fixture-${sector.name}-${lighting.name}-1280x800.png`);
      await page.screenshot({ path: capture });
      await testInfo.attach(`Isolated rendered ${sector.name} ${lighting.name} fixture`, { path: capture, contentType: 'image/png' });
      frames.push(frame);
    }
    expect(new Set(frames.map(frame => frame.pixels)).size).toBe(8);
    expect(photographicRequests).toEqual([]); expect(errors).toEqual([]);
  });
});
