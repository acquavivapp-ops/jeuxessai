import { CALVI_MAP } from './data/calvi-map.js';
import { createCalviWorld } from './calvi-world.js';
import { attachTerrain, terrainGradient, sampleElevation } from './terrain.js';
import { initCombat, shoot, cycleWeapon, updateCombat, applyExplosion, collidePedestrians, createBlast } from './combat.js';
import { initPolice, reportCrime, spawnPolice, updatePolice } from './police.js';
import { MOBILITY, initializeMobility, isMobilityVehicle, isAirborne, vehicleRadius, vehicleHalfLength, canBoardVehicle, canTransferBoats, mobilityAction, mobilityExitPoint, mobilityExit, updateMobility, updateAbandonedAircraft } from './mobility.js';
import { isPlayerAirborne, initializeParachute, deployParachute, updateParachute } from './parachute.js';
import { createMobilityVehicles } from './mobility-spawns.js';
import { createAerialStarter, createAerialVehicles } from './aerial-vehicles.js';
import { CALVI_AERIAL_OBJECTS } from './data/calvi-aerial-objects.js';
import { attachVegetation, createWorldVegetationIndexes, circleTouchesVegetation, capsuleTouchesVegetation, sweptCircleTouchesVegetation, vegetationMovementFactor, nearbyVegetation } from './vegetation.js';
import { createPierIndex, circleFitsPier, capsuleTouchesPier } from './piers.js';

export const WORLD_WIDTH = CALVI_MAP.width;
export const WORLD_HEIGHT = CALVI_MAP.height;
export const DURATION = 180;
export const MAX_BOTTLES = 3;
export const WALK_SPEED = 92;
export const DRIVE_SPEED = 210;
export const BLAST_RADIUS = 58;
export const FUSE_DURATION = 2.6;
const PLAYER_RADIUS = 7;
const CAR_RADIUS = 18;
const NAV_STEP = 50;
const CLASSIC_CAR_BODY = Object.freeze({ radius: 8, halfLength: 7 });
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ignoresCar = (ignored, id) => ignored instanceof Set ? ignored.has(id) : Array.isArray(ignored) ? ignored.includes(id) : ignored === id;
const circleHitsRect = (x, y, radius, rect) => Math.hypot(x - clamp(x, rect.x, rect.x + rect.w), y - clamp(y, rect.y, rect.y + rect.h)) < radius;
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function distanceToSegmentSquared(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
  return (x - a[0] - dx * t) ** 2 + (y - a[1] - dy * t) ** 2;
}

export function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (distanceToSegmentSquared(x, y, a, b) < 1e-12) return true;
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function touchesPolygonEdge(x, y, radius, polygon) {
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (distanceToSegmentSquared(x, y, polygon[j], polygon[i]) < radius * radius) return true;
  }
  return false;
}

export function circleHitsPolygon(x, y, radius, polygon, holes = []) {
  if (polygon.length < 3) return false;
  if (pointInPolygon(x, y, polygon) && !holes.some((hole) => pointInPolygon(x, y, hole))) return true;
  return touchesPolygonEdge(x, y, radius, polygon) || holes.some((hole) => touchesPolygonEdge(x, y, radius, hole));
}

function circleHitsBuilding(x, y, radius, building) {
  if (x + radius < building.x || x - radius > building.x + building.w || y + radius < building.y || y - radius > building.y + building.h) return false;
  return building.polygon ? circleHitsPolygon(x, y, radius, building.polygon, building.holes || []) : circleHitsRect(x, y, radius, building);
}

const rectanglePolygon = (b) => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
const capsuleAxis = (x, y, angle, halfLength = 7) => [[x - Math.cos(angle) * halfLength, y - Math.sin(angle) * halfLength], [x + Math.cos(angle) * halfLength, y + Math.sin(angle) * halfLength]];
const carExtent = (car) => isMobilityVehicle(car) ? vehicleRadius(car) + vehicleHalfLength(car) : (car.collisionRadius || 8) + (car.collisionHalfLength ?? 7);

export function segmentDistanceSquared(a, b, c, d) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const overlap = Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0]))
    && Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]));
  if (overlap && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return 0;
  return Math.min(distanceToSegmentSquared(a[0], a[1], c, d), distanceToSegmentSquared(b[0], b[1], c, d), distanceToSegmentSquared(c[0], c[1], a, b), distanceToSegmentSquared(d[0], d[1], a, b));
}

function capsuleTouchesEdges(axis, polygon, radius = 8) {
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) if (segmentDistanceSquared(axis[0], axis[1], polygon[j], polygon[i]) < radius * radius) return true;
  return false;
}

// Municipal and coastal rings can contain thousands of survey points. Index
// crossing edges by latitude and collision edges by local cell, once per map.
function indexRing(polygon) {
  const crossing = new Map(), nearby = new Map();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    minX = Math.min(minX, b[0]); maxX = Math.max(maxX, b[0]); minY = Math.min(minY, b[1]); maxY = Math.max(maxY, b[1]);
    const edge = [a, b];
    for (let y = Math.floor(Math.min(a[1], b[1]) / 256); y <= Math.floor(Math.max(a[1], b[1]) / 256); y++) {
      if (!crossing.has(y)) crossing.set(y, []); crossing.get(y).push(edge);
    }
    for (let y = Math.floor(Math.min(a[1], b[1]) / 128); y <= Math.floor(Math.max(a[1], b[1]) / 128); y++) {
      for (let x = Math.floor(Math.min(a[0], b[0]) / 128); x <= Math.floor(Math.max(a[0], b[0]) / 128); x++) {
        const key = `${x},${y}`;
        if (!nearby.has(key)) nearby.set(key, []); nearby.get(key).push(edge);
      }
    }
  }
  return { crossing, nearby, minX, maxX, minY, maxY };
}

function insideIndexedRing(x, y, ring) {
  if (x < ring.minX || x > ring.maxX || y < ring.minY || y > ring.maxY) return false;
  let inside = false;
  for (const [a, b] of ring.crossing.get(Math.floor(y / 256)) || []) {
    if (distanceToSegmentSquared(x, y, a, b) < 1e-12) return true;
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function indexedCircleTouches(ring, x, y, radius) {
  const minX = x - radius, minY = y - radius, maxX = x + radius, maxY = y + radius;
  if (maxX < ring.minX || minX > ring.maxX || maxY < ring.minY || minY > ring.maxY) return false;
  for (let cy = Math.floor(minY / 128); cy <= Math.floor(maxY / 128); cy++) {
    for (let cx = Math.floor(minX / 128); cx <= Math.floor(maxX / 128); cx++) {
      for (const [a, b] of ring.nearby.get(`${cx},${cy}`) || []) if (distanceToSegmentSquared(x, y, a, b) < radius * radius) return true;
    }
  }
  return false;
}

function indexedCapsuleTouches(ring, x, y, axis, radius = 8) {
  const minX = Math.min(axis[0][0], axis[1][0]) - radius, maxX = Math.max(axis[0][0], axis[1][0]) + radius;
  const minY = Math.min(axis[0][1], axis[1][1]) - radius, maxY = Math.max(axis[0][1], axis[1][1]) + radius;
  if (maxX < ring.minX || minX > ring.maxX || maxY < ring.minY || minY > ring.maxY) return false;
  for (let cy = Math.floor(minY / 128); cy <= Math.floor(maxY / 128); cy++) {
    for (let cx = Math.floor(minX / 128); cx <= Math.floor(maxX / 128); cx++) {
      for (const [a, b] of ring.nearby.get(`${cx},${cy}`) || []) if (segmentDistanceSquared(axis[0], axis[1], a, b) < radius * radius) return true;
    }
  }
  return false;
}

function circleFitsRegion(region, x, y, radius) {
  return insideIndexedRing(x, y, region.outer) && !indexedCircleTouches(region.outer, x, y, radius) && !region.holes.some((hole) => insideIndexedRing(x, y, hole) || indexedCircleTouches(hole, x, y, radius));
}

function capsuleFitsRegion(region, x, y, axis, radius = 8) {
  if (!insideIndexedRing(x, y, region.outer) || !insideIndexedRing(axis[0][0], axis[0][1], region.outer) || !insideIndexedRing(axis[1][0], axis[1][1], region.outer) || indexedCapsuleTouches(region.outer, x, y, axis, radius)) return false;
  for (const hole of region.holes) if (insideIndexedRing(x, y, hole) || insideIndexedRing(axis[0][0], axis[0][1], hole) || insideIndexedRing(axis[1][0], axis[1][1], hole) || indexedCapsuleTouches(hole, x, y, axis, radius)) return false;
  return true;
}

export function capsuleHitsPolygon(x, y, angle, polygon, holes = [], { radius = 8, halfLength = 7 } = CLASSIC_CAR_BODY) {
  const axis = capsuleAxis(x, y, angle, halfLength);
  if ([[x, y], ...axis].some(([px, py]) => pointInPolygon(px, py, polygon) && !holes.some((hole) => pointInPolygon(px, py, hole)))) return true;
  return capsuleTouchesEdges(axis, polygon, radius) || holes.some((hole) => capsuleTouchesEdges(axis, hole, radius));
}

export function createWorld({ map = 'calvi' } = {}) {
  if (map !== 'calvi') throw new RangeError('Blue Night utilise uniquement la carte réelle de Calvi.');
  const world = createCalviWorld();
  if (!world || world.metadata?.city !== 'Calvi' || world.mapSource !== 'OpenStreetMap' || world.mapStatus !== 'ready') {
    const error = new Error('La carte réelle de Calvi est indisponible ou invalide. Vérifiez les données locales.');
    error.code = 'CALVI_MAP_UNAVAILABLE';
    throw error;
  }
  return world;
}

// The small street graph uses A*; a patrol follows its waypoints rather than
// cutting directly across the solid blocks of houses.
class MinHeap {
  constructor() { this.items = []; }
  push(value) {
    const items = this.items;
    items.push(value);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].cost <= value.cost) break;
      items[i] = items[parent]; i = parent;
    }
    items[i] = value;
  }
  pop() {
    const items = this.items, first = items[0], last = items.pop();
    if (items.length) {
      let i = 0;
      while (i * 2 + 1 < items.length) {
        let child = i * 2 + 1;
        if (child + 1 < items.length && items[child + 1].cost < items[child].cost) child++;
        if (items[child].cost >= last.cost) break;
        items[i] = items[child]; i = child;
      }
      items[i] = last;
    }
    return first;
  }
  get length() { return this.items.length; }
}

export class Game {
  constructor({ seed = 42, onEvent = () => {}, world = null } = {}) {
    this.seed = seed >>> 0; this.initialSeed = this.seed;
    this.onEvent = onEvent; this.id = 0;
    this.worldTemplate = world;
    this.mode = 'title'; this.tutorial = true;
    this.reset();
  }

  random() {
    let s = this.seed += 0x6D2B79F5;
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  }

  emit(name, data = {}) { this.onEvent(name, data); }

  reset() {
    this.world = this.worldTemplate ? structuredClone(this.worldTemplate) : createWorld();
    if (!this.world.terrain) attachTerrain(this.world);
    this.mappedPhysics = this.world.physics?.carShape === 'capsule' || this.world.mapSource === 'OpenStreetMap' && this.world.mapStatus === 'ready';
    this.playerRadius = this.mappedPhysics ? 4 : PLAYER_RADIUS;
    this.navRadius = this.mappedPhysics ? this.world.physics?.navigationRadius || 9 : CAR_RADIUS;
    this.world.physics = this.mappedPhysics ? { ...this.world.physics, carShape: 'capsule', carWidth: 16, carLength: 30, capsuleRadius: 8, capsuleAxisHalfLength: 7, navigationClearance: this.navRadius, playerRadius: 4 } : { carShape: 'circle', carRadius: CAR_RADIUS, playerRadius: PLAYER_RADIUS };
    this.municipalRegions = (this.world.municipalBoundary?.polygons || []).map((polygon) => ({ outer: indexRing(polygon.outer), holes: (polygon.holes || []).map(indexRing) }));
    this.landRegions = (this.world.landPolygons || []).map((polygon) => ({ outer: indexRing(polygon), holes: [] }));
    this.seaRegions = (this.world.seaPolygons || []).map(indexRing);
    attachVegetation(this.world, CALVI_AERIAL_OBJECTS);
    if (!this.world.piers) this.world.piers = this.world.metadata?.city === 'Calvi' && this.world.vegetation.length ? structuredClone(CALVI_AERIAL_OBJECTS.piers || []) : [];
    this.pierIndex = createPierIndex(this.world);
    const vegetationIndexes = createWorldVegetationIndexes(this.world);
    this.vegetationIndex = vegetationIndexes.render;
    this.vegetationCollisionIndex = vegetationIndexes.collision;
    this.vegetationGroundIndex = vegetationIndexes.ground;
    this.people = this.world.scenery.filter((p) => p.kind === 'pedestrian' || p.kind === 'gendarme');
    this.pedestrians = this.people.filter((p) => p.kind === 'pedestrian');
    this.missionTargets = this.world.buildings.filter((b) => b.target);
    this.waterBodies = this.world.scenery.filter((p) => p.kind === 'water' && Number.isFinite(p.w) && Number.isFinite(p.h));
    this.buildingIndex = new Map();
    for (const building of this.world.buildings) {
      for (let cy = Math.floor(building.y / 128); cy <= Math.floor((building.y + building.h) / 128); cy++) {
        for (let cx = Math.floor(building.x / 128); cx <= Math.floor((building.x + building.w) / 128); cx++) {
          const key = `${cx},${cy}`;
          if (!this.buildingIndex.has(key)) this.buildingIndex.set(key, []);
          this.buildingIndex.get(key).push(building);
        }
      }
    }
    const starts = this.world.starts;
    if (!starts?.player || !Number.isFinite(starts.player.x) || !Number.isFinite(starts.player.y)) throw new Error('La carte ne fournit pas de départ jouable.');
    this.player = { dir: -Math.PI / 2, ...starts.player, altitude: 0, walk: 0, vx: 0, vy: 0, invulnerable: 0, plantAnim: 0 };
    initializeParachute(this.player);
    this.carSpatial = null;
    this.cars = structuredClone(starts.cars || []);
    this.vehicleBodies = new Map();
    this.cars.push(...createMobilityVehicles(this.world));
    this.placeAerialOpeningActors();
    const aerialStarter = createAerialStarter(this.world, this.cars);
    if (aerialStarter) this.cars[this.cars.findIndex((car) => car.id === 'car-start')] = aerialStarter;
    const aerial = createAerialVehicles(this.world, this.cars);
    this.cars.push(...aerial.vehicles);
    this.carSpatial = null;
    this.vehicleBodies = new Map(this.cars.filter((car) => Number.isFinite(car.collisionRadius) && Number.isFinite(car.collisionHalfLength)).map((car) => [car.id, { radius: car.collisionRadius, halfLength: car.collisionHalfLength }]));
    this.world.visualMeta ??= {};
    this.world.visualMeta.aerialVehicleMasks = aerial.masks;
    this.world.visualMeta.aerialVehicleCoverage = aerial.coverage;
    for (const vehicle of this.cars) initializeMobility(vehicle);
    this.vehicleId = null;
    this.abandonedAircraft = new Set();
    this.placeSceneryPeople();
    this.bottles = []; this.blasts = []; this.police = [];
    this.particles = []; this.popups = [];
    this.rendezvous = { x: this.player.x, y: this.player.y, radius: 36, ...starts?.rendezvous };
    this.sessionMode ??= 'mission';
    this.elapsed = 0; this.total = DURATION; this.hearts = 3;
    this.score = 0; this.demolished = 0; this.heat = 0;
    this.result = null; this.lastCause = ''; this.plantCooldown = 0;
    this.spawnClock = Infinity; this.crashCooldown = 0; this.shake = 0;
    this.missionComplete = false;
    initCombat(this);
    this.buildNavigation();
    initPolice(this);
  }

  get vehicle() { const index = this.carSpatial, car = index?.array === this.cars && index.length === this.cars.length ? index.byId.get(this.vehicleId)?.car : this.cars.find((car) => car.id === this.vehicleId); return car && !car.destroyed ? car : null; }

  // Source photographs stay in the fleet. Parked observations need no per-frame
  // simulation; collision queries visit only the cells touched by the body.
  ensureCarSpatial() {
    let index = this.carSpatial;
    if (!index || index.array !== this.cars || index.length !== this.cars.length) {
      index = this.carSpatial = { array: this.cars, length: this.cars.length, cells: new Map(), byId: new Map(), dynamic: new Set(), stamp: 0 };
      for (const car of this.cars) {
        const record = { car, keys: [], stamp: -1 };
        index.byId.set(car.id, record);
        if (!car.sourceImage) index.dynamic.add(record);
        this.updateCarSpatial(record, index);
      }
    }
    const driven = index.byId.get(this.vehicleId);
    if (driven) index.dynamic.add(driven);
    for (const record of index.dynamic) if (record.x !== record.car.x || record.y !== record.car.y || record.angle !== record.car.angle) this.updateCarSpatial(record, index);
    return index;
  }

  updateCarSpatial(record, index) {
    const car = record.car, extent = this.mappedPhysics || isMobilityVehicle(car) ? carExtent(car) : CAR_RADIUS;
    const minX = Math.floor((car.x - extent) / 128), maxX = Math.floor((car.x + extent) / 128), minY = Math.floor((car.y - extent) / 128), maxY = Math.floor((car.y + extent) / 128);
    record.x = car.x; record.y = car.y; record.angle = car.angle;
    if (record.minX === minX && record.maxX === maxX && record.minY === minY && record.maxY === maxY) return;
    for (const key of record.keys) { const cell = index.cells.get(key); cell.delete(record); if (!cell.size) index.cells.delete(key); }
    record.keys = []; Object.assign(record, { minX, maxX, minY, maxY });
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const key = `${x},${y}`;
      if (!index.cells.has(key)) index.cells.set(key, new Set());
      index.cells.get(key).add(record); record.keys.push(key);
    }
  }

  *nearbyCars(minX, minY, maxX, maxY) {
    const index = this.ensureCarSpatial(), stamp = ++index.stamp;
    for (let y = Math.floor(minY / 128); y <= Math.floor(maxY / 128); y++) for (let x = Math.floor(minX / 128); x <= Math.floor(maxX / 128); x++) {
      for (const record of index.cells.get(`${x},${y}`) || []) {
        if (record.stamp === stamp) continue;
        record.stamp = stamp; yield record.car;
      }
    }
  }
  get timeLeft() { return this.sessionMode === 'free' ? Infinity : Math.max(0, this.total - this.elapsed); }
  get buildings() { return this.world.buildings; }
  get objective() {
    const remaining = this.missionTargets.filter((b) => !b.destroyed);
    if (!remaining.length) return { name: this.missionComplete ? 'Exploration libre' : 'Rendez-vous au port', ...this.rendezvous, distance: distance(this.player, this.rendezvous), type: this.result?.won || this.missionComplete ? 'complete' : 'escape' };
    const target = remaining.reduce((best, item) => distance(this.player, item.approach) < distance(this.player, best.approach) ? item : best);
    return { name: target.name, ...target.approach, distance: distance(this.player, target.approach), type: 'target', id: target.id, missionId: target.missionId || target.id };
  }

  start({ mode = 'mission' } = {}) {
    this.sessionMode = mode === 'free' ? 'free' : 'mission';
    this.seed = this.initialSeed; this.reset(); this.mode = 'playing';
    this.emit('start', { sessionMode: this.sessionMode });
  }
  dismissTutorial() { this.tutorial = false; }
  pause() {
    if (this.mode !== 'playing') return false;
    this.mode = 'paused'; this.emit('pause'); return true;
  }
  resume() { if (this.mode === 'paused') { this.mode = 'playing'; this.emit('resume'); } }
  active() { return this.mode === 'playing' && !this.tutorial; }
  shoot(options = {}) { return !isPlayerAirborne(this) && shoot(this, options); }
  cycleWeapon() { return cycleWeapon(this); }
  vehicleAction() { return isPlayerAirborne(this) ? this.deployParachute() : mobilityAction(this); }
  deployParachute() { return deployParachute(this); }
  surfaceSlope(x, y) { return terrainGradient(this.world, x, y).slope; }
  groundWalkingFactor(x, y, radius = this.playerRadius) { return vegetationMovementFactor(this.vegetationGroundIndex, x, y, radius); }

  clearBuildingSegment(from, to, radius = this.playerRadius) {
    const length = distance(from, to), steps = Math.max(1, Math.ceil(length / 4));
    for (let i = 0; i <= steps; i++) {
      const x = from.x + (to.x - from.x) * i / steps, y = from.y + (to.y - from.y) * i / steps;
      if (circleTouchesVegetation(this.vegetationCollisionIndex, x, y, radius)) return false;
      for (let cy = Math.floor((y - radius) / 128); cy <= Math.floor((y + radius) / 128); cy++) for (let cx = Math.floor((x - radius) / 128); cx <= Math.floor((x + radius) / 128); cx++) {
        if (this.buildingIndex.get(`${cx},${cy}`)?.some((b) => !b.destroyed && circleHitsBuilding(x, y, radius, b))) return false;
      }
    }
    return true;
  }

  clearVehicleSegment(from, to, radius = this.playerRadius, ignoredCars = null) {
    const a = [from.x, from.y], b = [to.x, to.y];
    for (const car of this.nearbyCars(Math.min(from.x, to.x) - radius, Math.min(from.y, to.y) - radius, Math.max(from.x, to.x) + radius, Math.max(from.y, to.y) + radius)) {
      if (car.destroyed || car.pendingRoadblock || isAirborne(car) || ignoresCar(ignoredCars, car.id)) continue;
      const otherRadius = isMobilityVehicle(car) ? vehicleRadius(car) : this.mappedPhysics ? car.collisionRadius || 8 : CAR_RADIUS;
      const shaft = isMobilityVehicle(car) ? vehicleHalfLength(car) : this.mappedPhysics ? car.collisionHalfLength ?? 7 : 0;
      const extent = otherRadius + shaft + radius;
      if (car.x < Math.min(from.x, to.x) - extent || car.x > Math.max(from.x, to.x) + extent || car.y < Math.min(from.y, to.y) - extent || car.y > Math.max(from.y, to.y) + extent) continue;
      if (segmentDistanceSquared(a, b, ...capsuleAxis(car.x, car.y, car.angle || 0, shaft)) < (radius + otherRadius) ** 2) return false;
    }
    return true;
  }

  canWaterOccupy(x, y, radius = 9, ignoreCar = null, angle = null) {
    const vehicle = typeof ignoreCar === 'string' && this.cars?.find((car) => car.id === ignoreCar), shaft = vehicle ? vehicleHalfLength(vehicle) : 0;
    const heading = Number.isFinite(angle) ? angle : vehicle?.angle || 0;
    const axis = capsuleAxis(x, y, heading, shaft), ex = radius + Math.abs(Math.cos(heading) * shaft), ey = radius + Math.abs(Math.sin(heading) * shaft);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x - ex < 0 || y - ey < 0 || x + ex > this.world.width || y + ey > this.world.height) return false;
    // The sea is navigable beyond the land-only administrative boundary.
    if (this.landRegions.length) {
      if (this.landRegions.some((region) => [[x, y], ...axis].some(([px, py]) => insideIndexedRing(px, py, region.outer)) || indexedCapsuleTouches(region.outer, x, y, axis, radius))) return false;
    } else if (this.seaRegions.length) {
      if (!this.seaRegions.some((ring) => insideIndexedRing(x, y, ring) && !indexedCircleTouches(ring, x, y, radius))) return false;
    } else if (!this.waterBodies.some((p) => x - radius >= p.x && x + radius <= p.x + p.w && y - radius >= p.y && y + radius <= p.y + p.h)) return false;
    if (capsuleTouchesPier(this.pierIndex, axis, radius) || capsuleTouchesVegetation(this.vegetationCollisionIndex, axis, radius)) return false;
    for (let cy = Math.floor((y - ey) / 128); cy <= Math.floor((y + ey) / 128); cy++) for (let cx = Math.floor((x - ex) / 128); cx <= Math.floor((x + ex) / 128); cx++) {
      if (this.buildingIndex.get(`${cx},${cy}`)?.some((b) => !b.destroyed && capsuleHitsPolygon(x, y, heading, b.polygon || rectanglePolygon(b), b.holes || [], { radius, halfLength: shaft }))) return false;
    }
    for (const other of this.nearbyCars(x - ex, y - ey, x + ex, y + ey)) {
      if (other.destroyed || other.pendingRoadblock || isAirborne(other) || ignoresCar(ignoreCar, other.id) || Math.hypot(other.x - x, other.y - y) > radius + shaft + carExtent(other)) continue;
      const otherRadius = isMobilityVehicle(other) ? vehicleRadius(other) : other.collisionRadius || 8, otherShaft = isMobilityVehicle(other) ? vehicleHalfLength(other) : other.collisionHalfLength ?? 7;
      if (segmentDistanceSquared(...axis, ...capsuleAxis(other.x, other.y, other.angle || 0, otherShaft)) < (radius + otherRadius) ** 2) return false;
    }
    return true;
  }

  canBoatOccupy(x, y, radius = 9, ignoreCar = null) { return this.canWaterOccupy(x, y, radius, ignoreCar); }

  canGroundVehicleOccupy(vehicle, x, y, angle = vehicle.angle) {
    return vehicleHalfLength(vehicle) ? this.canCarOccupy(x, y, angle, vehicle.id)
      : this.canOccupy(x, y, vehicleRadius(vehicle), vehicle.id, { allowPiers: false });
  }

  canVehicleOccupy(vehicle, x, y, angle = vehicle.angle) {
    if (!isMobilityVehicle(vehicle)) return this.canCarOccupy(x, y, angle, vehicle.id);
    const radius = vehicleRadius(vehicle);
    if (vehicle.mobilityType === 'boat') return this.canWaterOccupy(x, y, radius, vehicle.id, angle);
    if (vehicle.altitude > 0) {
      const ex = radius + Math.abs(Math.cos(angle) * vehicleHalfLength(vehicle)), ey = radius + Math.abs(Math.sin(angle) * vehicleHalfLength(vehicle));
      if (x - ex < 0 || y - ey < 0 || x + ex > this.world.width || y + ey > this.world.height) return false;
      if (vehicle.altitude < 8 && !this.canGroundVehicleOccupy(vehicle, x, y, angle)) return false;
      for (let cy = Math.floor((y - radius) / 128); cy <= Math.floor((y + radius) / 128); cy++) for (let cx = Math.floor((x - radius) / 128); cx <= Math.floor((x + radius) / 128); cx++) {
        if (this.buildingIndex.get(`${cx},${cy}`)?.some((b) => !b.destroyed && (b.construction?.height || (b.construction?.floors || 2) * 3) + 4 >= vehicle.altitude && circleHitsBuilding(x, y, radius, b))) return false;
      }
      return true;
    }
    return this.canGroundVehicleOccupy(vehicle, x, y, angle);
  }

  canOccupy(x, y, radius = this.playerRadius, ignoreCar = null, { staticOnly = false, allowPiers = radius <= 5 } = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x - radius < 0 || y - radius < 0 || x + radius > this.world.width || y + radius > this.world.height) return false;
    const pier = allowPiers && circleFitsPier(this.pierIndex, x, y, radius);
    if (!pier && this.municipalRegions.length && !this.municipalRegions.some((region) => circleFitsRegion(region, x, y, radius))) return false;
    if (!pier && this.landRegions.length && !this.landRegions.some((region) => circleFitsRegion(region, x, y, radius))) return false;
    if (!pier && !this.world.coastalSeaMask && this.seaRegions.some((ring) => insideIndexedRing(x, y, ring) || indexedCircleTouches(ring, x, y, radius))) return false;
    if (!this.world.landPolygons?.length && !this.world.seaPolygons?.length && this.waterBodies.some((p) => circleHitsRect(x, y, radius, p))) return false;
    if (circleTouchesVegetation(this.vegetationCollisionIndex, x, y, radius)) return false;
    for (let cy = Math.floor((y - radius) / 128); cy <= Math.floor((y + radius) / 128); cy++) {
      for (let cx = Math.floor((x - radius) / 128); cx <= Math.floor((x + radius) / 128); cx++) {
        if (this.buildingIndex.get(`${cx},${cy}`)?.some((b) => !b.destroyed && circleHitsBuilding(x, y, radius, b))) return false;
      }
    }
    if (!staticOnly) for (const car of this.nearbyCars(x - radius, y - radius, x + radius, y + radius)) {
      if (car.destroyed || car.pendingRoadblock || isAirborne(car) || ignoresCar(ignoreCar, car.id)) continue;
      const extent = radius + (this.mappedPhysics || isMobilityVehicle(car) ? carExtent(car) : CAR_RADIUS);
      if (Math.abs(car.x - x) > extent || Math.abs(car.y - y) > extent) continue;
      if (isMobilityVehicle(car)) {
        if (!vehicleHalfLength(car)) { if (Math.hypot(car.x - x, car.y - y) < radius + vehicleRadius(car)) return false; continue; }
        const axis = capsuleAxis(car.x, car.y, car.angle, vehicleHalfLength(car));
        if (distanceToSegmentSquared(x, y, ...axis) < (radius + vehicleRadius(car)) ** 2) return false; continue;
      }
      if (!this.mappedPhysics) { if (Math.hypot(car.x - x, car.y - y) < radius + CAR_RADIUS) return false; continue; }
      const axis = capsuleAxis(car.x, car.y, car.angle, car.collisionHalfLength ?? 7);
      if (distanceToSegmentSquared(x, y, axis[0], axis[1]) < (radius + (car.collisionRadius || 8)) ** 2) return false;
    }
    return true;
  }

  playerAirborneObstacle(x, y, elevation) {
    const radius = this.playerRadius;
    for (let cy = Math.floor((y - radius) / 128); cy <= Math.floor((y + radius) / 128); cy++) {
      for (let cx = Math.floor((x - radius) / 128); cx <= Math.floor((x + radius) / 128); cx++) {
        for (const b of this.buildingIndex.get(`${cx},${cy}`) || []) {
          if (b.destroyed || !circleHitsBuilding(x, y, radius, b)) continue;
          const roof = sampleElevation(this.world, b.x + b.w / 2, b.y + b.h / 2) + (b.construction?.height || (b.construction?.floors || 2) * 3);
          if (elevation <= roof) return { building: b, elevation: roof };
        }
      }
    }
    return null;
  }

  playerLandingCause(x, y) {
    const radius = this.playerRadius;
    if (x - radius < 0 || y - radius < 0 || x + radius > this.world.width || y + radius > this.world.height) return 'boundary';
    const pier = circleFitsPier(this.pierIndex, x, y, radius);
    if (!pier && (this.landRegions.length && !this.landRegions.some((region) => circleFitsRegion(region, x, y, radius))
      || !this.world.coastalSeaMask && this.seaRegions.some((ring) => insideIndexedRing(x, y, ring) || indexedCircleTouches(ring, x, y, radius))
      || !this.world.landPolygons?.length && !this.world.seaPolygons?.length && this.waterBodies.some((p) => circleHitsRect(x, y, radius, p)))) return 'water';
    if (!pier && this.municipalRegions.length && !this.municipalRegions.some((region) => circleFitsRegion(region, x, y, radius))) return 'boundary';
    return 'landing';
  }

  canCarOccupy(x, y, angle, ignoreCar = null, { staticOnly = false, body = null } = {}) {
    if (!this.mappedPhysics) return this.canOccupy(x, y, CAR_RADIUS, ignoreCar, { staticOnly });
    body ||= this.vehicleBodies.get(ignoreCar) || CLASSIC_CAR_BODY;
    const radius = body.radius, halfLength = body.halfLength;
    const axis = capsuleAxis(x, y, angle, halfLength), ex = radius + Math.abs(Math.cos(angle) * halfLength), ey = radius + Math.abs(Math.sin(angle) * halfLength);
    if (x - ex < 0 || y - ey < 0 || x + ex > this.world.width || y + ey > this.world.height) return false;
    if (this.municipalRegions.length && !this.municipalRegions.some((region) => capsuleFitsRegion(region, x, y, axis, radius))) return false;
    if (this.landRegions.length && !this.landRegions.some((region) => capsuleFitsRegion(region, x, y, axis, radius))) return false;
    if (!this.world.coastalSeaMask && this.seaRegions.some((ring) => [[x, y], ...axis].some(([px, py]) => insideIndexedRing(px, py, ring)) || indexedCapsuleTouches(ring, x, y, axis, radius))) return false;
    if (capsuleTouchesVegetation(this.vegetationCollisionIndex, axis, radius)) return false;
    for (let cy = Math.floor((y - ey) / 128); cy <= Math.floor((y + ey) / 128); cy++) for (let cx = Math.floor((x - ex) / 128); cx <= Math.floor((x + ex) / 128); cx++) {
      if (this.buildingIndex.get(`${cx},${cy}`)?.some((b) => !b.destroyed && x + ex >= b.x && x - ex <= b.x + b.w && y + ey >= b.y && y - ey <= b.y + b.h && capsuleHitsPolygon(x, y, angle, b.polygon || rectanglePolygon(b), b.holes || [], body))) return false;
    }
    if (!staticOnly) for (const car of this.nearbyCars(x - ex, y - ey, x + ex, y + ey)) {
      if (car.destroyed || car.pendingRoadblock || isAirborne(car) || ignoresCar(ignoreCar, car.id)) continue;
      if (isMobilityVehicle(car)) {
        const extent = radius + halfLength + vehicleRadius(car) + vehicleHalfLength(car);
        if (Math.abs(car.x - x) > extent || Math.abs(car.y - y) > extent) continue;
        if (segmentDistanceSquared(...axis, ...capsuleAxis(car.x, car.y, car.angle, vehicleHalfLength(car))) < (radius + vehicleRadius(car)) ** 2) return false; continue;
      }
      const extent = radius + halfLength + carExtent(car);
      if (Math.abs(car.x - x) > extent || Math.abs(car.y - y) > extent) continue;
      const other = capsuleAxis(car.x, car.y, car.angle, car.collisionHalfLength ?? 7);
      if (segmentDistanceSquared(axis[0], axis[1], other[0], other[1]) < (radius + (car.collisionRadius || 8)) ** 2) return false;
    }
    return true;
  }

  clearSegment(from, to, radius = this.navRadius, ignoreCar = null, staticOnly = true) {
    if (sweptCircleTouchesVegetation(this.vegetationCollisionIndex, from.x, from.y, to.x, to.y, radius)) return false;
    if (!this.canOccupy(from.x, from.y, radius, ignoreCar, { staticOnly })) return false;
    const length = distance(from, to), steps = Math.max(1, Math.ceil(length / 5));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.canOccupy(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, radius, ignoreCar, { staticOnly })) return false;
    }
    return true;
  }

  interactionTarget() {
    if (isPlayerAirborne(this)) return null;
    if (this.vehicle) {
      if (this.vehicle.mobilityType !== 'boat' || mobilityExitPoint(this, this.vehicle)) return null;
      return this.cars.filter((car) => canTransferBoats(this, this.vehicle, car)).sort((a, b) => distance(a, this.player) - distance(b, this.player))[0] || null;
    }
    const entryDistance = item => distance(item.mobilityType === 'boat' && item.boarding ? item.boarding : item, this.player);
    return this.cars.filter((item) => isMobilityVehicle(item) ? canBoardVehicle(this, item) : !item.destroyed && !item.pendingRoadblock && !item.locked && distance(item, this.player) <= 36 && this.clearSegment(this.player, item, this.playerRadius, item.id, false)).sort((a, b) => entryDistance(a) - entryDistance(b))[0] || null;
  }

  interact() {
    if (!this.active() || isPlayerAirborne(this)) return false;
    const car = this.vehicle;
    if (car) {
      if (isMobilityVehicle(car)) {
        const transfer = this.interactionTarget();
        if (!transfer) return mobilityExit(this, car);
        car.speed = 0; car.vx = 0; car.vy = 0;
        const stolen = !transfer.owned && !transfer.stolen;
        transfer.stolen ||= stolen; transfer.occupied = false; transfer.speed = 0; transfer.vx = 0; transfer.vy = 0;
        this.vehicleId = transfer.id; this.player.x = transfer.x; this.player.y = transfer.y; this.player.altitude = 0;
        if (stolen) reportCrime(this, 'vehicleTheft', { x: transfer.x, y: transfer.y, sourceId: transfer.id });
        this.emit('car', { entered: true, stolen, id: transfer.id, mobilityType: 'boat', transferred: true });
        return true;
      }
      const normal = { x: -Math.sin(car.angle), y: Math.cos(car.angle) };
      const candidates = [
        { x: car.x + normal.x * 28, y: car.y + normal.y * 28 },
        { x: car.x - normal.x * 28, y: car.y - normal.y * 28 },
        { x: car.x - Math.cos(car.angle) * 40, y: car.y - Math.sin(car.angle) * 40 },
        { x: car.x + Math.cos(car.angle) * 40, y: car.y + Math.sin(car.angle) * 40 },
      ].sort((a, b) => distance(a, this.objective) - distance(b, this.objective));
      const exit = candidates.find((p) => this.canOccupy(p.x, p.y));
      if (!exit) { this.emit('notice', { message: 'Pas de place pour sortir : avance un peu.' }); return false; }
      car.speed = 0; car.kind = 'parked';
      this.vehicleId = null; this.player.x = exit.x; this.player.y = exit.y; this.player.vx = 0; this.player.vy = 0;
      this.emit('car', { entered: false }); return true;
    }
    const nearby = this.interactionTarget();
    if (!nearby) { this.emit('notice', { message: 'Approche-toi d’un véhicule ; pour un bateau, utilise le quai.' }); return false; }
    const stolen = !nearby.owned && nearby.id !== 'car-start' && !nearby.stolen;
    nearby.stolen ||= stolen; nearby.occupied = false;
    nearby.lastSafeExit = { x: this.player.x, y: this.player.y };
    this.vehicleId = nearby.id; nearby.kind = 'parked'; nearby.speed = 0;
    this.player.x = nearby.x; this.player.y = nearby.y; this.player.vx = 0; this.player.vy = 0;
    if (stolen) {
      reportCrime(this, 'vehicleTheft', { x: nearby.x, y: nearby.y, sourceId: nearby.id });
      this.popup(nearby.x, nearby.y - 18, isMobilityVehicle(nearby) ? `${MOBILITY[nearby.mobilityType].name.toUpperCase()} VOLÉ !` : 'VOITURE VOLÉE !', '#ffe5a1');
    }
    this.player.altitude = nearby.altitude || 0;
    this.emit('car', { entered: true, stolen, id: nearby.id, mobilityType: nearby.mobilityType }); return true;
  }

  plant() {
    if (!this.active() || isPlayerAirborne(this)) return false;
    if (this.vehicle) { this.emit('notice', { message: 'Descends de voiture pour poser.' }); return false; }
    if (this.plantCooldown > 0) return false;
    if (this.bottles.length >= MAX_BOTTLES) { this.emit('notice', { message: 'Trois bouteilles maximum : attends le prochain BOUM !' }); return false; }
    if (this.bottles.some((b) => distance(b, this.player) < 16)) { this.emit('notice', { message: 'Laisse un peu de place entre les bouteilles.' }); return false; }
    this.bottles.push({ id: ++this.id, x: this.player.x, y: this.player.y, fuse: FUSE_DURATION, maxFuse: FUSE_DURATION });
    this.plantCooldown = .35; this.player.plantAnim = .3;
    this.emit('plant'); this.popup(this.player.x, this.player.y, 'TIC… TAC…', '#b8f0cb'); return true;
  }

  popup(x, y, text, color) { this.popups.push({ x, y, text, color, life: 1.3 }); }
  spark(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = this.random() * Math.PI * 2, speed = 25 + this.random() * 55;
      this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: .4 + this.random() * .4, maxLife: .8, color, size: 2 + Math.floor(this.random() * 2) });
    }
  }

  explode(bottle) {
    this.bottles = this.bottles.filter((b) => b.id !== bottle.id);
    createBlast(this, bottle.x, bottle.y, BLAST_RADIUS, 'blast');
    this.shake = .25; this.spark(bottle.x, bottle.y, '#ffbb6a', 22); this.emit('explosion');
    applyExplosion(this, bottle.x, bottle.y, BLAST_RADIUS, 180, 'blast', { incidentId: `bottle-${bottle.id}` });
    for (const p of this.police) if (!p.dead && distance(p, bottle) <= BLAST_RADIUS + CAR_RADIUS) { p.stun = 2.8; p.speed = 0; }
    // Cartoon props can trigger one another; each keeps a visible short fuse.
    for (const b of this.bottles) if (distance(b, bottle) <= BLAST_RADIUS && b.fuse > .25) b.fuse = .25;
  }

  hurt(cause, { altitude = 0 } = {}) {
    if ((isAirborne(this.vehicle) || isPlayerAirborne(this)) && (cause === 'gendarme' || cause === 'blast' && Math.abs(altitude - this.player.altitude) > 8)) return;
    if (this.player.invulnerable > 0 || this.mode !== 'playing') return;
    this.hearts--; this.player.invulnerable = 2; this.lastCause = cause;
    this.shake = .25; if (this.vehicle) this.vehicle.speed *= .35;
    this.popup(this.player.x, this.player.y - 12, cause === 'fall' ? 'CHUTE !' : cause === 'blast' ? 'TROP PRÈS !' : 'INTERPELLÉ !', '#ffaaaa');
    this.emit('hurt', { cause }); if (this.hearts <= 0) this.finish(false, cause);
  }

  finish(won, cause) {
    if (this.mode === 'result') return;
    this.mode = 'result';
    if (won) this.score += this.hearts * 100 + (Number.isFinite(this.timeLeft) ? Math.floor(this.timeLeft) * 2 : 0);
    this.result = { won, cause, score: this.score, demolished: this.demolished, time: this.elapsed, hearts: this.hearts };
    this.emit(won ? 'win' : 'lose', this.result);
  }

  buildNavigation() {
    this.nav = new Map();
    this.polylineNavigation = this.world.roads.some((road) => Array.isArray(road.points));
    if (this.polylineNavigation) { this.buildPolylineNavigation(); this.indexNavigation(); return; }
    for (let y = NAV_STEP; y < this.world.height; y += NAV_STEP) for (let x = NAV_STEP; x < this.world.width; x += NAV_STEP) {
      if (!this.world.roads.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) || !this.canOccupy(x, y, CAR_RADIUS, null, { staticOnly: true })) continue;
      this.nav.set(`${x},${y}`, { x, y, key: `${x},${y}`, neighbors: [], roadWidth: Math.max(...this.world.roads.filter((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h).map((r) => Math.min(r.w, r.h))) });
    }
    for (const node of this.nav.values()) for (const [dx, dy] of [[NAV_STEP, 0], [-NAV_STEP, 0], [0, NAV_STEP], [0, -NAV_STEP]]) {
      const other = this.nav.get(`${node.x + dx},${node.y + dy}`);
      if (other && this.clearSegment(node, other)) node.neighbors.push(other.key);
    }
    this.indexNavigation();
  }

  buildPolylineNavigation() {
    const addNode = (key, point, roadWidth = 22) => {
      if (!this.canOccupy(point[0], point[1], this.navRadius, null, { staticOnly: true })) return null;
      if (!this.nav.has(key)) this.nav.set(key, { key, x: point[0], y: point[1], neighbors: [], roadWidth });
      else this.nav.get(key).roadWidth = Math.max(this.nav.get(key).roadWidth, roadWidth);
      return this.nav.get(key);
    };
    const connect = (a, b) => {
      if (!a || !b || a === b || !this.clearSegment(a, b)) return;
      if (!a.neighbors.includes(b.key)) a.neighbors.push(b.key);
      if (!b.neighbors.includes(a.key)) b.neighbors.push(a.key);
    };
    for (const [roadIndex, road] of this.world.roads.entries()) {
      if (!road.points || road.drivable === false || road.pedestrian || ['footway', 'path', 'steps', 'pedestrian'].includes(road.type)) continue;
      const roadId = road.id ?? `road-${roadIndex}`;
      const vertexKey = (i) => road.nodeIds?.[i] !== undefined && road.nodeIds[i] !== null ? `source-node:${road.nodeIds[i]}` : `${roadId}:vertex:${i}`;
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1], b = road.points[i];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.max(1, Math.ceil(length / 20));
        let previous = addNode(vertexKey(i - 1), a, road.width);
        for (let step = 1; step <= steps; step++) {
          const point = [a[0] + (b[0] - a[0]) * step / steps, a[1] + (b[1] - a[1]) * step / steps];
          const key = step === steps ? vertexKey(i) : `${roadId}:segment:${i}:sample:${step}`;
          const next = addNode(key, point, road.width);
          connect(previous, next); previous = next;
        }
      }
    }
  }

  indexNavigation() {
    this.navIndex = new Map();
    for (const node of this.nav.values()) {
      const key = `${Math.floor(node.x / 256)},${Math.floor(node.y / 256)}`;
      if (!this.navIndex.has(key)) this.navIndex.set(key, []);
      this.navIndex.get(key).push(node);
    }
    let component = 0;
    for (const origin of this.nav.values()) {
      if (origin.component !== undefined) continue;
      const pending = [origin]; origin.component = component;
      for (let at = 0; at < pending.length; at++) for (const key of pending[at].neighbors) {
        const node = this.nav.get(key);
        if (node && node.component === undefined) { node.component = component; pending.push(node); }
      }
      component++;
    }
  }

  navigationNodesNear(point, radius = 850) {
    const nodes = [];
    for (let y = Math.floor((point.y - radius) / 256); y <= Math.floor((point.y + radius) / 256); y++) {
      for (let x = Math.floor((point.x - radius) / 256); x <= Math.floor((point.x + radius) / 256); x++) {
        for (const node of this.navIndex.get(`${x},${y}`) || []) if (distance(node, point) <= radius) nodes.push(node);
      }
    }
    return nodes;
  }

  nearestNode(point, avoidCars = false, requireConnection = false, ignoredCars = this.vehicleId, clearance = this.navRadius) {
    const checked = new Set();
    for (const radius of [128, 384, 1024, Infinity]) {
      const nodes = Number.isFinite(radius) ? this.navigationNodesNear(point, radius) : [...this.nav.values()];
      const candidates = nodes.filter((node) => !checked.has(node.key)).map((node) => ({ node, length: distance(node, point) })).sort((a, b) => a.length - b.length);
      for (const { node } of candidates) {
        checked.add(node.key);
        if (avoidCars && !this.canOccupy(node.x, node.y, clearance, ignoredCars)) continue;
        if (!requireConnection || this.clearSegment(point, node, clearance, ignoredCars, !avoidCars)) return node;
      }
    }
    return null;
  }

  streetPath(from, to, { ignoreCars = this.vehicleId, maxVisited = Infinity, body = null } = {}) {
    const actor = this.mappedPhysics && (typeof ignoreCars === 'string' ? this.cars.find(car => car.id === ignoreCars) : this.vehicle && ignoresCar(ignoreCars, this.vehicle.id) ? this.vehicle : null);
    body ||= actor ? { radius: isMobilityVehicle(actor) ? vehicleRadius(actor) : actor.collisionRadius || 8, halfLength: isMobilityVehicle(actor) ? vehicleHalfLength(actor) : actor.collisionHalfLength ?? 7 } : { radius: this.navRadius, halfLength: 0 };
    const start = this.nearestNode(from, true, this.polylineNavigation, ignoreCars, body.radius), end = this.nearestNode(to, true, false, ignoreCars, body.radius);
    if (!start || !end) return [];
    const positioned = new Map(), edgeRoutes = new Map();
    const position = (node) => {
      if (positioned.has(node.key)) return positioned.get(node.key);
      let point = node;
      const extent = body.radius + body.halfLength;
      if (!this.canOccupy(node.x, node.y, extent, ignoreCars, { allowPiers: false })) {
        point = null;
        // Parking aisle axes are approximate; the photographic hulls are exact.
        // Keep the source graph, and find a nearby position that can turn safely.
        for (let radius = 4; radius <= 28 && !point; radius += 4) for (let i = 0; i < 16; i++) {
          const x = node.x + Math.cos(i * Math.PI / 8) * radius, y = node.y + Math.sin(i * Math.PI / 8) * radius;
          if (this.canOccupy(x, y, extent, ignoreCars, { allowPiers: false })) { point = { x, y }; break; }
        }
      }
      positioned.set(node.key, point); return point;
    };
    const startPoint = position(start), endPoint = position(end);
    if (!startPoint || !endPoint) return [];
    const open = new MinHeap(), costs = new Map([[start.key, 0]]), parent = new Map();
    const heuristic = (p) => this.polylineNavigation ? distance(p, end) : Math.abs(p.x - end.x) + Math.abs(p.y - end.y);
    open.push({ node: start, cost: heuristic(start), traveled: 0 });
    let visited = 0;
    while (open.length && visited++ < maxVisited) {
      const current = open.pop();
      if (current.traveled > costs.get(current.node.key)) continue;
      if (current.node.key === end.key) {
        const keys = [end.key]; let k = end.key;
        while (parent.has(k)) { k = parent.get(k); keys.push(k); }
        keys.reverse();
        const path = [{ x: startPoint.x, y: startPoint.y }];
        for (const key of keys.slice(1)) path.push(...edgeRoutes.get(key));
        return path;
      }
      for (const neighborKey of current.node.neighbors) {
        const node = this.nav.get(neighborKey);
        // Static clearance was checked when this edge was built. Only parked
        // or moving vehicles can change while A* is running.
        const fromPoint = position(current.node), toPoint = position(node);
        if (!fromPoint || !toPoint) continue;
        const edgeFrom = [fromPoint.x, fromPoint.y], edgeTo = [toPoint.x, toPoint.y];
        const angle = Math.atan2(edgeTo[1] - edgeFrom[1], edgeTo[0] - edgeFrom[0]), dx = Math.cos(angle) * body.halfLength, dy = Math.sin(angle) * body.halfLength;
        const sweptFrom = [edgeFrom[0] - dx, edgeFrom[1] - dy], sweptTo = [edgeTo[0] + dx, edgeTo[1] + dy];
        let obstruction = null;
        for (const car of this.nearbyCars(Math.min(...[sweptFrom[0], sweptTo[0]]) - body.radius, Math.min(sweptFrom[1], sweptTo[1]) - body.radius, Math.max(sweptFrom[0], sweptTo[0]) + body.radius, Math.max(sweptFrom[1], sweptTo[1]) + body.radius)) {
          if (car.destroyed || car.pendingRoadblock || isAirborne(car) || ignoresCar(ignoreCars, car.id)) continue;
          const radius = isMobilityVehicle(car) ? vehicleRadius(car) : this.mappedPhysics ? car.collisionRadius || 8 : CAR_RADIUS;
          const halfLength = isMobilityVehicle(car) ? vehicleHalfLength(car) : this.mappedPhysics ? car.collisionHalfLength ?? 7 : 0;
          if (segmentDistanceSquared(sweptFrom, sweptTo, ...capsuleAxis(car.x, car.y, car.angle || 0, halfLength)) < (body.radius + radius) ** 2) { obstruction = car; break; }
        }
        let route = [toPoint];
        if (obstruction) route = this.vehicleNavigationDetour(fromPoint, toPoint, obstruction, body, ignoreCars);
        else if ((fromPoint !== current.node || toPoint !== node) && !this.clearBodySegment(fromPoint, toPoint, body, ignoreCars)) route = null;
        if (!route) continue;
        let leg = fromPoint, length = 0;
        for (const point of route) { length += distance(leg, point); leg = point; }
        const nextCost = current.traveled + length;
        if (nextCost >= (costs.get(neighborKey) ?? Infinity)) continue;
        costs.set(neighborKey, nextCost); parent.set(neighborKey, current.node.key); edgeRoutes.set(neighborKey, route.map(({ x, y }) => ({ x, y })));
        open.push({ node, traveled: nextCost, cost: nextCost + heuristic(node) });
      }
    }
    return [];
  }

  clearBodySegment(from, to, body, ignoredCars) {
    if (!body.halfLength) return this.clearSegment(from, to, body.radius, ignoredCars, false);
    const length = distance(from, to), steps = Math.max(1, Math.ceil(length / 4)), angle = Math.atan2(to.y - from.y, to.x - from.x);
    for (let i = 0; i <= steps; i++) if (!this.canCarOccupy(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, angle, ignoredCars, { body })) return false;
    return true;
  }

  vehicleNavigationDetour(from, to, car, body, ignoredCars) {
    const radius = isMobilityVehicle(car) ? vehicleRadius(car) : this.mappedPhysics ? car.collisionRadius || 8 : CAR_RADIUS;
    const shaft = isMobilityVehicle(car) ? vehicleHalfLength(car) : this.mappedPhysics ? car.collisionHalfLength ?? 7 : 0;
    const clearance = body.radius + body.halfLength + 2, along = shaft + radius + clearance, side = radius + clearance;
    const c = Math.cos(car.angle || 0), s = Math.sin(car.angle || 0), corners = [];
    for (const a of [-along, along]) for (const b of [-side, side]) {
      const point = { x: car.x + c * a - s * b, y: car.y + s * a + c * b };
      if (this.canOccupy(point.x, point.y, body.radius + body.halfLength, ignoredCars, { allowPiers: false })) corners.push(point);
    }
    let best = null, shortest = Infinity;
    for (let one = 0; one < corners.length; one++) for (let two = -1; two < corners.length; two++) {
      if (one === two) continue;
      const route = two < 0 ? [corners[one], to] : [corners[one], corners[two], to];
      let previous = from, length = 0, clear = true;
      for (const point of route) {
        length += distance(previous, point);
        if (length >= shortest || !this.clearBodySegment(previous, point, body, ignoredCars)) { clear = false; break; }
        previous = point;
      }
      if (clear && length < distance(from, to) + 140) { best = route; shortest = length; }
    }
    return best;
  }

  spawnPolice(options = {}) { return spawnPolice(this, options); }

  canMoveGroundCircle(from, to, radius = this.playerRadius, ignoreCar = null) {
    return !sweptCircleTouchesVegetation(this.vegetationCollisionIndex, from.x, from.y, to.x, to.y, radius)
      && this.canOccupy(to.x, to.y, radius, ignoreCar);
  }

  placeSceneryPeople() {
    for (const person of this.people) {
      if (this.canOccupy(person.x, person.y, 5)) continue;
      const original = { x: person.x, y: person.y };
      let placed = false;
      for (let radius = 4; radius <= 48 && !placed; radius += 4) for (let i = 0; i < 16; i++) {
        const x = original.x + Math.cos(i * Math.PI / 8) * radius, y = original.y + Math.sin(i * Math.PI / 8) * radius;
        if (!this.canOccupy(x, y, 5)) continue;
        person.x = person.homeX = x; person.y = person.homeY = y;
        placed = true; break;
      }
    }
  }

  placeAerialOpeningActors() {
    if (this.world.metadata?.city !== 'Calvi' || !this.world.vegetation.length) return;
    const photos = CALVI_AERIAL_OBJECTS.vehicles.filter((item) => !item.mobilityType || item.mobilityType !== 'boat');
    const fitsPhotos = (x, y, radius, halfLength = 0, angle = 0) => {
      const body = capsuleAxis(x, y, angle, halfLength);
      return photos.every((photo) => {
        const otherRadius = photo.width / 2, otherShaft = Math.max(0, (photo.length - photo.width) / 2);
        if (Math.hypot(photo.x - x, photo.y - y) > radius + halfLength + otherRadius + otherShaft) return true;
        const other = capsuleAxis(photo.x, photo.y, photo.angle, otherShaft);
        return segmentDistanceSquared(body[0], body[1], other[0], other[1]) >= (radius + otherRadius) ** 2;
      });
    };
    const opening = { x: 16533.689, y: 8679.178 };
    if (this.canOccupy(opening.x, opening.y, this.playerRadius, 'car-start') && fitsPhotos(opening.x, opening.y, this.playerRadius)) {
      this.player.x = opening.x; this.player.y = opening.y;
      this.world.starts.player = { ...this.world.starts.player, ...opening };
    }
    const unavailableFictionalCars = new Set();
    for (const vehicle of this.cars) {
      if (vehicle.id === 'car-start' || vehicle.sourceImage || vehicle.mobilityType === 'boat') continue;
      const radius = isMobilityVehicle(vehicle) ? vehicleRadius(vehicle) : vehicle.collisionRadius || 8;
      const shaft = isMobilityVehicle(vehicle) ? 0 : vehicle.collisionHalfLength ?? 7;
      if (fitsPhotos(vehicle.x, vehicle.y, radius, shaft, vehicle.angle)) continue;
      const original = { x: vehicle.x, y: vehicle.y };
      const roadCar = !isMobilityVehicle(vehicle);
      const nearbyRoads = roadCar ? this.world.roads.filter(road => !road.pedestrian && road.type !== 'steps' && Number(road.layer || 0) === 0 && road.tunnel !== 'yes'
        && road.points?.some(([x, y], i, points) => i && distanceToSegmentSquared(original.x, original.y, points[i - 1], [x, y]) < 160 ** 2)) : [];
      const reserved = roadCar ? [this.player, this.world.starts.rendezvous, ...this.missionTargets.flatMap(target => [target.approach, target.parking])].filter(Boolean) : [];
      let placed = false;
      for (let offset = 4; offset <= 96 && !placed; offset += 4) for (let i = 0; i < 24; i++) {
        const x = original.x + Math.cos(i * Math.PI / 12) * offset, y = original.y + Math.sin(i * Math.PI / 12) * offset;
        const parking = vehicle.sourceParkingId && this.world.scenery.find((item) => item.id === vehicle.sourceParkingId && item.polygon);
        if (parking && (!pointInPolygon(x, y, parking.polygon) || touchesPolygonEdge(x, y, radius, parking.polygon) || (parking.holes || []).some((hole) => circleHitsPolygon(x, y, radius, hole)))) continue;
        if (reserved.some(point => Math.hypot(x - point.x, y - point.y) < 80)) continue;
        const axis = capsuleAxis(x, y, vehicle.angle, shaft);
        if (nearbyRoads.some(road => road.points.some((point, i, points) => i && segmentDistanceSquared(...axis, points[i - 1], point) < 30 ** 2))) continue;
        const clear = isMobilityVehicle(vehicle) ? this.canVehicleOccupy(vehicle, x, y) : this.canCarOccupy(x, y, vehicle.angle, vehicle.id);
        if (!clear || !fitsPhotos(x, y, radius, shaft, vehicle.angle)) continue;
        vehicle.x = x; vehicle.y = y; placed = true; break;
      }
      // An invented parked actor must never suppress a real photographed
      // vehicle when its original parking has no remaining safe space.
      if (!placed && roadCar) unavailableFictionalCars.add(vehicle.id);
    }
    if (unavailableFictionalCars.size) {
      this.cars = this.cars.filter(vehicle => !unavailableFictionalCars.has(vehicle.id));
      this.carSpatial = null;
    }
  }

  groundVegetationDetour(person, goal, radius = 5, home = person, homeRadius = 40) {
    if (!this.canOccupy(goal.x, goal.y, radius)) return null;
    if (!sweptCircleTouchesVegetation(this.vegetationCollisionIndex, person.x, person.y, goal.x, goal.y, radius)) return null;
    let best = null, bestDistance = Infinity;
    const margin = 24;
    for (const tree of nearbyVegetation(this.vegetationCollisionIndex, Math.min(person.x, goal.x) - margin, Math.min(person.y, goal.y) - margin, Math.max(person.x, goal.x) + margin, Math.max(person.y, goal.y) + margin)) {
      const around = (tree.solidRadius ?? tree.trunkRadius) + radius + 2;
      const ring = Array.from({ length: 16 }, (_, i) => ({ x: tree.x + Math.cos(i * Math.PI / 8) * around, y: tree.y + Math.sin(i * Math.PI / 8) * around }));
      const points = [person, goal, ...ring], costs = new Float64Array(18).fill(Infinity), previous = new Int8Array(18).fill(-1), used = new Uint8Array(18);
      costs[0] = 0;
      for (let step = 0; step < 18; step++) {
        let at = -1;
        for (let i = 0; i < 18; i++) if (!used[i] && (at < 0 || costs[i] < costs[at])) at = i;
        if (at < 0 || !Number.isFinite(costs[at]) || at === 1) break;
        used[at] = 1;
        for (let next = 1; next < 18; next++) {
          if (used[next] || distance(points[next], home) > homeRadius || !this.clearSegment(points[at], points[next], radius, null, false)) continue;
          const cost = costs[at] + distance(points[at], points[next]);
          if (cost < costs[next]) { costs[next] = cost; previous[next] = at; }
        }
      }
      if (costs[1] < bestDistance) {
        const route = []; let at = 1;
        while (at > 0) { route.push(points[at]); at = previous[at]; }
        bestDistance = costs[1]; best = route.reverse();
      }
    }
    return best;
  }

  moveFoot(dt, input) {
    const p = this.player, length = Math.max(1, Math.hypot(input.x, input.y));
    const gradient = terrainGradient(this.world, p.x, p.y);
    const grade = gradient.x * input.x / length + gradient.y * input.y / length;
    const speed = WALK_SPEED * clamp(1 - grade * 1.3, .65, 1.12) * vegetationMovementFactor(this.vegetationGroundIndex, p.x, p.y, this.playerRadius);
    const vx = input.x / length * speed, vy = input.y / length * speed;
    const changeX = vx - p.vx, changeY = vy - p.vy, change = Math.hypot(changeX, changeY);
    const fraction = change ? Math.min(1, (input.x || input.y ? 1400 : 1900) * dt / change) : 1;
    p.vx += changeX * fraction; p.vy += changeY * fraction;
    const oldX = p.x, oldY = p.y, dx = p.vx * dt, dy = p.vy * dt;
    if (dx && this.canMoveGroundCircle(p, { x: p.x + dx, y: p.y }, this.playerRadius)) p.x += dx; else p.vx = 0;
    if (dy && this.canMoveGroundCircle(p, { x: p.x, y: p.y + dy }, this.playerRadius)) p.y += dy; else p.vy = 0;
    const movedX = p.x - oldX, movedY = p.y - oldY;
    if (movedX || movedY) { p.dir = Math.atan2(movedY, movedX); p.walk += Math.hypot(movedX, movedY) / 5; }
  }

  moveCar(dt, input) {
    const car = this.vehicle, magnitude = Math.min(1, Math.hypot(input.x, input.y));
    let reverse = false, turnFactor = 1;
    if (magnitude > .02) {
      let desired = Math.atan2(input.y, input.x);
      reverse = Math.cos(angleDelta(car.angle, desired)) < -.7;
      if (reverse) desired += Math.PI;
      const difference = angleDelta(car.angle, desired), turnRate = 6;
      turnFactor = clamp(Math.cos(difference), .25, 1);
      const nextAngle = car.angle + clamp(difference, -turnRate * dt, turnRate * dt);
      if (this.canCarOccupy(car.x, car.y, nextAngle, car.id)) car.angle = nextAngle;
      else car.speed *= .7;
    }
    const gradient = terrainGradient(this.world, car.x, car.y);
    const grade = (gradient.x * Math.cos(car.angle) + gradient.y * Math.sin(car.angle)) * (reverse ? -1 : 1);
    const terrainFactor = clamp(1 - grade * .8, .72, 1.12);
    const targetSpeed = input.brake ? 0 : DRIVE_SPEED * magnitude * terrainFactor * turnFactor * (reverse ? -.55 : 1);
    const acceleration = input.brake ? 760 : Math.sign(targetSpeed) !== Math.sign(car.speed) && Math.abs(car.speed) > 8 ? 460 : Math.abs(targetSpeed) > Math.abs(car.speed) ? 310 : 420;
    car.speed += clamp(targetSpeed - car.speed, -acceleration * dt, acceleration * dt);
    const dx = Math.cos(car.angle) * car.speed * dt, dy = Math.sin(car.angle) * car.speed * dt;
    let blocked = false;
    if (this.canCarOccupy(car.x + dx, car.y, car.angle, car.id)) car.x += dx; else blocked = true;
    if (this.canCarOccupy(car.x, car.y + dy, car.angle, car.id)) car.y += dy; else blocked = true;
    if (blocked) {
      car.speed *= .45;
      if (this.crashCooldown <= 0) { this.emit('notice', { message: 'Oups, la carrosserie ! Reprends la rue.' }); this.crashCooldown = 1.2; this.shake = .1; }
    }
    this.player.x = car.x; this.player.y = car.y; this.player.dir = car.angle;
  }

  updateTraffic(dt) {
    for (const car of this.cars) {
      if (car.destroyed || car.kind !== 'traffic' || car.id === this.vehicleId) continue;
      if (car.route?.length > 1) {
        let at = clamp(car.routeIndex ?? 1, 0, car.route.length - 1);
        let [x, y] = car.route[at], d = Math.hypot(x - car.x, y - car.y);
        if (d < 5) {
          car.direction ??= 1;
          if (at + car.direction >= car.route.length || at + car.direction < 0) car.direction *= -1;
          at += car.direction; car.routeIndex = at; [x, y] = car.route[at]; d = Math.hypot(x - car.x, y - car.y);
        }
        const desired = Math.atan2(y - car.y, x - car.x), angle = car.angle + clamp(angleDelta(car.angle, desired), -4 * dt, 4 * dt);
        if (this.canCarOccupy(car.x, car.y, angle, car.id)) car.angle = angle;
        const move = Math.min(d, (car.cruise || 38) * dt), next = { x: car.x + Math.cos(car.angle) * move, y: car.y + Math.sin(car.angle) * move };
        const playerClear = this.vehicleId || isPlayerAirborne(this) || distance(next, this.player) >= 15 + this.playerRadius;
        if (playerClear && this.canCarOccupy(next.x, next.y, car.angle, car.id)) { car.x = next.x; car.y = next.y; car.speed = car.cruise || 38; } else car.speed = 0;
        continue;
      }
      const direction = Math.cos(car.angle) > 0 ? 1 : -1;
      const next = { x: car.x + direction * car.cruise * dt, y: car.y };
      if (next.x < 50 || next.x > this.world.width - 50) { car.angle = direction > 0 ? Math.PI : 0; continue; }
      const playerClear = this.vehicleId || isPlayerAirborne(this) || distance(next, this.player) >= CAR_RADIUS + PLAYER_RADIUS;
      if (playerClear && this.canOccupy(next.x, next.y, CAR_RADIUS, car.id)) { car.x = next.x; car.speed = car.cruise; } else car.speed = 0;
    }
  }

  updatePedestrians(dt) {
    let index = 0;
    for (const p of this.pedestrians) {
      if (p.dead || p.knockedDown) continue;
      index++;
      if (p.motionDirection === undefined) {
        p.homeX ??= p.x; p.homeY ??= p.y;
        p.motionDirection = index % 2 ? 1 : -1;
        p.motionAxis = p.axis || (this.clearSegment({ x: p.x - 18, y: p.y }, { x: p.x + 18, y: p.y }, 5) ? 'horizontal' : 'vertical');
        p.walk = 0;
      }
      p.detourCooldown = Math.max(0, (p.detourCooldown || 0) - dt);
      const speed = (12 + index % 4 * 2) * vegetationMovementFactor(this.vegetationGroundIndex, p.x, p.y, 5), direction = p.motionDirection;
      if (p.detour?.length) {
        const point = p.detour[0], remaining = distance(p, point), step = Math.min(remaining, speed * dt);
        const next = remaining ? { x: p.x + (point.x - p.x) / remaining * step, y: p.y + (point.y - p.y) / remaining * step } : point;
        if (!this.canMoveGroundCircle(p, next, 5)) { p.detour = []; p.motionDirection *= -1; p.detourCooldown = 1; continue; }
        p.dir = Math.atan2(next.y - p.y, next.x - p.x); p.x = next.x; p.y = next.y; p.walk += step / 5;
        if (remaining <= step + .01) p.detour.shift();
        continue;
      }
      const next = { x: p.x + (p.motionAxis === 'horizontal' ? direction * speed * dt : 0), y: p.y + (p.motionAxis === 'vertical' ? direction * speed * dt : 0) };
      if (Math.abs(next.x - p.homeX) > 18 || Math.abs(next.y - p.homeY) > 18) {
        p.motionDirection *= -1; continue;
      }
      if (!this.canMoveGroundCircle(p, next, 5)) {
        const goal = { x: p.homeX + (p.motionAxis === 'horizontal' ? direction * 18 : 0), y: p.homeY + (p.motionAxis === 'vertical' ? direction * 18 : 0) };
        const detour = p.detourCooldown <= 0 && this.groundVegetationDetour(p, goal, 5, { x: p.homeX, y: p.homeY });
        p.detourCooldown = 1;
        if (detour) { p.detour = detour; continue; }
        p.motionDirection *= -1; continue;
      }
      p.x = next.x; p.y = next.y;
      p.dir = p.motionAxis === 'horizontal' ? (direction > 0 ? 0 : Math.PI) : (direction > 0 ? Math.PI / 2 : -Math.PI / 2);
      p.walk += dt * speed / 5;
    }
  }

  updatePolice(dt) { return updatePolice(this, dt); }

  step(dt, input) {
    this.elapsed += dt;
    if (this.sessionMode === 'mission' && this.elapsed >= this.total) { this.elapsed = this.total; this.finish(false, 'time'); return; }
    this.player.invulnerable = Math.max(0, this.player.invulnerable - dt);
    this.player.plantAnim = Math.max(0, this.player.plantAnim - dt);
    this.plantCooldown = Math.max(0, this.plantCooldown - dt);
    this.crashCooldown = Math.max(0, this.crashCooldown - dt); this.shake = Math.max(0, this.shake - dt);
    if (this.vehicle) {
      const previous = { id: this.vehicle.id, x: this.vehicle.x, y: this.vehicle.y, angle: this.vehicle.angle, speed: this.vehicle.speed };
      if (!updateMobility(this, dt, input)) this.moveCar(dt, input);
      if (this.vehicle && !isAirborne(this.vehicle) && this.vehicle.mobilityType !== 'boat') collidePedestrians(this, previous, this.vehicle, dt);
    } else if (!updateParachute(this, dt, input)) this.moveFoot(dt, input);
    if (this.mode !== 'playing') return;
    updateAbandonedAircraft(this, dt);
    this.player.aimAngle = Number.isFinite(input.aimAngle) ? input.aimAngle : this.player.dir;
    this.updateTraffic(dt);
    this.updatePedestrians(dt);
    updateCombat(this, dt);
    if (input.shootHeld) this.shoot({ angle: this.player.aimAngle });
    for (const b of this.bottles) b.fuse -= dt;
    const due = this.bottles.filter((b) => b.fuse <= 0);
    for (const b of due) if (this.bottles.includes(b)) this.explode(b);
    for (const blast of this.blasts) {
      const hitsPlayer = this.mappedPhysics && this.vehicle ? distanceToSegmentSquared(blast.x, blast.y, ...capsuleAxis(this.vehicle.x, this.vehicle.y, this.vehicle.angle, this.vehicle.collisionHalfLength ?? 7)) <= (blast.radius + (this.vehicle.collisionRadius || 8)) ** 2 : distance(blast, this.player) <= blast.radius + (this.vehicle ? CAR_RADIUS : this.playerRadius);
      if (hitsPlayer && Math.abs((blast.altitude || 0) - (this.player.altitude || 0)) <= 8) this.hurt('blast', { altitude: blast.altitude || 0 });
      if (!(blast.altitude > 8)) for (const p of this.police) if (!p.dead && (this.mappedPhysics ? distanceToSegmentSquared(blast.x, blast.y, ...capsuleAxis(p.x, p.y, p.angle)) <= (blast.radius + 8) ** 2 : distance(blast, p) <= blast.radius + CAR_RADIUS)) { p.stun = 2.8; p.speed = 0; }
      blast.life -= dt;
    }
    this.blasts = this.blasts.filter((b) => b.life > 0);
    for (const p of this.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const popup of this.popups) { popup.life -= dt; popup.y -= dt * 10; }
    this.popups = this.popups.filter((p) => p.life > 0);
    if (this.mode !== 'playing') return;
    this.updatePolice(dt);
    if (this.mode === 'playing' && !isPlayerAirborne(this) && !isAirborne(this.vehicle) && !this.missionComplete && this.demolished === 3 && distance(this.player, this.rendezvous) <= this.rendezvous.radius && !this.bottles.length && !this.blasts.length) {
      if (this.sessionMode === 'mission') this.finish(true, 'complete');
      else {
        this.missionComplete = true; this.score += this.hearts * 100;
        this.emit('missionComplete', { score: this.score, demolished: this.demolished, time: this.elapsed, hearts: this.hearts });
        this.popup(this.player.x, this.player.y - 20, 'MISSIONS TERMINÉES !', '#b8f0cb');
      }
    }
  }

  update(dt, input = { x: 0, y: 0 }) {
    if (!this.active()) return;
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, .05);
    if (!dt) return;
    input ??= {};
    input = { x: Number.isFinite(input.x) ? input.x : 0, y: Number.isFinite(input.y) ? input.y : 0, shootHeld: Boolean(input.shootHeld), brake: Boolean(input.brake), aimAngle: Number.isFinite(input.aimAngle) ? input.aimAngle : null };
    const steps = Math.max(1, Math.ceil(dt / (1 / 120))), substep = dt / steps;
    for (let i = 0; i < steps && this.mode === 'playing'; i++) this.step(substep, input);
  }
}
