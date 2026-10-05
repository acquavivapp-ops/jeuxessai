import { test, expect } from '@playwright/test';
import { walkTo, canvasDigest, expectIllustrated } from './helpers.js';

const snapshot = page => page.evaluate(() => window.blueNight.snapshot());
async function begin(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'JOUER', exact: false }).click();
  await page.getByRole('button', { name: "C'EST PARTI !", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).mode).toBe('playing');
  await expectIllustrated(page);
}
async function brake(page) {
  await page.keyboard.down('Space');
  try { await expect.poll(async () => Math.abs((await snapshot(page)).vehicle.speed), { intervals: [30] }).toBeLessThan(5); }
  finally { await page.keyboard.up('Space'); }
}
// Use the visible movement stick and the cloned public coordinates. This
// controller sends normal pointer input; it never writes a vehicle position.
async function sailTo(page, goal) {
  const box = await page.locator('#joystick').boundingBox(), center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(center.x, center.y); await page.mouse.down();
  const deadline = Date.now() + 20000;
  try {
    while (Date.now() < deadline) {
      const state = await snapshot(page), dx = goal.x - state.player.x, dy = goal.y - state.player.y, distance = Math.hypot(dx, dy);
      expect(state.mode).toBe('playing'); expect(state.vehicle.mobilityType).toBe('boat');
      if (distance < 10) {
        // Brake before the mouse-up round trip. Neutralising the stick first
        // lets a coasting hull pass its waypoint while CDP waits for a paint.
        await page.keyboard.down('Space');
        return;
      }
      const strength = distance > 60 ? .4 : .25;
      await page.mouse.move(center.x + dx / distance * strength * 30, center.y + dy / distance * strength * 30);
      await page.waitForTimeout(50);
    }
    throw new Error(`The real boat did not reach its mooring: ${JSON.stringify((await snapshot(page)).player)}`);
  } finally { await page.mouse.up(); }
}

test('four local vehicle types are available; the motorcycle can be stolen, driven, braked and left', async ({ page }) => {
  await begin(page);
  const initial = await snapshot(page), bike = initial.cars.find(car => car.id === 'calvi-motorcycle-port');
  expect([...new Set(initial.cars.filter(car => car.mobilityType).map(car => car.mobilityType))].sort()).toEqual(['boat', 'helicopter', 'motorcycle', 'plane']);
  expect(bike.mobilityMode).toBe('ground'); expect(bike.altitude).toBe(0);
  // Approach from the genuine parking aisle west of the newly solid photo
  // cars, stopping precisely so E selects the motorcycle rather than a car.
  await walkTo(page, { x: 16480, y: 8736 }, { radius: 1 });
  await walkTo(page, { x: bike.x - 12, y: bike.y }, { radius: 1 });
  expect((await snapshot(page)).interactionTarget?.id).toBe(bike.id);
  await expect(page.locator('#boom')).toHaveAccessibleName(/voler cette moto/i);
  await page.keyboard.press('e');
  const boarded = await snapshot(page);
  expect(boarded.vehicleId).toBe(bike.id); expect(boarded.vehicle.stolen).toBe(true);
  await expect(page.locator('#location')).toContainText('MOTO');
  await expect(page.locator('#plant')).toHaveAccessibleName('Freiner');
  // The native northern parking gap is free. The southward shortcut crosses
  // another photographed car, whose physical body now correctly blocks it.
  await page.keyboard.down('ArrowUp');
  try {
    await expect.poll(async () => {
      const player = (await snapshot(page)).player;
      return Math.hypot(player.x - boarded.player.x, player.y - boarded.player.y);
    }, { intervals: [20] }).toBeGreaterThan(20);
  } finally { await page.keyboard.up('ArrowUp'); }
  const ridden = await snapshot(page);
  expect(Math.hypot(ridden.player.x - boarded.player.x, ridden.player.y - boarded.player.y)).toBeGreaterThan(10);
  expect(ridden.vehicle.altitude).toBe(0); expect(ridden.vehicle.mobilityMode).toBe('ground');
  await brake(page); await page.keyboard.press('e');
  expect((await snapshot(page)).vehicleId).toBeNull();
  expect((await snapshot(page)).hearts).toBeGreaterThan(0);
});

test('a photographed boat is stolen from the real quay, sails on water and permits leaving after returning to land', async ({ page }) => {
  test.setTimeout(60_000);
  await begin(page);
  const initial = await snapshot(page), boat = initial.cars.find(car => car.sourceImage?.annotationId === 'photo-boat-port-016-01');
  expect(boat).toBeDefined(); expect(boat.owned).toBe(false); expect(boat.stolen).toBe(false);
  expect(boat.boarding).toBeDefined();
  const observed = await page.evaluate(async id => {
    const { CALVI_AERIAL_OBJECTS: objects } = await import('/data/calvi-aerial-objects.js');
    const manifest = await (await fetch('/data/calvi-imagery-tiles.json')).json();
    const boat = objects.vehicles.find(boat => boat.id === id);
    const source = [...manifest.sourceTiles, ...manifest.detailSourceTiles].find(source => source.id === boat.sourcePlacement.tileId);
    return { x: boat.x, y: boat.y, sha256: boat.sourcePlacement.sha256, sourceSha256: source.sha256 };
  }, boat.sourceImage.annotationId);
  expect(boat.x).toBe(observed.x); expect(boat.y).toBe(observed.y);
  expect(boat.sourceImage.sha256).toBe(observed.sha256); expect(observed.sha256).toBe(observed.sourceSha256);
  // Approach the advertised land-side boarding point, rather than stepping
  // into the water or injecting the player into the boat.
  await walkTo(page, { x: initial.player.x + 8, y: initial.player.y - 6 }, { radius: .8 });
  await walkTo(page, { x: initial.player.x + 20, y: initial.player.y - 6 }, { radius: .8 });
  await walkTo(page, boat.boarding, { radius: .8 });
  expect((await snapshot(page)).interactionTarget?.id).toBe(boat.id);
  await expect(page.locator('#boom')).toHaveAccessibleName('Voler ce bateau');
  await page.keyboard.press('e');
  const boarded = await snapshot(page);
  expect(boarded.vehicleId).toBe(boat.id); expect(boarded.vehicle.mobilityMode).toBe('water');
  expect(boarded.vehicle.stolen).toBe(true); expect(boarded.wanted.points).toBeGreaterThanOrEqual(12);
  expect(boarded.vehicle.sourceImage.sha256).toMatch(/^[a-f0-9]{64}$/);
  await expect(page.locator('#movement-label')).toHaveText('NAVIGUER');
  const mooring = { x: boarded.player.x, y: boarded.player.y };
  // Follow the real gap between the photographed hulls before turning into
  // clear water. The offshore point has no shore exit or neighbouring hull
  // close enough to transfer into, so E must keep this boat occupied.
  const corner = { x: 16652.68, y: 8607.8 };
  await sailTo(page, corner); await brake(page);
  await sailTo(page, { x: 16710, y: 8605 }); await brake(page);
  const atSea = await snapshot(page);
  expect(Math.hypot(atSea.player.x - mooring.x, atSea.player.y - mooring.y)).toBeGreaterThan(100);
  expect(atSea.vehicle.altitude).toBe(0); expect(atSea.vehicle.mobilityMode).toBe('water');
  expect(atSea.interactionTarget).toBeNull();
  await page.keyboard.press('e'); expect((await snapshot(page)).vehicleId).toBe(boat.id);
  await sailTo(page, corner); await brake(page);
  await sailTo(page, mooring); await brake(page); await page.keyboard.press('e');
  const disembarked = await snapshot(page);
  expect(disembarked.vehicleId).toBeNull();
  expect(Math.hypot(disembarked.player.x - boat.boarding.x, disembarked.player.y - boat.boarding.y)).toBeLessThan(12);
  expect(disembarked.hearts).toBeGreaterThan(0);
});

test('the real port helicopter permits jumping, opening a parachute, steering and landing through public controls', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await begin(page);
  const initial = await snapshot(page), helicopter = initial.cars.find(car => car.id === 'calvi-helicopter-port');
  expect(helicopter).toBeDefined();
  // The quay aisle and OSM streets lead around the actual buildings and photo
  // vehicles to the source parking. Every waypoint uses the visible stick.
  const route = [{ x: 16480, y: 8736 }, { x: 16480, y: 8716 }, { x: 16472, y: 8708 },
    { x: 16456, y: 8708 }, { x: 16448, y: 8716 }, { x: 16304, y: 8708 },
    { x: 16256, y: 8676 }, { x: 16168, y: 8572 }, { x: 16144, y: 8548 },
    { x: 16120, y: 8540 }, { x: 16112, y: 8540 }, { x: 16040, y: 8580 },
    { x: 16000, y: 8612 }, { x: 15976, y: 8660 }, { x: 15960, y: 8690 },
    { x: 15960, y: 8730 }, { x: 15948, y: 8768 }, { x: helicopter.x, y: helicopter.y + 24 }];
  for (const waypoint of route) await walkTo(page, waypoint, { radius: 1.5, timeout: 12000 });
  expect((await snapshot(page)).interactionTarget?.id).toBe(helicopter.id);
  await page.keyboard.press('e');
  expect((await snapshot(page)).vehicleId).toBe(helicopter.id);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snapshot(page)).vehicle.altitude, { timeout: 8000 }).toBeGreaterThan(75);
  await expect(page.locator('#boom')).toHaveAccessibleName(/sauter/i);
  await page.keyboard.press('e');
  const falling = await snapshot(page);
  expect(falling.vehicleId).toBeNull(); expect(falling.player.airborneMode).toBe('freefall');
  expect(falling.player.altitude).toBeGreaterThan(0);
  await expect(page.locator('#location')).toContainText('CHUTE LIBRE');
  await expect(page.locator('#plant')).toHaveAccessibleName(/parachute/i);
  await page.locator('#plant').click();
  await expect.poll(async () => (await snapshot(page)).player.airborneMode).toBe('parachute');
  await expect(page.locator('#location')).toContainText('PARACHUTE');
  await expect(page.locator('#plant')).toBeDisabled();
  await expect.poll(async () => (await snapshot(page)).player.parachuteInflation).toBe(1);
  const canopyScreenshot = testInfo.outputPath('parachute-mobile.png');
  await page.screenshot({ path: canopyScreenshot });
  await testInfo.attach('parachute-mobile', { path: canopyScreenshot, contentType: 'image/png' });
  await page.keyboard.press('Escape');
  const paused = await snapshot(page), pausedCanvas = await canvasDigest(page);
  await page.waitForTimeout(250);
  expect((await snapshot(page)).player).toEqual(paused.player);
  expect((await snapshot(page)).elapsed).toBe(paused.elapsed);
  expect(await canvasDigest(page)).toBe(pausedCanvas);
  await page.getByRole('button', { name: 'REPRENDRE', exact: true }).click();
  await walkTo(page, { x: helicopter.x, y: helicopter.y + 24 }, { radius: 2 });
  const guided = await snapshot(page);
  expect(guided.player.y).toBeGreaterThan(falling.player.y + 15);
  expect(guided.player.altitude).toBeGreaterThan(0);
  expect(guided.hearts).toBe(initial.hearts);
  const beforeContact = await page.waitForFunction(() => {
    const state = window.blueNight.snapshot();
    return state.player.airborneMode === 'parachute' && state.player.altitude > 0 && state.player.altitude < 2
      && { verticalSpeed: state.player.verticalSpeed, hearts: state.hearts };
  }, null, { timeout: 20000 });
  const descending = await beforeContact.jsonValue();
  expect(descending.verticalSpeed).toBeCloseTo(-5.5, 1); expect(descending.hearts).toBe(initial.hearts);
  await expect.poll(async () => (await snapshot(page)).player.airborneMode, { timeout: 20000 }).toBeNull();
  const landed = await snapshot(page);
  expect(landed.player.altitude).toBe(0); expect(landed.mode).toBe('playing');
  // Theft still permits a patrol to intercept the player on the ground; the
  // intact airborne hearts and safe contact speed distinguish that from a fall.
  expect(landed.hearts).toBeGreaterThan(0); expect(landed.vehicleId).toBeNull();
  expect(landed.cars.find(car => car.id === helicopter.id).altitude).toBeGreaterThan(0);
  await expect(page.locator('#location')).toContainText('À PIED');
  await expect(page.locator('#plant')).toBeEnabled();
  expect(errors).toEqual([]);
});
