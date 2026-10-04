import { sampleElevation, terrainGradient } from './terrain.js';
import { drawArcadeActor, drawArcadeCar, photographicVehicleDimensions } from './neon-art.js';
import { drawBloodDecal, drawFire, drawExplosion, drawDestructionDust } from './effects-art.js';
import { osmHeightMeters } from './building-height.js';
import { timeOfDay } from './game-time.js';
import { aerialImagery, imageryStreamReady, imageryManifestMatches } from './imagery-stream.js';
export { imageryStats } from './imagery-stream.js';

export const WIDTH = 330;
export const HEIGHT = 390;

const NIGHT_COLOURS = {
  ink: '#111c2d', road: '#263343', roadDark: '#172333', curb: '#73828c',
  ground: '#495d6b', groundDark: '#364d5c', cream: '#f6dfbb',
  roof: '#895b63', roofLight: '#aa7875', roofDark: '#574555',
  olive: '#46675f', oliveDark: '#263e43', mint: '#63eee0',
  sea: '#123b51', seaDark: '#10283e', seaLight: '#63aaa9',
  orange: '#ffbc7c', police: '#5696bb', navy: '#213752',
};
const DAY_COLOURS = {
  ...NIGHT_COLOURS, ink: '#263234', road: '#555a56', roadDark: '#404741', curb: '#b7b8ab',
  ground: '#9a9a82', groundDark: '#7b856d', cream: '#f0e5c9',
  roof: '#ae7863', roofLight: '#cfab8b', roofDark: '#785f55', olive: '#637955', oliveDark: '#42593f',
  sea: '#2f747b', seaDark: '#285e6c', seaLight: '#b6d7ce', navy: '#395d72',
};
let C = { ...NIGHT_COLOURS }, materialLight = { daylight: 0, night: 1, twilight: 0, sunAngle: -.75 * Math.PI };
function mixColour(a, b, amount) {
  const t = Math.max(0, Math.min(1, amount));
  return '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
}
function surfaceColour(night, day) { return mixColour(night, day, materialLight.daylight); }
export function renderLighting(game) {
  const clock = timeOfDay(game), height = Math.max(0, Math.sin(clock.sunAngle));
  return { ...clock, lamps: clock.night * clock.night, shadowOpacity: .15 + clock.daylight * .15,
    shadowX: clock.daylight > .01 ? -Math.cos(clock.sunAngle) * (.38 + (1 - height) * 1.05) : .65,
    shadowY: clock.daylight > .01 ? .38 + height * .35 : .85 };
}
function setMaterialLight(light) {
  materialLight = light;
  C = Object.fromEntries(Object.keys(NIGHT_COLOURS).map(key => [key, mixColour(NIGHT_COLOURS[key], DAY_COLOURS[key], light.daylight)]));
}
function underMaterialLight(daylight, paint) {
  const previous = materialLight;
  setMaterialLight({ ...previous, daylight, night: 1 - daylight, lamps: (1 - daylight) ** 2 });
  try { return paint(); } finally { setMaterialLight(previous); }
}

// Fine world geometry retains fractional coordinates. The high-density backing
// canvas resolves subpixel metal, masonry and sprite details without changing scale.
const rect = (ctx, x, y, w, h, color) => {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
};
function polygon(ctx, points, color, clip = null) {
  if (points.length < 3) return;
  ctx.save();
  if (clip) { ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.w, clip.h); ctx.clip(); }
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.restore();
}
function ellipse(ctx, x, y, rx, ry, color) {
  if (rx <= 0 || ry <= 0) return;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
}
function line(ctx, x0, y0, x1, y1, color, size = 1) {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = 'butt'; ctx.stroke();
}

const hash = (x, y, salt = 0) => {
  let n = Math.imul(Math.round(x) + salt * 419, 374761393) ^ Math.imul(Math.round(y) + salt * 71, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
let backgroundCache = new WeakMap();
let currentRenderWorld = null;
let roofCache = new Map();
const ROOF_CACHE_BYTES = 16 * 1024 * 1024;
let roofCacheBytes = 0;
const foliageCache = new Map(), FOLIAGE_CACHE_BYTES = 4 * 1024 * 1024;
let foliageBytes = 0;
let waterSurface = null;
const waterSurfaceReady = typeof Image === 'undefined' ? Promise.resolve(false)
  : import('./data/calvi-water-surface.js').then(module => {
    waterSurface = module.CALVI_WATER_SURFACE; return waterSurface?.status === 'ready';
  }).catch(() => false);
let frameDetails = { vegetationVisible: 0, seaRippleCount: 0, aerialMaskCount: 0, maskSignature: '', actorUnderCanopy: 0, actorsInLowVegetation: 0, playerUnderCanopy: false };
export function rendererStats() {
  const ground = backgroundCache.get(currentRenderWorld);
  return Object.freeze({ photoMode: currentRenderWorld ? hasPhotograph(currentRenderWorld) : false,
    groundEntries: ground?.size || 0, groundBytes: ground ? [...ground.values()].reduce((total, entry) => total + imageBytes(entry), 0) : 0,
    maximumGroundBytes: 32 * 1024 * 1024, roofEntries: roofCache.size, roofBytes: roofCacheBytes,
    maximumRoofBytes: ROOF_CACHE_BYTES, foliageEntries: foliageCache.size, foliageBytes,
    maximumFoliageBytes: FOLIAGE_CACHE_BYTES, ...frameDetails,
    visibleVegetation: frameDetails.vegetationVisible, seaRippleLines: frameDetails.seaRippleCount,
    appliedVehicleMasks: frameDetails.aerialMaskCount, waterMaskReady: waterSurface?.status === 'ready' });
}
// Original local art and verified IGN ground detail retain procedural fallbacks.
// Loading invalidates static caches; both decoders belong to artReady.
let textureAtlas = null;
let atlasLoaded = false;
let orthophoto = null, imageryProvenance = null;
const atlasReady = typeof Image === 'undefined' ? Promise.resolve(false) : new Promise(resolve => {
  const atlas = new Image();
  atlas.onload = async () => {
    try { await atlas.decode(); } catch { /* onload still provides a usable image */ }
    textureAtlas = atlas;
    atlasLoaded = atlas.naturalWidth === 1254 && atlas.naturalHeight === 1254;
    backgroundCache = new WeakMap(); roofCache = new Map(); roofCacheBytes = 0;
    resolve(atlasLoaded);
  };
  atlas.onerror = () => resolve(false);
  atlas.src = new URL('./assets/corsica-textures.png', import.meta.url).href;
});
const imageryReady = typeof Image === 'undefined' ? Promise.resolve(false) : (async () => {
  try {
    if (await imageryStreamReady) { backgroundCache = new WeakMap(); return true; }
    const response = await fetch(new URL('./data/calvi-imagery-provenance.json', import.meta.url));
    if (!response.ok) return false;
    const provenance = await response.json();
    if (provenance.status !== 'ready' || provenance.asset !== 'assets/calvi-orthophoto.jpg'
      || !Number.isInteger(provenance.image?.width) || provenance.image.width <= 0
      || !Number.isInteger(provenance.image?.height) || provenance.image.height <= 0) return false;
    return await new Promise(resolve => {
      const image = new Image();
      image.onload = async () => {
        try { await image.decode(); } catch { /* A loaded image remains usable. */ }
        if (image.naturalWidth !== provenance.image.width || image.naturalHeight !== provenance.image.height) { resolve(false); return; }
        orthophoto = image; imageryProvenance = provenance; backgroundCache = new WeakMap(); resolve(true);
      };
      image.onerror = () => resolve(false);
      image.src = new URL('./assets/calvi-orthophoto.jpg', import.meta.url).href;
    });
  } catch { return false; }
})();
export const artReady = Promise.all([atlasReady, imageryReady, waterSurfaceReady]).then(([atlas, photo]) => atlas || photo);
function textureFill(ctx, column, row, x, y, w, h, size = 64, opacity = 1) {
  if (!atlasLoaded || w <= 0 || h <= 0) return;
  ctx.save(); ctx.imageSmoothingEnabled = true;
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.globalAlpha *= opacity;
  for (let yy = Math.floor(y / size) * size; yy < y + h; yy += size) {
    for (let xx = Math.floor(x / size) * size; xx < x + w; xx += size) {
      ctx.drawImage(textureAtlas, column * 418, row * 418, 418, 418, xx, yy, size, size);
    }
  }
  ctx.restore();
}
function leafyTexture(ctx, x, y, r) {
  if (!atlasLoaded) return;
  ctx.save(); ctx.beginPath();
  for (let dy = -r + 2; dy <= r - 2; dy++) {
    const half = Math.floor(r * Math.sqrt(Math.max(0, 1 - dy * dy / ((r - 1) * (r - 1)))));
    const edge = Math.abs(dy) % 3 === 0 ? 1 : 0;
    ctx.rect(Math.round(x - half + edge), Math.round(y + dy), Math.max(1, half * 2 + 1 - edge), 1);
  }
  ctx.clip();
  textureFill(ctx, 2, 2, x - r, y - r, r * 2 + 1, r * 2 + 1, 64, 0.12);
  ctx.restore();
}

function canvasFor(ctx, width, height, density = 1) {
  width = Math.ceil(width * density); height = Math.ceil(height * density);
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (ctx.canvas?.ownerDocument) {
    const canvas = ctx.canvas.ownerDocument.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  }
  return null;
}

const ELEVATION_SCALE = 1.4;
const cameraState = new WeakMap();
const liftAt = (world, x, y) => Math.max(0, sampleElevation(world, x, y)) * ELEVATION_SCALE;
export const vehicleVisualLift = vehicle => ['helicopter', 'plane'].includes(vehicle?.mobilityType)
  && Number.isFinite(vehicle.altitude) ? Math.max(0, vehicle.altitude) * ELEVATION_SCALE : 0;
const maximumLiftCache = new WeakMap();
function maximumLift(world) {
  const data = world?.terrain;
  if (data?.status !== 'ready') return 0;
  const reported = data.maxElevation ?? data.metadata?.maximum;
  if (Number.isFinite(reported)) return Math.max(0, reported) * ELEVATION_SCALE;
  if (!maximumLiftCache.has(data)) maximumLiftCache.set(data, (data.values || []).reduce((max, value) => Math.max(max, value), 0) * ELEVATION_SCALE);
  return maximumLiftCache.get(data);
}
const terrainLiftCache = new WeakMap();
const coastRowsCache = new WeakMap();
function indexedRings(items) {
  return rings(items).map(ring => {
    const rows = new Map();
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      if (a[1] === b[1]) continue;
      for (let row = Math.floor(Math.min(a[1], b[1]) / 128); row <= Math.floor(Math.max(a[1], b[1]) / 128); row++) {
        if (!rows.has(row)) rows.set(row, []);
        rows.get(row).push([a, b]);
      }
    }
    return rows;
  });
}
function coastRows(world) {
  let index = coastRowsCache.get(world);
  if (!index) { index = { land: indexedRings(world.landPolygons), sea: indexedRings(world.seaPolygons) }; coastRowsCache.set(world, index); }
  return index;
}
function inIndexedRings(rows, x, y) {
  return rows.some(ring => {
    let inside = false;
    for (const [a, b] of ring.get(Math.floor(y / 128)) || [])
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    return inside;
  });
}
export function photographicSeaAt(world, x, y) {
  const rows = coastRows(world);
  return inIndexedRings(rows.sea, x, y) && !inIndexedRings(rows.land, x, y);
}
const waterSurfaceIndexCache = new WeakMap();
export function waterSurfaceContains(world, x, y, surface = waterSurface) {
  const metadata = surface?.metadata, bounds = world?.metadata?.bounds;
  if (surface?.status !== 'ready' || !bounds || Math.abs(world.width - metadata?.worldWidth) > .05
    || Math.abs(world.height - metadata?.worldHeight) > .05
    || !['west', 'south', 'east', 'north'].every(key => Number.isFinite(metadata?.boundsWGS84?.[key]) && Math.abs(bounds[key] - metadata.boundsWGS84[key]) < 1e-7)) return false;
  let index = waterSurfaceIndexCache.get(surface);
  if (!index) {
    index = new Map();
    for (const tile of surface.tiles || []) {
      const area = tile.boundsWorld, cells = tile.columns * tile.rows;
      if (!area || ![area.x, area.y, area.w, area.h].every(Number.isFinite) || area.w <= 0 || area.h <= 0
        || !Number.isInteger(tile.columns) || !Number.isInteger(tile.rows) || cells <= 0 || cells > 4096
        || typeof tile.bitsHex !== 'string' || tile.bitsHex.length !== Math.ceil(cells / 8) * 2 || !/^[0-9a-f]+$/i.test(tile.bitsHex)) continue;
      const entry = { ...tile, bytes: Uint8Array.from(tile.bitsHex.match(/../g), byte => parseInt(byte, 16)) };
      for (let row = Math.floor(area.y / 1024); row <= Math.floor((area.y + area.h - .0001) / 1024); row++)
        for (let column = Math.floor(area.x / 1024); column <= Math.floor((area.x + area.w - .0001) / 1024); column++) {
          const key = `${column},${row}`;
          if (!index.has(key)) index.set(key, []);
          index.get(key).push(entry);
        }
    }
    for (const entries of index.values()) entries.sort((a, b) => (b.lod || 0) - (a.lod || 0));
    waterSurfaceIndexCache.set(surface, index);
  }
  for (const tile of index.get(`${Math.floor(x / 1024)},${Math.floor(y / 1024)}`) || []) {
    const area = tile.boundsWorld;
    if (x < area.x || y < area.y || x >= area.x + area.w || y >= area.y + area.h) continue;
    const column = Math.floor((x - area.x) / area.w * tile.columns), row = Math.floor((y - area.y) / area.h * tile.rows);
    const bit = row * tile.columns + column;
    // An unclassified fine pixel refuses the ripple. Never fall back to a
    // coarse blue cell which might have blurred a white photographed boat.
    return !!(tile.bytes[bit >> 3] & (1 << (7 - (bit & 7))));
  }
  return false;
}
function groundLiftAt(world, x, y) {
  if (world.terrain?.status !== 'ready') return 0;
  let cache = terrainLiftCache.get(world);
  if (!cache) { cache = new Map(); terrainLiftCache.set(world, cache); }
  const key = `${x},${y}`;
  if (cache.has(key)) return cache.get(key);
  const rows = coastRows(world);
  const isLand = (!rows.land.length || inIndexedRings(rows.land, x, y)) && !inIndexedRings(rows.sea, x, y);
  const value = isLand ? liftAt(world, x, y) : 0;
  cache.set(key, value);
  while (cache.size > 8192) cache.delete(cache.keys().next().value);
  return value;
}
export function cameraFor(game, canvas = null) {
  const previous = cameraState.get(game);
  const width = canvas?.viewWidth || canvas?.width || previous?.width || WIDTH, height = canvas?.viewHeight || canvas?.height || previous?.height || HEIGHT;
  const focus = game.vehicle || game.player || { x: width / 2, y: height / 2 };
  const world = game.world || {};
  const look = game.vehicle ? clamp(game.vehicle.speed || 0, -55, 150) * 0.3 : 0;
  const airLift = vehicleVisualLift(game.vehicle), maxLift = maximumLift(world) + airLift;
  const targetX = clamp(focus.x + Math.cos(focus.angle || 0) * look - width / 2, 0, Math.max(0, (world.width || 1500) - width));
  const targetY = clamp(focus.y - liftAt(world, focus.x, focus.y) - airLift + Math.sin(focus.angle || 0) * look - height / 2, -maxLift, Math.max(-maxLift, (world.height || 1400) - height));
  const elapsed = Number.isFinite(game.elapsed) ? game.elapsed : 0;
  const changed = !previous || previous.width !== width || previous.height !== height || previous.world !== world || elapsed < previous.elapsed;
  const dt = previous ? Math.max(0, Math.min(0.12, elapsed - previous.elapsed)) : 0;
  const distant = previous && Math.hypot(targetX - previous.x, targetY - previous.y) > Math.max(width, height);
  const ease = changed || distant ? 1 : 1 - Math.exp(-dt * 8);
  const camera = { x: changed ? targetX : previous.x + (targetX - previous.x) * ease,
    y: changed ? targetY : previous.y + (targetY - previous.y) * ease, width, height, elapsed };
  Object.defineProperty(camera, 'world', { value: world });
  cameraState.set(game, camera);
  return camera;
}
export function worldToScreen(game, x, y, canvas = null) {
  const camera = cameraFor(game, canvas);
  return { x: x - camera.x, y: y - liftAt(game.world, x, y) - camera.y };
}
export function screenToWorld(game, x, y, canvas = null) {
  const camera = cameraFor(game, canvas), wx = x + camera.x;
  const flatY = y + camera.y;
  let wy = flatY;
  for (let i = 0; i < 28; i++) {
    const next = flatY + liftAt(game.world, wx, wy);
    if (Math.abs(next - wy) < 0.0001) { wy = next; break; }
    wy = next;
  }
  // Detailed LiDAR cliff cells may converge slowly. Bracket the physical
  // height range rather than changing terrain or accepting a drifting aim.
  if (Math.abs(wy - liftAt(game.world, wx, wy) - flatY) > .0001) {
    let low = flatY, high = flatY + maximumLift(game.world) + .01;
    for (let i = 0; i < 32; i++) {
      const middle = (low + high) / 2;
      if (middle - liftAt(game.world, wx, middle) > flatY) high = middle; else low = middle;
    }
    wy = (low + high) / 2;
  }
  return { x: wx, y: wy };
}
// Request only the actual ground seen by the camera. Using the commune's
// highest mountain as a photo margin wastes the four fine decoded images.
export function photoViewBounds(game, canvas = null) {
  const camera = cameraFor(game, canvas), points = [];
  for (const fx of [0, .25, .5, .75, 1]) for (const fy of [0, .5, 1])
    points.push(screenToWorld(game, camera.width * fx, camera.height * fy, canvas));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  return { x: camera.x - 4, y: minY - 4, w: camera.width + 8, h: maxY - minY + 8 };
}
function visible(object, camera, margin = 20) {
  if (object.x + (object.w || margin) < camera.x - margin || object.x > camera.x + camera.width + margin
    || object.y + (object.h || margin) < camera.y - margin
    || object.y > camera.y + camera.height + maximumLift(camera.world) + vehicleVisualLift(object) + margin) return false;
  const y = object.y - liftAt(camera.world, object.x + (object.w || 0) / 2, object.y + (object.h || 0) / 2) - vehicleVisualLift(object);
  return object.x + (object.w || margin) >= camera.x - margin && object.x <= camera.x + camera.width + margin &&
    y + (object.h || margin) >= camera.y - margin && y <= camera.y + camera.height + margin;
}
function label(ctx, text, x, y, color = C.cream, size = 7) {
  ctx.font = `bold ${size}px monospace`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
function pointsAt(object, points) {
  const a = object.angle ?? object.dir ?? 0, co = Math.cos(a), si = Math.sin(a);
  return points.map(([x, y]) => [object.x + x * co - y * si, object.y + x * si + y * co]);
}
function boxAt(ctx, object, x, y, w, h, color) {
  polygon(ctx, pointsAt(object, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]), color);
}

function rings(items) {
  if (!Array.isArray(items)) return [];
  if (Array.isArray(items[0]) && typeof items[0][0] === 'number') return [items];
  return items.flatMap(item => {
    const points = item?.points || item?.polygon || item;
    return Array.isArray(points?.[0]) && typeof points[0][0] === 'number' ? [points] :
      Array.isArray(points) ? points.filter(r => Array.isArray(r?.[0]) && typeof r[0][0] === 'number') : [];
  });
}
function overlapsView(a, b, margin = 0) {
  return !b || a.x + a.w + margin >= b.x && a.y + a.h + margin >= b.y && a.x - margin <= b.x + b.w && a.y - margin <= b.y + b.h;
}
function pointsBounds(points, pad = 0) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) - x + pad, h: Math.max(...ys) - y + pad };
}
const renderIndexCache = new WeakMap();
function renderIndex(world) {
  let index = renderIndexCache.get(world);
  if (index) return index;
  const size = 512, buildings = new Map(), scenery = new Map(), vegetation = new Map(), masks = new Map(), people = [], targets = [];
  const extents = new WeakMap();
  const insert = (table, object, bounds = object) => {
    bounds = { x: bounds.x, y: bounds.y, w: bounds.w || 1, h: bounds.h || 1 };
    extents.set(object, bounds);
    const left = Math.floor(bounds.x / size), top = Math.floor(bounds.y / size);
    const right = Math.floor((bounds.x + (bounds.w || 1)) / size), bottom = Math.floor((bounds.y + (bounds.h || 1)) / size);
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const key = `${x},${y}`;
      if (!table.has(key)) table.set(key, []);
      table.get(key).push(object);
    }
  };
  for (const building of world.buildings || []) { insert(buildings, building); if (building.target) targets.push(building); }
  for (const item of world.scenery || []) {
    if (item.kind === 'pedestrian' || item.kind === 'gendarme') people.push(item);
    else if (!item.polygon) insert(scenery, item);
  }
  for (const tree of world.vegetation || []) {
    const radius = Math.max(2, tree.radius || 8), lift = Math.max(0, tree.heightMeters || 0) * ELEVATION_SCALE;
    insert(vegetation, tree, { x: tree.x - radius, y: tree.y - radius - lift, w: radius * 2, h: radius * 2 + lift });
  }
  for (const mask of world.visualMeta?.aerialVehicleMasks || []) insert(masks, mask);
  index = { size, buildings, scenery, vegetation, masks, people, targets, extents,
    sourcedVegetation: (world.vegetation || []).some(tree => tree.source || tree.sourcePlacement) };
  renderIndexCache.set(world, index); return index;
}
export function renderCandidates(world, bounds, category = 'buildings') {
  const index = renderIndex(world), table = index[category];
  if (!(table instanceof Map)) return [];
  const selected = new Set();
  for (let y = Math.floor(bounds.y / index.size); y <= Math.floor((bounds.y + bounds.h) / index.size); y++)
    for (let x = Math.floor(bounds.x / index.size); x <= Math.floor((bounds.x + bounds.w) / index.size); x++)
      for (const item of table.get(`${x},${y}`) || []) if (overlapsView(index.extents.get(item) || { x: item.x, y: item.y, w: item.w || 1, h: item.h || 1 }, bounds)) selected.add(item);
  return [...selected];
}
export function imageryMatches(world, provenance) {
  const source = provenance?.georeferencing, a = world?.metadata?.bounds, b = provenance?.boundsWGS84;
  return provenance?.status === 'ready' && world?.metadata?.city === 'Calvi'
    && Number.isFinite(source?.worldWidth) && Number.isFinite(source?.worldHeight)
    && Math.abs(world.width - source.worldWidth) < .05 && Math.abs(world.height - source.worldHeight) < .05
    && !!a && !!b && ['west', 'south', 'east', 'north'].every(key => Number.isFinite(a[key]) && Number.isFinite(b[key]) && Math.abs(a[key] - b[key]) < 1e-7);
}
function hasPhotograph(world) {
  return !!aerialImagery.overviewImage && imageryManifestMatches(world, aerialImagery.manifest)
    || !!orthophoto && imageryMatches(world, imageryProvenance);
}
function drawPhotograph(ctx, world, bounds) {
  if (!aerialImagery.drawOverview(ctx, world, bounds) && orthophoto && imageryMatches(world, imageryProvenance)) {
    const x = Math.max(0, bounds.x), y = Math.max(0, bounds.y);
    const w = Math.min(world.width, bounds.x + bounds.w) - x, h = Math.min(world.height, bounds.y + bounds.h) - y;
    if (w > 0 && h > 0) ctx.drawImage(orthophoto, x / world.width * orthophoto.width, y / world.height * orthophoto.height,
      w / world.width * orthophoto.width, h / world.height * orthophoto.height, x, y, w, h);
  }
  aerialImagery.draw(ctx, world, bounds);
}
function photographicGround(ctx, world, bounds) {
  if (!hasPhotograph(world)) return false;
  ctx.save(); ctx.imageSmoothingEnabled = true;
  drawPhotograph(ctx, world, bounds);
  // Only accepted annotations are retouched, in the ground material itself.
  // The pavement patch persists when its interactive vehicle drives away.
  for (const mask of renderCandidates(world, bounds, 'masks')) {
    if (!Array.isArray(mask.polygon) || mask.polygon.length < 3) continue;
    ctx.save(); path(ctx, mask.polygon); ctx.clip();
    rect(ctx, mask.x, mask.y, mask.w, mask.h, mask.groundColor || '#6e7068');
    const source = mask.groundPatch?.sourceBoundsWorld;
    if (source && [source.x, source.y, source.w, source.h].every(Number.isFinite) && source.w > 0 && source.h > 0) {
      ctx.translate(mask.x, mask.y); ctx.scale(mask.w / source.w, mask.h / source.h); ctx.translate(-source.x, -source.y);
      drawPhotograph(ctx, world, source);
    }
    ctx.restore();
  }
  // Exposure belongs to the photographic material; actors and local lights
  // retain their own illumination rather than receiving a screen-wide filter.
  if (materialLight.night > .001) {
    ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = materialLight.night * .74;
    rect(ctx, bounds.x, bounds.y, bounds.w, bounds.h, '#244565');
  }
  ctx.restore();
  return true;
}
function importedGround(ctx, world, bounds) {
  rect(ctx, bounds.x, bounds.y, bounds.w, bounds.h, C.seaDark);
  textureFill(ctx, 2, 1, bounds.x, bounds.y, bounds.w, bounds.h, 96, 0.065);
  const land = rings(world.landPolygons);
  for (const ring of land) {
    if (!overlapsView(pointsBounds(ring), bounds)) continue;
    polygon(ctx, ring, C.ground, bounds);
    ctx.save(); path(ctx, ring); ctx.clip();
    textureFill(ctx, 0, 0, bounds.x, bounds.y, bounds.w, bounds.h, 96, 0.09); ctx.restore();
  }
  for (const ring of rings(world.seaPolygons)) {
    if (!overlapsView(pointsBounds(ring), bounds)) continue;
    polygon(ctx, ring, C.sea, bounds);
    ctx.save(); path(ctx, ring); ctx.clip();
    textureFill(ctx, 2, 1, bounds.x, bounds.y, bounds.w, bounds.h, 96, 0.075); ctx.restore();
  }
}
const roadGeometryCache = new WeakMap();
function roadGeometry(world) {
  let cached = roadGeometryCache.get(world);
  if (cached) return cached;
  const roads = (world.roads || []).map((road, i) => {
    const points = road.points || (road.axis === 'vertical' ? [[road.x + road.w / 2, road.y], [road.x + road.w / 2, road.y + road.h]] :
      [[road.x, road.y + road.h / 2], [road.x + road.w, road.y + road.h / 2]]);
    const width = Math.max(4, road.width || (road.axis === 'vertical' ? road.w : road.h) || 20);
    const foot = road.pedestrian || ['pedestrian', 'footway', 'path', 'steps', 'cycleway'].includes(road.type);
    let length = 0;
    const segments = points.slice(1).map((b, index) => {
      const a = points[index], dx = b[0] - a[0], dy = b[1] - a[1], size = Math.hypot(dx, dy);
      const segment = { a, b, dx, dy, size, start: length }; length += size; return segment;
    });
    return { ...road, i, points, width, foot, length, segments, bounds: pointsBounds(points, width + 8) };
  }).sort((a, b) => Number(b.foot) - Number(a.foot));
  const nodes = new Map();
  for (const road of roads) {
    if (road.foot) continue;
    road.points.forEach((p, i) => {
      const key = road.nodeIds?.[i] || `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
      let node = nodes.get(key);
      if (!node) nodes.set(key, node = { x: p[0], y: p[1], width: road.width, branches: [] });
      node.width = Math.max(node.width, road.width);
      for (const j of [i - 1, i + 1]) {
        const q = road.points[j]; if (!q) continue;
        const angle = Math.atan2(q[1] - p[1], q[0] - p[0]);
        if (!node.branches.some(branch => Math.abs(Math.atan2(Math.sin(branch.angle - angle), Math.cos(branch.angle - angle))) < 0.2))
          node.branches.push({ angle, width: road.width, length: Math.hypot(q[0] - p[0], q[1] - p[1]) });
      }
    });
  }
  cached = { roads, junctions: [...nodes.values()].filter(node => node.branches.length >= 3 && node.width >= 26) };
  roadGeometryCache.set(world, cached); return cached;
}
function strokeRoad(ctx, road, width, color) {
  ctx.beginPath();
  road.points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.lineWidth = width; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
}
function roadPoint(road, distance) {
  const segment = road.segments.find(s => s.size && distance <= s.start + s.size) || road.segments.at(-1);
  if (!segment?.size) return null;
  const f = clamp((distance - segment.start) / segment.size, 0, 1);
  return { x: segment.a[0] + segment.dx * f, y: segment.a[1] + segment.dy * f,
    angle: Math.atan2(segment.dy, segment.dx) };
}
function roadTexture(ctx, road, bounds) {
  const region = { x: Math.max(road.bounds.x, bounds.x), y: Math.max(road.bounds.y, bounds.y),
    w: Math.min(road.bounds.x + road.bounds.w, bounds.x + bounds.w) - Math.max(road.bounds.x, bounds.x),
    h: Math.min(road.bounds.y + road.bounds.h, bounds.y + bounds.h) - Math.max(road.bounds.y, bounds.y) };
  if (region.w <= 0 || region.h <= 0) return;
  ctx.save(); ctx.beginPath();
  for (const segment of road.segments) {
    if (!segment.size) continue;
    const nx = -segment.dy / segment.size * road.width / 2, ny = segment.dx / segment.size * road.width / 2;
    ctx.moveTo(segment.a[0] + nx, segment.a[1] + ny); ctx.lineTo(segment.b[0] + nx, segment.b[1] + ny);
    ctx.lineTo(segment.b[0] - nx, segment.b[1] - ny); ctx.lineTo(segment.a[0] - nx, segment.a[1] - ny); ctx.closePath();
  }
  ctx.clip(); textureFill(ctx, road.foot ? 0 : 2, 0, region.x, region.y, region.w, region.h, 96, road.foot ? 0.075 : 0.055);
  // Narrow old-town lanes receive setts, while asphalt stays a continuous neutral surface.
  if (road.foot) for (let y = Math.floor(region.y / 3.2) * 3.2; y < region.y + region.h; y += 3.2) {
    for (let x = Math.floor(region.x / 5.5) * 5.5 + (Math.round(y / 3.2) % 2) * 2.7; x < region.x + region.w; x += 5.5) {
      rect(ctx, x, y, 4.6, .45, '#7b8a94'); rect(ctx, x, y + .5, .35, 2.1, '#3f5665');
    }
  }
  if (!road.foot) {
    ctx.globalAlpha = .13;
    for (let y = Math.floor(region.y / 4) * 4; y < region.y + region.h; y += 4)
      for (let x = Math.floor(region.x / 4) * 4; x < region.x + region.w; x += 4) {
        if (hash(x, y, 790) < .68) continue;
        rect(ctx, x + hash(x, y, 791) * 2, y + hash(x, y, 792) * 2, .55, .45, '#8a9fa2');
      }
    ctx.globalAlpha = 1;
    for (let distance = 38; distance < road.length - 22; distance += 111) {
      const p = roadPoint(road, distance); if (!p || !overlapsView({ x: p.x, y: p.y, w: 20, h: 20 }, bounds, 22)) continue;
      const patch = { ...p, x: p.x - Math.sin(p.angle) * road.width * .16, y: p.y + Math.cos(p.angle) * road.width * .16 };
      ctx.globalAlpha = .28; boxAt(ctx, patch, -8, -4, 17, 8, '#192c3b');
      ctx.globalAlpha = .21; boxAt(ctx, patch, -7.5, -3.5, 16, .45, '#687d84');
      line(ctx, patch.x - 2, patch.y - 4, patch.x + 1, patch.y + 1, '#0c2334', .35);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
  if (road.type === 'steps') for (let distance = 2; distance < road.length - 2; distance += 5) {
    const point = roadPoint(road, distance); if (!point || !overlapsView({ x: point.x, y: point.y, w: 1, h: 1 }, bounds, 8)) continue;
    boxAt(ctx, point, -1, -road.width / 2 + 1, 1, road.width - 2, '#817e66');
    boxAt(ctx, point, 0, -road.width / 2 + 1, 1, road.width - 2, '#dfd4af');
  }
}

function ground(ctx, world, bounds = null) {
  const w = world.width || 1500, h = world.height || 1400;
  bounds ||= { x: 0, y: 0, w, h };
  if (rings(world.landPolygons).length) { importedGround(ctx, world, bounds); return; }
  rect(ctx, 0, 0, w, h, C.ground);
  // Moss and old limestone are flat, walkable ground textures, not obstacles.
  polygon(ctx, [[1000, 0], [w, 0], [w, h], [1080, h], [1010, 1120], [1090, 760], [1020, 420]], '#31544d');
  rect(ctx, 0, h - 410, 1000, 410, '#4d606f');
  textureFill(ctx, 0, 0, bounds.x, bounds.y, bounds.w, bounds.h, 96, 0.09);
  textureFill(ctx, 1, 1, Math.max(0, bounds.x), Math.max(h - 410, bounds.y), Math.max(0, Math.min(1000, bounds.x + bounds.w) - bounds.x), Math.max(0, Math.min(h, bounds.y + bounds.h) - Math.max(h - 410, bounds.y)), 96, 0.06);
  ctx.save(); ctx.beginPath();
  ctx.moveTo(1000, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h); ctx.lineTo(1080, h);
  ctx.lineTo(1010, 1120); ctx.lineTo(1090, 760); ctx.lineTo(1020, 420); ctx.closePath(); ctx.clip();
  textureFill(ctx, 1, 0, Math.max(1000, bounds.x), bounds.y, Math.max(0, bounds.x + bounds.w - Math.max(1000, bounds.x)), bounds.h, 96, 0.12);
  ctx.restore();

}

function drawRoads(ctx, world, bounds = null) {
  bounds ||= { x: 0, y: 0, w: world.width || 1500, h: world.height || 1400 };
  const geometry = roadGeometry(world), roads = geometry.roads.filter(road => overlapsView(road.bounds, bounds));
  ctx.save();
  // Paint each whole network layer before the next. Connected asphalt meets
  // seamlessly; a curb never crosses an adjoining street or a polyline vertex.
  for (const road of roads) strokeRoad(ctx, road, road.width + (road.foot ? 4 : 10), '#253949');
  for (const road of roads) strokeRoad(ctx, road, road.width + (road.foot ? 2 : 8), road.foot ? '#536375' : C.curb);
  for (const road of roads) if (!road.foot) for (let distance = 1; distance < road.length; distance += 7) {
    const p = roadPoint(road, distance); if (!p || !overlapsView({ x: p.x, y: p.y, w: 1, h: 1 }, bounds, road.width + 9)) continue;
    for (const side of [-1, 1]) {
      const q = { ...p, x: p.x - Math.sin(p.angle) * (road.width / 2 + 2.7) * side, y: p.y + Math.cos(p.angle) * (road.width / 2 + 2.7) * side };
      boxAt(ctx, q, 0, -1.9, .4, 3.8, '#546b79'); boxAt(ctx, q, .6, -1.9, .25, 3.8, '#91a0a5');
    }
  }
  for (const road of roads) strokeRoad(ctx, road, road.width + 1.1, road.foot ? '#657984' : '#84969e');
  for (const road of roads) strokeRoad(ctx, road, road.width, road.foot ? '#5e7280' : C.road);
  for (const road of roads) if (road.foot) roadTexture(ctx, road, bounds);
  // Walking links may cross a main road; the through carriageway stays asphalt.
  for (const road of roads) if (!road.foot) strokeRoad(ctx, road, road.width, C.road);
  for (const road of roads) if (!road.foot) roadTexture(ctx, road, bounds);
  const nearbyJunctions = geometry.junctions.filter(node => overlapsView({ x: node.x - 75, y: node.y - 75, w: 150, h: 150 }, bounds));
  // Dash phase follows the cumulative path distance, including every bend.
  for (const road of roads) {
    if (road.foot || road.width < 26) continue;
    for (let distance = 10; distance < road.length - 6; distance += 29) {
      const a = roadPoint(road, distance), b = roadPoint(road, Math.min(distance + 11, road.length - 3));
      if (!a || !b || !overlapsView({ x: a.x, y: a.y, w: 2, h: 2 }, bounds, 12)) continue;
      if (nearbyJunctions.some(node => Math.hypot(a.x - node.x, a.y - node.y) < node.width * 0.9)) continue;
      ctx.lineCap = 'butt'; ctx.lineWidth = 1.25; ctx.strokeStyle = '#a9c4c7';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // Drain gratings and restrained worn paint add street scale without filling a lane.
    for (let distance = 65; distance < road.length - 25; distance += 128) {
      const p = roadPoint(road, distance); if (!p) continue;
      const o = { ...p, x: p.x - Math.sin(p.angle) * (road.width / 2 - 2), y: p.y + Math.cos(p.angle) * (road.width / 2 - 2) };
      if (!overlapsView({ x: o.x, y: o.y, w: 5, h: 5 }, bounds, 5)) continue;
      boxAt(ctx, o, -3, -1, 6, 2, '#262f33'); boxAt(ctx, o, -2, -1, 1, 2, '#6b7c78'); boxAt(ctx, o, 1, -1, 1, 2, '#6b7c78');
    }
  }
  for (const node of nearbyJunctions) {
    for (const branch of node.branches) {
      if (branch.length < node.width * 1.8 || branch.width < 24) continue;
      const distance = node.width * 0.88 + 8, co = Math.cos(branch.angle), si = Math.sin(branch.angle);
      const o = { x: node.x + co * distance, y: node.y + si * distance, angle: branch.angle };
      for (let across = -branch.width / 2 + 4; across < branch.width / 2 - 3; across += 6)
        boxAt(ctx, o, -4, across, 8, 3, '#b1cbd0');
      boxAt(ctx, o, 9, 1, 1, branch.width / 2 - 4, '#b1cbd0');
    }
  }
  const names = ['RUE DU PORT', 'BOULEVARD PAOLI', 'RUE DU MARCHÉ', 'AV. DE LA CITADELLE', 'CARRUGHJU VECCHJU', 'STRADA DI U MAQUIS'];
  for (const road of roads) {
    const name = road.name || (!road.type ? names[road.i % names.length] : null);
    if (!name || road.length < 240 || (road.type && !['primary', 'secondary', 'tertiary', 'pedestrian'].includes(road.type))) continue;
    const p = roadPoint(road, road.length * 0.45); if (!p) continue;
    const x = p.x - Math.sin(p.angle) * (road.width / 2 + 10), y = p.y + Math.cos(p.angle) * (road.width / 2 + 10);
    if (!overlapsView({ x, y, w: 85, h: 8 }, bounds, 2)) continue;
    const text = String(name).toUpperCase().slice(0, 23), w = Math.min(92, text.length * 3.05 + 7);
    rect(ctx, x, y, w, 8, '#26474e'); rect(ctx, x, y, w, 1, '#aab4a1');
    label(ctx, text, x + 3, y + 2, '#eee7c6', 5);
  }
  ctx.restore();
}

function water(ctx, item) {
  const x = item.x || 0, y = item.y || 0, w = item.w || 1500, h = item.h || 60;
  rect(ctx, x, y, w, h, C.sea);
  rect(ctx, x, y + 23, w, Math.max(0, h - 23), C.seaDark);
  textureFill(ctx, 2, 1, x, y, w, h, 64, 0.8);
  for (let yy = y + 10; yy < y + h; yy += 15) {
    for (let xx = x + 7; xx < x + w; xx += 43) {
      const off = Math.floor(hash(xx, yy, 21) * 15);
      rect(ctx, xx + off, yy, 14, 1, C.seaLight);
      rect(ctx, xx + off + 4, yy + 2, 6, 1, '#459faf');
    }
  }
  rect(ctx, x, y - 5, w, 5, '#d7c69b');
  rect(ctx, x, y, w, 2, '#4c7779');
  for (let xx = x + 42; xx < x + w - 28; xx += 140) {
    rect(ctx, xx, y - 3, 3, 4, '#373c38');
    rect(ctx, xx + 28, y - 3, 3, 4, '#373c38');
    // Little moored wooden boats remain entirely inside blocked port water.
    polygon(ctx, [[xx + 4, y + 14], [xx + 8, y + 8], [xx + 25, y + 8],
      [xx + 31, y + 14], [xx + 25, y + 22], [xx + 8, y + 22]], '#273b4d');
    polygon(ctx, [[xx + 5, y + 14], [xx + 9, y + 10], [xx + 25, y + 10],
      [xx + 28, y + 14], [xx + 24, y + 19], [xx + 10, y + 19]], '#e2d7af');
    rect(ctx, xx + 10, y + 12, 13, 4, '#b77448');
    rect(ctx, xx + 17, y + 7, 1, 17, '#efe8c7');
    line(ctx, xx + 2, y + 2, xx + 6, y + 13, '#a7c5af');
    line(ctx, xx + 29, y + 2, xx + 27, y + 13, '#a7c5af');
  }
}

function tree(ctx, x, y, scale = 1, type = 'olive') {
  const pine = type === 'pine', r = (type === 'maquis' ? 7.5 : pine ? 13 : 11.5) * scale;
  ctx.save(); ctx.globalAlpha *= .19 + materialLight.daylight * .08;
  ellipse(ctx, x + (materialLight.shadowX ?? .65) * r * .45, y + (materialLight.shadowY ?? .85) * r * .45, r + .9, r * .72, '#142d3d'); ctx.restore();
  rect(ctx, x -.65, y + r * .35, 1.8, r * .28, '#5c6260');
  const points = Array.from({ length: 18 }, (_, i) => {
    const a = i / 18 * Math.PI * 2, size = r * (.84 + hash(x, y, i + 805) * .19);
    return [x + Math.cos(a) * size, y + Math.sin(a) * size * .82];
  });
  ctx.save(); path(ctx, points); ctx.clip();
  const sx = Math.cos(materialLight.sunAngle) * r * .36, sy = Math.sin(materialLight.sunAngle) * r * .24;
  const shade = ctx.createRadialGradient(x + sx, y - sy, .4, x - sx * .5, y + sy * .5, r * 1.1);
  shade.addColorStop(0, type === 'maquis' ? surfaceColour('#6a7d62', '#a0ad72') : surfaceColour('#81917a', '#afbd83'));
  shade.addColorStop(.48, surfaceColour('#48655b', pine ? '#597951' : '#748364')); shade.addColorStop(1, surfaceColour('#263f45', pine ? '#315442' : '#486345'));
  ctx.fillStyle = shade; ctx.fillRect(x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2);
  for (let i = 0; i < 34; i++) {
    const px = x + (hash(x, y, i + 840) - .5) * r * 1.8, py = y + (hash(x, y, i + 880) - .5) * r * 1.4;
    const size = (.4 + hash(x, y, i + 920) * .7) * scale;
    ctx.globalAlpha = .48; ellipse(ctx, px + .35, py + .4, size, size * .65, '#263e42');
    ctx.globalAlpha = .54; ellipse(ctx, px, py, size, size * .65, i % 3 ? '#8a9a7c' : '#567565');
  }
  ctx.restore();
}

function paving(ctx, item) {
  const { x, y } = item, w = item.w || 32, h = item.h || 26;
  const garden = item.material === 'garden';
  rect(ctx, x, y, w, h, garden ? '#2f3e3f' : '#47515b');
  textureFill(ctx, garden ? 1 : 0, 0, x, y, w, h, 96, 0.07);
  if (garden) {
    for (let yy = 6; yy < h - 3; yy += 15) rect(ctx, x + w / 2 - 2, y + yy, 5, 6, '#4f5b5f');
  } else {
    for (let yy = 14; yy < h; yy += 16) line(ctx, x + 1, y + yy, x + w - 2, y + yy, '#3d4851');
    for (let xx = 18; xx < w; xx += 24) line(ctx, x + xx, y + 1, x + xx, y + h - 2, '#3f4a53');
    rect(ctx, x, y, w, 1, '#5d676f'); rect(ctx, x, y + h - 1, w, 1, '#2e3a42');
  }
}

function flowers(ctx, item) {
  const { x, y } = item, w = item.w || 16, h = item.h || 10;
  rect(ctx, x, y, w, h, '#4f5a4c');
  rect(ctx, x, y, w, 1, '#737664');
  const petals = [['#71576d', '#957989'], ['#7c5f52', '#a0947f'], ['#58566f', '#89829d']][(item.variant || 0) % 3];
  for (let yy = 2; yy < h - 1; yy += 4) for (let xx = 2; xx < w - 1; xx += 4) {
    rect(ctx, x + xx - 1, y + yy, 3, 3, '#2e413b');
    rect(ctx, x + xx, y + yy - 1, 1, 2, '#717c5d');
    rect(ctx, x + xx, y + yy + 1, 2, 1, petals[0]);
    rect(ctx, x + xx + 1, y + yy, 1, 1, petals[1]);
  }
}
function boat(ctx, item) {
  const x = item.x, y = item.y, w = item.w || 27, h = item.h || 13;
  polygon(ctx, [[x, y + h / 2], [x + 5, y], [x + w - 5, y], [x + w, y + h / 2],
    [x + w - 5, y + h], [x + 5, y + h]], '#24333d');
  polygon(ctx, [[x + 3, y + h / 2], [x + 6, y + 2], [x + w - 6, y + 2], [x + w - 3, y + h / 2],
    [x + w - 6, y + h - 2], [x + 6, y + h - 2]], '#97978c');
  rect(ctx, x + 7, y + 4, w - 14, h - 8, (item.variant || 0) % 2 ? '#5f5a4f' : '#67514b');
  line(ctx, x + w / 2, y + 1, x + w / 2, y + h - 1, '#a9a89d');
}

function areaGround(ctx, item, bounds, world) {
  const shape = item.polygon, box = pointsBounds(shape);
  if (!overlapsView(box, bounds)) return;
  const area = item.areaKind || item.kind;
  const green = ['maquis', 'wood', 'forest', 'scrub', 'grass', 'park', 'garden', 'meadow'].includes(area);
  const beach = area === 'beach';
  const region = { x: Math.max(box.x, bounds.x), y: Math.max(box.y, bounds.y),
    w: Math.min(box.x + box.w, bounds.x + bounds.w) - Math.max(box.x, bounds.x),
    h: Math.min(box.y + box.h, bounds.y + bounds.h) - Math.max(box.y, bounds.y) };
  ctx.save();
  // Land-use boundaries (a marina, for example) may include open water. They
  // change surface art only; they must never invent land beyond the real coast.
  const land = rings(world?.landPolygons), seas = rings(world?.seaPolygons);
  if (land.length) {
    ctx.beginPath();
    for (const ring of land) {
      ring.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
    }
    ctx.clip();
  }
  if (seas.length) {
    path(ctx, [[bounds.x, bounds.y], [bounds.x + bounds.w, bounds.y], [bounds.x + bounds.w, bounds.y + bounds.h], [bounds.x, bounds.y + bounds.h]], seas);
    ctx.clip('evenodd');
  }
  path(ctx, shape, item.holes || []); ctx.clip('evenodd');
  rect(ctx, region.x, region.y, region.w, region.h, green ? surfaceColour('#2d3d40', '#768464') : beach ? surfaceColour('#52545a', '#c9ba91') : C.ground);
  textureFill(ctx, green ? 1 : beach ? 1 : 0, green ? 0 : beach ? 2 : 0,
    region.x, region.y, region.w, region.h, 96, green ? 0.14 : beach ? 0.055 : 0.08);
  if (green) {
    for (let y = Math.floor(region.y / 16) * 16; y < region.y + region.h; y += 16) {
      for (let x = Math.floor(region.x / 17) * 17; x < region.x + region.w; x += 17) {
        const n = hash(x, y, 98);
        if (n < 0.86) continue;
        ellipse(ctx, x + 4, y + 3, 5, 3, '#425147');
        rect(ctx, x + 1, y + 1, 3, 1, '#69735f');
        rect(ctx, x + 5, y + 3, 2, 1, '#34413d');
      }
    }
  }
  ctx.restore();
}

function scenery(ctx, item) {
  const { x, y, kind } = item;
  if (kind === 'poster' && item.text) {
    const colour = item.text.includes('K7') ? '#b69df5' : '#66dedb';
    rect(ctx, x - 7, y - 6, 14, 12, '#122b3d'); rect(ctx, x - 6, y - 5, 12, 10, '#33485b');
    rect(ctx, x - 5, y - 4, 10, 1, colour); label(ctx, item.text.includes('K7') ? 'K7' : 'FM', x - 4, y - 2, colour, 5);
    return;
  }
  if (kind === 'parkedbike' && item.theme === 'scooter') {
    ellipse(ctx, x + 2, y + 3, 9, 4, '#1a2d40');
    rect(ctx, x - 7, y - 1, 4, 3, '#182a3e'); rect(ctx, x + 3, y - 1, 4, 3, '#182a3e');
    polygon(ctx, [[x - 5, y - 3], [x + 4, y - 4], [x + 6, y], [x - 4, y + 2]], '#b8b0a7');
    rect(ctx, x - 3, y - 4, 6, 3, '#41566b'); rect(ctx, x + 4, y - 5, 1, 4, '#87a5b3');
    rect(ctx, x + 3, y - 6, 4, 1, '#617a8a'); return;
  }
  if ((kind === 'market' || kind === 'awning') && item.theme) {
    const w = item.w || 24, h = item.h || 18, radio = item.theme === 'radio-kiosk', colour = radio ? '#65d7db' : '#b599e6';
    rect(ctx, x + 3, y + 4, w, h, '#1b2d42'); rect(ctx, x, y, w, h, '#37495d');
    for (let xx = 0; xx < w; xx += 8) rect(ctx, x + xx, y, 4, h - 4, '#657280');
    rect(ctx, x, y + h - 4, w, 4, '#122c3e'); rect(ctx, x + 2, y + h - 4, w - 4, 1, colour);
    label(ctx, radio ? 'FM' : 'K7', x + 4, y + h - 3, colour, 5);
    if (radio) { rect(ctx, x + w - 5, y + 3, 4, 7, '#162b3e'); rect(ctx, x + w - 4, y + 5, 2, 1, colour); }
    return;
  }
  if (kind === 'terrace' && item.theme) {
    const w = item.w || 36, h = item.h || 28, colour = item.theme === 'pizzeria' ? '#e99486' : '#dfb989';
    rect(ctx, x, y, w, h, '#586576'); rect(ctx, x, y, w, 1, '#7d8b94');
    for (const [tx, ty] of [[9, 9], [w - 10, h - 9]]) {
      ellipse(ctx, x + tx + 2, y + ty + 2, 6, 4, '#263a4f'); ellipse(ctx, x + tx, y + ty, 6, 4, '#859398');
      rect(ctx, x + tx - 2, y + ty - 1, 2, 2, colour); rect(ctx, x + tx + 2, y + ty, 1, 1, '#ecdfbc');
      rect(ctx, x + tx - 8, y + ty - 2, 3, 5, '#355c69'); rect(ctx, x + tx + 6, y + ty - 2, 3, 5, '#355c69');
    }
    rect(ctx, x + 2, y + h - 3, w - 4, 1, colour); return;
  }
  if (kind === 'courtyard' || kind === 'path' || kind === 'plaza') {
    paving(ctx, item);
  } else if (kind === 'flowerbed') {
    flowers(ctx, item);
  } else if (kind === 'planter') {
    ellipse(ctx, x + 2, y + 3, 5, 4, '#5f6156');
    ellipse(ctx, x, y, 5, 4, '#66524b');
    ellipse(ctx, x, y - 1, 4, 3, '#807161');
    ellipse(ctx, x, y - 1, 3, 3, '#3a4e42');
    rect(ctx, x - 2, y - 3, 2, 2, '#627358');
    rect(ctx, x + 1, y - 2, 2, 2, (item.variant || 0) % 2 ? '#92816d' : '#947d8d');
    rect(ctx, x, y - 3, 1, 1, '#a59e92');
  } else if (kind === 'barrel') {
    ellipse(ctx, x + 2, y + 2, 5, 4, '#595a53');
    ellipse(ctx, x, y, 5, 4, '#3c3c3c');
    ellipse(ctx, x - 1, y - 1, 4, 3, '#6c6154');
    rect(ctx, x - 3, y - 2, 1, 5, '#837967');
    rect(ctx, x + 2, y - 2, 1, 4, '#443f3d');
    rect(ctx, x - 3, y, 6, 1, '#494641');
  } else if (kind === 'bollard') {
    ellipse(ctx, x + 2, y + 2, 3, 2, '#5b5f5a');
    rect(ctx, x - 2, y - 2, 4, 5, '#404a4d');
    rect(ctx, x - 1, y - 2, 2, 2, '#909186');
  } else if (kind === 'boat') {
    boat(ctx, item);
  } else if (kind === 'poster') {
    rect(ctx, x - 6, y - 5, 12, 10, '#3f4f55');
    rect(ctx, x - 5, y - 4, 10, 8, (item.variant || 0) % 2 ? '#898068' : '#8f887a');
    rect(ctx, x - 3, y - 3, 6, 1, '#60504c');
    rect(ctx, x - 3, y, 6, 1, '#615850');
    rect(ctx, x - 3, y + 2, 4, 1, '#615850');
  } else if (kind === 'parkedbike') {
    ellipse(ctx, x - 5, y + 1, 3, 2, '#2b383d');
    ellipse(ctx, x + 5, y + 1, 3, 2, '#2b383d');
    line(ctx, x - 5, y, x, y - 2, '#634b49');
    line(ctx, x, y - 2, x + 5, y, '#634b49');
    line(ctx, x - 5, y, x + 3, y, '#807364');
    rect(ctx, x - 1, y - 4, 3, 2, '#303e43');
    rect(ctx, x + 5, y - 3, 1, 4, '#313f45');
  } else if (kind === 'tree' || kind === 'olive' || kind === 'maquis' || kind === 'bush') {
    if (kind === 'maquis' && item.w && item.h) {
      for (let dy = 7; dy < item.h; dy += 12) for (let dx = 7; dx < item.w; dx += 13) {
        tree(ctx, x + dx, y + dy, 0.85 + hash(x + dx, y + dy) * 0.2, 'maquis');
      }
    } else tree(ctx, x, y, item.scale || 1, item.species || item.type || (kind === 'maquis' || kind === 'bush' ? 'maquis' : 'olive'));
  } else if (kind === 'lamppost' || kind === 'lamp') {
    line(ctx, x + 1, y + 2, x + 9, y + 10, '#565a55', 2);
    rect(ctx, x - 2, y - 2, 5, 5, '#26323a');
    rect(ctx, x - 1, y - 1, 3, 3, surfaceColour('#dfc8a0', '#a7aca1'));
    rect(ctx, x, y, 1, 1, surfaceColour('#fff1c4', '#d5d9c8'));
  } else if (kind === 'telephone') {
    // Overhead glass telephone booth, ochre Telecom-era canopy and handset.
    rect(ctx, x - 4, y - 4, 13, 14, '#5f6059');
    rect(ctx, x - 7, y - 7, 13, 14, '#303c43');
    rect(ctx, x - 6, y - 6, 11, 12, '#847c63');
    rect(ctx, x - 4, y - 4, 7, 8, '#697f80');
    rect(ctx, x - 4, y - 4, 2, 7, '#8f9a91');
    rect(ctx, x - 1, y - 3, 1, 7, '#495b61');
    rect(ctx, x + 1, y - 3, 2, 5, '#25323a');
    rect(ctx, x, y - 3, 3, 1, '#25323a');
    rect(ctx, x, y + 1, 3, 1, '#25323a');
    rect(ctx, x - 6, y - 6, 11, 1, '#98937a');
  } else if (kind === 'terrace') {
    const w = item.w || 36, h = item.h || 28;
    rect(ctx, x, y, w, h, '#848479');
    for (const [dx, dy] of [[9, 9], [w - 9, h - 9]]) {
      ellipse(ctx, x + dx + 1, y + dy + 2, 5, 4, '#66645b');
      ellipse(ctx, x + dx, y + dy, 5, 4, '#999687');
      rect(ctx, x + dx - 1, y + dy - 1, 2, 2, '#60504b');
      for (const [cx, cy] of [[-8, 0], [8, 0], [0, -6], [0, 6]]) {
        rect(ctx, x + dx + cx - 2, y + dy + cy - 2, 4, 4, '#504c45');
        rect(ctx, x + dx + cx - 2, y + dy + cy - 2, 3, 1, '#706656');
      }
    }
  } else if (kind === 'bench') {
    rect(ctx, x - 8, y - 3, 16, 6, '#4b433f');
    rect(ctx, x - 7, y - 3, 14, 1, '#756b5a');
    rect(ctx, x - 7, y, 14, 1, '#756b5a');
  } else if (kind === 'fountain') {
    ellipse(ctx, x + 3, y + 3, 13, 10, '#545b57');
    ellipse(ctx, x, y, 13, 11, '#8c8d85');
    ellipse(ctx, x, y, 10, 8, '#47696d');
    ellipse(ctx, x - 3, y - 2, 4, 2, '#7d9792');
    rect(ctx, x - 2, y - 3, 4, 6, '#949387');
  } else if (kind === 'market' || kind === 'awning') {
    const w = item.w || 24, h = item.h || 18;
    rect(ctx, x + 3, y + 4, w, h, '#60635b');
    rect(ctx, x, y, w, h, '#43585d');
    for (let xx = 0; xx < w; xx += 6) rect(ctx, x + xx, y, 3, h, '#999789');
    rect(ctx, x, y + h - 3, w, 3, '#32484d');
  }
}

function terrainShade(ctx, world, bounds) {
  if (world.terrain?.status !== 'ready') return;
  const step = 32;
  ctx.save();
  const land = rings(world.landPolygons), seas = rings(world.seaPolygons);
  if (land.length) {
    ctx.beginPath(); for (const ring of land) { ring.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); } ctx.clip();
  }
  if (seas.length) { path(ctx, [[bounds.x, bounds.y], [bounds.x + bounds.w, bounds.y], [bounds.x + bounds.w, bounds.y + bounds.h], [bounds.x, bounds.y + bounds.h]], seas); ctx.clip('evenodd'); }
  for (let y = bounds.y; y < bounds.y + bounds.h; y += step) for (let x = bounds.x; x < bounds.x + bounds.w; x += step) {
    const gradient = terrainGradient(world, x + step / 2, y + step / 2);
    const gx = gradient.x || 0, gy = gradient.y || 0;
    const light = (-gx * -0.63 - gy * -0.52 + 0.7) / Math.sqrt(1 + gx * gx + gy * gy);
    const shade = clamp((0.7 - light) * 0.85, -0.2, 0.33);
    ctx.globalAlpha = Math.abs(shade);
    rect(ctx, x, y, step, step, shade >= 0 ? surfaceColour('#10263b', '#526146') : surfaceColour('#9ebdcf', '#e5debc'));
  }
  ctx.restore();
}
function projectedTile(ctx, tile, bounds, world, camera, gutter = 0) {
  const imageWidth = bounds.w + gutter * 2, imageHeight = bounds.h + gutter * 2;
  if (world.terrain?.status !== 'ready') { ctx.drawImage(tile, bounds.x - gutter, bounds.y - gutter, imageWidth, imageHeight); return; }
  const step = 64;
  const mesh = projectedGroundBounds(world, bounds);
  if (mesh.plane) {
    // Exact planes, especially offshore water, need no triangulated redraw.
    ctx.save();
    ctx.transform(1, mesh.plane.shear, 0, mesh.plane.scale, bounds.x, mesh.plane.y);
    ctx.drawImage(tile, -gutter, -gutter, imageWidth, imageHeight); ctx.restore();
    return;
  }
  const triangle = (source, destination) => {
    // Source right triangles permit an exact shear/scale: the texture and
    // every road bend follow the same physical elevation as people and cars.
    const [a, b, c] = source, [pa, pb, pc] = destination;
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (!det) return;
    const shear = ((pb[1] - pa[1]) * (c[1] - a[1]) - (pc[1] - pa[1]) * (b[1] - a[1])) / det;
    const scale = ((b[0] - a[0]) * (pc[1] - pa[1]) - (c[0] - a[0]) * (pb[1] - pa[1])) / det;
    if (scale < 0.1) return;
    ctx.save();
    const cx = destination.reduce((sum, p) => sum + p[0], 0) / 3, cy = destination.reduce((sum, p) => sum + p[1], 0) / 3;
    ctx.beginPath(); destination.forEach(([x, y], i) => {
      const length = Math.max(1, Math.hypot(x - cx, y - cy)), px = x + (x - cx) / length * 1.3, py = y + (y - cy) / length * 1.3;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }); ctx.closePath(); ctx.clip();
    ctx.transform(1, shear, 0, scale, bounds.x, pa[1] - shear * a[0] - scale * a[1]);
    ctx.drawImage(tile, -gutter, -gutter, imageWidth, imageHeight); ctx.restore();
  };
  for (let y = 0; y < bounds.h; y += step) for (let x = 0; x < bounds.w; x += step) {
    const right = Math.min(bounds.w, x + step), bottom = Math.min(bounds.h, y + step);
    const source = [[x, y], [right, y], [right, bottom], [x, bottom]];
    const col = x / step, row = y / step, columns = mesh.columns;
    const target = [mesh.vertices[row * columns + col], mesh.vertices[row * columns + col + 1],
      mesh.vertices[(row + 1) * columns + col + 1], mesh.vertices[(row + 1) * columns + col]];
    // The remaining triangles use precisely the original projected mesh.
    if (camera && (bounds.x + right < camera.x - 1 || bounds.x + x > camera.x + camera.width + 1
      || Math.max(...target.map(point => point[1])) < camera.y - 1
      || Math.min(...target.map(point => point[1])) > camera.y + camera.height + 1)) continue;
    triangle([source[0], source[1], source[2]], [target[0], target[1], target[2]]);
    triangle([source[0], source[2], source[3]], [target[0], target[2], target[3]]);
  }
}
const projectedBoundsCache = new WeakMap();
function projectedGroundBounds(world, bounds) {
  let cache = projectedBoundsCache.get(world);
  if (!cache) { cache = new Map(); projectedBoundsCache.set(world, cache); }
  const key = `${bounds.x},${bounds.y}`;
  if (cache.has(key)) return cache.get(key);
  let top = Infinity, bottom = -Infinity;
  const vertices = [], columns = Math.ceil(bounds.w / 64) + 1;
  // Bounds use the same mesh vertices as the warped ground, including coast.
  for (let y = 0; y <= bounds.h; y += 64) for (let x = 0; x <= bounds.w; x += 64) {
    const projectedY = bounds.y + y - groundLiftAt(world, bounds.x + x, bounds.y + y);
    vertices.push([bounds.x + x, projectedY]);
    top = Math.min(top, projectedY); bottom = Math.max(bottom, projectedY);
  }
  const origin = vertices[0], across = vertices[columns - 1], down = vertices[vertices.length - columns];
  const shear = (across[1] - origin[1]) / bounds.w, scale = (down[1] - origin[1]) / bounds.h;
  const isPlane = scale > .1 && vertices.every(([x, y], index) =>
    Math.abs(y - (origin[1] + shear * (x - bounds.x) + scale * Math.floor(index / columns) * 64)) < .0001);
  const result = { x: bounds.x, y: top, w: bounds.w, h: bottom - top, vertices, columns,
    plane: isPlane ? { shear, scale, y: origin[1] } : null };
  cache.set(key, result);
  while (cache.size > 256) cache.delete(cache.keys().next().value);
  return result;
}
function paintGroundTile(ctx, world, bounds, daylight) {
  return underMaterialLight(daylight, () => {
    const density = hasPhotograph(world) ? 1 : 2;
    const tile = canvasFor(ctx, bounds.w, bounds.h, density), paint = tile?.getContext('2d', { alpha: false });
    if (!paint) return null;
    paint.scale(density, density); paint.translate(-bounds.x, -bounds.y);
    if (photographicGround(paint, world, bounds)) return tile;
    ground(paint, world, bounds);
    for (const item of world.scenery || []) if (Array.isArray(item.polygon)) areaGround(paint, item, bounds, world);
    photographicGround(paint, world, bounds);
    terrainShade(paint, world, bounds); drawRoads(paint, world, bounds);
    for (const item of world.scenery || []) if (!item.polygon && item.kind === 'water' && overlapsView(item, bounds)) water(paint, item);
    for (const item of world.scenery || []) if (!item.polygon && item.ground && overlapsView(item, bounds, 20)) scenery(paint, item);
    if (!daylight) { paint.globalAlpha = .12; rect(paint, bounds.x, bounds.y, bounds.w, bounds.h, '#1e2d50'); }
    return tile;
  });
}
function paintProjectedGround(ctx, world, bounds, projected, daylight, density = 2) {
  // Neighbouring photographs also supply a small source gutter. Fractional
  // camera translation must never blend a transparent tile edge with the sea.
  const gutter = 3, expanded = { x: bounds.x - gutter, y: bounds.y - gutter, w: bounds.w + gutter * 2, h: bounds.h + gutter * 2 };
  const source = paintGroundTile(ctx, world, expanded, daylight);
  if (!source) return null;
  const tile = canvasFor(ctx, projected.w, projected.h, density), paint = tile?.getContext('2d');
  if (!paint) return null;
  paint.scale(density, density); paint.translate(-projected.x, -projected.y);
  projectedTile(paint, source, bounds, world, null, gutter);
  return tile;
}
function blendedArt(ctx, entry, make, width, height, alpha = false) {
  // One colour-channel step is imperceptible; reblending every simulation tick
  // would upload all visible rooftop and ground bitmaps sixty times per second.
  const daylight = Math.round(materialLight.daylight * 128) / 128;
  if (daylight < .0001) return entry.night ||= make(0);
  if (daylight > .9999) return entry.day ||= make(1);
  entry.night ||= make(0); entry.day ||= make(1);
  if (!entry.night || !entry.day) return entry.day || entry.night;
  entry.mixed ||= canvasFor(ctx, width, height, entry.density || 2);
  if (entry.mixed && entry.daylight !== daylight) {
    const paint = entry.mixed.getContext('2d', { alpha });
    paint.globalCompositeOperation = 'copy'; paint.globalAlpha = 1; paint.drawImage(entry.night, 0, 0);
    paint.globalCompositeOperation = 'source-over'; paint.globalAlpha = daylight; paint.drawImage(entry.day, 0, 0); paint.globalAlpha = 1;
    entry.daylight = daylight;
  }
  return entry.mixed || entry.day;
}
function imageBytes(entry) { return ['night', 'day', 'mixed'].reduce((bytes, key) => bytes + (entry[key] ? entry[key].width * entry[key].height * 4 : 0), 0); }
function backdrop(ctx, world, camera) {
  const size = 512;
  let cache = backgroundCache.get(world);
  if (!cache) { cache = new Map(); backgroundCache.set(world, cache); }
  const maxLift = maximumLift(world);
  const left = Math.floor(camera.x / size), top = Math.floor(camera.y / size);
  const right = Math.floor((camera.x + camera.width - 1) / size), bottom = Math.floor((camera.y + camera.height + maxLift - 1) / size);
  for (let ty = top; ty <= bottom; ty++) for (let tx = left; tx <= right; tx++) {
    const key = `${tx},${ty}`, bounds = { x: tx * size, y: ty * size, w: size, h: size };
    const mesh = projectedGroundBounds(world, bounds);
    if (!overlapsView(mesh, { x: camera.x, y: camera.y, w: camera.width, h: camera.height }, 2)) continue;
    const projected = { x: mesh.x - 1, y: mesh.y - 1, w: mesh.w + 2, h: Math.ceil(mesh.h) + 2 };
    const signature = aerialImagery.signature(world, bounds), existing = cache.get(key);
    const entry = existing && existing.signature === signature ? existing : { signature, density: hasPhotograph(world) ? 1 : 2 };
    // Relief and map geometry are static. Project each source palette once,
    // then blend the correctly warped tiles as daylight changes.
    const tile = blendedArt(ctx, entry, daylight => paintProjectedGround(ctx, world, bounds, projected, daylight, entry.density), projected.w, projected.h, true);
    if (!tile) continue;
    cache.delete(key); cache.set(key, entry);
    let bytes = [...cache.values()].reduce((sum, value) => sum + imageBytes(value), 0);
    while (cache.size > 12 || bytes > 32 * 1024 * 1024 && cache.size > 1) {
      const oldest = cache.keys().next().value; bytes -= imageBytes(cache.get(oldest)); cache.delete(oldest);
    }
    ctx.drawImage(tile, projected.x, projected.y, projected.w, projected.h);
  }
}
function onTerrain(ctx, world, item, paint) {
  const x = item.x + (item.w || 0) / 2, y = item.y + (item.h || 0) / 2;
  ctx.save(); ctx.translate(0, -liftAt(world, x, y)); paint(); ctx.restore();
}
const coastGeometryCache = new WeakMap();
function terrainCliffs(ctx, world, camera) {
  if (world.terrain?.status !== 'ready') return;
  const land = rings(world.landPolygons), seas = rings(world.seaPolygons);
  const isLand = (x, y) => land.some(ring => pointInRing(x, y, ring)) && !seas.some(ring => pointInRing(x, y, ring));
  let segments = coastGeometryCache.get(world);
  if (!segments) {
    segments = land.flatMap(ring => ring.slice(1).map((b, i) => ({ a: ring[i], b, bounds: pointsBounds([ring[i], b], 90), faces: null })));
    coastGeometryCache.set(world, segments);
  }
  for (const segment of segments) {
    if (!overlapsView(segment.bounds, { x: camera.x, y: camera.y, w: camera.width, h: camera.height + 90 })) continue;
    if (!segment.faces) {
      const { a, b } = segment, size = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const pieces = Math.max(1, Math.ceil(size / 32)); segment.faces = [];
    for (let j = 0; j < pieces; j++) {
      const p = [a[0] + (b[0] - a[0]) * j / pieces, a[1] + (b[1] - a[1]) * j / pieces];
      const q = [a[0] + (b[0] - a[0]) * (j + 1) / pieces, a[1] + (b[1] - a[1]) * (j + 1) / pieces];
      const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
      // Only sea-facing southern slopes expose a side in this projection.
      if (isLand(mx, my + 10)) continue;
      const lp = liftAt(world, p[0], p[1] - 3), lq = liftAt(world, q[0], q[1] - 3);
      if (Math.max(lp, lq) < 9) continue;
        segment.faces.push({ p, q, lp, lq, mx, my });
      }
    }
    for (const { p, q, lp, lq, mx, my } of segment.faces) {
      polygon(ctx, [p, q, [q[0], q[1] - lq], [p[0], p[1] - lp]], surfaceColour('#40576b', '#8f927d'));
      line(ctx, p[0], p[1] - lp, q[0], q[1] - lq, surfaceColour('#839baa', '#c3bfa8'));
      line(ctx, mx, my - 2, mx - 1, my - (lp + lq) * .36, surfaceColour('#2d475e', '#6d7868'));
    }
  }
}
const municipalSegmentCache = new WeakMap();
function municipalBorder(ctx, world, camera) {
  if (!world.municipalBoundary?.polygons) return;
  let segments = municipalSegmentCache.get(world);
  if (!segments) {
    segments = [];
    for (const polygon of world.municipalBoundary.polygons) for (const ring of [polygon.outer, ...(polygon.holes || [])])
      for (let i = 1; i < ring.length; i++) segments.push({ a: ring[i - 1], b: ring[i], bounds: pointsBounds([ring[i - 1], ring[i]], 20) });
    municipalSegmentCache.set(world, segments);
  }
  ctx.save(); ctx.globalAlpha *= .28; ctx.strokeStyle = '#bdc7a2'; ctx.lineWidth = .75; ctx.setLineDash([7, 5]);
  for (const { a, b, bounds } of segments) {
      if (!overlapsView(bounds, { x: camera.x, y: camera.y, w: camera.width, h: camera.height }, maximumLift(world))) continue;
      ctx.beginPath(); ctx.moveTo(a[0], a[1] - liftAt(world, ...a)); ctx.lineTo(b[0], b[1] - liftAt(world, ...b)); ctx.stroke();
  }
  ctx.restore();
}

const nightTints = new Map();
function nightTint(colour, fallback = '#70818c') {
  const key = /^#[0-9a-f]{6}$/i.test(colour || '') ? colour : fallback;
  if (nightTints.has(key)) return mixColour(nightTints.get(key), key, materialLight.daylight * .93);
  const channels = [1, 3, 5].map(i => parseInt(key.slice(i, i + 2), 16)), luma = channels.reduce((a, b) => a + b) / 3;
  const rgb = channels.map((v, i) => Math.round((luma + (v - luma) * .56) * .69 + [27, 49, 80][i] * .26));
  const result = '#' + rgb.map(v => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('');
  nightTints.set(key, result); return mixColour(result, key, materialLight.daylight * .93);
}
function roofMaterial(b) {
  const tags = b.osmTags || {}, source = tags['roof:shape'] || b.roofShape;
  if (b.target || ['depot', 'warehouse', 'garage'].includes(b.kind) || /metal|steel|tin/.test(tags['roof:material'] || b.construction?.material || '')) return 'metal';
  if (source === 'flat' || b.roof === 1 && hash(b.x, b.y, 620) > .76) return 'flat';
  return 'hipped';
}
function roofFacet(ctx, points, light, shade, x0, y0, x1, y1) {
  ctx.save(); path(ctx, points); ctx.clip();
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  gradient.addColorStop(0, light); gradient.addColorStop(1, shade);
  ctx.fillStyle = gradient; ctx.fillRect(Math.min(...points.map(p => p[0])) - 1, Math.min(...points.map(p => p[1])) - 1,
    Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])) + 2, Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1])) + 2);
  ctx.restore();
}
function paintRoof(ctx, b, x, y) {
  const w = b.w, h = b.h, material = roofMaterial(b), horizontal = w >= h;
  rect(ctx, x, y, w, h, '#273846');
  if (material === 'metal') {
    const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
    gradient.addColorStop(0, surfaceColour('#667a7f', '#adb5a9')); gradient.addColorStop(.48, surfaceColour('#465e68', '#909d94')); gradient.addColorStop(1, surfaceColour('#344b58', '#687e77'));
    ctx.fillStyle = gradient; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    for (let xx = 2; xx < w - 1; xx += 2.6) {
      line(ctx, x + xx, y + 1, x + xx, y + h - 1, '#809397', .33);
      line(ctx, x + xx + .65, y + 1, x + xx + .65, y + h - 1, '#344d5a', .45);
    }
    for (let yy = 14; yy < h - 1; yy += 22) line(ctx, x + 1, y + yy, x + w - 1, y + yy, '#263f4c', .55);
    for (let yy = 11; yy < h - 7; yy += 30) for (let xx = 12; xx < w - 8; xx += 34) {
      rect(ctx, x + xx + .8, y + yy + 1, 11, 6.5, '#223e4b');
      rect(ctx, x + xx, y + yy, 10, 6, '#668a92'); line(ctx, x + xx + 2, y + yy + .8, x + xx + 2, y + yy + 5.2, '#bfd0ca', .6);
      line(ctx, x + xx + 6, y + yy, x + xx + 6, y + yy + 6, '#385c6d', .5);
    }
  } else if (material === 'flat') {
    const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
    gradient.addColorStop(0, surfaceColour('#75818a', '#c0bdb0')); gradient.addColorStop(.5, surfaceColour('#5b6875', '#a4a798')); gradient.addColorStop(1, surfaceColour('#465869', '#808f81'));
    ctx.fillStyle = gradient; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    for (let yy = 11; yy < h; yy += 13) line(ctx, x + 1.5, y + yy, x + w - 1.5, y + yy, '#465464', .4);
    for (let xx = 14; xx < w; xx += 17) line(ctx, x + xx, y + 1.5, x + xx, y + h - 1.5, '#4d5b6a', .35);
    // Parapets cast a narrow real-looking inner shadow across rooftop slabs.
    rect(ctx, x + 1, y + 1, w - 2, 1.4, '#a3acae'); rect(ctx, x + 2, y + 2.4, w - 4, 1.2, '#344758');
    rect(ctx, x + w - 2.4, y + 1, 1.4, h - 2, '#8b9ea7'); rect(ctx, x + w - 3.5, y + 2, 1, h - 4, '#354a5c');
    for (let i = 0; i < 7; i++) {
      const px = x + hash(b.x, b.y, 701 + i) * w, py = y + hash(b.x, b.y, 711 + i) * h;
      ctx.save(); ctx.globalAlpha = .12; ellipse(ctx, px, py, 2 + i % 3, 1 + i % 2, '#233b50'); ctx.restore();
    }
    if (w > 25 && h > 25) {
      rect(ctx, x + w * .52 + 1, y + h * .32 + 1.5, 11, 8, '#2b3e4b');
      rect(ctx, x + w * .52, y + h * .32, 10, 7, '#9aa7a8');
      ellipse(ctx, x + w * .52 + 5, y + h * .32 + 3.5, 2.1, 2, '#485f6e');
      for (let grille = 1; grille < 9; grille += 1.4) line(ctx, x + w * .52 + grille, y + h * .32 + .8, x + w * .52 + grille, y + h * .32 + 6.2, '#687d87', .35);
    }
  } else {
    const inset = Math.min(w, h) * .3;
    const tl = [x, y], tr = [x + w, y], br = [x + w, y + h], bl = [x, y + h];
    const a = horizontal ? [x + inset, y + h * .5] : [x + w * .5, y + inset];
    const c = horizontal ? [x + w - inset, y + h * .5] : [x + w * .5, y + h - inset];
    const north = horizontal ? [tl, tr, c, a] : [tl, tr, a];
    const east = horizontal ? [tr, br, c] : [tr, br, c, a];
    const south = horizontal ? [bl, br, c, a] : [bl, br, c];
    const west = horizontal ? [tl, bl, a] : [tl, bl, c, a];
    roofFacet(ctx, north, surfaceColour('#a68c7b', '#c4a286'), surfaceColour('#796764', '#9b7e69'), x, y, x + w * .35, y + h * .5);
    roofFacet(ctx, east, surfaceColour('#6f6367', '#a1816c'), surfaceColour('#485160', '#707369'), x + w * .55, y, x + w, y + h);
    roofFacet(ctx, south, surfaceColour('#7c6665', '#b68c73'), surfaceColour('#534c59', '#806e63'), x, y + h * .5, x + w * .45, y + h);
    roofFacet(ctx, west, surfaceColour('#887368', '#c19c7d'), surfaceColour('#655960', '#957d67'), x, y, x + w * .5, y + h);
    textureFill(ctx, 0, 1, x, y, w, h, 70, .035);
    // Tile rolls are fine half-pixel edges, staggered instead of large painted bars.
    ctx.save(); path(ctx, [[x + 1, y + 1], [x + w - 1, y + 1], [x + w - 1, y + h - 1], [x + 1, y + h - 1]]); ctx.clip();
    const across = horizontal ? h : w, along = horizontal ? w : h;
    for (let row = 1.5, n = 0; row < across; row += 2.9, n++) {
      ctx.globalAlpha = .38;
      if (horizontal) line(ctx, x + .7, y + row, x + w - .7, y + row, row < h * .5 ? '#c0a28e' : '#967c78', .35);
      else line(ctx, x + row, y + .7, x + row, y + h - .7, row < w * .5 ? '#b79a86' : '#83747a', .35);
      ctx.globalAlpha = .45;
      for (let tile = (n % 2 ? 2 : .5); tile < along; tile += 5.2) {
        if (horizontal) line(ctx, x + tile, y + row, x + tile + .35, y + row + 2.4, '#514f5a', .32);
        else line(ctx, x + row, y + tile, x + row + 2.4, y + tile + .35, '#4b5060', .32);
      }
    }
    ctx.restore();
    for (const corner of horizontal ? [tl, bl] : [tl, tr]) line(ctx, corner[0], corner[1], a[0], a[1], '#433f49', 1.2);
    for (const corner of horizontal ? [tr, br] : [bl, br]) line(ctx, corner[0], corner[1], c[0], c[1], '#3d3c4a', 1.2);
    line(ctx, a[0], a[1], c[0], c[1], '#c6ac94', 1.25);
    line(ctx, a[0] + .6, a[1] + 1, c[0] + .6, c[1] + 1, '#534c54', .8);
  }
  if (w > 35 && h > 27) {
    const px = x + w * .24, py = y + h * .62;
    rect(ctx, px + .7, py + 1, 8.4, 6.4, '#263c49'); rect(ctx, px, py, 8, 6, '#526f7b');
    rect(ctx, px + .7, py + .7, 6.6, 4.6, '#6e9298'); line(ctx, px + 2.1, py + 1, px + 2.1, py + 5, '#b5d3cf', .55);
    line(ctx, px + 5.2, py + .5, px + 5.2, py + 5.5, '#315867', .45);
  }
  if (b.roofDetails?.chimney !== false && w > 25 && h > 20) {
    const px = x + w * .75, py = y + h * .27;
    rect(ctx, px + 1.3, py + 2, 4.5, 5.5, '#2b3d4f'); rect(ctx, px, py, 4.5, 5.5, '#838784');
    rect(ctx, px -.45, py -.55, 5.4, 1.6, '#b0ada5'); rect(ctx, px + .6, py -.25, 2.8, .6, '#354250');
    for (const dy of [1.9, 3.7]) line(ctx, px, py + dy, px + 4.4, py + dy, '#5a6a73', .35);
  }
  if (b.roofDetails?.antenna !== false && w > 42 && h > 30) {
    const px = x + w * .67, py = y + h * .69;
    line(ctx, px + .7, py - 5, px + .7, py + 4, '#202e3d', .8); line(ctx, px, py - 5, px, py + 4, '#95a6ad', .45);
    line(ctx, px - 3.4, py - 2, px + 3.4, py - 2, '#8c9da7', .5); line(ctx, px - 2.3, py + .6, px + 2.3, py + .6, '#7e919d', .5);
  }
  if (b.roofDetails?.satellite && w > 30 && h > 25) {
    ellipse(ctx, x + w * .77 + .8, y + h * .3 + 1.2, 3.5, 2.4, '#304553');
    ellipse(ctx, x + w * .77, y + h * .3, 3.5, 2.4, '#b1c0c2'); ellipse(ctx, x + w * .77 - .5, y + h * .3 -.2, 2.8, 1.8, '#819fa9');
    line(ctx, x + w * .77, y + h * .3, x + w * .77 + 3, y + h * .3 + 4, '#334f61', .6);
  }
  if (b.sign && !b.neon && w > 25) {
    const text = String(b.sign).toUpperCase().slice(0, 18), size = text.length > 12 ? 4 : 5;
    const sw = Math.min(w - 8, text.length * size * .6 + 7);
    rect(ctx, x + 4, y + h - 12, sw, 7, '#273b48'); label(ctx, text, x + 7, y + h - 10, '#c1ccc9', size);
  }
}

function rubble(ctx, b) {
  rect(ctx, b.x, b.y, b.w, b.h, '#30424d');
  const scorch = ctx.createRadialGradient(b.x + b.w * .48, b.y + b.h * .45, 2, b.x + b.w * .5, b.y + b.h * .5, Math.max(b.w, b.h) * .68);
  scorch.addColorStop(0, '#1a2935'); scorch.addColorStop(1, '#455360');
  ctx.fillStyle = scorch; ctx.fillRect(b.x, b.y, b.w, b.h);
  const pieces = Math.min(90, Math.max(22, Math.ceil(b.w * b.h / 110)));
  for (let i = 0; i < pieces; i++) {
    const x = b.x + hash(b.x, b.y, i + 62) * b.w, y = b.y + hash(b.x, b.y, i + 72) * b.h;
    const size = 1.4 + hash(b.x, b.y, i + 82) * 4.2, angle = hash(b.x, b.y, i + 92) * Math.PI;
    const piece = { x, y, angle };
    boxAt(ctx, { ...piece, x: x + 1, y: y + .8 }, -size / 2, -size / 3, size, size * .6, '#182c3c');
    boxAt(ctx, piece, -size / 2, -size / 3, size, size * .6, i % 4 ? '#737e7e' : '#86736a');
    boxAt(ctx, piece, -size / 2, -size / 3, size, .45, '#a3a7a0');
  }
  for (let i = 0; i < 3; i++) {
    const x = b.x + b.w * (.18 + i * .26), y = b.y + b.h * (.2 + hash(b.x, b.y, i + 95) * .6);
    line(ctx, x - 3, y, x + 4, y + 1, '#102837', .65); line(ctx, x + 4, y + 1, x + 8, y - 3, '#102837', .5);
  }
}

export function buildingProfile(b) {
  const tags = b.osmTags || {}, sourceHeight = b.sourceHeight?.heightMeters;
  const reportedHeight = osmHeightMeters(tags);
  const constructedHeight = tags.height === undefined ? b.construction?.height : null;
  const statedHeight = typeof sourceHeight === 'number' && Number.isFinite(sourceHeight) && sourceHeight > 0
    ? sourceHeight : reportedHeight ?? constructedHeight;
  const statedFloors = Number(b.construction?.floors || parseFloat(tags['building:levels']));
  const industrial = b.target || ['depot', 'warehouse', 'garage'].includes(b.kind) || b.style === 'garage';
  const heritage = ['church', 'chapel'].includes(b.style) || tags.amenity === 'place_of_worship' || ['castle', 'tower'].includes(tags.historic);
  const hasHeight = Number.isFinite(statedHeight) && statedHeight > 0;
  // Without a levels tag, window spacing is artistic even when roof height is
  // sourced. Never describe the decorative rows as surveyed floors.
  const fallbackFloors = hasHeight ? Math.max(1, Math.round(statedHeight / (industrial ? 5 : 3.4)))
    : industrial ? 1 : heritage ? 3 : b.w * b.h < 1500 ? 2 : hash(b.x, b.y, 501) > .5 ? 3 : 2;
  const floors = clamp(Number.isFinite(statedFloors) && statedFloors > 0 ? Math.round(statedFloors) : fallbackFloors, 1, 6);
  const height = Number.isFinite(b.visualHeight) ? clamp(b.visualHeight, 15, 98) : hasHeight
    ? clamp(statedHeight * 4, 4, 98) : floors * 14 + (industrial ? 4 : heritage ? 11 : 6);
  return { floors, height, source: typeof sourceHeight === 'number' && Number.isFinite(sourceHeight) && sourceHeight > 0
    ? b.sourceHeight.source || 'source height'
    : Number.isFinite(statedFloors) && statedFloors > 0 || Number.isFinite(statedHeight) && statedHeight > 0 ? 'OSM tags' : 'original game art' };
}
function visualHeight(b) { return buildingProfile(b).height; }

function footprint(b) {
  return Array.isArray(b.polygon) && b.polygon.length >= 3 ? b.polygon :
    [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
}
export function buildingOccludes(b, focus, world = null) {
  if (!focus || b.destroyed || vehicleVisualLift(focus) > .5 || pointInFootprint(focus.x, focus.y, b)) return false;
  const lift = liftAt(world, b.x + b.w / 2, b.y + b.h / 2), z = visualHeight(b);
  const roof = footprint(b).map(([x, y]) => [x - 4, y - z - lift]);
  const y = focus.y - liftAt(world, focus.x, focus.y);
  return pointInRing(focus.x, y, roof) && !(b.holes || []).some(ring => pointInRing(focus.x, y, ring.map(([x, y]) => [x - 4, y - z - lift])));
}
function path(ctx, points, holes = []) {
  ctx.beginPath();
  for (const ring of [points, ...holes]) {
    ring.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
  }
}
function buildingShadow(ctx, b, photo = false) {
  if (b.destroyed || b.hp <= 0) return;
  const z = visualHeight(b), dx = z * (materialLight.shadowX ?? .65), dy = z * (materialLight.shadowY ?? .85), points = footprint(b);
  ctx.save(); ctx.globalAlpha *= (materialLight.shadowOpacity ?? .2) * (photo ? .4 : 1); ctx.fillStyle = surfaceColour('#091b2a', '#344439'); ctx.beginPath();
  const add = ring => {
    const area = ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
    const ordered = area < 0 ? [...ring].reverse() : ring;
    ordered.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
  };
  add(points.map(([x, y]) => [x + dx, y + dy]));
  for (let i = 0; i < points.length; i++) { const a = points[i], c = points[(i + 1) % points.length]; add([a, c, [c[0] + dx, c[1] + dy], [a[0] + dx, a[1] + dy]]); }
  ctx.fill(); ctx.restore();
}

function paintRaisedBuilding(ctx, b, world = null) {
  const profile = buildingProfile(b), z = profile.height, ox = 4;
  const photo = world && hasPhotograph(world);
  const base = footprint(b).map(([x, y]) => [x - b.x + ox, y - b.y + z]);
  const roof = base.map(([x, y]) => [x - ox, y - z]);
  const inner = (b.holes || []).map(ring => ring.map(([x, y]) => [x - b.x + ox, y - b.y + z]));
  const roofInner = inner.map(ring => ring.map(([x, y]) => [x - ox, y - z]));
  const tone = photo ? '#b4b3aa' : nightTint(b.wallTone || '#c2c4c3');
  for (const edgeRing of [base, ...inner]) for (let i = 0; i < edgeRing.length; i++) {
    const a = edgeRing[i], c = edgeRing[(i + 1) % edgeRing.length], ar = [a[0] - ox, a[1] - z], cr = [c[0] - ox, c[1] - z];
    const dx = c[0] - a[0], dy = c[1] - a[1], length = Math.hypot(dx, dy);
    if (length < .1) continue;
    const vertical = Math.abs(dy) > Math.abs(dx), face = [a, c, cr, ar];
    polygon(ctx, face, vertical ? photo ? '#858b83' : surfaceColour('#43515f', mixColour(tone, '#5e7369', .24)) : tone);
    ctx.save(); path(ctx, face); ctx.clip();
    const shade = ctx.createLinearGradient(ar[0], ar[1], a[0], a[1]);
    shade.addColorStop(0, 'rgba(12,23,38,.42)'); shade.addColorStop(.2, 'rgba(12,23,38,.03)'); shade.addColorStop(1, 'rgba(12,23,38,.17)');
    ctx.fillStyle = shade; ctx.fillRect(Math.min(a[0], c[0]) - 5, Math.min(ar[1], cr[1]) - 1, Math.abs(dx) + 10, Math.abs(dy) + z + 2);
    for (let row = 1; row < profile.floors; row++) {
      const f = row / profile.floors;
      line(ctx, ar[0] + ox * f, ar[1] + z * f, cr[0] + ox * f, cr[1] + z * f, '#a3aaa6', .42);
      line(ctx, ar[0] + ox * f, ar[1] + z * f + .6, cr[0] + ox * f, cr[1] + z * f + .6, '#354556', .45);
    }
    if (length >= 11) {
      const count = Math.max(1, Math.min(photo ? 9 : 18, Math.floor(length / (photo ? 20 : 13)))), rows = profile.floors;
      for (let row = 0; row < rows; row++) for (let pane = 0; pane < count; pane++) {
        const along = (pane + .5) / count, down = (row + .46) / rows;
        const px = ar[0] + dx * along + ox * down, py = ar[1] + dy * along + z * down;
        const windowWidth = vertical ? 2.6 : 3.8, windowHeight = Math.min(6, z / rows * .43);
        rect(ctx, px - windowWidth / 2 - .5, py - windowHeight / 2 - .6, windowWidth + 1, windowHeight + 1.2, '#243444');
        const lit = b.windowGlow && materialLight.night > .5 && hash(b.x + pane, b.y + row, 570) > .28;
        rect(ctx, px - windowWidth / 2, py - windowHeight / 2, windowWidth, windowHeight, lit ? b.windowGlow : surfaceColour('#47636e', '#536c70'));
        rect(ctx, px - windowWidth / 2, py - windowHeight / 2, .55, windowHeight, lit ? '#ffedd0' : surfaceColour('#7a9ca0', '#cad4c3'));
        rect(ctx, px - .2, py - windowHeight / 2, .42, windowHeight, '#44515c');
        rect(ctx, px - windowWidth / 2 - .8, py + windowHeight / 2, windowWidth + 1.7, .75, '#97a7a9');
        if (b.shutterTone && !vertical) {
          rect(ctx, px - windowWidth / 2 - 1.6, py - windowHeight / 2, .8, windowHeight, nightTint(b.shutterTone));
          rect(ctx, px + windowWidth / 2 + .8, py - windowHeight / 2, .8, windowHeight, nightTint(b.shutterTone));
        }
        if (b.balcony && row < rows - 1 && pane % 3 === 1 && !vertical) {
          rect(ctx, px - 4, py + 2.8, 8, 3, '#334657'); line(ctx, px - 4, py + 3, px + 4, py + 3, '#a5b3b5', .5);
          for (let rail = -3; rail <= 3; rail += 2) line(ctx, px + rail, py + 3, px + rail, py + 5.6, '#91a4ab', .4);
        }
      }
      // Street-level doors are small openings in the same real face.
      const doorX = a[0] + dx * .54 - 1, doorY = a[1] + dy * .54 - 6;
      rect(ctx, doorX - 2, doorY, 4.5, 6.3, '#293b49'); rect(ctx, doorX - 1.2, doorY + .7, 2.8, 5.4, '#46656b');
      rect(ctx, doorX + .9, doorY + 3.2, .55, .55, '#c7b58e');
    }
    ctx.restore(); line(ctx, a[0], a[1], c[0], c[1], photo ? '#777d76' : '#1d3348', photo ? .35 : .8);
    line(ctx, ar[0], ar[1], cr[0], cr[1], photo ? '#74786b' : '#263544', photo ? .35 : 1.5);
  }
  ctx.save(); path(ctx, roof, roofInner); ctx.clip('evenodd');
  if (photo) { ctx.translate(-b.x, -b.y); drawPhotograph(ctx, world, { x: b.x, y: b.y, w: b.w, h: b.h }); }
  else paintRoof(ctx, b, 0, 0);
  ctx.restore();
  for (const ring of [roof, ...roofInner]) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length];
    line(ctx, a[0], a[1], c[0], c[1], photo ? '#9d9e8c' : i === 0 ? '#a2a5a0' : '#465161', photo ? .25 : .65);
    if (!photo) line(ctx, a[0] + .8, a[1] + 1.1, c[0] + .8, c[1] + 1.1, '#27394a', .7);
  }
}

function photoBuildingNight(ctx, b, height) {
  if (materialLight.night < .001) return;
  const ring = footprint(b), roof = ring.map(([x, y]) => [x - 4, y - height]);
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha *= materialLight.night * .72;
  ctx.beginPath();
  const add = points => {
    const area = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
    const ordered = area < 0 ? [...points].reverse() : points;
    ordered.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
  };
  add(roof);
  for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; add([ring[i], ring[j], roof[j], roof[i]]); }
  ctx.fillStyle = '#244565'; ctx.fill(); ctx.restore();
  if (b.windowGlow && materialLight.lamps > .01) {
    ctx.save(); ctx.globalAlpha *= materialLight.lamps;
    const floors = buildingProfile(b).floors;
    for (let edge = 0; edge < ring.length; edge++) {
      const a = ring[edge], c = ring[(edge + 1) % ring.length], dx = c[0] - a[0], dy = c[1] - a[1];
      if (Math.abs(dx) < Math.abs(dy)) continue;
      const count = Math.min(9, Math.floor(Math.hypot(dx, dy) / 20));
      for (let row = 0; row < floors; row++) for (let pane = 0; pane < count; pane++) {
        if (hash(b.x + pane, b.y + row, 570) <= .28) continue;
        const along = (pane + .5) / count, down = (row + .46) / floors;
        const px = a[0] - 4 + dx * along + 4 * down, py = a[1] - height + dy * along + height * down;
        if (pointInRing(px, py, roof)) continue;
        rect(ctx, px - 1.9, py - 2,
          3.8, Math.min(4, height / floors * .36), b.windowGlow);
      }
    }
    ctx.restore();
  }
}

function building(ctx, b, world) {
  if (b.destroyed || b.hp <= 0) {
    ctx.save(); path(ctx, footprint(b), b.holes || []); ctx.clip('evenodd'); rubble(ctx, b); ctx.restore(); return;
  }
  const photo = hasPhotograph(world), signature = photo ? aerialImagery.signature(world, b) : '';
  let cached = roofCache.get(b);
  if (cached && (cached.photo !== photo || cached.signature !== signature)) {
    roofCacheBytes -= imageBytes(cached); roofCache.delete(b); cached = null;
  }
  if (!cached) {
    const z = visualHeight(b), width = Math.ceil(b.w + 6), height = Math.ceil(b.h + z + 2);
    cached = { z, width, height, photo, signature, density: Math.min(photo ? 1.25 : 2, Math.sqrt(256 * 1024 / (width * height))) };
  }
  const beforeBytes = imageBytes(cached);
  const make = daylight => underMaterialLight(daylight, () => {
    const image = canvasFor(ctx, cached.width, cached.height, cached.density), paint = image?.getContext('2d');
    if (!paint) return null;
    paint.scale(cached.density, cached.density); paintRaisedBuilding(paint, b, world); return image;
  });
  // A photographic roof keeps one natural texture. Night exposure is a cheap
  // local silhouette and window pass, avoiding three full roof bitmaps per view.
  const canvas = photo ? cached.day ||= make(1) : blendedArt(ctx, cached, make, cached.width, cached.height, true);
  if (!canvas) { ctx.save(); ctx.translate(b.x - 4, b.y - cached.z); paintRaisedBuilding(ctx, b, world); ctx.restore(); return; }
  roofCacheBytes += imageBytes(cached) - beforeBytes;
  roofCache.delete(b); roofCache.set(b, cached);
  while ((roofCacheBytes > ROOF_CACHE_BYTES || roofCache.size > 160) && roofCache.size > 1) {
    const first = roofCache.keys().next().value; roofCacheBytes -= imageBytes(roofCache.get(first)); roofCache.delete(first);
  }
  ctx.drawImage(canvas, b.x - 4, b.y - cached.z, cached.width, cached.height);
  if (photo) photoBuildingNight(ctx, b, cached.z);
  neonSign(ctx, b);
  const damage = Number.isFinite(b.maxHp) && b.maxHp > 0 ? clamp(1 - b.hp / b.maxHp, 0, 1) : 0;
  if (damage > 0.12) {
    ctx.save(); ctx.translate(-4, -cached.z); path(ctx, footprint(b), b.holes || []); ctx.clip('evenodd');
    for (let i = 0; i < Math.ceil(damage * 9); i++) {
      const x = b.x + hash(b.x, b.y, i + 140) * b.w, y = b.y + hash(b.x, b.y, i + 160) * b.h;
      line(ctx, x - 5, y - 4, x, y, '#473f39'); line(ctx, x, y, x - 2, y + 6, '#3d4540');
      line(ctx, x, y, x + 7, y + 2, '#4a443a');
    }
    ctx.restore();
    // A short bar appears only after an impact; solid walls keep a quiet skyline.
    if (b.damageFlash > 0) {
      const width = Math.min(36, b.w - 4), x = b.x + b.w / 2 - width / 2, y = b.y - cached.z - 6;
      rect(ctx, x - 1, y - 1, width + 2, 4, C.ink); rect(ctx, x, y, width * (1 - damage), 2, '#ecc272');
    }
  }
}

const lightPoolCache = new Map();
function lightPool(ctx, x, y, colour = '#ffc493', radius = 45, strength = 1) {
  strength *= materialLight.lamps ?? 1;
  if (strength < .001) return;
  let light = lightPoolCache.get(colour);
  if (!light) {
    light = canvasFor(ctx, 128, 128);
    if (light) {
      const p = light.getContext('2d'), glow = p.createRadialGradient(64, 64, 2, 64, 64, 63);
      const rgb = [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16));
      glow.addColorStop(0, `rgba(${rgb},0.42)`); glow.addColorStop(.34, `rgba(${rgb},0.19)`);
      glow.addColorStop(.7, `rgba(${rgb},0.045)`); glow.addColorStop(1, `rgba(${rgb},0)`);
      p.fillStyle = glow; p.fillRect(0, 0, 128, 128); lightPoolCache.set(colour, light);
    }
  }
  if (!light) return;
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha *= strength;
  ctx.drawImage(light, x - radius, y - radius * .68, radius * 2, radius * 1.36); ctx.restore();
}
function lampGlow(ctx, x, y, colour = '#ffc493') { lightPool(ctx, x, y, colour, 44, .9); }
function neonAnchor(b) {
  const points = footprint(b), edges = points.map((a, i) => {
    const c = points[(i + 1) % points.length]; return { x: (a[0] + c[0]) / 2, y: (a[1] + c[1]) / 2, width: Math.hypot(c[0] - a[0], c[1] - a[1]) };
  }).filter(edge => edge.width > 12);
  const east = b.neon?.side === 'east', west = b.neon?.side === 'west', north = b.neon?.side === 'north';
  return edges.sort((a, c) => east ? c.x - a.x : west ? a.x - c.x : north ? a.y - c.y : c.y - a.y)[0] || { x: b.x + b.w / 2, y: b.y + b.h, width: b.w };
}
function storefrontGlow(ctx, b, world) {
  if (b.destroyed || !b.neon) return;
  const p = neonAnchor(b), colour = b.neon.color || '#66e0df';
  const y = p.y - liftAt(world, b.x + b.w / 2, b.y + b.h / 2);
  const dx = b.neon.side === 'east' ? 9 : b.neon.side === 'west' ? -9 : 0;
  lightPool(ctx, p.x + dx, y + (dx ? 0 : 8), colour, 53, (b.neon.intensity ?? .7) * 1.3);
  // A short sheen follows the shop front, never adding a road or an obstacle.
  ctx.save(); ctx.globalAlpha = .15 * (materialLight.lamps ?? 1);
  rect(ctx, p.x - 10, y + 12, 20, 1, colour); rect(ctx, p.x - 6, y + 16, 12, 1, colour); ctx.restore();
}
function neonSign(ctx, b) {
  if (b.destroyed || !b.neon) return;
  const p = neonAnchor(b), text = String(b.neon.label || b.sign || '').toUpperCase().slice(0, 19);
  if (!text) return;
  const size = text.length > 12 ? 5 : 6, width = Math.min(86, Math.max(26, text.length * size * .61 + 10));
  const x = p.x - width / 2 - 3, y = p.y - visualHeight(b) / 2 - 6, colour = mixColour(b.neon.color || '#66e0df', '#406357', materialLight.daylight * .55);
  lightPool(ctx, p.x, y + 4, colour, 31, 1.15);
  rect(ctx, x - 1, y - 1, width + 2, 11, '#102333'); rect(ctx, x, y, width, 9, '#172c3d');
  rect(ctx, x, y + 8, width, 1, colour); rect(ctx, x + 1, y, width - 2, 1, colour);
  label(ctx, text, x + 5, y + 2, colour, size);
  rect(ctx, x + 2, y + 2, 1, 4, '#e1f4ef');
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], c = ring[j];
    if ((a[1] > y) !== (c[1] > y) && x < (c[0] - a[0]) * (y - a[1]) / (c[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function pointInFootprint(x, y, b) {
  if (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) return false;
  if (!b.polygon) return true;
  return pointInRing(x, y, b.polygon) && !(b.holes || []).some(ring => pointInRing(x, y, ring));
}

function beamLength(vehicle, world) {
  const co = Math.cos(vehicle.angle || 0), si = Math.sin(vehicle.angle || 0);
  const start = { x: vehicle.x + co * 15, y: vehicle.y + si * 15 };
  let length = 65;
  const nearby = renderCandidates(world, { x: start.x - length, y: start.y - length, w: length * 2, h: length * 2 });
  // A short sampled ray prevents a headlight from shining through actual walls.
  for (let step = 5; step < length; step += 5) {
    const x = start.x + co * step, y = start.y + si * step;
    const hit = nearby.some(b => !b.destroyed && (b.hp ?? 1) > 0 && pointInFootprint(x, y, b));
    if (hit) { length = Math.max(8, step - 2); break; }
  }
  return length;
}
function headlights(ctx, c, world) {
  if (materialLight.lamps < .001) return;
  const reach = beamLength(c, world), end = 15 + reach;
  ctx.save();
  for (const [length, width, alpha] of [[end, reach * 0.29, 0.045], [end - 5, reach * 0.2, 0.055], [end - 12, reach * 0.13, 0.08]]) {
    ctx.globalAlpha = alpha * materialLight.lamps;
    polygon(ctx, pointsAt(c, [[14, -5], [14, 5], [length, width], [length + 3, 0], [length, -width]]), '#ffedb3');
  }
  ctx.globalAlpha = 0.15 * materialLight.lamps;
  for (const side of [-3, 3]) polygon(ctx, pointsAt(c, [[14, side - 1], [14, side + 1], [end - 5, side + reach * 0.055], [end, side], [end - 5, side - reach * 0.055]]), '#fff4cc');
  ctx.restore();
}
const seaPointCache = new WeakMap();
function eveningLights(ctx, game, camera, t, reducedEffects, nearbyBuildings = [], nearbyScenery = []) {
  if (hasPhotograph(game.world)) {
    if (materialLight.lamps < .001) return;
    for (const b of nearbyBuildings) if (!b.destroyed) storefrontGlow(ctx, b, game.world);
    for (const item of nearbyScenery) if (item.kind === 'lamppost' || item.kind === 'lamp')
      onTerrain(ctx, game.world, item, () => lampGlow(ctx, item.x, item.y, item.lightColor || '#ffc493'));
    for (const c of game.cars || []) if (!c.destroyed && (c.id === game.vehicleId || (c.kind === 'traffic' && Math.abs(c.speed || 0) > 5)) && visible(c, camera, 100))
      onTerrain(ctx, game.world, c, () => headlights(ctx, c, game.world));
    for (const c of game.police || []) if (!c.vehicleId && !c.dead && !c.onFoot && visible(c, camera, 100))
      onTerrain(ctx, game.world, c, () => headlights(ctx, c, game.world));
    return;
  }
  for (const b of nearbyBuildings) {
    if (!b.destroyed && visible(b, camera, 70)) storefrontGlow(ctx, b, game.world);
  }
  for (const item of game.world.scenery || []) {
    if ((item.kind === 'lamppost' || item.kind === 'lamp') && visible(item, camera, 60)) onTerrain(ctx, game.world, item, () => lampGlow(ctx, item.x, item.y, item.lightColor || '#ffc493'));
    if ((item.theme === 'radio-kiosk' || item.theme === 'cassette-stall' || item.theme === 'pizzeria') && visible(item, camera, 45)) {
      const colour = item.theme === 'radio-kiosk' ? '#66dedb' : item.theme === 'cassette-stall' ? '#b69df5' : '#e99486';
      onTerrain(ctx, game.world, item, () => lightPool(ctx, item.x + (item.w || 0) / 2, item.y + (item.h || 0), colour, 25, .45));
    }
    if (item.kind === 'water' && visible(item, camera, 60)) {
      const x0 = Math.max(item.x, camera.x), x1 = Math.min(item.x + item.w, camera.x + camera.width);
      const phase = reducedEffects ? 0 : Math.floor(t * 0.8) % 4;
      ctx.save();
      for (let x = x0 + 12; x < x1; x += 35) {
        const y = item.y + 8 + hash(x, item.y, 88) * Math.max(8, item.h - 12);
        ctx.globalAlpha = 0.17;
        rect(ctx, x + phase, y, 9, 1, '#67bdbf');
        rect(ctx, x + 3 + phase, y + 2, 3, 1, '#9ed1d1');
      }
      // Reflections align with genuine lights along this actual quayside.
      for (const light of game.world.scenery || []) {
        if ((light.kind !== 'lamppost' && light.kind !== 'lamp') || light.y > item.y || item.y - light.y > 85 || light.x < x0 || light.x > x1) continue;
        ctx.globalAlpha = 0.16 * materialLight.lamps;
        for (let dy = 4; dy < Math.min(item.h, 36); dy += 5) rect(ctx, light.x - 5 + (dy % 3), item.y + dy, 10 - dy / 5, 2, '#ffda8b');
      }
      ctx.restore();
    }
  }
  const land = rings(game.world.landPolygons), seas = rings(game.world.seaPolygons);
  if (land.length || seas.length) {
    let points = seaPointCache.get(game.world);
    if (!points) { points = new Map(); seaPointCache.set(game.world, points); }
    const isSea = (x, y) => {
      const key = `${x.toFixed(3)},${y.toFixed(3)}`;
      if (points.has(key)) return points.get(key);
      const sea = seas.length ? seas.some(ring => pointInRing(x, y, ring)) : !land.some(ring => pointInRing(x, y, ring));
      points.set(key, sea); while (points.size > 2048) points.delete(points.keys().next().value); return sea;
    };
    const phase = reducedEffects ? 0 : Math.floor(t * 0.8) % 4;
    ctx.save(); ctx.globalAlpha = .13 + materialLight.daylight * .12;
    // Sample only the visible coast, following the imported shoreline exactly.
    for (let y = Math.floor(camera.y / 44) * 44; y < camera.y + camera.height; y += 44) {
      for (let x = Math.floor(camera.x / 62) * 62; x < camera.x + camera.width; x += 62) {
        const px = x + hash(x, y, 93) * 11 + phase, py = y + hash(x, y, 94) * 9;
        if (!isSea(px, py) || !isSea(px + 9, py + 2)) continue;
        rect(ctx, px, py, 9, 1, '#67bdbf'); rect(ctx, px + 3, py + 2, 3, 1, '#9ed1d1');
      }
    }
    for (const light of game.world.scenery || []) {
      if ((light.kind !== 'lamppost' && light.kind !== 'lamp') || !visible(light, camera, 60)) continue;
      ctx.globalAlpha = .13 * materialLight.lamps;
      for (let dy = 12; dy < 72; dy += 6) {
        if (!isSea(light.x, light.y + dy)) continue;
        rect(ctx, light.x - 4 + (dy % 5), light.y + dy, 7 - Math.floor(dy / 18), 1, '#ffda8b');
      }
    }
    ctx.restore();
  }
  for (const c of game.cars || []) if (!c.destroyed && (c.id === game.vehicleId || (c.kind === 'traffic' && Math.abs(c.speed || 0) > 5)) && visible(c, camera, 100)) onTerrain(ctx, game.world, c, () => headlights(ctx, c, game.world));
  for (const c of game.police || []) if (!c.dead && !c.destroyed && !c.onFoot && visible(c, camera, 100)) onTerrain(ctx, game.world, c, () => headlights(ctx, c, game.world));
}

function car(ctx, vehicle, t, police = false, occupied = false, reducedEffects = false) {
  drawArcadeCar(ctx, vehicle, t, { police, occupied, reducedEffects, externalEffects: true, lighting: materialLight, skipShadow: vehicleVisualLift(vehicle) > 0 });
  drawFire(ctx, vehicle, t, { reducedEffects });
}
export function foliageProfile(tree) {
  const scrub = (tree.kind || tree.type) === 'scrub';
  return { radius: clamp(tree.radius || 8, 2, 40), scrub,
    height: scrub ? 0 : Math.max(0, tree.heightMeters || 4) * ELEVATION_SCALE,
    legsOnly: scrub || (tree.heightMeters || 4) < 1.6 };
}
const foliageContourCache = new Map();
const foliageProjectionCache = new WeakMap();
function foliageProjection(world, object) {
  let index = foliageProjectionCache.get(world);
  if (!index) { index = new WeakMap(); foliageProjectionCache.set(world, index); }
  let value = index.get(object);
  if (!value || value.x !== object.x || value.y !== object.y || value.terrain !== world.terrain) {
    const elevation = sampleElevation(world, object.x, object.y);
    value = { x: object.x, y: object.y, terrain: world.terrain, elevation, lift: Math.max(0, elevation) * ELEVATION_SCALE };
    index.set(object, value);
  }
  return value;
}
function foliageContour(tree) {
  let contour = foliageContourCache.get(tree);
  if (contour) return contour;
  if (Array.isArray(tree.canopyPolygon) && tree.canopyPolygon.length >= 3) contour = tree.canopyPolygon;
  else {
    const { radius } = foliageProfile(tree), seed = hash(tree.x, tree.y) * 10;
    contour = Array.from({ length: 24 }, (_, i) => {
      const angle = i / 24 * Math.PI * 2, r = radius * (.89 + .075 * Math.sin(angle * 5 + seed) + .035 * Math.sin(angle * 9 - seed));
      return [tree.x + Math.cos(angle) * r, tree.y + Math.sin(angle) * r * .87];
    });
  }
  foliageContourCache.set(tree, contour);
  while (foliageContourCache.size > 512) foliageContourCache.delete(foliageContourCache.keys().next().value);
  return contour;
}
function polygonsTouch(a, b) {
  if (a.some(([x, y]) => pointInRing(x, y, b)) || b.some(([x, y]) => pointInRing(x, y, a))) return true;
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const p = a[i], q = a[(i + 1) % a.length], r = b[j], s = b[(j + 1) % b.length];
    if (Math.max(Math.min(p[0], q[0]), Math.min(r[0], s[0])) > Math.min(Math.max(p[0], q[0]), Math.max(r[0], s[0]))
      || Math.max(Math.min(p[1], q[1]), Math.min(r[1], s[1])) > Math.min(Math.max(p[1], q[1]), Math.max(r[1], s[1]))) continue;
    if (cross(p, q, r) * cross(p, q, s) <= 0 && cross(r, s, p) * cross(r, s, q) <= 0) return true;
  }
  return false;
}
export function vegetationOccludes(tree, person, world, angle = null) {
  if (!tree || tree.destroyed || !person || person.dead && Number.isFinite(person.deathTimer) && person.deathTimer <= 0) return false;
  const profile = foliageProfile(tree), dx = person.x - tree.x;
  if (Math.abs(dx) > profile.radius + 24) return false;
  const personGround = foliageProjection(world, person), treeGround = foliageProjection(world, tree);
  if (personGround.elevation + (person.altitude || 0) >= treeGround.elevation + (tree.heightMeters || 4)) return false;
  const dy = person.y - personGround.lift - (tree.y - treeGround.lift);
  if (dy < -profile.radius - profile.height - 24 || dy > profile.radius + 24) return false;
  angle ??= !person.kind && !person.onFoot && Number.isFinite(person.aimAngle) ? person.aimAngle : person.dir ?? person.angle ?? 0;
  const actor = { x: person.x, y: tree.y + dy, angle };
  const body = pointsAt(actor, profile.legsOnly ? [[-11, -4.3], [-2.8, -4.3], [-2.8, 4.3], [-11, 4.3]] : [[-12, -8], [21, -8], [21, 8], [-12, 8]]);
  // Use the same real/estimated crown contour as the painter. Low vegetation
  // counts only a contact with legs, rather than with the actor's head.
  const contour = foliageContour(tree);
  return (profile.height > 0 ? [0, profile.height] : [0]).some(lift => polygonsTouch(body, contour.map(([x, y]) => [x, y - lift])));
}
export function foliageDepth(tree, world, people = []) {
  const profile = foliageProfile(tree);
  let depth = tree.y - foliageProjection(world, tree).lift + profile.radius + 2;
  for (const person of people) if (vegetationOccludes(tree, person, world))
    depth = Math.max(depth, person.y - foliageProjection(world, person).lift + .5);
  return depth;
}
function crownPath(ctx, radius, seed, tree = null) {
  ctx.beginPath();
  if (tree) {
    foliageContour(tree).forEach(([x, y], i) => i ? ctx.lineTo(x - tree.x, y - tree.y) : ctx.moveTo(x - tree.x, y - tree.y));
    ctx.closePath(); return;
  }
  // Photo-derived clusters have irregular edges; this contour is an artistic
  // volume, not a claim to have surveyed the individual crown boundary.
  for (let i = 0; i <= 24; i++) {
    const a = i / 24 * Math.PI * 2, r = radius * (.89 + .075 * Math.sin(a * 5 + seed) + .035 * Math.sin(a * 9 - seed));
    const x = Math.cos(a) * r, y = Math.sin(a) * r * .87;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}
function foliageBitmap(ctx, tree, world) {
  const { radius } = foliageProfile(tree);
  const bounds = { x: tree.x - radius, y: tree.y - radius, w: radius * 2, h: radius * 2 };
  const signature = aerialImagery.signature(world, bounds), seed = hash(tree.x, tree.y) * 10;
  let entry = foliageCache.get(tree);
  if (entry && entry.signature !== signature) { foliageBytes -= entry.bytes; foliageCache.delete(tree); entry = null; }
  if (!entry) {
    const image = canvasFor(ctx, radius * 2 + 2, radius * 2 + 2), paint = image?.getContext('2d');
    if (!paint) return null;
    paint.translate(radius + 1, radius + 1); crownPath(paint, radius, seed, tree); paint.clip();
    paint.fillStyle = tree.color || '#677967'; paint.fill();
    paint.save(); paint.translate(-tree.x, -tree.y); drawPhotograph(paint, world, bounds); paint.restore();
    const shade = paint.createLinearGradient(-radius * .65, -radius, radius * .8, radius);
    shade.addColorStop(0, 'rgba(220,230,189,.11)'); shade.addColorStop(.45, 'rgba(35,55,35,0)'); shade.addColorStop(1, 'rgba(12,33,26,.26)');
    paint.fillStyle = shade; paint.fillRect(-radius - 1, -radius - 1, radius * 2 + 2, radius * 2 + 2);
    entry = { image, signature, bytes: image.width * image.height * 4 }; foliageBytes += entry.bytes;
  }
  foliageCache.delete(tree); foliageCache.set(tree, entry);
  while (foliageCache.size > 256 || foliageBytes > FOLIAGE_CACHE_BYTES) {
    const oldest = foliageCache.keys().next().value; foliageBytes -= foliageCache.get(oldest).bytes; foliageCache.delete(oldest);
  }
  return entry;
}
function foliageShadow(ctx, tree) {
  const { radius, height, scrub } = foliageProfile(tree);
  if (scrub) return;
  ctx.save(); ctx.globalAlpha *= .22;
  ellipse(ctx, tree.x + materialLight.shadowX * height * .5, tree.y + materialLight.shadowY * height * .35, radius * .9, radius * .6, '#142e26');
  ctx.restore();
}
function foliageTrunk(ctx, tree) {
  const { height, scrub } = foliageProfile(tree);
  if (!scrub) line(ctx, tree.x, tree.y, tree.x - .6, tree.y - height, surfaceColour('#283439', '#655e47'), 1.6);
}
function photographedFoliage(ctx, tree, world, native = false) {
  const { radius, height } = foliageProfile(tree), entry = foliageBitmap(ctx, tree, world);
  if (!entry) return;
  const seed = hash(tree.x, tree.y) * 10;
  ctx.save(); ctx.translate(tree.x, tree.y);
  ctx.translate(0, native ? 0 : -height); ctx.drawImage(entry.image, -radius - 1, -radius - 1);
  if (materialLight.night > .001) {
    crownPath(ctx, radius, seed, tree); ctx.clip(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha *= materialLight.night * .62;
    rect(ctx, -radius - 1, -radius - 1, radius * 2 + 2, radius * 2 + 2, '#31546a');
  }
  ctx.restore();
}
function photographicActorOcclusion(ctx, tree, person, world, angle) {
  if (!vegetationOccludes(tree, person, world, angle)) return false;
  const profile = foliageProfile(tree), projected = { x: person.x, y: person.y - liftAt(world, person.x, person.y), angle };
  ctx.save();
  // Low scrub hides the trailing feet, preserving the head and shoulders.
  // Taller crowns cover the body only where photographic leaves intersect.
  path(ctx, pointsAt(projected, profile.legsOnly ? [[-11, -4.3], [-2.8, -4.3], [-2.8, 4.3], [-11, 4.3]]
    : [[-12, -8], [21, -8], [21, 8], [-12, 8]])); ctx.clip();
  onTerrain(ctx, world, tree, () => photographedFoliage(ctx, tree, world, true));
  ctx.restore(); return true;
}
const rippleCellsCache = new WeakMap();
function seaRipples(ctx, world, bounds, time, reducedEffects) {
  let cache = rippleCellsCache.get(world);
  if (!cache) { cache = new Map(); rippleCellsCache.set(world, cache); }
  let count = 0;
  ctx.save(); ctx.lineWidth = .42; ctx.strokeStyle = materialLight.daylight > .5 ? '#c3e1dc' : '#8fbdce';
  for (let row = Math.floor(bounds.y / 44); row <= Math.floor((bounds.y + bounds.h) / 44); row++)
    for (let column = Math.floor(bounds.x / 44); column <= Math.floor((bounds.x + bounds.w) / 44); column++) {
      const key = `${column},${row}`;
      let cell = cache.get(key);
      if (cell === undefined) {
        const seed = hash(column, row, 71), x = column * 44 + 9 + seed * 24, y = row * 44 + 10 + hash(column, row, 72) * 22;
        cell = seed < .54 && [[0, 0], [-10, 0], [10, 0], [0, -5], [0, 5]].every(([dx, dy]) => photographicSeaAt(world, x + dx, y + dy))
          ? { x, y, seed, width: 4 + seed * 8 } : null;
        cache.set(key, cell);
      }
      if (!cell || count >= 128) continue;
      const phase = (reducedEffects ? 0 : time * .8) + cell.seed * Math.PI * 8;
      const strength = .025 + (.035 + .045 * materialLight.daylight) * (.5 + .5 * Math.sin(phase));
      const dy = Math.sin(phase) * .7;
      if (![[cell.x - cell.width, cell.y + dy], [cell.x, cell.y + dy - .8], [cell.x + cell.width, cell.y + dy]].every(([x, y]) => waterSurfaceContains(world, x, y))) continue;
      ctx.globalAlpha = strength;
      ctx.beginPath(); ctx.moveTo(cell.x - cell.width, cell.y + dy);
      ctx.quadraticCurveTo(cell.x, cell.y + dy - .8, cell.x + cell.width, cell.y + dy); ctx.stroke(); count++;
    }
  while (cache.size > 1024) cache.delete(cache.keys().next().value);
  ctx.restore(); return count;
}
function aircraftShadow(ctx, vehicle) {
  const lift = vehicleVisualLift(vehicle);
  if (lift < .5 || vehicle.destroyed) return;
  ctx.save(); ctx.translate(vehicle.x + lift * .16 * (materialLight.shadowX ?? .65), vehicle.y + lift * .16 * (materialLight.shadowY ?? .85));
  ctx.rotate(vehicle.angle || 0); ctx.globalAlpha *= Math.max(.07, .22 - lift / 1300);
  const expansion = 1 + Math.min(.2, lift / 700);
  ctx.scale(expansion, expansion);
  const photoDimensions = photographicVehicleDimensions(vehicle);
  if (photoDimensions?.type === 'plane') ctx.scale(photoDimensions.length / 44, photoDimensions.width / 52);
  if (vehicle.mobilityType === 'plane') {
    polygon(ctx, [[-22, -2], [-7, -4], [-4, -26], [3, -26], [6, -4], [22, -2], [22, 2], [6, 4], [3, 26], [-4, 26], [-7, 4], [-22, 2]], '#102630');
  } else {
    ellipse(ctx, -1, 0, 22, 3.5, '#102630'); ellipse(ctx, 0, 0, 8, 6, '#102630');
  }
  ctx.restore();
}

function actor(ctx, person, t, player = false, reducedEffects = false) {
  drawArcadeActor(ctx, person, t, { player, reducedEffects, lighting: materialLight });
  if (person.dead || person.knockedDown) return;
  const uniform = person.kind === 'gendarme' || person.role === 'officer' || person.onFoot;
  if (!player && !uniform) return;
  const a = { ...person, angle: player && Number.isFinite(person.aimAngle) ? person.aimAngle : person.dir || person.angle || 0 };
  const recoil = (person.recoil || 0) * 1.5, id = person.weaponId, launcher = id === 'launcher', smg = id === 'smg', rifle = id === 'rifle', shotgun = id === 'shotgun', carbine = id === 'carbine';
  const length = launcher ? 9 : rifle ? 14 : shotgun ? 11 : carbine ? 10 : smg ? 7 : 5.5;
  boxAt(ctx, a, 4.4 - recoil, 1.1, length, launcher ? 2.2 : shotgun ? 1.8 : 1.15, launcher ? '#839b87' : '#536a80');
  boxAt(ctx, a, 3.1 + length - recoil, launcher ? .8 : .9, launcher ? 2.4 : 1.6, launcher ? 2.8 : 1.35, '#b7d5d8');
  if (smg || carbine) boxAt(ctx, a, 6.3 - recoil, 2.1, .8, 1.6, '#384a60');
  if (rifle) { boxAt(ctx, a, 6 - recoil, -.1, 4, .9, '#273846'); boxAt(ctx, a, 3.3 - recoil, 1.4, 3.3, 1.8, '#746653'); }
  if (shotgun) { boxAt(ctx, a, 9 - recoil, 1, 3.3, 1.9, '#82715b'); boxAt(ctx, a, 7 - recoil, 2.4, 6.8, .45, '#adc0c4'); }
  if (carbine) boxAt(ctx, a, 3.5 - recoil, 1.8, 2.6, 1.8, '#3f525c');
  boxAt(ctx, a, 4.4 - recoil, 2.05, 1.9, .65, player ? '#3a5b54' : '#426e8f');
  if (person.muzzleFlash > 0) muzzle(ctx, person, a.angle, reducedEffects);
}

function muzzle(ctx, person, angle, reducedEffects = false, inCar = false) {
  const o = { x: person.x, y: person.y, angle };
  const reach = inCar ? 19 : person.weaponId === 'rifle' ? 19 : person.weaponId === 'shotgun' ? 16 : person.weaponId === 'carbine' ? 15 : 12;
  polygon(ctx, pointsAt(o, [[reach, 0], [reach + 2, -3], [reach + 3, -1], [reach + 7, -2], [reach + 5, 0], [reach + 7, 2], [reach + 3, 1], [reach + 2, 3]]), '#ffc978');
  if (!reducedEffects) boxAt(ctx, o, reach, -1, 4, 2, '#fff2bb');
}
function projectile(ctx, shot, world, reducedEffects) {
  const a = [shot.prevX ?? shot.x - Math.cos(shot.angle || 0) * 6, shot.prevY ?? shot.y - Math.sin(shot.angle || 0) * 6];
  const b = [shot.x, shot.y];
  const altitude = Number.isFinite(shot.altitude) ? Math.max(0, shot.altitude) : 0;
  const previousAltitude = Number.isFinite(shot.prevAltitude) ? Math.max(0, shot.prevAltitude) : altitude;
  const startY = a[1] - liftAt(world, a[0], a[1]) - previousAltitude * ELEVATION_SCALE;
  const endY = b[1] - liftAt(world, b[0], b[1]) - altitude * ELEVATION_SCALE;
  if (shot.explosive) {
    const o = { ...shot, y: endY, angle: shot.angle || Math.atan2(shot.vy || 0, shot.vx || 1) };
    boxAt(ctx, o, -4, -1, 8, 3, '#b3a875'); boxAt(ctx, o, 3, 0, 3, 1, '#ffdf95');
    if (!reducedEffects) { ctx.save(); ctx.globalAlpha = 0.5; line(ctx, a[0], startY, b[0], endY, '#c9cbb1', 2); ctx.restore(); }
  } else {
    ctx.save(); ctx.globalAlpha = reducedEffects ? 0.7 : 0.9;
    line(ctx, a[0], startY, b[0], endY, '#ffe7a0'); rect(ctx, b[0], endY, 2, 2, '#fff3be'); ctx.restore();
  }
}

function marker(ctx, x, y, number, complete = false, t = 0, reducedEffects = false) {
  const bob = reducedEffects ? 0 : Math.round(Math.sin(t * 3) * 1);
  ellipse(ctx, x, y + 3, 12, 5, complete ? '#819b71' : '#b29a60');
  const color = complete ? '#91d9a7' : C.orange;
  polygon(ctx, [[x - 9, y - 15 + bob], [x + 9, y - 15 + bob], [x + 9, y - 1 + bob],
    [x + 3, y - 1 + bob], [x, y + 3 + bob], [x - 3, y - 1 + bob], [x - 9, y - 1 + bob]], C.ink);
  rect(ctx, x - 7, y - 13 + bob, 14, 10, color);
  ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = C.ink;
  ctx.fillText(complete ? '✓' : String(number), Math.round(x), Math.round(y - 8 + bob));
}
function circle(ctx, x, y, radius, color, dash = false) {
  let last;
  for (let i = 0; i <= 100; i++) {
    const angle = i / 100 * Math.PI * 2;
    const p = [Math.round(x + Math.cos(angle) * radius), Math.round(y + Math.sin(angle) * radius)];
    if (last && (!dash || Math.floor(i / 5) % 2 === 0)) line(ctx, ...last, ...p, color);
    last = p;
  }
}
function bottle(ctx, b, t, reducedEffects) {
  const fraction = clamp(b.fuse / (b.maxFuse || 2.6), 0, 1);
  // A radial countdown is a game cue; it contains no real-world instructions.
  ctx.globalAlpha = reducedEffects ? 0.12 : 0.1 + Math.sin(t * 7) * 0.025;
  ellipse(ctx, b.x, b.y, 58, 58, '#ed9a50'); ctx.globalAlpha = 1;
  circle(ctx, b.x, b.y, 58, '#d19a50', true);
  ellipse(ctx, b.x + 2, b.y + 3, 5, 4, '#7b7c5c');
  rect(ctx, b.x - 4, b.y - 5, 8, 10, '#243747');
  rect(ctx, b.x - 3, b.y - 5, 6, 9, '#d67843');
  rect(ctx, b.x - 3, b.y - 4, 2, 6, '#ffbf67');
  rect(ctx, b.x - 1, b.y - 7, 2, 3, '#d7c896');
  rect(ctx, b.x - 2, b.y - 8, 4, 1, '#6d8178');
  rect(ctx, b.x - 2, b.y - 1, 4, 3, '#eedcb0');
  rect(ctx, b.x - 8, b.y - 14, 16, 3, C.ink);
  rect(ctx, b.x - 7, b.y - 13, Math.max(1, Math.round(14 * fraction)), 1, '#ffd466');
}
function roadblockCue(ctx, block, t, reducedEffects) {
  const pulse = reducedEffects ? .6 : .45 + Math.sin(t * 4) * .12;
  ctx.save(); ctx.globalAlpha *= block.active ? .42 : pulse;
  const o = { ...block, angle: block.angle || 0 };
  if (!block.active) {
    ctx.setLineDash([4, 3]); ctx.strokeStyle = '#d1ab66'; ctx.lineWidth = .8;
    ctx.beginPath(); ctx.ellipse(block.x, block.y, 25, 17, 0, 0, Math.PI * 2); ctx.stroke();
    label(ctx, 'BARRAGE', block.x - 19, block.y - 28, '#dfbc83', 5);
  } else {
    // Mark only the occupied vehicle side, preserving the physical escape lane.
    for (const side of [-1, 1]) boxAt(ctx, o, side * 19 - 1.7, -5, 3.4, 3.4, '#d8a16a');
  }
  ctx.restore();
}
function helicopterGround(ctx, helicopter, world) {
  if (!helicopter?.active) return;
  onTerrain(ctx, world, helicopter, () => {
    ctx.save(); ctx.globalAlpha *= .19;
    const offset = Math.min(18, (helicopter.altitude || 80) * .13);
    ellipse(ctx, helicopter.x + offset, helicopter.y + offset, 25, 14, '#172a30'); ctx.restore();
  });
  if (helicopter.visible && helicopter.searchlight && materialLight.lamps > .01) {
    const p = helicopter.searchlight;
    onTerrain(ctx, world, p, () => lightPool(ctx, p.x, p.y, '#f4e9c1', 35, 1.8));
    const fromY = helicopter.y - liftAt(world, helicopter.x, helicopter.y) - (helicopter.altitude || 80), toY = p.y - liftAt(world, p.x, p.y);
    ctx.save(); ctx.globalAlpha *= materialLight.lamps * .04;
    polygon(ctx, [[helicopter.x - 2, fromY], [helicopter.x + 2, fromY], [p.x + 18, toY + 6], [p.x - 18, toY + 6]], '#f0ead6'); ctx.restore();
  }
}
function helicopterBody(ctx, helicopter, t, reducedEffects) {
  if (!helicopter?.active) return;
  const y = helicopter.y - (helicopter.altitude || 80);
  ctx.save(); ctx.translate(helicopter.x, y); ctx.rotate(helicopter.angle || 0);
  const hull = surfaceColour('#42657c', '#63848c');
  polygon(ctx, [[-12, -5], [-4, -7], [9, -6], [14, -3], [15, 2], [10, 6], [-7, 6], [-13, 3]], '#233b45');
  polygon(ctx, [[-11, -4], [-3, -6], [8, -5], [12, -2], [12, 3], [7, 5], [-6, 5]], hull);
  polygon(ctx, [[5, -4.4], [9, -3.7], [12, -1.5], [12, 2.8], [8, 4], [5, 4]], '#284954');
  line(ctx, 6, -3.5, 10, -2.2, '#b3d0c7', .6); line(ctx, 8.3, -3.2, 8.3, 3.7, '#668d95', .5);
  polygon(ctx, [[-11, -2.6], [-31, -1], [-33, 1.2], [-12, 2.8]], '#4e6f7c');
  line(ctx, -30, -1.7, -28, -6, '#afbeb9', 1.4); line(ctx, -30, 1.5, -28, 5.5, '#6b8e96', 1.2);
  line(ctx, -9, -8, 9, -8, '#202f37', 1.1); line(ctx, -9, 8, 9, 8, '#202f37', 1.1);
  for (const x of [-7, 6]) { line(ctx, x, -5, x, -8, '#a3aaa2', .6); line(ctx, x, 5, x, 8, '#a3aaa2', .6); }
  ctx.save(); ctx.rotate(reducedEffects ? .65 : helicopter.rotor || t * 32);
  ctx.globalAlpha *= reducedEffects ? .7 : .42;
  for (const angle of [0, Math.PI / 2]) { ctx.save(); ctx.rotate(angle); polygon(ctx, [[-27, -.9], [-9, -1.2], [25, -.6], [27, .6], [9, 1.1], [-26, .6]], '#293e43'); ctx.restore(); }
  ctx.restore(); ellipse(ctx, -1, 0, 1.8, 1.8, '#9fada8');
  rect(ctx, 1, -5.5, 1, 1, '#ce7968'); rect(ctx, 1, 4.5, 1, 1, '#8dbb99'); ctx.restore();
}
function policeFireCue(ctx, unit, world, focus) {
  if (!(unit.fireWindup > 0) || unit.dead || !focus) return;
  const angle = Number.isFinite(unit.aimAngle) ? unit.aimAngle : Math.atan2(focus.y - unit.y, focus.x - unit.x);
  const length = Math.min(230, Math.hypot(focus.x - unit.x, focus.y - unit.y));
  ctx.save(); ctx.globalAlpha = .25 + Math.max(0, 1 - unit.fireWindup / 1.25) * .25;
  ctx.strokeStyle = '#d88773'; ctx.lineWidth = .7; ctx.setLineDash([4, 5]); ctx.beginPath();
  ctx.moveTo(unit.x, unit.y - liftAt(world, unit.x, unit.y));
  const x = unit.x + Math.cos(angle) * length, y = unit.y + Math.sin(angle) * length;
  ctx.lineTo(x, y - liftAt(world, x, y)); ctx.stroke(); ctx.restore();
}
export function render(ctx, game, { reducedEffects = false, time = 0 } = {}) {
  const width = ctx.canvas?.viewWidth || ctx.canvas?.width || WIDTH, height = ctx.canvas?.viewHeight || ctx.canvas?.height || HEIGHT;
  const density = ctx.canvas?.renderScale || 1;
  const scaleX = ctx.canvas?.renderScaleX || density, scaleY = ctx.canvas?.renderScaleY || density;
  ctx.save(); ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, ctx.canvas?.width || width, ctx.canvas?.height || height);
  ctx.scale(scaleX, scaleY);
  const world = game.world;
  if (!world) { rect(ctx, 0, 0, width, height, '#263944'); ctx.restore(); return; }
  currentRenderWorld = world;
  const camera = cameraFor(game, ctx.canvas), t = Number.isFinite(game.elapsed) ? game.elapsed : time / 1000;
  const rawBounds = { x: camera.x - 140, y: camera.y - 140, w: camera.width + 280, h: camera.height + maximumLift(world) + 280 };
  const nearbyBuildings = renderCandidates(world, rawBounds).filter(item => visible(item, camera, 140));
  const nearbyScenery = renderCandidates(world, rawBounds, 'scenery').filter(item => visible(item, camera, 65));
  const photo = hasPhotograph(world);
  const photoBounds = photoViewBounds(game, ctx.canvas);
  aerialImagery.request(world, photoBounds);
  const nearTrees = renderCandidates(world, rawBounds, 'vegetation').filter(item => !item.destroyed && visible(item, camera, (item.radius || 8) + (item.heightMeters || 0) * ELEVATION_SCALE + 8));
  const hasSourcedVegetation = renderIndex(world).sourcedVegetation;
  const groundPeople = [...renderIndex(world).people, ...(game.police || []).filter(unit => unit.onFoot || unit.kind === 'gendarme' || unit.role === 'officer'), ...(!game.vehicle && game.player ? [game.player] : [])]
    .filter(person => visible(person, camera, 30) && !(person.dead && Number.isFinite(person.deathTimer) && person.deathTimer <= 0));
  const personSet = new Set(groundPeople);
  const nearMasks = renderCandidates(world, photoBounds, 'masks');
  frameDetails = { vegetationVisible: nearTrees.length, seaRippleCount: 0, aerialMaskCount: nearMasks.length,
    maskSignature: nearMasks.map(mask => mask.annotationId || mask.vehicleId).sort().join('|'), actorUnderCanopy: 0, actorsInLowVegetation: 0, playerUnderCanopy: false };
  setMaterialLight(renderLighting(game));
  rect(ctx, 0, 0, width, height, C.seaDark);
  ctx.translate(-camera.x, -camera.y);
  backdrop(ctx, world, camera); terrainCliffs(ctx, world, camera); municipalBorder(ctx, world, camera);
  if (photo) frameDetails.seaRippleCount = seaRipples(ctx, world, photoBounds, t, reducedEffects);
  // Persistent marks belong to the street surface, below bodies and vehicles.
  for (const decal of game.blood || []) if (visible(decal, camera, 35)) onTerrain(ctx, world, decal, () => drawBloodDecal(ctx, decal, t, { reducedEffects }));
  for (const b of nearbyBuildings) onTerrain(ctx, world, b, () => buildingShadow(ctx, b, photo));
  for (const tree of nearTrees) onTerrain(ctx, world, tree, () => {
    foliageShadow(ctx, tree);
    // The native crown is also a leaf surface, not pavement. Paint the same
    // cached material before actors and during their occlusion, avoiding a
    // brighter rectangular patch that would appear only beneath a moving body.
    photographedFoliage(ctx, tree, world, true);
  });
  for (const c of game.cars || []) if (vehicleVisualLift(c) > 0 && visible(c, camera, 180)) onTerrain(ctx, world, c, () => aircraftShadow(ctx, c));
  eveningLights(ctx, game, camera, t, reducedEffects, nearbyBuildings, nearbyScenery);
  if (game.helicopter && visible(game.helicopter, camera, 180)) helicopterGround(ctx, game.helicopter, world);
  for (const block of game.roadblocks || []) if (visible(block, camera, 50)) onTerrain(ctx, world, block, () => roadblockCue(ctx, block, t, reducedEffects));
  const rendezvous = game.rendezvous;
  if (rendezvous && visible(rendezvous, camera, 50)) onTerrain(ctx, world, rendezvous, () => {
    circle(ctx, rendezvous.x, rendezvous.y, rendezvous.radius || 36, game.demolished >= 3 ? '#b0e3a5' : '#85a995', true);
    label(ctx, 'RENDEZ-VOUS', rendezvous.x - 30, rendezvous.y + 40, '#d6dfb3', 6);
    if (game.demolished >= 3) marker(ctx, rendezvous.x, rendezvous.y, '↗', false, t, reducedEffects);
  });
  const objects = [];
  const queue = (object, paint, depth = null) => {
    const foliage = object.kind === 'tree' || object.kind === 'scrub' || object.type === 'tree' || object.type === 'scrub';
    if (!visible(object, camera, foliage ? (object.radius || 8) + (object.heightMeters || 0) * ELEVATION_SCALE + 8 : object.polygon || object.w > 28 && object.h > 28 ? 130 : 55)) return;
    const airLift = vehicleVisualLift(object);
    objects.push({ object, paint, airLift, depth: depth ?? (airLift > .5 ? camera.y + camera.height + 100 + airLift
      : object.y + (object.h || 0) - liftAt(world, object.x + (object.w || 0) / 2, object.y + (object.h || 0) / 2)) });
  };
  for (const b of nearbyBuildings) queue(b, () => {
    ctx.save(); if (buildingOccludes(b, game.vehicle || game.player, world)) ctx.globalAlpha *= .5;
    building(ctx, b, world); ctx.restore();
    drawFire(ctx, b, t, { building: true, reducedEffects });
  });
  for (const tree of nearTrees) if (!foliageProfile(tree).legsOnly) {
    queue(tree, () => foliageTrunk(ctx, tree), tree.y - liftAt(world, tree.x, tree.y));
    queue(tree, () => photographedFoliage(ctx, tree, world), foliageDepth(tree, world, groundPeople));
  }
  for (const item of [...nearbyScenery, ...renderIndex(world).people]) {
    if (item.polygon || item.ground || item.kind === 'water') continue;
    const person = item.kind === 'pedestrian' || item.kind === 'gendarme';
    if (hasSourcedVegetation && ['tree', 'olive', 'maquis', 'bush'].includes(item.kind)) continue;
    if (photo && !person && !['lamppost', 'lamp'].includes(item.kind)) continue;
    queue(item, () => person ? actor(ctx, item, t, false, reducedEffects) : scenery(ctx, item));
  }
  for (const c of game.cars || []) {
    if (c.pendingRoadblock) continue;
    const unit = (game.police || []).find(police => police.vehicleId === c.id);
    queue(c, () => {
    ctx.save(); if (unit?.warn > 0) ctx.globalAlpha *= .4;
    car(ctx, unit ? { ...c, kind: unit.kind, faction: unit.faction } : c, t, c.role === 'police' || c.kind === 'police' || c.lawEnforcement, c.id === game.vehicleId, reducedEffects); ctx.restore();
    if (c.id === game.vehicleId && game.player?.muzzleFlash > 0) muzzle(ctx, c, game.player.aimAngle ?? game.player.dir ?? c.angle, reducedEffects, true);
    });
  }
  for (const c of game.police || []) {
    if (c.vehicleId) continue;
    queue(c, () => {
    ctx.save(); if (c.warn > 0) ctx.globalAlpha *= .4;
    if (c.onFoot || c.kind === 'gendarme' || c.role === 'officer') actor(ctx, c, t, false, reducedEffects);
    else car(ctx, c.dead ? { ...c, wreck: true } : c, t, true, false, reducedEffects);
    ctx.restore();
    });
  }
  if (game.player && !game.vehicle) queue(game.player, () => {
    const flicker = game.player.invulnerable > 0 && !reducedEffects && Math.floor(t * 8) % 2 === 0;
    if (flicker) ctx.globalAlpha = 0.45;
    actor(ctx, { ...game.player, weaponId: game.weapon?.id }, t, true, reducedEffects); ctx.globalAlpha = 1;
  });
  objects.sort((a, b) => a.depth - b.depth);
  for (const entry of objects) onTerrain(ctx, world, entry.object, () => {
    ctx.save(); if (entry.airLift) ctx.translate(0, -entry.airLift); entry.paint();
    if (personSet.has(entry.object)) {
      ctx.save(); ctx.translate(0, liftAt(world, entry.object.x, entry.object.y));
      const angle = entry.object === game.player && Number.isFinite(entry.object.aimAngle) ? entry.object.aimAngle : entry.object.dir ?? entry.object.angle ?? 0;
      let underTree = false, inScrub = false;
      for (const tree of nearTrees) if (photographicActorOcclusion(ctx, tree, entry.object, world, angle)) {
        if (foliageProfile(tree).legsOnly) inScrub = true; else underTree = true;
      }
      if (underTree) frameDetails.actorUnderCanopy++;
      if (inScrub) frameDetails.actorsInLowVegetation++;
      if (entry.object === game.player) frameDetails.playerUnderCanopy = underTree;
      ctx.restore();
    }
    ctx.restore();
  });
  for (const unit of game.police || []) if (visible(unit, camera, 250)) policeFireCue(ctx, unit, world, game.vehicle || game.player);
  if (game.helicopter && visible(game.helicopter, camera, 180)) onTerrain(ctx, world, game.helicopter, () => helicopterBody(ctx, game.helicopter, t, reducedEffects));
  // Indicators remain readable above roofs and light pools, with the same elevation.
  let number = 0;
  for (const b of renderIndex(world).targets) {
    if (!b.target) continue; number++;
    const p = b.approach || { x: b.x + b.w / 2, y: b.y - 15 };
    if (visible(p, camera, 24)) onTerrain(ctx, world, p, () => marker(ctx, p.x, p.y, b.missionNumber || number, b.destroyed, t, reducedEffects));
  }
  for (const b of game.bottles || []) if (visible(b, camera, 70)) onTerrain(ctx, world, b, () => bottle(ctx, b, t, reducedEffects));
  for (const shot of game.projectiles || []) if (visible(shot, camera, 30)) projectile(ctx, shot, world, reducedEffects);
  for (const shot of game.policeShots || []) if (visible(shot, camera, 240)) {
    ctx.save(); ctx.globalAlpha = clamp(shot.life / (shot.maxLife || .14), 0, 1);
    line(ctx, shot.x, shot.y - liftAt(world, shot.x, shot.y), shot.toX, shot.toY - liftAt(world, shot.toX, shot.toY), '#f7c39a', .8); ctx.restore();
  }
  // The visual lifetime is separate from the short physical blast damage window.
  for (const effect of game.explosionEffects ?? game.blasts ?? []) if (visible(effect, camera, (effect.radius || 58) + 90)) onTerrain(ctx, world, effect, () => drawExplosion(ctx, effect, t, { reducedEffects }));
  for (const dust of game.destructionDust || []) if (visible(dust, camera, (dust.radius || 30) + 60)) onTerrain(ctx, world, dust, () => drawDestructionDust(ctx, dust, t, { reducedEffects }));
  for (const p of game.particles || []) if (visible(p, camera)) {
    ctx.globalAlpha = clamp(p.life / (p.maxLife || 1), 0, 1);
    rect(ctx, p.x, p.y - liftAt(world, p.x, p.y), p.size || 2, p.size || 2, p.color || C.cream);
  }
  ctx.globalAlpha = 1;
  for (const popup of game.popups || []) if (visible(popup, camera, 40)) onTerrain(ctx, world, popup, () => {
    ctx.globalAlpha = clamp(popup.life * 2, 0, 1);
    label(ctx, popup.text, popup.x + 1, popup.y + 1, C.ink, 8);
    label(ctx, popup.text, popup.x, popup.y, popup.color || C.cream, 8);
  });
  ctx.restore();
  ctx.save(); ctx.scale(scaleX, scaleY);
  const objective = game.objective;
  if (objective && objective.type !== 'complete') {
    const sx = objective.x - camera.x, sy = objective.y - liftAt(world, objective.x, objective.y) - camera.y;
    if (sx < 12 || sx > width - 12 || sy < 12 || sy > height - 12) {
      const dx = sx - width / 2, dy = sy - height / 2;
      const factor = Math.min((width / 2 - 12) / Math.max(1, Math.abs(dx)), (height / 2 - 12) / Math.max(1, Math.abs(dy)));
      const x = Math.round(width / 2 + dx * factor), y = Math.round(height / 2 + dy * factor), a = Math.atan2(dy, dx);
      ctx.save(); polygon(ctx, pointsAt({ x, y, angle: a }, [[6, 0], [-4, -5], [-2, 0], [-4, 5]]), '#ffe07b'); ctx.restore();
    }
  }
  ctx.restore();
}

const minimapBackdropCache = new WeakMap();
function paintMinimapBase(ctx, world) {
  ctx.save(); ctx.imageSmoothingEnabled = false;
  rect(ctx, 0, 0, 120, 100, '#112435');
  if (!world) { ctx.restore(); return; }
  const sx = 114 / world.width, sy = 94 / world.height;
  const px = x => 3 + x * sx, py = y => 3 + y * sy;
  rect(ctx, 3, 3, 114, 94, rings(world.landPolygons).length ? '#163d53' : '#566d7e');
  for (const ring of rings(world.landPolygons)) polygon(ctx, ring.map(([x, y]) => [px(x), py(y)]), '#566d7e');
  for (const ring of rings(world.seaPolygons)) polygon(ctx, ring.map(([x, y]) => [px(x), py(y)]), '#215569');
  for (const r of world.roads || []) {
    if (r.points) {
      const thickness = Math.max(1, Math.round((r.width || 20) * (sx + sy) / 2));
      for (let i = 1; i < r.points.length; i++) line(ctx, px(r.points[i - 1][0]), py(r.points[i - 1][1]), px(r.points[i][0]), py(r.points[i][1]), '#a3b8c3', thickness);
    } else rect(ctx, px(r.x), py(r.y), Math.max(2, r.w * sx), Math.max(2, r.h * sy), '#a3b8c3');
  }
  for (const b of world.buildings || []) {
    const color = b.destroyed ? '#6d7568' : '#233e53';
    if (b.polygon) {
      polygon(ctx, b.polygon.map(([x, y]) => [px(x), py(y)]), color);
      for (const hole of b.holes || []) polygon(ctx, hole.map(([x, y]) => [px(x), py(y)]), '#566d7e');
    }
    else rect(ctx, px(b.x), py(b.y), Math.max(2, b.w * sx), Math.max(2, b.h * sy), color);
  }
  for (const s of world.scenery || []) if (s.kind === 'water') rect(ctx, px(s.x), py(s.y), s.w * sx, s.h * sy, '#389ca6');
  for (const area of world.municipalBoundary?.polygons || []) {
    ctx.save(); ctx.globalAlpha = .7; ctx.strokeStyle = '#d6ca94'; ctx.lineWidth = .65;
    path(ctx, area.outer.map(([x, y]) => [px(x), py(y)]), (area.holes || []).map(ring => ring.map(([x, y]) => [px(x), py(y)]))); ctx.stroke(); ctx.restore();
  }
  ctx.restore();
}
export function renderMinimap(ctx, game) {
  const world = game.world;
  ctx.save(); ctx.imageSmoothingEnabled = false;
  if (!world) { rect(ctx, 0, 0, 120, 100, '#112435'); ctx.restore(); return; }
  let background = minimapBackdropCache.get(world);
  if (!background) {
    background = canvasFor(ctx, 120, 100);
    if (background) { paintMinimapBase(background.getContext('2d'), world); minimapBackdropCache.set(world, background); }
  }
  if (background) ctx.drawImage(background, 0, 0); else paintMinimapBase(ctx, world);
  const sx = 114 / world.width, sy = 94 / world.height, px = x => 3 + x * sx, py = y => 3 + y * sy;
  for (const b of world.buildings || []) if (b.destroyed) rect(ctx, px(b.x), py(b.y), Math.max(1, b.w * sx), Math.max(1, b.h * sy), '#8d8074');
  const camera = cameraFor(game);
  ctx.globalAlpha = 0.2; rect(ctx, px(camera.x), py(camera.y), camera.width * sx, camera.height * sy, '#eef1bc'); ctx.globalAlpha = 1;
  let number = 0;
  for (const b of world.buildings || []) if (b.target) {
    number++;
    const p = b.approach || { x: b.x, y: b.y };
    rect(ctx, px(p.x) - 3, py(p.y) - 3, 7, 7, b.destroyed ? '#78c591' : '#efb45c');
    label(ctx, String(b.missionNumber || number), px(p.x) - 1, py(p.y) - 2, '#203039', 5);
  }
  if (game.rendezvous) {
    const p = game.rendezvous;
    rect(ctx, px(p.x) - 3, py(p.y) - 3, 6, 6, '#abd7bc');
    rect(ctx, px(p.x) - 1, py(p.y) - 1, 2, 2, '#375c56');
  }
  for (const p of game.police || []) if (!p.dead) rect(ctx, px(p.x) - 1, py(p.y) - 1, 3, 3, p.faction === 'army' ? '#b7c88d' : '#73c7f6');
  for (const b of game.roadblocks || []) if (b.active) rect(ctx, px(b.x) - 1, py(b.y) - 1, 2, 2, '#e0a974');
  if (game.helicopter?.active) rect(ctx, px(game.helicopter.x) - 1, py(game.helicopter.y) - 1, 2, 2, '#d5e5cf');
  const focus = game.vehicle || game.player;
  if (focus) {
    rect(ctx, px(focus.x) - 3, py(focus.y) - 3, 6, 6, '#1e3435');
    rect(ctx, px(focus.x) - 2, py(focus.y) - 2, 4, 4, '#f3eebd');
  }
  ctx.restore();
}

export function renderCelebration(ctx, { time = 0, reducedEffects = false } = {}) {
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, 160, 76);
  const t = Number.isFinite(time) ? time / 1000 : 0;
  const hop = reducedEffects ? 0 : Math.round(Math.max(0, Math.sin(t * 5)) * 2);
  // A small period getaway car and two overhead masked companions celebrate.
  car(ctx, { x: 80, y: 48, angle: 0, color: '#d89056' }, 0, false, false, true);
  actor(ctx, { x: 50, y: 52 - hop, dir: -Math.PI / 2, walk: 0 }, 0, true);
  actor(ctx, { x: 109, y: 52 - hop, dir: -Math.PI / 2, walk: 0 }, 0, true);
  polygon(ctx, [[80, 13], [82, 19], [88, 20], [84, 24], [85, 30], [80, 27], [75, 30], [76, 24], [72, 20], [78, 19]], '#ffd05d');
  for (const x of [48, 108]) {
    line(ctx, x, 23, x - 4, 18, '#ffd05d', 2);
    line(ctx, x + 4, 23, x + 8, 18, '#ffd05d', 2);
  }
  ctx.restore();
}
