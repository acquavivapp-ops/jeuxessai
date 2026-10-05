import { expect } from '@playwright/test';

export async function expectIllustrated(page) {
  await expect.poll(() => page.evaluate(() => window.blueNight.snapshot().renderer)).toMatchObject({
    artMode: 'illustrated', photoMode: false, materialsReady: true,
    sourceMapSha256: '0ba6530cd231d4eb22749450014d9e6ab103359899c22cfeccc276f65bfa6baf',
    geometryFingerprint: '11f0e5b971f8f605',
  });
  const state = await page.evaluate(() => window.blueNight.snapshot());
  expect(state.imagery.status).toBe('disabled');
  for (const key of ['requests', 'resident', 'pending', 'decodedBytes']) expect(state.imagery[key], `Disabled photographic stream: ${key}`).toBe(0);
  expect(state.renderer.groundBytes).toBeLessThanOrEqual(state.renderer.maximumGroundBytes);
  expect(state.renderer.roofBytes).toBeLessThanOrEqual(state.renderer.maximumRoofBytes);
  expect(state.renderer.foliageBytes).toBeLessThanOrEqual(state.renderer.maximumFoliageBytes);
  return state;
}

// The timed mission route and free exploration are separate player choices.
// Tests select the former explicitly instead of depending on the title default.
export async function chooseGameMode(page, mode) {
  const choice = page.getByRole('combobox', { name: 'Mode de jeu', exact: true });
  await choice.selectOption(mode);
}

export async function chooseStartingTime(page, minutes) {
  await page.locator('#start-time').selectOption(String(minutes));
}

export const drivingKey = car => Math.abs(Math.cos(car.angle)) >= Math.abs(Math.sin(car.angle))
  ? (Math.cos(car.angle) > 0 ? 'ArrowRight' : 'ArrowLeft')
  : (Math.sin(car.angle) > 0 ? 'ArrowDown' : 'ArrowUp');

// Approach a real waypoint using the visible movement stick. Slow down near
// it so delayed CDP responses do not carry the player past a parked car.
export async function walkTo(page, goal, { radius = 2.5, timeout = 8000 } = {}) {
  const box = await page.locator('#joystick').boundingBox();
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(center.x, center.y); await page.mouse.down();
  const deadline = Date.now() + timeout;
  let position;
  try {
    while (Date.now() < deadline) {
      position = await page.evaluate(() => {
        const state = window.blueNight.snapshot();
        return { x: state.player.x, y: state.player.y, mode: state.mode, vehicleId: state.vehicleId };
      });
      if (position.mode !== 'playing' || position.vehicleId) throw new Error('The foot route requires an active player on foot');
      const dx = goal.x - position.x, dy = goal.y - position.y, distance = Math.hypot(dx, dy);
      if (distance < radius) return;
      // Stop before the next expensive public snapshot when approaching a
      // small target. Continuous input otherwise overshoots it while a second
      // browser worker draws the city. Keep each required axis above the real
      // stick dead zone so a diagonal gap is approached diagonally.
      const precise = distance < 12;
      const strength = Math.min(.7, Math.max(.16, distance / 90));
      const component = value => Math.abs(value) < radius * .4 ? 0 : Math.sign(value) * Math.max(.115, Math.abs(value) / distance * .16);
      const required = [dx, dy].filter(value => Math.abs(value) >= radius * .4);
      const diagonalMinimum = .115 / Math.min(...required.map(value => Math.abs(value) / distance));
      const continuousStrength = Math.min(.7, Math.max(strength, diagonalMinimum));
      const x = precise ? component(dx) : dx / distance * continuousStrength;
      const y = precise ? component(dy) : dy / distance * continuousStrength;
      await page.mouse.move(center.x + x * 30, center.y + y * 30);
      if (precise) {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        await page.mouse.move(center.x, center.y);
      } else await page.waitForTimeout(20);
    }
    throw new Error('The public foot route did not reach ' + JSON.stringify({ goal, position }));
  } finally { await page.mouse.up(); }
}

// Inspect only the shipped OSM footprints and cloned public actors. This does
// not instantiate a world or alter the game; it avoids aiming through walls.
export const visiblePedestrian = page => page.evaluate(async () => {
  const [{ CALVI_MAP }, { segmentBuildingHit }, { segmentDistanceSquared }] = await Promise.all([
    import('/data/calvi-map.js'), import('/combat.js'), import('/engine.js'),
  ]);
  const state = window.blueNight.snapshot(), from = [state.player.x, state.player.y];
  const intersectsCar = (to, car) => {
    const dx = Math.cos(car.angle), dy = Math.sin(car.angle), shaft = car.collisionHalfLength ?? 7, radius = car.collisionRadius || 8;
    const a = [car.x - dx * shaft, car.y - dy * shaft], b = [car.x + dx * shaft, car.y + dy * shaft];
    return segmentDistanceSquared(from, to, a, b) < radius * radius;
  };
  return state.pedestrians.map((person, index) => ({ ...person, index, observedAt: state.elapsed, distance: Math.hypot(person.x - from[0], person.y - from[1]) }))
    .filter(person => {
      if (person.dead || person.distance > state.weapon.range - 20) return false;
      const to = [person.x, person.y], point = window.blueNight.screenPoint(person.x, person.y);
      if (point.x < 20 || point.x > innerWidth - 20 || point.y < 20 || point.y > innerHeight - 20) return false;
      if (document.elementFromPoint(point.x, point.y)?.id !== 'game') return false;
      if (CALVI_MAP.buildings.some(building => segmentBuildingHit(from, to, building) !== null)) return false;
      return !state.cars.some(car => !car.destroyed && intersectsCar(to, car));
    }).sort((a, b) => a.distance - b.distance)[0];
});

export const canvasDigest = page => page.locator('#game').evaluate(async canvas => {
  // Let the requested pause/menu transition finish its one allowed paint.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const digest = await crypto.subtle.digest('SHA-256', pixels);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
});
