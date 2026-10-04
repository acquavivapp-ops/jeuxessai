import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEAPONS, initCombat, shoot, cycleWeapon, updateCombat, segmentBuildingHit,
  damageBuilding, damagePerson, damageCar, applyExplosion, collidePedestrians,
} from '../combat.js';

// Small, explicitly synthetic scenes isolate combat; they do not approximate
// Calvi's map or claim historical or geographic fidelity.
function scene({ buildings = [], cars = [], people = [], police = [], mapped = false } = {}) {
  const events = [];
  const game = {
    mode: 'playing', tutorial: false, id: 0,
    world: { width: 900, height: 400, buildings, scenery: people }, cars, police,
    player: { x: 40, y: 150, dir: 0, invulnerable: 0 }, playerRadius: 7,
    mappedPhysics: mapped, vehicleId: null, bottles: [], blasts: [], particles: [], popups: [],
    heat: 0, spawnClock: Infinity, score: 0, demolished: 0,
    active() { return this.mode === 'playing' && !this.tutorial; },
    get vehicle() { return this.cars.find((car) => car.id === this.vehicleId) || null; },
    emit(name, data = {}) { events.push({ ...data, event: name }); },
    spark() {}, popup() {}, hurt() { if (this.player.invulnerable <= 0) { this.player.invulnerable = 2; this.hits = (this.hits || 0) + 1; } },
  };
  initCombat(game);
  return { game, events };
}

const wall = (extra = {}) => ({ id: 'wall', x: 120, y: 110, w: 30, h: 80, kind: 'house', hp: Infinity, target: false, destroyed: false, ...extra });
const pedestrian = (x, y = 150) => ({ id: `p-${x}`, kind: 'pedestrian', x, y });
const car = (id, x, y = 150) => ({ id, x, y, angle: 0, speed: 0, kind: 'parked' });
const selectWeapon = (game, id) => {
  for (let count = 0; game.weapon.id !== id && count < WEAPONS.length; count++) cycleWeapon(game);
  assert.equal(game.weapon.id, id);
};

test('a swept bullet hits the nearest solid wall and protects an actor behind it', () => {
  const building = wall(), behind = pedestrian(200);
  const { game } = scene({ buildings: [building], people: [behind] });
  assert.equal(shoot(game), true);
  updateCombat(game, .5); // 320 px in one step: well beyond both objects.
  assert.equal(game.projectiles.length, 0);
  assert.equal(building.hp, building.maxHp - WEAPONS[0].damage);
  assert.equal(behind.dead, false);
  assert.equal(behind.hp, 28);
});

test('nearest actor absorbs a shot before a more distant wall', () => {
  const building = wall({ x: 200 }), person = pedestrian(100);
  const { game, events } = scene({ buildings: [building], people: [person] });
  shoot(game); updateCombat(game, .5);
  assert.equal(person.dead, true);
  assert.equal(building.hp, building.maxHp);
  assert.equal(events.filter((event) => event.event === 'kill').length, 1);
  assert.equal(game.eliminated.pedestrians, 1);
  assert.equal(game.blood.length, 1); assert.equal(game.blood[0].cause, 'shot');
  assert.ok(game.particles.some((particle) => particle.kind === 'blood'));
});

test('polygon collision respects a courtyard hole and concave exterior', () => {
  const courtyard = { polygon: [[0, 0], [100, 0], [100, 100], [0, 100]], holes: [[[20, 20], [80, 20], [80, 80], [20, 80]]] };
  assert.equal(segmentBuildingHit([30, 50], [70, 50], courtyard), null);
  assert.ok(Math.abs(segmentBuildingHit([30, 50], [120, 50], courtyard) - 50 / 90) < 1e-9);
  const lShape = { polygon: [[0, 0], [100, 0], [100, 30], [30, 30], [30, 100], [0, 100]] };
  assert.equal(segmentBuildingHit([40, 40], [90, 90], lShape), null);
  assert.equal(segmentBuildingHit([40, 40], [10, 40], lShape), 1 / 3);
});

test('mapped vehicles use their narrow capsule, rather than the old 18 px circle', () => {
  const vehicle = car('narrow', 120, 140), person = pedestrian(180);
  const { game } = scene({ cars: [vehicle], people: [person], mapped: true });
  shoot(game); updateCombat(game, .5);
  assert.equal(vehicle.hp, vehicle.maxHp); // y=150 misses a radius-8 capsule.
  assert.equal(person.dead, true);
});

test('a projectile uses a photo-derived car width instead of the original larger vehicle capsule', () => {
  const vehicle = { ...car('aerial-car-fixture', 120, 144), collisionRadius: 4, collisionHalfLength: 5 }, person = pedestrian(180);
  const { game } = scene({ cars: [vehicle], people: [person], mapped: true });
  assert.equal(shoot(game), true); updateCombat(game, .5);
  assert.equal(vehicle.hp, vehicle.maxHp); assert.equal(person.dead, true);
});

test('ground shots and explosions cannot hit an aircraft above them, while a high explosion leaves ground actors safe', () => {
  const aircraft = { ...car('sky', 120), mobilityType: 'helicopter', altitude: 80 }, ground = car('ground', 170);
  const person = pedestrian(200);
  const { game } = scene({ cars: [aircraft, ground], people: [person], mapped: true });
  shoot(game); updateCombat(game, .5);
  assert.equal(aircraft.hp, aircraft.maxHp); assert.equal(ground.hp, ground.maxHp - 32);
  applyExplosion(game, 120, 150, 80, 32);
  assert.equal(aircraft.hp, aircraft.maxHp);
  const groundHealth = ground.hp, personHealth = person.hp;
  applyExplosion(game, 120, 150, 80, 500, 'launcher', { altitude: 80 });
  assert.equal(aircraft.destroyed, true);
  assert.equal(ground.hp, groundHealth); assert.equal(person.hp, personHealth);
});

test('an aerial launcher descends visibly, freezes in pause and impacts the ground only after falling', () => {
  const aircraft = { ...car('pilot', 40), mobilityType: 'helicopter', altitude: 80 };
  const building = wall(), person = pedestrian(330);
  const { game, events } = scene({ cars: [aircraft], buildings: [building], people: [person], mapped: true });
  game.vehicleId = aircraft.id; game.player.altitude = 80;
  for (let i = 0; i < 100; i++) assert.equal(shoot(game), false);
  assert.equal(events.filter((event) => event.event === 'notice').length, 1, 'Held firing cannot flood notices');
  assert.equal(game.shotsFired, 0);
  selectWeapon(game, 'launcher'); assert.equal(shoot(game), true);
  assert.equal(game.projectiles[0].altitude, 80);
  updateCombat(game, .3); assert.equal(game.projectiles[0].altitude, 50);
  assert.equal(building.hp, building.maxHp); assert.equal(person.dead, false);
  const falling = structuredClone(game.projectiles);
  game.mode = 'paused'; updateCombat(game, 1); assert.deepEqual(game.projectiles, falling);
  game.mode = 'playing'; updateCombat(game, .8);
  assert.equal(game.projectiles.length, 0); assert.equal(person.dead, true);
  assert.equal(building.hp, building.maxHp, 'The projectile passed over this roof before touching ground farther away');
  assert.equal(aircraft.hp, aircraft.maxHp);
  assert.ok(game.blasts.some((blast) => Math.abs(blast.x - 296) < 1e-8 && !(blast.altitude > 0)));
});

test('a motorcycle swept collision keeps the narrower rider envelope and protects a distant passer-by', () => {
  const close = pedestrian(70, 158), beside = pedestrian(70, 164);
  const { game } = scene({ people: [close, beside], mapped: true });
  collidePedestrians(game, { x: 40, y: 150 }, { x: 100, y: 150, angle: 0, mobilityType: 'motorcycle', altitude: 0 }, .5);
  assert.equal(close.dead, true); assert.equal(beside.dead, false);
});

test('pause and tutorial freeze shots, cooldowns, projectile travel and weapon switching', () => {
  const { game } = scene();
  shoot(game);
  game.mode = 'paused';
  const state = JSON.stringify({ bullets: game.projectiles, cooldown: game.fireCooldown, weapon: game.weapon.id, muzzle: game.player.muzzleFlash });
  assert.equal(shoot(game), false);
  assert.equal(cycleWeapon(game), false);
  updateCombat(game, 3);
  assert.equal(JSON.stringify({ bullets: game.projectiles, cooldown: game.fireCooldown, weapon: game.weapon.id, muzzle: game.player.muzzleFlash }), state);
  game.mode = 'playing'; game.tutorial = true;
  assert.equal(shoot(game), false);
  updateCombat(game, 3);
  assert.equal(game.projectiles[0].x, 40);
  game.tutorial = false; updateCombat(game, .1);
  assert.equal(game.projectiles[0].x, 104);
});

test('weapon switching preserves cooldown, keeps the original order, and wraps through all six weapons', () => {
  const { game } = scene();
  shoot(game);
  assert.equal(cycleWeapon(game).id, 'smg');
  assert.equal(shoot(game), false);
  updateCombat(game, .3);
  assert.equal(shoot(game), true);
  assert.equal(game.projectiles.at(-1).damage, 16);
  assert.equal(cycleWeapon(game).id, 'launcher');
  updateCombat(game, .1);
  assert.equal(shoot(game), true);
  assert.equal(game.projectiles.at(-1).explosive, true);
  assert.equal(cycleWeapon(game).id, 'shotgun');
  assert.equal(cycleWeapon(game).id, 'rifle');
  assert.equal(cycleWeapon(game).id, 'carbine');
  assert.equal(cycleWeapon(game).id, 'pistol');
  assert.equal(game.shotsFired, 3);
});

test('one pump action fires seven swept pellets in a bounded symmetric fan with one sound and cooldown', () => {
  const { game, events } = scene(), aim = 1.9;
  selectWeapon(game, 'shotgun');
  assert.equal(shoot(game, { angle: aim }), true);
  assert.equal(game.projectiles.length, 7); assert.equal(game.shotsFired, 1);
  const angles = game.projectiles.map((projectile) => projectile.angle - aim);
  assert.ok(Math.abs(angles[0] + .18) < 1e-12 && Math.abs(angles.at(-1) - .18) < 1e-12);
  for (let i = 0; i < angles.length; i++) assert.ok(Math.abs(angles[i] + angles.at(-1 - i)) < 1e-12);
  assert.equal(angles[3], 0);
  assert.equal(new Set(game.projectiles.map((p) => p.id)).size, 7);
  assert.deepEqual(game.projectiles.map((p) => p.pelletIndex), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(game.projectiles.every((p) => p.shotId === 1 && p.damage === 19 && p.weapon === 'shotgun'));
  assert.equal(events.filter((event) => event.event === 'shoot').length, 1);
  assert.equal(events.find((event) => event.event === 'shoot').audioVariant, 3);
  assert.equal(game.wanted.points, 2, 'Seven pellets report one trigger crime');
  selectWeapon(game, 'rifle'); assert.equal(shoot(game), false, 'Cycling cannot skip the pump recovery');
  updateCombat(game, .71); assert.equal(shoot(game), false);
  updateCombat(game, .011); assert.equal(shoot(game), true);
});

test('pump pellets hit separate off-axis actors while the central wall shields the actor behind it', () => {
  const shield = wall({ x: 100, y: 143, w: 20, h: 14 });
  const upper = pedestrian(220, 150 - Math.tan(.18) * 180);
  const lower = pedestrian(220, 150 + Math.tan(.18) * 180), behind = pedestrian(220);
  const { game } = scene({ buildings: [shield], people: [upper, lower, behind] });
  selectWeapon(game, 'shotgun'); shoot(game); updateCombat(game, 1);
  assert.equal(upper.hp, 9); assert.equal(lower.hp, 9);
  assert.equal(behind.hp, 28); assert.equal(behind.dead, false);
  assert.equal(shield.hp, shield.maxHp - 57, 'Three central pellets stop at the first wall');
  assert.equal(game.projectiles.length, 0);
});

test('the precise rifle reaches beyond pistol range but still stops at the first solid wall', () => {
  const pistolTarget = pedestrian(700), rifleTarget = pedestrian(700), protectedTarget = pedestrian(700);
  const ordinary = scene({ people: [pistolTarget] }), precise = scene({ people: [rifleTarget] });
  shoot(ordinary.game); updateCombat(ordinary.game, 2); assert.equal(pistolTarget.hp, 28);
  selectWeapon(precise.game, 'rifle'); shoot(precise.game);
  assert.equal(precise.game.projectiles[0].angle, 0); assert.equal(precise.game.projectiles.length, 1);
  updateCombat(precise.game, 2); assert.equal(rifleTarget.dead, true);
  const shield = wall(), blocked = scene({ buildings: [shield], people: [protectedTarget] });
  selectWeapon(blocked.game, 'rifle'); shoot(blocked.game); updateCombat(blocked.game, 2);
  assert.equal(protectedTarget.hp, 28); assert.equal(shield.hp, shield.maxHp - 84);
});

test('the pump has a shorter useful range than the pistol', () => {
  const far = pedestrian(330), { game } = scene({ people: [far] });
  selectWeapon(game, 'shotgun'); shoot(game); updateCombat(game, 5);
  assert.equal(far.hp, 28); assert.equal(game.projectiles.length, 0);
  const comparison = scene({ people: [pedestrian(330)] });
  shoot(comparison.game); updateCombat(comparison.game, 5);
  assert.equal(comparison.game.world.scenery[0].dead, true);
});

test('the automatic carbine has its own cadence, damage, range and reproducible bounded dispersion', () => {
  const run = (id) => {
    const { game, events } = scene(), angles = [];
    selectWeapon(game, id);
    for (let i = 0; i < 100; i++) {
      if (shoot(game, 1.9)) angles.push(game.projectiles.at(-1).angle);
      updateCombat(game, .01);
    }
    return { game, angles, events };
  };
  const first = run('carbine'), replay = run('carbine'), faster = run('smg');
  assert.deepEqual(first.angles, replay.angles, 'Replaying a seed preserves the spread');
  assert.ok(new Set(first.angles).size > 1, 'Successive carbine shots are distinct');
  assert.ok(first.angles.every((angle) => Math.abs(angle - 1.9) <= .035));
  assert.ok(faster.game.shotsFired > first.game.shotsFired && first.game.shotsFired >= 6);
  assert.equal(first.events.filter((event) => event.event === 'shoot').length, first.game.shotsFired);
  assert.ok(first.game.projectiles.every((p) => p.damage === 26 && Math.abs(p.maxLife * Math.hypot(p.vx, p.vy) - 640) < 1e-9));
  assert.ok(WEAPONS[5].damage > WEAPONS[1].damage && WEAPONS[5].range > WEAPONS[1].range);
});

test('a mounted reinforcement takes one vehicle hit without also damaging its invisible crew', () => {
  const vehicle = { ...car('armoured', 120), maxHp: 340, lawEnforcement: true };
  const crew = { ...car('crew', 120), vehicleId: vehicle.id, hp: 340, maxHp: 340 };
  const { game } = scene({ cars: [vehicle], police: [crew], mapped: true });
  shoot(game); updateCombat(game, .5);
  assert.equal(vehicle.hp, 308); assert.equal(crew.hp, 340);
  applyExplosion(game, 120, 150, 58, 180, 'blast');
  assert.equal(vehicle.hp, 128); assert.equal(crew.hp, 340);
  assert.equal(game.eliminated.police, 0, 'The police update owns crew synchronization');
});

test('pending roadblock vehicles neither shield actors nor receive damage before arrival', () => {
  const pending = { ...car('roadblock', 120), pendingRoadblock: true }, person = pedestrian(180);
  const { game } = scene({ cars: [pending], people: [person] });
  shoot(game); updateCombat(game, .5);
  assert.equal(person.dead, true); assert.equal(pending.hp, pending.maxHp);
  assert.equal(damageCar(game, pending, 999), false);
  applyExplosion(game, pending.x, pending.y, 58, 310, 'launcher');
  assert.equal(pending.hp, pending.maxHp); assert.equal(pending.destroyed, undefined);
});

test('a pump impact and an explosion report objects and incidents once, rather than once per pellet', () => {
  const shield = wall(), { game, events } = scene({ buildings: [shield] });
  selectWeapon(game, 'shotgun'); shoot(game); updateCombat(game, .2);
  assert.equal(game.wanted.points, 10, 'One shot plus one damaged property, including repeated pellets');
  assert.equal(events.filter((event) => event.event === 'crime' && event.type === 'propertyDamage').length, 1);
  const explosion = scene();
  applyExplosion(explosion.game, 400, 150, 58, 180, 'blast', { incidentId: 'bottle-42' });
  applyExplosion(explosion.game, 400, 150, 58, 180, 'blast', { incidentId: 'bottle-42' });
  assert.equal(explosion.game.wanted.points, 25); assert.equal(explosion.game.heat, 2);
  assert.equal(explosion.events.filter((event) => event.event === 'crime' && event.type === 'explosion').length, 1);
});

test('ordinary buildings have finite varied strength; missions count exactly once', () => {
  const small = wall({ id: 'small', w: 10, h: 10 });
  const strong = wall({ id: 'fort', kind: 'fortress', w: 200, h: 200, construction: { floors: 3, material: 'stone' } });
  const mission = wall({ id: 'mission', target: true, hp: 1 });
  const { game, events } = scene({ buildings: [small, strong, mission] });
  assert.ok(Number.isFinite(small.hp) && strong.hp > small.hp);
  damageBuilding(game, small, 180, 'blast');
  assert.equal(small.destroyed, false);
  damageBuilding(game, small, 180, 'blast');
  assert.equal(small.destroyed, true);
  assert.equal(game.demolished, 0);
  damageBuilding(game, mission, 180, 'blast');
  damageBuilding(game, mission, 999, 'blast');
  assert.equal(game.demolished, 1);
  assert.equal(game.destroyedBuildings, 2);
  assert.equal(events.filter((event) => event.event === 'demolish').length, 1);
  assert.equal(game.score, 300);
});

test('one remaining building hit point does not regenerate on its next hit', () => {
  const building = wall({ hp: 33 });
  const { game } = scene({ buildings: [building] });
  damageBuilding(game, building, 32);
  assert.equal(building.hp, 1);
  damageBuilding(game, building, 1);
  assert.equal(building.destroyed, true);
});

test('a mission bottle destroys its target while leaving an adjacent full-health car usable', () => {
  const mission = wall({ x: 120, target: true, hp: 1 }), vehicle = car('escape', 110, 180);
  const { game } = scene({ buildings: [mission], cars: [vehicle] });
  applyExplosion(game, 100, 150, 58, 180, 'blast');
  assert.equal(mission.destroyed, true);
  assert.equal(vehicle.destroyed, undefined);
  assert.ok(vehicle.hp > 0 && vehicle.hp < vehicle.maxHp);
});

test('close parked cars chain once each; a remote vehicle survives', () => {
  const vehicles = [car('first', 100), car('second', 130), car('third', 160), car('far', 400)];
  const { game, events } = scene({ cars: vehicles });
  damageCar(game, vehicles[0], 999, 'launcher');
  assert.deepEqual(vehicles.map((vehicle) => Boolean(vehicle.destroyed)), [true, true, true, false]);
  assert.equal(events.filter((event) => event.event === 'vehicleExplosion').length, 3);
  assert.equal(game._vehicleExplosionQueue.length, 0);
  assert.equal(game._resolvingVehicleExplosions, false);
  assert.ok(vehicles.slice(0, 3).every((vehicle) => vehicle.wreck && vehicle.speed === 0));
});

test('a launcher projectile explodes on the first wall, with one local splash', () => {
  const building = wall(), close = car('close', 145, 180), far = car('far', 400);
  const { game, events } = scene({ buildings: [building], cars: [close, far] });
  cycleWeapon(game); cycleWeapon(game);
  shoot(game); updateCombat(game, 1);
  assert.equal(game.projectiles.length, 0);
  assert.equal(building.destroyed, true);
  assert.equal(close.destroyed, true);
  assert.equal(far.hp, far.maxHp);
  assert.equal(events.filter((event) => event.event === 'explosion' && event.weapon === 'launcher').length, 1);
});

test('ordinary shots expire at their finite range without hitting a farther actor', () => {
  const far = pedestrian(650);
  const { game } = scene({ people: [far] });
  shoot(game); updateCombat(game, 5);
  assert.equal(game.projectiles.length, 0);
  assert.equal(far.dead, false);
  assert.equal(far.hp, 28);
});

test('destroying the occupied vehicle exits it safely and applies only one immediate hit', () => {
  const vehicle = car('occupied', 40), nearby = car('nearby', 70);
  const { game } = scene({ cars: [vehicle, nearby] });
  game.vehicleId = vehicle.id;
  damageCar(game, vehicle, 999);
  assert.equal(game.vehicleId, null);
  assert.equal(game.hits, 1);
  assert.equal(game.player.x, vehicle.x);
  assert.equal(vehicle.destroyed, true); assert.equal(vehicle.exploded, false); assert.ok(vehicle.burnFuse > 0);
  updateCombat(game, 1.41);
  assert.equal(vehicle.exploded, true); assert.equal(game.hits, 1, 'The usual protection prevents a second hit from the delayed blast');
});

test('swept high-speed runover catches an actor between vehicle endpoints', () => {
  const person = pedestrian(150), vehicle = car('driver', 220);
  const { game } = scene({ people: [person], cars: [vehicle] });
  collidePedestrians(game, { ...vehicle, x: 80 }, vehicle, .5);
  assert.equal(person.dead, true);
  assert.equal(game.eliminated.pedestrians, 1);
  assert.equal(game.blood.length, 1); assert.equal(game.blood[0].cause, 'runover');
  collidePedestrians(game, { ...vehicle, x: 80 }, vehicle, .5);
  assert.equal(game.eliminated.pedestrians, 1);
});

test('fatal ordinary shots ignite a car before one delayed explosion, and pause freezes the fuse and fire', () => {
  const vehicles = [car('burning', 100), car('adjacent', 130), car('far', 400)];
  const { game, events } = scene({ cars: vehicles });
  damageCar(game, vehicles[0], 999, 'shot');
  assert.equal(vehicles[0].destructionCause, 'shot'); assert.equal(vehicles[0].destroyed, true);
  assert.equal(vehicles[0].exploded, false); assert.ok(vehicles[0].fireTimer > 0 && vehicles[0].smokeTimer > 0);
  assert.equal(vehicles[1].destroyed, undefined, 'The first fire cannot instantly chain into its neighbour');
  assert.equal(events.filter((event) => event.event === 'vehicleExplosion').length, 0);
  game.mode = 'paused';
  const frozen = structuredClone({ fuse: vehicles[0].burnFuse, fire: vehicles[0].fireTimer, smoke: vehicles[0].smokeTimer });
  updateCombat(game, 2);
  assert.deepEqual({ fuse: vehicles[0].burnFuse, fire: vehicles[0].fireTimer, smoke: vehicles[0].smokeTimer }, frozen);
  game.mode = 'playing'; updateCombat(game, 1.39);
  assert.equal(vehicles[0].exploded, false);
  updateCombat(game, .02);
  assert.equal(vehicles[0].exploded, true); assert.equal(vehicles[0].explosionCause, 'secondary');
  assert.equal(vehicles[1].exploded, true); assert.equal(vehicles[2].destroyed, undefined);
  updateCombat(game, 3); damageCar(game, vehicles[0], 999, 'launcher');
  assert.equal(events.filter((event) => event.event === 'vehicleExplosion' && event.id === 'burning').length, 1);
  assert.equal(events.filter((event) => event.event === 'vehicleExplosion' && event.id === 'adjacent').length, 1);
});

test('shots collapse a building locally while explosive destruction creates larger fire and visual shock effects', () => {
  const bullet = wall({ id: 'bullet-house' }), explosive = wall({ id: 'explosive-house', x: 400 });
  const { game } = scene({ buildings: [bullet, explosive] });
  damageBuilding(game, bullet, 999, 'shot');
  assert.equal(bullet.destructionCause, 'shot'); assert.equal(bullet.fireHotspots.length, 1);
  assert.equal(game.blasts.length, 0); assert.equal(game.explosionEffects.length, 0);
  assert.equal(game.destructionDust.length, 1);
  damageBuilding(game, explosive, 999, 'launcher');
  assert.equal(explosive.destructionCause, 'launcher'); assert.equal(explosive.fireHotspots.length, 3);
  assert.ok(explosive.fireTimer > bullet.fireTimer && explosive.smokeTimer > bullet.smokeTimer);
  assert.equal(game.blasts.length, 0, 'A collapse visual does not duplicate the projectile splash damage');
  assert.equal(game.explosionEffects.length, 1);
  game.mode = 'paused';
  const frozen = structuredClone({ fire: explosive.fireTimer, smoke: explosive.smokeTimer, dust: game.destructionDust, visual: game.explosionEffects });
  updateCombat(game, 10);
  assert.deepEqual({ fire: explosive.fireTimer, smoke: explosive.smokeTimer, dust: game.destructionDust, visual: game.explosionEffects }, frozen);
  game.mode = 'playing'; updateCombat(game, 25);
  assert.equal(explosive.fireTimer, 0); assert.equal(explosive.smokeTimer, 0);
  assert.equal(game.destructionDust.length, 0); assert.equal(game.explosionEffects.length, 0);
});

test('blood traces remain bounded, freeze during pause and expire without duplicate marks on dead actors', () => {
  const persons = Array.from({ length: 95 }, (_, i) => pedestrian(50 + i * 6));
  const { game } = scene({ people: persons });
  for (const p of persons) damagePerson(game, p, 100, 'shot');
  assert.equal(game.blood.length, 80); assert.ok(game.blood.every((decal) => decal.life > 0 && decal.size > 0));
  const retained = structuredClone(game.blood);
  game.mode = 'paused'; updateCombat(game, 40); assert.deepEqual(game.blood, retained);
  game.mode = 'playing'; damagePerson(game, persons.at(-1), 100, 'shot');
  assert.deepEqual(game.blood, retained, 'Repeating damage on an eliminated actor cannot create another pool');
  updateCombat(game, 36); assert.equal(game.blood.length, 0);
});

test('a slow vehicle bump knocks down and recovers; a paused vehicle cannot hurt', () => {
  const person = pedestrian(80), vehicle = car('driver', 80);
  const { game } = scene({ people: [person], cars: [vehicle] });
  game.mode = 'paused'; collidePedestrians(game, { ...vehicle, x: 40 }, vehicle, .1);
  assert.equal(person.dead, false);
  assert.equal(person.knockedDown, undefined);
  game.mode = 'playing'; collidePedestrians(game, { ...vehicle, x: 65 }, vehicle, .5);
  assert.equal(person.knockedDown, true);
  assert.equal(person.dead, false);
  updateCombat(game, 1.3);
  assert.equal(person.knockedDown, false);
});

test('police take multiple ordinary shots and produce one elimination', () => {
  const officer = { id: 'officer', x: 100, y: 150, angle: 0, path: [], speed: 0 };
  const { game, events } = scene({ police: [officer] });
  damagePerson(game, officer, 32, 'shot', 'police');
  assert.equal(officer.hp, 48); assert.equal(officer.dead, undefined);
  damagePerson(game, officer, 32, 'shot', 'police');
  damagePerson(game, officer, 32, 'shot', 'police');
  damagePerson(game, officer, 32, 'shot', 'police');
  assert.equal(officer.dead, true);
  assert.equal(game.eliminated.police, 1);
  assert.equal(events.filter((event) => event.event === 'kill').length, 1);
});
