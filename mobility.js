// Arcade locomotion. Coordinates stay in the real map; altitude is metres.
import { jumpFromAircraft, isPlayerAirborne } from './parachute.js';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const delta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const MOBILITY = Object.freeze({
  motorcycle: Object.freeze({ name: 'Moto', radius: 5, speed: 250, acceleration: 460, steering: 9, mode: 'ground' }),
  boat: Object.freeze({ name: 'Bateau', radius: 9, speed: 165, acceleration: 115, steering: 2.8, mode: 'water' }),
  helicopter: Object.freeze({ name: 'Hélicoptère', radius: 12, speed: 205, acceleration: 190, steering: 6, mode: 'ground' }),
  plane: Object.freeze({ name: 'Avion', radius: 18, speed: 320, acceleration: 125, steering: 1.5, mode: 'ground' }),
});

export const isMobilityVehicle = (vehicle) => Boolean(MOBILITY[vehicle?.mobilityType]);
export const isAirborne = (vehicle) => (vehicle?.altitude || 0) > 8;
export const vehicleRadius = (vehicle) => vehicle?.collisionRadius > 0 ? vehicle.collisionRadius : MOBILITY[vehicle?.mobilityType]?.radius || 15;
export const vehicleHalfLength = (vehicle) => Number.isFinite(vehicle?.collisionHalfLength) ? Math.max(0, vehicle.collisionHalfLength) : 0;
export function distanceToVehicleHull(point, vehicle) {
  const dx = Math.cos(vehicle.angle || 0), dy = Math.sin(vehicle.angle || 0), shaft = vehicleHalfLength(vehicle);
  const along = clamp((point.x - vehicle.x) * dx + (point.y - vehicle.y) * dy, -shaft, shaft);
  return Math.max(0, Math.hypot(point.x - vehicle.x - dx * along, point.y - vehicle.y - dy * along) - vehicleRadius(vehicle));
}
function nearestOnAxis(point, vehicle) {
  const dx = Math.cos(vehicle.angle || 0), dy = Math.sin(vehicle.angle || 0), shaft = vehicleHalfLength(vehicle);
  const along = clamp((point.x - vehicle.x) * dx + (point.y - vehicle.y) * dy, -shaft, shaft);
  return { x: vehicle.x + dx * along, y: vehicle.y + dy * along };
}
function hullConnection(one, two) {
  const ends = vehicle => [-1, 1].map(side => ({ x: vehicle.x + Math.cos(vehicle.angle || 0) * vehicleHalfLength(vehicle) * side, y: vehicle.y + Math.sin(vehicle.angle || 0) * vehicleHalfLength(vehicle) * side }));
  const pairs = [...ends(one).map(a => [a, nearestOnAxis(a, two)]), ...ends(two).map(b => [nearestOnAxis(b, one), b])];
  pairs.sort((a, b) => distance(...a) - distance(...b));
  const [a, b] = pairs[0], length = distance(a, b);
  const dx = length ? (b.x - a.x) / length : 1, dy = length ? (b.y - a.y) / length : 0;
  return { gap: Math.max(0, length - vehicleRadius(one) - vehicleRadius(two)),
    from: { x: a.x + dx * vehicleRadius(one), y: a.y + dy * vehicleRadius(one) },
    to: { x: b.x - dx * vehicleRadius(two), y: b.y - dy * vehicleRadius(two) } };
}
export function canTransferBoats(game, one, two) {
  if (one?.mobilityType !== 'boat' || two?.mobilityType !== 'boat' || one === two || one.destroyed || two.destroyed || two.locked || Math.abs(one.speed || 0) > 25 || Math.abs(two.speed || 0) > 25) return false;
  const connection = hullConnection(one, two);
  if (connection.gap > 26) return false;
  const ignored = new Set([one.id, two.id]);
  if (!game.clearVehicleSegment(connection.from, connection.to, game.playerRadius, ignored)) return false;
  for (let step = 0, count = Math.max(1, Math.ceil(connection.gap / 2)); step <= count; step++) {
    const fraction = step / count;
    if (!game.canWaterOccupy(connection.from.x + (connection.to.x - connection.from.x) * fraction, connection.from.y + (connection.to.y - connection.from.y) * fraction, 1, ignored)) return false;
  }
  return true;
}

export function initializeMobility(vehicle) {
  if (!isMobilityVehicle(vehicle)) return vehicle;
  vehicle.mobilityMode ??= MOBILITY[vehicle.mobilityType].mode;
  vehicle.altitude ??= 0; vehicle.speed ??= 0; vehicle.angle ??= 0;
  vehicle.vx = 0; vehicle.vy = 0; vehicle.rotor = 0;
  vehicle.takeoffRequested = false; vehicle.landingRequested = false;
  vehicle.abandonedFlight = false;
  return vehicle;
}

export function canBoatOccupy(game, x, y, radius = 9, ignoreCar = null) {
  return game.canWaterOccupy(x, y, radius, ignoreCar);
}

export function canLandVehicle(game, vehicle, x = vehicle.x, y = vehicle.y) {
  const radius = vehicleRadius(vehicle);
  if (!game.canOccupy(x, y, radius, vehicle.id, { allowPiers: false }) || !game.canGroundVehicleOccupy(vehicle, x, y)) return false;
  const slope = game.surfaceSlope?.(x, y) || 0;
  if (slope > (vehicle.mobilityType === 'plane' ? .12 : .3)) return false;
  if (vehicle.mobilityType === 'plane') {
    const end = { x: x + Math.cos(vehicle.angle) * 140, y: y + Math.sin(vehicle.angle) * 140 };
    for (let at = 20; at <= 140; at += 20) if ((game.surfaceSlope?.(x + Math.cos(vehicle.angle) * at, y + Math.sin(vehicle.angle) * at) || 0) > .12) return false;
    return game.clearSegment({ x, y }, end, radius, vehicle.id, false);
  }
  return true;
}

export function canBoardVehicle(game, vehicle) {
  if (isPlayerAirborne(game) || !isMobilityVehicle(vehicle) || vehicle.destroyed || vehicle.locked || vehicle.pendingRoadblock || vehicle.altitude > 0) return false;
  if (vehicle.mobilityType === 'boat') {
    const boarding = vehicle.boarding;
    return Boolean(boarding && distanceToVehicleHull(boarding, vehicle) <= 28 && distance(game.player, boarding) <= 22 && game.canOccupy(boarding.x, boarding.y, game.playerRadius, vehicle.id) && game.clearSegment(game.player, boarding, game.playerRadius, vehicle.id, false) && game.clearBuildingSegment?.(boarding, vehicle, 2) && game.clearVehicleSegment(boarding, vehicle, game.playerRadius, vehicle.id));
  }
  return distance(game.player, vehicle) <= 36 && game.clearSegment(game.player, vehicle, game.playerRadius, vehicle.id, false);
}

function notice(game, message) { game.emit('notice', { message }); }

export function mobilityAction(game) {
  if (!game.active()) return false;
  const vehicle = game.vehicle;
  if (!isMobilityVehicle(vehicle)) return false;
  if (vehicle.mobilityType === 'motorcycle' || vehicle.mobilityType === 'boat') {
    vehicle.actionBrakeTimer = .35;
    return true;
  }
  if (vehicle.altitude > 0 || vehicle.takeoffRequested) {
    vehicle.takeoffRequested = false;
    vehicle.landingRequested = !vehicle.landingRequested;
    notice(game, vehicle.landingRequested ? vehicle.mobilityType === 'plane' ? 'Atterrissage : aligne une approche libre sur terre et ralentis.' : 'Atterrissage : place-toi au-dessus d’un sol libre, puis relâche le déplacement.' : 'Atterrissage annulé.');
    return true;
  }
  if (!canLandVehicle(game, vehicle)) { notice(game, 'Décollage impossible : dégage le véhicule et son approche.'); return false; }
  vehicle.takeoffRequested = true; vehicle.landingRequested = false;
  vehicle.mobilityMode = 'takingOff';
  notice(game, vehicle.mobilityType === 'plane' ? 'Décollage armé : accélère droit devant sur la piste.' : 'Décollage : prends de la hauteur avant de survoler les bâtiments.');
  return true;
}

export function mobilityExitPoint(game, vehicle) {
  if (vehicle.altitude > 0 || vehicle.takeoffRequested || Math.abs(vehicle.speed) > 15) return null;
  const normal = { x: -Math.sin(vehicle.angle), y: Math.cos(vehicle.angle) };
  const candidates = [];
  if (vehicle.mobilityType === 'boat' && vehicle.boarding && distanceToVehicleHull(vehicle.boarding, vehicle) <= 28) candidates.push(vehicle.boarding);
  for (const length of [24, 34, 44]) {
    candidates.push({ x: vehicle.x + normal.x * length, y: vehicle.y + normal.y * length }, { x: vehicle.x - normal.x * length, y: vehicle.y - normal.y * length });
    candidates.push({ x: vehicle.x + Math.cos(vehicle.angle) * length, y: vehicle.y + Math.sin(vehicle.angle) * length }, { x: vehicle.x - Math.cos(vehicle.angle) * length, y: vehicle.y - Math.sin(vehicle.angle) * length });
  }
  if (vehicle.mobilityType === 'boat' && vehicleHalfLength(vehicle)) {
    const dx = Math.cos(vehicle.angle || 0), dy = Math.sin(vehicle.angle || 0);
    for (const along of [-vehicleHalfLength(vehicle), 0, vehicleHalfLength(vehicle)]) for (const side of [-1, 1]) for (const offset of [12, 24]) {
      const normal = (vehicleRadius(vehicle) + offset) * side;
      candidates.push({ x: vehicle.x + dx * along - dy * normal, y: vehicle.y + dy * along + dx * normal });
    }
  }
  return candidates.find((p) => (vehicle.mobilityType !== 'boat' || distanceToVehicleHull(p, vehicle) <= 28) && game.canOccupy(p.x, p.y, game.playerRadius, vehicle.id) && game.clearBuildingSegment(vehicle, p, game.playerRadius) && game.clearVehicleSegment(vehicle, p, game.playerRadius, vehicle.id) && (vehicle.mobilityType === 'boat' || game.clearSegment(vehicle, p, game.playerRadius, vehicle.id, false))) || null;
}

export function mobilityExit(game, vehicle) {
  if (vehicle.altitude > 0 && ['plane', 'helicopter'].includes(vehicle.mobilityType)) return jumpFromAircraft(game, vehicle);
  if (vehicle.altitude > 0 || vehicle.takeoffRequested) { notice(game, 'Atterris avant de descendre du véhicule.'); return false; }
  if (Math.abs(vehicle.speed) > 15) { notice(game, 'Ralentis avant de descendre du véhicule.'); return false; }
  const exit = mobilityExitPoint(game, vehicle);
  if (!exit) { notice(game, vehicle.mobilityType === 'boat' ? 'Accoste près d’un quai ou d’une rive pour descendre.' : 'Pas de sol libre pour descendre : déplace le véhicule.'); return false; }
  vehicle.speed = 0; vehicle.vx = 0; vehicle.vy = 0;
  if (vehicle.mobilityType === 'boat') vehicle.boarding = { x: exit.x, y: exit.y };
  game.vehicleId = null; game.player.x = exit.x; game.player.y = exit.y;
  game.player.vx = 0; game.player.vy = 0; game.player.altitude = 0;
  game.emit('car', { entered: false, id: vehicle.id, mobilityType: vehicle.mobilityType });
  return true;
}

// Detached aircraft keep their own flight state; only occupied mobility copies
// its position and altitude into the player. A helicopter coasts to a hover and
// an airplane retains forward flight until the existing map/obstacle limits.
export function updateAbandonedAircraft(game, dt) {
  for (const vehicle of game.abandonedAircraft || []) {
    if (!vehicle.abandonedFlight || vehicle.destroyed || vehicle.id === game.vehicleId) { game.abandonedAircraft.delete(vehicle); continue; }
    if (vehicle.mobilityType === 'helicopter') {
      vehicle.rotor = (vehicle.rotor + 28 * dt) % (Math.PI * 2);
      vehicle.vx += clamp(-vehicle.vx, -MOBILITY.helicopter.acceleration * dt, MOBILITY.helicopter.acceleration * dt);
      vehicle.vy += clamp(-vehicle.vy, -MOBILITY.helicopter.acceleration * dt, MOBILITY.helicopter.acceleration * dt);
      if (game.canVehicleOccupy(vehicle, vehicle.x + vehicle.vx * dt, vehicle.y, vehicle.angle)) vehicle.x += vehicle.vx * dt; else vehicle.vx = 0;
      if (game.canVehicleOccupy(vehicle, vehicle.x, vehicle.y + vehicle.vy * dt, vehicle.angle)) vehicle.y += vehicle.vy * dt; else vehicle.vy = 0;
      vehicle.speed = Math.hypot(vehicle.vx, vehicle.vy);
    } else if (vehicle.mobilityType === 'plane') {
      advanceSpeed(vehicle, Math.max(160, vehicle.speed), MOBILITY.plane.acceleration, dt);
      moveWithCollision(game, vehicle, dt, true);
    }
  }
}

function steer(vehicle, input, dt, rate, reverseAllowed) {
  const magnitude = Math.min(1, Math.hypot(input.x, input.y));
  let reverse = false, factor = 1;
  if (magnitude > .02) {
    let desired = Math.atan2(input.y, input.x);
    reverse = reverseAllowed && Math.cos(delta(vehicle.angle, desired)) < -.7;
    if (reverse) desired += Math.PI;
    const turn = delta(vehicle.angle, desired);
    factor = clamp(Math.cos(turn), .25, 1);
    vehicle.lean = clamp(turn, -.5, .5);
    vehicle.angle += clamp(turn, -rate * dt, rate * dt);
  } else vehicle.lean = (vehicle.lean || 0) * Math.max(0, 1 - dt * 8);
  return { magnitude, reverse, factor };
}

function advanceSpeed(vehicle, target, acceleration, dt) {
  vehicle.speed += clamp(target - vehicle.speed, -acceleration * dt, acceleration * dt);
}

function moveWithCollision(game, vehicle, dt, silent = false) {
  const dx = Math.cos(vehicle.angle) * vehicle.speed * dt, dy = Math.sin(vehicle.angle) * vehicle.speed * dt;
  let blocked = false;
  if (game.canVehicleOccupy(vehicle, vehicle.x + dx, vehicle.y, vehicle.angle)) vehicle.x += dx; else blocked = true;
  if (game.canVehicleOccupy(vehicle, vehicle.x, vehicle.y + dy, vehicle.angle)) vehicle.y += dy; else blocked = true;
  if (blocked) {
    vehicle.speed *= .4;
    if (!silent && game.crashCooldown <= 0) { notice(game, vehicle.mobilityType === 'boat' ? 'La coque touche la rive : reprends le large.' : vehicle.altitude > 8 ? 'Limite ou obstacle : tourne pour repartir.' : 'Obstacle : ralentis et change de direction.'); game.crashCooldown = 1.2; }
  }
  vehicle.vx = dx / dt; vehicle.vy = dy / dt;
}

export function updateMobility(game, dt, input) {
  const vehicle = game.vehicle, type = vehicle?.mobilityType, config = MOBILITY[type];
  if (!config) return false;
  vehicle.actionBrakeTimer = Math.max(0, (vehicle.actionBrakeTimer || 0) - dt);
  const brake = input.brake || vehicle.actionBrakeTimer > 0;
  if (type === 'helicopter') {
    vehicle.rotor = (vehicle.rotor + dt * (vehicle.altitude > 0 || vehicle.takeoffRequested ? 28 : 7)) % (Math.PI * 2);
    if (vehicle.takeoffRequested) {
      vehicle.altitude = Math.min(80, vehicle.altitude + 22 * dt);
      if (vehicle.altitude >= 80) { vehicle.takeoffRequested = false; vehicle.mobilityMode = 'air'; }
    }
    const inputLength = Math.hypot(input.x, input.y), magnitude = Math.min(1, inputLength);
    const safeLanding = vehicle.landingRequested && magnitude < .05 && canLandVehicle(game, vehicle);
    const flying = vehicle.altitude > 0;
    const targetX = flying && !brake && !safeLanding ? input.x / Math.max(1, inputLength) * config.speed : 0;
    const targetY = flying && !brake && !safeLanding ? input.y / Math.max(1, inputLength) * config.speed : 0;
    vehicle.vx += clamp(targetX - vehicle.vx, -config.acceleration * dt, config.acceleration * dt);
    vehicle.vy += clamp(targetY - vehicle.vy, -config.acceleration * dt, config.acceleration * dt);
    vehicle.speed = Math.hypot(vehicle.vx, vehicle.vy);
    if (magnitude > .02) vehicle.angle += clamp(delta(vehicle.angle, Math.atan2(input.y, input.x)), -6 * dt, 6 * dt);
    if (flying) {
      if (game.canVehicleOccupy(vehicle, vehicle.x + vehicle.vx * dt, vehicle.y, vehicle.angle)) vehicle.x += vehicle.vx * dt; else vehicle.vx = 0;
      if (game.canVehicleOccupy(vehicle, vehicle.x, vehicle.y + vehicle.vy * dt, vehicle.angle)) vehicle.y += vehicle.vy * dt; else vehicle.vy = 0;
    }
    if (safeLanding && vehicle.speed < 25) {
      vehicle.mobilityMode = 'landing'; vehicle.altitude = Math.max(0, vehicle.altitude - 20 * dt);
      if (!vehicle.altitude) { vehicle.landingRequested = false; vehicle.mobilityMode = 'ground'; vehicle.vx = 0; vehicle.vy = 0; vehicle.speed = 0; }
    } else if (vehicle.landingRequested && flying) vehicle.mobilityMode = 'air';
  } else {
    const oldAngle = vehicle.angle;
    const steering = steer(vehicle, input, dt, type === 'plane' && vehicle.altitude > 0 ? 1.2 : config.steering, type !== 'plane');
    if (!game.canVehicleOccupy(vehicle, vehicle.x, vehicle.y, vehicle.angle)) vehicle.angle = oldAngle;
    let target = brake ? 0 : config.speed * steering.magnitude * steering.factor * (steering.reverse ? -.4 : 1);
    if (type === 'plane') {
      if (vehicle.altitude > 0) target = vehicle.landingRequested || brake ? 110 : Math.max(160, config.speed * steering.magnitude * steering.factor);
      else target = brake ? 0 : (vehicle.takeoffRequested ? 260 : 115) * steering.magnitude * steering.factor;
    }
    advanceSpeed(vehicle, target, brake && !vehicle.altitude ? 600 : config.acceleration, dt);
    if (type === 'plane' && vehicle.takeoffRequested && vehicle.speed >= 150) {
      vehicle.altitude = Math.min(95, vehicle.altitude + 25 * dt);
      if (vehicle.altitude >= 95) { vehicle.takeoffRequested = false; vehicle.mobilityMode = 'air'; }
    }
    moveWithCollision(game, vehicle, dt);
    if (type === 'boat') vehicle.wakeTimer = Math.min(1, Math.abs(vehicle.speed) / 100);
    if (type === 'plane' && vehicle.landingRequested && vehicle.altitude > 0 && vehicle.speed <= 145 && canLandVehicle(game, vehicle)) {
      vehicle.mobilityMode = 'landing'; vehicle.altitude = Math.max(0, vehicle.altitude - 20 * dt);
      if (!vehicle.altitude) { vehicle.landingRequested = false; vehicle.mobilityMode = 'ground'; }
    } else if (type === 'plane' && vehicle.landingRequested && vehicle.altitude > 0) vehicle.mobilityMode = 'air';
  }
  game.player.x = vehicle.x; game.player.y = vehicle.y; game.player.dir = vehicle.angle;
  game.player.altitude = vehicle.altitude;
  return true;
}
