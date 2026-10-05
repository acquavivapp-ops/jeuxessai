import { test, expect } from '@playwright/test';
import { chooseGameMode, chooseStartingTime, drivingKey, visiblePedestrian, canvasDigest, walkTo } from './helpers.js';

const snap = page => page.evaluate(() => window.blueNight.snapshot());
async function begin(page) {
  await page.goto('/');
  await chooseGameMode(page, 'missions');
  await page.evaluate(async () => await (await import('/render.js')).artReady);
  await page.getByRole('button', { name: 'JOUER', exact: false }).click();
  await page.getByRole('button', { name: "C'EST PARTI !", exact: true }).click();
  await expect.poll(async () => (await snap(page)).mode).toBe('playing');
  expect((await snap(page)).map).toMatchObject({ city: 'Calvi', source: 'OpenStreetMap', status: 'ready' });
}

// Calvi's quay turns southwest. Walking diagonally follows the actual land
// instead of continuing south into the marina's water boundary.
async function walkAlongQuay(page, length) {
  const start = (await snap(page)).player;
  await page.keyboard.down('ArrowLeft'); await page.keyboard.down('ArrowDown');
  try {
    await expect.poll(async () => {
      const player = (await snap(page)).player;
      return Math.hypot(player.x - start.x, player.y - start.y);
    }, { intervals: [16], timeout: 4000 }).toBeGreaterThanOrEqual(Math.min(length - 2, 48));
  } finally {
    await page.keyboard.up('ArrowDown'); await page.keyboard.up('ArrowLeft');
  }
  if (length > 50) {
    // The newly converted parking row occupies the old long diagonal. Pass
    // west of its bodies before continuing south, keeping the same escape
    // distance required to survive the planted bottle.
    await page.keyboard.down('ArrowLeft');
    try { await expect.poll(async () => (await snap(page)).player.x, { intervals: [16] }).toBeLessThan(start.x - 54); }
    finally { await page.keyboard.up('ArrowLeft'); }
    await page.keyboard.down('ArrowDown');
    try {
      await expect.poll(async () => {
        const player = (await snap(page)).player; return Math.hypot(player.x - start.x, player.y - start.y);
      }, { intervals: [16] }).toBeGreaterThanOrEqual(length - 2);
    } finally { await page.keyboard.up('ArrowDown'); }
  }
  await page.waitForTimeout(70);
  const end = (await snap(page)).player;
  expect(end.x).toBeLessThan(start.x); expect(end.y).toBeGreaterThan(start.y);
}

test('the tutorial freezes Calvi; a bottle explodes after escaping along the real quay and dialogue stays absent', async ({ page }) => {
  // Play past the former first radio programme, using the real game clock.
  test.setTimeout(45_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await chooseGameMode(page, 'missions'); await page.getByRole('button', { name: 'JOUER', exact: false }).click();
  await page.keyboard.press('Space'); await page.keyboard.press('e'); await page.waitForTimeout(200);
  expect((await snap(page)).elapsed).toBe(0);
  expect((await snap(page)).bottles).toEqual([]); expect((await snap(page)).vehicleId).toBeNull();
  await page.getByRole('button', { name: "C'EST PARTI !", exact: true }).click();
  await expect(page.locator('#location')).toContainText('CALVI');
  await page.getByRole('button', { name: 'POSER', exact: false }).click();
  const planted = await snap(page);
  expect(planted.bottles).toHaveLength(1); expect(planted.bottles[0].fuse).toBeGreaterThan(2);
  const bottle = planted.bottles[0];
  // Observe the short visual effect while walking, rather than starting the
  // observation after a slower browser has already completed the escape.
  const explosion = page.waitForFunction(bottle => window.blueNight.snapshot().explosionEffects.some(effect =>
    effect.cause === 'blast' && Math.hypot(effect.x - bottle.x, effect.y - bottle.y) < 5), bottle, { timeout: 15000 });
  void explosion.catch(() => {});
  await walkAlongQuay(page, 85);
  await explosion;
  const escaped = await snap(page);
  expect(escaped.bottles).toEqual([]); expect(escaped.hearts).toBe(3);
  expect(Math.hypot(escaped.player.x - bottle.x, escaped.player.y - bottle.y)).toBeGreaterThan(70);
  expect(escaped.objective.type).toBe('target');
  expect(escaped.objective.id).toMatch(/^osm-building-/);
  await page.locator('#hud-details').click();
  await expect(page.locator('#missiontext')).toBeVisible(); await expect(page.locator('#heat')).toBeVisible();
  await expect.poll(async () => (await snap(page)).elapsed, { timeout: 12000 }).toBeGreaterThan(9);
  await expect(page.locator('#radio')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(/François Mitterrand|Edmond Sim[ée]oni|Ninu|Nino|Ant[òo]/i);
  await page.keyboard.press('Escape');
  const paused = await snap(page);
  await page.waitForTimeout(250);
  const frozen = await snap(page);
  expect(frozen.elapsed).toBe(paused.elapsed); expect(frozen.player).toEqual(paused.player);
  await page.getByRole('button', { name: 'REPRENDRE', exact: true }).click();
  await expect.poll(async () => (await snap(page)).elapsed).toBeGreaterThan(paused.elapsed);
  await expect(page.locator('#radio')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('E enters a car, directional keys drive through town, pause freezes it, and E exits safely', async ({ page }) => {
  await begin(page);
  const mapBefore = await page.locator('#minimap').evaluate(canvas => canvas.toDataURL());
  await page.keyboard.press('e');
  const entered = await snap(page);
  expect(entered.vehicleId).not.toBeNull(); expect(entered.vehicle).not.toBeNull();
  await expect(page.locator('#boom')).toHaveAccessibleName(/sortir/i);
  await page.keyboard.press('Space'); expect((await snap(page)).bottles).toEqual([]);
  const key = drivingKey(entered.vehicle);
  await page.keyboard.down(key); await page.waitForTimeout(500); await page.keyboard.up(key);
  const driven = await snap(page);
  expect(Math.hypot(driven.player.x - entered.player.x, driven.player.y - entered.player.y)).toBeGreaterThan(12);
  expect(await page.locator('#minimap').evaluate(canvas => canvas.toDataURL())).not.toBe(mapBefore);
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  const paused = await snap(page); await page.waitForTimeout(250); const frozen = await snap(page);
  expect(frozen.elapsed).toBe(paused.elapsed); expect(frozen.player).toEqual(paused.player);
  expect(frozen.vehicleId).toBe(paused.vehicleId); expect(frozen.vehicle).toEqual(paused.vehicle);
  await page.getByRole('button', { name: 'REPRENDRE', exact: true }).click(); await page.keyboard.press('e');
  const exited = await snap(page);
  expect(exited.vehicleId).toBeNull(); expect(exited.vehicle).toBeNull(); await expect(page.locator('#plant')).toBeEnabled();
  await page.keyboard.down('ArrowDown'); await page.waitForTimeout(200); await page.keyboard.up('ArrowDown');
  const walked = await snap(page);
  expect(Math.hypot(walked.player.x - exited.player.x, walked.player.y - exited.player.y)).toBeGreaterThan(5);
});

test('touch stops on cancellation on the real quay; its district is named and interruption freezes a fuse', async ({ page }) => {
  await begin(page); const initial = await snap(page), start = initial.player;
  await expect(page.locator('#district-name')).toHaveText(initial.district.name);
  const rect = await page.locator('#joystick').boundingBox();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 30, y: y + 30 }] });
  await page.waitForTimeout(250); await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  const stopped = (await snap(page)).player;
  expect(start.x - stopped.x).toBeGreaterThan(8); expect(stopped.y - start.y).toBeGreaterThan(8);
  await page.waitForTimeout(200);
  const settled = (await snap(page)).player;
  expect(Math.hypot(settled.x - stopped.x, settled.y - stopped.y)).toBeLessThanOrEqual(3);
  await page.waitForTimeout(100);
  expect((await snap(page)).player.x).toBeCloseTo(settled.x, 4);
  expect((await snap(page)).player.y).toBeCloseTo(settled.y, 4);
  const footStart = (await snap(page)).player;
  await walkAlongQuay(page, 40);
  const entered = await snap(page);
  expect(Math.hypot(entered.player.x - footStart.x, entered.player.y - footStart.y)).toBeGreaterThan(30);
  await expect(page.locator('#district-name')).toHaveText(entered.district.name);
  await expect(page.locator('#district-line')).toHaveCount(0);
  await page.keyboard.press('Space'); await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const paused = await snap(page);
  expect(paused.mode).toBe('paused'); expect(paused.bottles).toHaveLength(1);
  await page.waitForTimeout(300);
  expect((await snap(page)).elapsed).toBe(paused.elapsed); expect((await snap(page)).bottles[0].fuse).toBe(paused.bottles[0].fuse);
  await page.getByRole('button', { name: 'REPRENDRE', exact: true }).click();
  await expect.poll(async () => (await snap(page)).bottles[0].fuse).toBeLessThan(paused.bottles[0].fuse);
});

test('two touch joysticks permit moving and aiming together and both stop on cancellation', async ({ page }) => {
  await begin(page);
  const move = await page.locator('#joystick').boundingBox(), aim = await page.locator('#aim-stick').boundingBox();
  const first = { id: 1, x: move.x + move.width / 2, y: move.y + move.height / 2 };
  const second = { id: 2, x: aim.x + aim.width / 2, y: aim.y + aim.height / 2 };
  const client = await page.context().newCDPSession(page), start = await snap(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, second] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...first, x: first.x - 30, y: first.y + 30 }, { ...second, x: second.x + 35 }] });
  await expect.poll(async () => (await snap(page)).shotsFired).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  expect(start.player.x - (await snap(page)).player.x).toBeGreaterThan(8);
  expect((await snap(page)).player.y - start.player.y).toBeGreaterThan(8);
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await page.waitForTimeout(200);
  const settled = await snap(page);
  await page.waitForTimeout(300);
  const stopped = await snap(page);
  expect(stopped.player.x).toBeCloseTo(settled.player.x, 4);
  expect(stopped.player.y).toBeCloseTo(settled.player.y, 4);
  expect(stopped.shotsFired).toBe(settled.shotsFired);
});

test('three exposed automatic blasts show a complete mobile result, save the record and replay the city', async ({ page }) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 320, height: 568 });
  // Measure the output graph including the final jingle after music stops.
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      if (destination instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser(); analyser.fftSize = 256;
        connect.call(this, analyser); window.__audioProbe = analyser;
      }
      return connect.call(this, destination, ...args);
    };
  });
  await begin(page);
  // Sampling runs in the page while the final bottle is ticking. The result
  // jingle is brief and can finish before a delayed CDP snapshot returns.
  const resultSound = page.waitForFunction(() => {
    if (!document.querySelector('.result-card')) return false;
    const data = new Float32Array(256); window.__audioProbe.getFloatTimeDomainData(data);
    return Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length) > .002;
  }, null, { timeout: 30000 });
  void resultSound.catch(() => {});
  for (let hearts = 2; hearts >= 0; hearts--) {
    await expect.poll(async () => {
      const state = await snap(page); return state.bottles.length === 0 && state.player.invulnerable === 0;
    }, { intervals: [30], timeout: 6000 }).toBe(true);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await snap(page)).hearts, { intervals: [30], timeout: 6000 }).toBe(hearts);
  }
  const result = await snap(page);
  expect(result.mode).toBe('result'); expect(result.result.cause).toBe('blast');
  await resultSound;
  await expect(page.getByText('FIN DE PARTIE', { exact: true })).toBeVisible();
  const banner = page.getByRole('img', { name: 'Aïe !', exact: true }); await expect(banner).toBeVisible();
  await expect.poll(() => banner.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  for (const element of [banner, page.locator('.menu-card'), page.getByRole('button', { name: 'REJOUER', exact: false })]) {
    const box = await element.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320); expect(box.y + box.height).toBeLessThanOrEqual(568);
  }
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('blue-night-save')).best)).toBe(result.score);
  await page.getByRole('button', { name: 'REJOUER', exact: false }).click(); const replay = await snap(page);
  expect(replay.hearts).toBe(3); expect(replay.demolished).toBe(0); expect(replay.heat).toBe(0);
  expect(replay.vehicleId).toBeNull(); expect(replay.bottles).toEqual([]);
  expect(replay.elapsed).toBeLessThan(.3); expect(replay.tutorial).toBe(false);
});

test('sound unlocks by gesture; mute and reduced effects persist; options pause and resume', async ({ page }) => {
  await begin(page); expect((await snap(page)).audioState).toBe('running');
  await page.locator('#hud-details').click();
  await page.getByRole('button', { name: 'Couper le son', exact: true }).click();
  await page.getByRole('button', { name: 'Options et accessibilité', exact: true }).click();
  const frozen = (await snap(page)).elapsed; await page.waitForTimeout(150); expect((await snap(page)).elapsed).toBe(frozen);
  await page.getByLabel('Effets réduits', { exact: false }).check();
  await page.getByRole('button', { name: 'RETOUR AU JEU', exact: true }).click(); expect((await snap(page)).mode).toBe('playing');
  await page.reload(); expect((await snap(page)).muted).toBe(true); expect((await snap(page)).reduced).toBe(true);
  await expect(page.locator('#sound')).toHaveAttribute('aria-label', 'Activer le son');
  await expect(page.locator('#sound')).toHaveAttribute('aria-pressed', 'true');
  await chooseGameMode(page, 'missions');
  await page.getByRole('button', { name: 'JOUER', exact: false }).click(); expect((await snap(page)).tutorial).toBe(false);
});

test('the title and gameplay help omit character names, presentation text and fictional dialogue', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.subtitle, .edition-pills, .title-crew b')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(/François Mitterrand|Edmond Sim[ée]oni|Ninu|Nino|Ant[òo]/i);
  await page.getByRole('button', { name: 'JOUER', exact: false }).click();
  await page.getByRole('button', { name: "C'EST PARTI !", exact: true }).click();
  await page.getByRole('button', { name: 'Options et accessibilité', exact: true }).click();
  await page.locator('.dossier-open:visible').first().click();
  await expect(page.getByRole('dialog', { name: 'AIDE', exact: true })).toBeVisible();
  await expect(page.locator('#dossier')).toContainText(/parachute/i);
  await expect(page.locator('#crew, #cameos, #chapter-copy, #dossier blockquote')).toHaveCount(0);
  expect(await page.locator('#dossier').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.locator('#dossier').innerText()).not.toMatch(/François Mitterrand|Edmond Sim[ée]oni|Ninu|Nino|Ant[òo]|répliques sont inventées|inaugurations/i);
});

for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932], [844, 390], [1280, 800]]) {
  test(`the map fills the viewport and its HUD and controls fit at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await begin(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width < 1000) {
      await expect(page.locator('#hud-details')).toHaveAttribute('aria-expanded', 'false');
      for (const id of ['minimap', 'missiontext', 'game-clock', 'time-phase']) await expect(page.locator(`#${id}`)).toBeHidden();
      await expect(page.locator('#location')).toBeVisible();
      const details = await page.locator('#hud-details').boundingBox();
      expect(details.width).toBeGreaterThanOrEqual(44); expect(details.height).toBeGreaterThanOrEqual(44);
    }
    for (const selector of ['.hud', '.communication', '.bottomline']) {
      const overflow = await page.locator(selector).evaluate(element => element.scrollWidth - element.clientWidth);
      expect(overflow, `${selector} must not overflow horizontally`).toBeLessThanOrEqual(1);
    }
    for (const id of ['plant', 'boom', 'joystick', 'aim-stick', 'fire', 'weapon']) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
      expect(await page.evaluate(({ id, box }) => Boolean(document.elementFromPoint(
        box.x + box.width / 2, box.y + box.height / 2)?.closest(`#${id}`)), { id, box }),
      `${id} must receive input at its visible centre`).toBe(true);
    }
    if (width < 1000) {
      await page.locator('#hud-details').click();
      await expect(page.locator('#hud-details')).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('#scene')).toHaveClass(/hud-expanded/);
    }
    for (const id of ['minimap', 'missiontext', 'heat', 'game-clock', 'time-phase']) {
      await expect(page.locator(`#${id}`)).toBeVisible(); const box = await page.locator(`#${id}`).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    }
    expect((await page.locator('#heat').textContent()).match(/[★☆]/g)).toHaveLength(6);
    await expect(page.locator('#missiontext')).toHaveText(/\S/);
    const mapColors = await page.locator('#minimap').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; const colors = new Set();
      for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      return colors.size;
    });
    expect(mapColors).toBeGreaterThan(5);
    if (width < 1000) {
      await page.locator('#hud-details').click();
      await expect(page.locator('#hud-details')).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('#minimap')).toBeHidden();
    }
    for (const id of ['scene', 'game']) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box.x).toBeCloseTo(0, 0); expect(box.y).toBeCloseTo(0, 0);
      expect(box.width).toBeCloseTo(width, 0); expect(box.height).toBeCloseTo(height, 0);
    }
    const resolution = await page.locator('#game').evaluate(canvas => ({ width: canvas.width, height: canvas.height }));
    expect(resolution.width).toBe(width);
    expect(resolution.height).toBe(height);
  });
}

test('the offline cache starts the playable city and retains local graphics, universe and map modules', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await context.setOffline(true); await page.reload();
  await chooseGameMode(page, 'missions');
  await chooseStartingTime(page, 720);
  await page.getByRole('button', { name: 'JOUER', exact: false }).click();
  await page.getByRole('button', { name: "C'EST PARTI !", exact: true }).click();
  const offline = await snap(page);
  expect(offline.mode).toBe('playing'); expect(offline.map).toMatchObject({ city: 'Calvi', source: 'OpenStreetMap', status: 'ready' });
  expect(offline.timeOfDay.hour).toBe(12);
  expect(offline.timeOfDay.phase).toBe('jour');
  await expect.poll(async () => (await snap(page)).timeOfDay.label, { timeout: 3000 }).not.toBe(offline.timeOfDay.label);
  await page.keyboard.press('Escape');
  const paused = await snap(page);
  await page.waitForTimeout(250);
  expect((await snap(page)).timeOfDay).toEqual(paused.timeOfDay);
  expect((await snap(page)).elapsed).toBe(paused.elapsed);
  await expect(page.locator('#game-clock')).toHaveText(paused.timeOfDay.label);
  await expect(page.locator('#time-phase')).toHaveText('JOUR');
  await page.getByRole('button', { name: 'REPRENDRE', exact: true }).click();
  await expect.poll(async () => (await snap(page)).timeOfDay.hours, { timeout: 3000 }).toBeGreaterThan(paused.timeOfDay.hours);
  await page.keyboard.press('e'); expect((await snap(page)).vehicleId).not.toBeNull();
  await page.locator('#hud-details').click();
  await expect(page.locator('#minimap')).toBeVisible();
  const portraits = await page.evaluate(async () => Promise.all(['simeoni', 'guelfucci', 'mitterrand', 'pasqua', 'ninu', 'anto'].map(async name => {
    const img = new Image(); img.src = `assets/${name}.svg`; await img.decode(); return img.naturalWidth;
  })));
  expect(portraits.every(width => width > 0)).toBe(true);
  const modules = await page.evaluate(async () => Promise.all(['universe.js', 'game-time.js', 'police.js', 'imagery-stream.js', 'mobility.js', 'mobility-spawns.js', 'piers.js', 'vegetation.js', 'aerial-vehicles.js', 'data/calvi-aerial-objects.js', 'data/calvi-water-surface.js', 'calvi-world.js', 'data/calvi-map.js', 'combat.js', 'neon-art.js', 'effects-art.js', 'street-life.js', 'terrain.js', 'data/calvi-elevation.js', 'data/calvi-lidar-elevation.js', 'data/calvi-lidar-urban-elevation.js', 'building-height.js', 'data/calvi-building-heights.js'].map(async path => {
    const response = await fetch(path);
    return { path, ok: response.ok, type: response.headers.get('content-type') };
  })));
  for (const module of modules) {
    expect(module.ok, `Offline module: ${module.path}`).toBe(true);
    expect(module.type, `Offline module type: ${module.path}`).toMatch(/javascript/);
  }
  const boundary = await page.evaluate(async () => {
    const response = await fetch('data/calvi-boundary.geojson');
    return { ok: response.ok, data: await response.json() };
  });
  expect(boundary.ok).toBe(true); expect(boundary.data.type).toBe('Feature');
  expect(boundary.data.properties).toMatchObject({ insee: '2B050', sourceId: 1151255 });
  expect(boundary.data.geometry.type).toBe('MultiPolygon');
  expect(boundary.data.geometry.coordinates.length).toBeGreaterThan(0);
  await context.setOffline(false);
});

test('free exploration is the default; keyboard fire stops on release and cycles six usable weapons', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Mode de jeu', exact: true })).toHaveValue('free');
  await expect(page.locator('#start-time')).toHaveValue('1110');
  expect(await page.locator('#start-time option').evaluateAll(options => options.map(option => option.value))).toEqual(['1110', '360', '720', '0']);
  await chooseGameMode(page, 'free');
  await page.getByRole('button', { name: 'JOUER', exact: false }).click();
  await page.getByRole('button', { name: "C'EST PARTI !", exact: true }).click();
  expect((await snap(page)).sessionMode).toBe('free');
  const start = await snap(page);
  expect(start.weapon.id).toBe('pistol'); expect(start.shotsFired).toBe(0);
  await page.keyboard.down('f');
  await expect.poll(async () => (await snap(page)).shotsFired, { timeout: 2000 }).toBeGreaterThanOrEqual(2);
  await page.keyboard.up('f');
  const stopped = (await snap(page)).shotsFired;
  const wanted = (await snap(page)).wanted;
  expect(wanted.level).toBeGreaterThanOrEqual(1); expect(wanted.points).toBeGreaterThanOrEqual(2);
  expect(['pursuit', 'search']).toContain(wanted.state);
  await page.waitForTimeout(350); expect((await snap(page)).shotsFired).toBe(stopped);
  for (const id of ['smg', 'launcher', 'shotgun', 'rifle', 'carbine', 'pistol']) {
    await page.keyboard.press('Tab');
    await expect.poll(async () => (await snap(page)).weapon.id).toBe(id);
    const selected = await snap(page), label = ({ shotgun: 'POMPE', rifle: 'PRÉCISION' })[id] || selected.weapon.name.toUpperCase();
    await expect(page.locator('#weapon-name')).toHaveText(label);
    await expect(page.locator('#weapon-icon')).toHaveAttribute('data-weapon', id);
    await expect(page.locator('#weapon')).toHaveAttribute('title', new RegExp(`${selected.weaponIndex + 1}/6`));
    expect(await page.locator('#weapon').evaluate(button => button.scrollWidth - button.clientWidth)).toBeLessThanOrEqual(1);
    const before = (await snap(page)).shotsFired;
    await page.keyboard.down('j');
    await expect.poll(async () => (await snap(page)).shotsFired).toBeGreaterThan(before);
    await page.keyboard.up('j');
  }
  await expect(page.getByRole('button', { name: 'Changer d’arme', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('touch fire cancellation and interruption clear held combat input; pause freezes projectiles', async ({ page }) => {
  await begin(page);
  const box = await page.locator('#fire').boundingBox();
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await expect.poll(async () => (await snap(page)).shotsFired).toBeGreaterThan(0);
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  const released = (await snap(page)).shotsFired;
  await page.waitForTimeout(350); expect((await snap(page)).shotsFired).toBe(released);
  await page.keyboard.down('f');
  await expect.poll(async () => (await snap(page)).shotsFired).toBeGreaterThan(released);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const paused = await snap(page); expect(paused.mode).toBe('paused');
  await page.waitForTimeout(200);
  const frozen = await snap(page);
  expect(frozen.elapsed).toBe(paused.elapsed); expect(frozen.shotsFired).toBe(paused.shotsFired);
  expect(frozen.projectiles).toEqual(paused.projectiles);
  await page.keyboard.up('f');
  await page.getByRole('button', { name: 'REPRENDRE', exact: true }).click();
  await page.waitForTimeout(350); expect((await snap(page)).shotsFired).toBe(paused.shotsFired);
  await page.keyboard.down('f');
  await expect.poll(async () => (await snap(page)).shotsFired).toBeGreaterThan(paused.shotsFired);
  await page.keyboard.up('f');
});

test('held pistol fire ignites a parked car; its delayed explosion and visual effects freeze during pause', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await chooseGameMode(page, 'free');
  await page.getByRole('button', { name: 'JOUER', exact: false }).click();
  await page.getByRole('button', { name: "C'EST PARTI !", exact: true }).click();
  const car = (await snap(page)).cars.find(car => car.id === 'car-start');
  expect(car.destroyed).not.toBe(true); expect(car.hp).toBeGreaterThan(0);
  // Move normally, then aim at the parked car through the actual mouse input.
  // Separate key releases can change the final walking direction by one frame;
  // the explicit aim is how a player keeps firing at the same target.
  await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(50);
  await page.keyboard.up('ArrowDown'); await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(80);
  const aim = await page.evaluate(({ x, y }) => window.blueNight.screenPoint(x, y), car);
  await page.mouse.move(aim.x, aim.y);
  await page.keyboard.down('f');
  try {
    await expect.poll(async () => (await snap(page)).cars.find(car => car.id === 'car-start').destroyed,
      { intervals: [30], timeout: 5000 }).toBe(true);
  } finally { await page.keyboard.up('f'); }
  const result = await snap(page), wreck = result.cars.find(car => car.id === 'car-start');
  expect(wreck.hp).toBe(0); expect(result.shotsFired).toBeGreaterThanOrEqual(9);
  expect(wreck.destructionCause).toBe('shot'); expect(wreck.exploded).toBe(false);
  expect(wreck.fireTimer).toBeGreaterThan(0); expect(wreck.smokeTimer).toBeGreaterThan(0);
  expect(wreck.burnFuse).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  const paused = await snap(page), frozenImage = await canvasDigest(page);
  await page.waitForTimeout(250);
  const frozen = await snap(page);
  expect(frozen.cars.find(car => car.id === 'car-start')).toEqual(paused.cars.find(car => car.id === 'car-start'));
  expect(frozen.wanted).toEqual(paused.wanted);
  expect(frozen.roadblocks).toEqual(paused.roadblocks);
  expect(frozen.helicopter).toEqual(paused.helicopter);
  expect(await canvasDigest(page)).toBe(frozenImage);
  const secondaryExplosion = page.waitForFunction(wreck => {
    const state = window.blueNight.snapshot(), car = state.cars.find(car => car.id === wreck.id);
    window.__qaSecondaryState = { mode: state.mode, elapsed: state.elapsed, hearts: state.hearts,
      car: { x: car.x, y: car.y, exploded: car.exploded, burnFuse: car.burnFuse, explosionCause: car.explosionCause },
      effects: state.explosionEffects.map(effect => ({ x: effect.x, y: effect.y, cause: effect.cause, life: effect.life })) };
    return state.explosionEffects.some(effect => Math.hypot(effect.x - wreck.x, effect.y - wreck.y) < 5);
  }, wreck, { timeout: 8000 });
  void secondaryExplosion.catch(() => {});
  await page.getByRole('button', { name: 'REPRENDRE', exact: true }).click();
  try { await secondaryExplosion; }
  catch (error) { throw new Error('Secondary explosion observation: ' + JSON.stringify(await page.evaluate(() => window.__qaSecondaryState)), { cause: error }); }
  const afterBlast = await snap(page), exploded = afterBlast.cars.find(car => car.id === 'car-start');
  expect(exploded.burnFuse).toBe(0); expect(exploded.exploded).toBe(true); expect(exploded.explosionCause).toBe('secondary');
  expect(afterBlast.elapsed - paused.elapsed).toBeGreaterThanOrEqual(paused.cars.find(car => car.id === 'car-start').burnFuse - .04);
  expect(afterBlast.hearts).toBeGreaterThan(0); expect(afterBlast.mode).toBe('playing');
  await expect(page.locator('#heat')).toBeVisible();
  expect(errors).toEqual([]);
});

test('mouse aiming kills a moving pedestrian and leaves blood that freezes during pause', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await chooseGameMode(page, 'free');
  await page.getByRole('button', { name: 'JOUER', exact: false }).click();
  await page.getByRole('button', { name: "C'EST PARTI !", exact: true }).click();
  // The source fleet has narrow gaps. First look from the real starting quay;
  // if necessary, walk the verified parking aisle before selecting a target.
  // Select a live person through the real OSM street geometry and actual
  // parked cars. The nearest person may be behind a wall or vehicle.
  let target = await visiblePedestrian(page);
  if (!target) {
    await walkTo(page, { x: 16480, y: 8736 }, { radius: 1 });
    target = await visiblePedestrian(page);
  }
  expect(target).toBeDefined();
  const point = await page.evaluate(({ x, y }) => window.blueNight.screenPoint(x, y), target);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  let previous = { x: target.x, y: target.y, elapsed: target.observedAt };
  try {
    await expect.poll(async () => {
      const observation = await page.evaluate(({ index, previous }) => {
        const state = window.blueNight.snapshot(), person = state.pedestrians[index];
        const dt = state.elapsed - previous.elapsed;
        const vx = dt > .01 ? (person.x - previous.x) / dt : 0, vy = dt > .01 ? (person.y - previous.y) / dt : 0;
        // Lead a walking person using observed motion and projectile travel,
        // allowing for mouse dispatch. Only the cursor is moved; no game data
        // or simulation time is changed, even under a slow browser render.
        const lead = Math.hypot(person.x - state.player.x, person.y - state.player.y) / state.weapon.speed + .15;
        return { dead: person.dead, x: person.x, y: person.y, elapsed: state.elapsed,
          aim: window.blueNight.screenPoint(person.x + vx * lead, person.y + vy * lead) };
      }, { index: target.index, previous });
      previous = observation;
      if (!observation.dead) await page.mouse.move(observation.aim.x, observation.aim.y);
      return observation.dead;
    }, { intervals: [30], timeout: 3000 }).toBe(true);
  } finally { await page.mouse.up(); }
  const result = await snap(page);
  expect(result.pedestrians[target.index].hp).toBe(0);
  expect(result.eliminated.pedestrians).toBeGreaterThanOrEqual(1); expect(result.shotsFired).toBeGreaterThan(0);
  const person = result.pedestrians[target.index];
  const trace = result.blood.find(mark => mark.cause === 'shot' && Math.hypot(mark.x - person.x, mark.y - person.y) < 8);
  expect(trace).toBeDefined(); expect(trace.life).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  const paused = await snap(page), frozenImage = await canvasDigest(page);
  await page.waitForTimeout(250);
  expect((await snap(page)).blood).toEqual(paused.blood);
  expect(await canvasDigest(page)).toBe(frozenImage);
  await page.getByRole('button', { name: 'REPRENDRE', exact: true }).click();
  await expect.poll(async () => (await snap(page)).blood.find(mark => mark.seed === trace.seed)?.life).toBeLessThan(trace.life);
  // The target was hit through a clear street, with the parked car intact.
  expect(result.cars.find(car => car.id === 'car-start').hp).toBe(260);
  expect(errors).toEqual([]);
});

test('unavailable Web Audio or local storage still permits city actions', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { value: undefined }); Object.defineProperty(window, 'webkitAudioContext', { value: undefined });
    Storage.prototype.setItem = () => { throw new Error('Storage unavailable'); };
  });
  await begin(page); await page.keyboard.press('Space');
  expect((await snap(page)).bottles).toHaveLength(1); expect((await snap(page)).audioState).toBe('locked');
  await page.keyboard.press('e'); expect((await snap(page)).vehicleId).not.toBeNull();
});

test('the complete city tutorial and pause menu fit the smallest supported portrait', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/'); await chooseGameMode(page, 'missions'); await page.getByRole('button', { name: 'JOUER', exact: false }).click();
  const card = await page.locator('.menu-card').boundingBox();
  expect(card.y).toBeGreaterThanOrEqual(0); expect(card.y + card.height).toBeLessThanOrEqual(568);
  const start = await page.getByRole('button', { name: "C'EST PARTI !", exact: true }).boundingBox(); expect(start.y + start.height).toBeLessThanOrEqual(568);
  await page.getByRole('button', { name: "C'EST PARTI !", exact: true }).click(); await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  const pause = await page.locator('.menu-card').boundingBox(); expect(pause.y).toBeGreaterThanOrEqual(0); expect(pause.y + pause.height).toBeLessThanOrEqual(568);
});
