import { sampleElevation } from './terrain.js';

// XY use the map's coordinates. Height and vertical velocity are metres and
// metres/second; keep a world elevation so steering into a hill reduces clearance.
export const PARACHUTE = Object.freeze({ gravity: 9.81, terminalSpeed: 55, descentSpeed: 5.5, inflationTime: .65, braking: 45, steeringSpeed: 70, steeringAcceleration: 125, safeImpactSpeed: 8.5, fatalImpactSpeed: 14 });
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const isPlayerAirborne = (game) => game.player?.airborneMode === 'freefall' || game.player?.airborneMode === 'parachute';

export function initializeParachute(player) {
  Object.assign(player, { airborneMode: null, verticalSpeed: 0, parachuteInflation: 0, airborneElevation: null, airborneVehicleId: null });
}

export function jumpFromAircraft(game, vehicle) {
  if (!game.active() || isPlayerAirborne(game) || !['plane', 'helicopter'].includes(vehicle?.mobilityType) || !(vehicle.altitude > 0)) return false;
  const player = game.player;
  player.x = vehicle.x; player.y = vehicle.y; player.dir = vehicle.angle;
  player.altitude = vehicle.altitude;
  player.airborneElevation = sampleElevation(game.world, player.x, player.y) + player.altitude;
  player.airborneMode = 'freefall'; player.verticalSpeed = 0; player.parachuteInflation = 0;
  player.vx = Number.isFinite(vehicle.vx) ? vehicle.vx : Math.cos(vehicle.angle) * vehicle.speed;
  player.vy = Number.isFinite(vehicle.vy) ? vehicle.vy : Math.sin(vehicle.angle) * vehicle.speed;
  player.airborneVehicleId = vehicle.id;
  player.plantAnim = 0;
  vehicle.abandonedFlight = true; vehicle.takeoffRequested = false; vehicle.landingRequested = false; vehicle.mobilityMode = 'air';
  (game.abandonedAircraft ??= new Set()).add(vehicle);
  game.vehicleId = null;
  game.emit('car', { entered: false, jumped: true, id: vehicle.id, mobilityType: vehicle.mobilityType });
  game.emit('jump', { altitude: player.altitude, mobilityType: vehicle.mobilityType });
  game.emit('notice', { message: 'Chute libre : ouvre ton parachute et dirige-toi vers un sol libre.' });
  return true;
}

export function deployParachute(game) {
  if (!game.active() || game.player.airborneMode !== 'freefall' || !(game.player.altitude > 0)) return false;
  game.player.airborneMode = 'parachute'; game.player.parachuteInflation = 0;
  game.emit('parachute', { altitude: game.player.altitude });
  return true;
}

function finishImpact(game, cause, { elevation = null, x = game.player.x, y = game.player.y } = {}) {
  const player = game.player;
  player.x = x; player.y = y;
  if (elevation !== null) player.airborneElevation = elevation;
  player.altitude = Math.max(0, player.airborneElevation - sampleElevation(game.world, x, y));
  player.vx = 0; player.vy = 0; player.verticalSpeed = 0;
  game.lastCause = cause; game.shake = .35;
  game.emit('landing', { safe: false, cause, x, y, altitude: player.altitude });
  game.finish(false, cause);
}

function touchGround(game) {
  const player = game.player, speed = Math.abs(player.verticalSpeed);
  player.altitude = 0; player.airborneElevation = sampleElevation(game.world, player.x, player.y);
  // The actual final point must fit a whole foot body. Never search for a nearby
  // shore, old boarding position, roof or free parking place.
  if (!game.canOccupy(player.x, player.y, game.playerRadius)) {
    finishImpact(game, game.playerLandingCause(player.x, player.y));
    return;
  }
  if (speed > PARACHUTE.fatalImpactSpeed) { finishImpact(game, 'fall'); return; }
  const hardLanding = speed > PARACHUTE.safeImpactSpeed;
  initializeParachute(player); player.vx = 0; player.vy = 0; player.walk = 0;
  game.emit('landing', { safe: !hardLanding, cause: hardLanding ? 'fall' : null, x: player.x, y: player.y, altitude: 0 });
  if (hardLanding) game.hurt('fall');
}

export function updateParachute(game, dt, input) {
  if (!isPlayerAirborne(game)) return false;
  const player = game.player, previous = { x: player.x, y: player.y, altitude: player.altitude, elevation: player.airborneElevation };
  const canopy = player.airborneMode === 'parachute';
  if (canopy) player.parachuteInflation = Math.min(1, player.parachuteInflation + dt / PARACHUTE.inflationTime);
  const inflation = player.parachuteInflation;
  player.verticalSpeed = Math.max(-PARACHUTE.terminalSpeed, player.verticalSpeed - PARACHUTE.gravity * dt);
  if (canopy && player.verticalSpeed < -PARACHUTE.descentSpeed) {
    player.verticalSpeed = Math.min(-PARACHUTE.descentSpeed, player.verticalSpeed + (PARACHUTE.braking + PARACHUTE.gravity) * inflation * dt);
  }
  const magnitude = Math.hypot(input.x, input.y), nx = input.x / Math.max(1, magnitude), ny = input.y / Math.max(1, magnitude);
  // In free fall, limited steering preserves the aircraft's momentum. An open
  // canopy gradually brakes that momentum and gives precise landing control.
  const steer = canopy ? 35 + (PARACHUTE.steeringAcceleration - 35) * inflation : 35;
  const speed = canopy ? 95 + (PARACHUTE.steeringSpeed - 95) * inflation : 95;
  player.vx += clamp(nx * speed - player.vx, -steer * dt, steer * dt);
  player.vy += clamp(ny * speed - player.vy, -steer * dt, steer * dt);
  if (magnitude > .02) player.dir = Math.atan2(input.y, input.x);
  const next = { x: player.x + player.vx * dt, y: player.y + player.vy * dt, elevation: player.airborneElevation + player.verticalSpeed * dt };
  const clearance = next.elevation - sampleElevation(game.world, next.x, next.y);
  const fraction = clearance <= 0 ? clamp(previous.altitude / Math.max(1e-9, previous.altitude - clearance), 0, 1) : 1;
  // Sample the short swept path as well as the endpoint: low flight cannot pass
  // through thin walls between simulation frames.
  const steps = Math.max(1, Math.ceil(Math.hypot(next.x - previous.x, next.y - previous.y) * fraction / Math.max(1, game.playerRadius)));
  for (let step = 1; step <= steps; step++) {
    const t = fraction * step / steps, x = previous.x + (next.x - previous.x) * t, y = previous.y + (next.y - previous.y) * t;
    const elevation = previous.elevation + (next.elevation - previous.elevation) * t;
    const obstacle = game.playerAirborneObstacle(x, y, elevation);
    if (obstacle) {
      // A descending contact from above stops at the roof plane. A lateral
      // contact stays at its actual height instead of lifting the actor onto it.
      const roofT = (previous.elevation - obstacle.elevation) / (previous.elevation - next.elevation);
      const roofX = previous.x + (next.x - previous.x) * roofT, roofY = previous.y + (next.y - previous.y) * roofT;
      const roofContact = roofT >= 0 && roofT <= t && game.playerAirborneObstacle(roofX, roofY, obstacle.elevation)?.building === obstacle.building;
      finishImpact(game, 'obstacle', roofContact ? { x: roofX, y: roofY, elevation: obstacle.elevation } : { x, y, elevation });
      return true;
    }
  }
  player.x = previous.x + (next.x - previous.x) * fraction;
  player.y = previous.y + (next.y - previous.y) * fraction;
  player.airborneElevation = previous.elevation + (next.elevation - previous.elevation) * fraction;
  player.altitude = Math.max(0, player.airborneElevation - sampleElevation(game.world, player.x, player.y));
  if (clearance <= 0) touchGround(game);
  return true;
}
