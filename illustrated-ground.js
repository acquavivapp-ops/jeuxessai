import { drawMaterialGrain, strokeMaterialGrain } from './illustrated-materials.js';
import { airportSurfacesFor } from './data/calvi-architecture.js';

// Painted materials follow the archived Calvi geometry. This module changes
// only pixels: it never edits roads, shores, areas, piers or physical bodies.
const CELL = 512, URBAN_FRINGE = 24, indexes = new WeakMap(), areaPaths = new WeakMap();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const intersects = (a, b, pad = 0) => a.x + a.w + pad >= b.x && a.y + a.h + pad >= b.y && a.x - pad <= b.x + b.w && a.y - pad <= b.y + b.h;
function hash(x, y, salt = 0) {
  let n = Math.imul(Math.round(x) + salt * 419, 374761393) ^ Math.imul(Math.round(y) + salt * 71, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function mix(a, b, amount) {
  const t = clamp(amount, 0, 1);
  return '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
}
function rings(items) {
  if (!Array.isArray(items)) return [];
  if (Array.isArray(items[0]) && typeof items[0][0] === 'number') return [items];
  return items.flatMap(item => {
    const p = item?.points || item?.polygon || item;
    return Array.isArray(p?.[0]) && typeof p[0][0] === 'number' ? [p] : Array.isArray(p) ? p.filter(r => Array.isArray(r?.[0]) && typeof r[0][0] === 'number') : [];
  });
}
function boundsOf(points, pad = 0) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const [x, y] of points) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  return { x: left - pad, y: top - pad, w: right - left + pad * 2, h: bottom - top + pad * 2 };
}
function append(ctx, points) {
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
}
function path(ctx, outer, holes = []) { ctx.beginPath(); append(ctx, outer); for (const hole of holes) append(ctx, hole); }
function fill(ctx, b, colour) { ctx.fillStyle = colour; ctx.fillRect(b.x, b.y, b.w, b.h); }
function line(ctx, a, b, colour, width = 1) {
  ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.stroke();
}
function contains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function insert(table, item) {
  const b = item.bounds;
  for (let y = Math.floor(b.y / CELL); y <= Math.floor((b.y + b.h) / CELL); y++)
    for (let x = Math.floor(b.x / CELL); x <= Math.floor((b.x + b.w) / CELL); x++) {
      const key = `${x},${y}`; if (!table.has(key)) table.set(key, []); table.get(key).push(item);
    }
}
function nearby(table, bounds) {
  const result = new Set();
  for (let y = Math.floor(bounds.y / CELL); y <= Math.floor((bounds.y + bounds.h) / CELL); y++)
    for (let x = Math.floor(bounds.x / CELL); x <= Math.floor((bounds.x + bounds.w) / CELL); x++)
      for (const item of table.get(`${x},${y}`) || []) if (intersects(item.bounds, bounds)) result.add(item);
  return [...result];
}
function retainedPath(contours) {
  if (typeof Path2D === 'undefined') return null;
  const p = new Path2D(); for (const contour of contours) append(p, contour); return p;
}
function subtractPath(ctx, b, excluded, cached) {
  if (cached) {
    const mask = new Path2D(); mask.rect(b.x, b.y, b.w, b.h); mask.addPath(cached); ctx.clip(mask, 'evenodd');
  } else {
    path(ctx, [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]], excluded); ctx.clip('evenodd');
  }
}

function geometry(world) {
  let index = indexes.get(world); if (index) return index;
  const areas = new Map(), coast = new Map(), piers = new Map(), buildings = new Map();
  for (const item of world.scenery || []) if (Array.isArray(item.polygon)) insert(areas, { item, bounds: boundsOf(item.polygon) });
  // Shorelines are the original coastline ways, not edges of the map rectangle.
  for (const ring of rings(world.shorelines)) for (let i = 1; i < ring.length; i++) insert(coast, { a: ring[i - 1], b: ring[i], bounds: boundsOf([ring[i - 1], ring[i]], 34) });
  for (const pier of world.piers || []) if (pier.width > 0 && Array.isArray(pier.points)) insert(piers, { pier, bounds: boundsOf(pier.points, pier.width / 2 + 4) });
  for (const building of world.buildings || []) if (building.polygon?.length >= 3) insert(buildings, { building, bounds: boundsOf(building.polygon, URBAN_FRINGE) });
  index = { areas, coast, piers, buildings, land: rings(world.landPolygons), sea: rings(world.seaPolygons) };
  // The full commune coast contains thousands of exact vertices. Construct
  // retained paths once, rather than repeating their JS calls per 32 m tile.
  index.landPath = retainedPath(index.land); index.seaPath = retainedPath(index.sea);
  indexes.set(world, index); return index;
}
function clipLand(ctx, index, b) {
  if (!index.land.length) return false;
  if (index.landPath) ctx.clip(index.landPath);
  else { ctx.beginPath(); for (const ring of index.land) append(ctx, ring); ctx.clip(); }
  if (index.sea.length) subtractPath(ctx, b, index.sea, index.seaPath);
  return true;
}
function clipWater(ctx, index, b) {
  if (index.sea.length) {
    if (index.seaPath) ctx.clip(index.seaPath);
    else { ctx.beginPath(); for (const ring of index.sea) append(ctx, ring); ctx.clip(); }
  }
  subtractPath(ctx, b, index.land, index.landPath);
}
// Caller owns save/restore. Road details share the exact land-minus-sea clip;
// genuine pier decks are drawn separately, after restoring this clip.
export function clipIllustratedLand(ctx, world, bounds) { return clipLand(ctx, geometry(world), bounds); }
const GREEN = new Set(['maquis', 'wood', 'forest', 'scrub', 'grass', 'park', 'garden', 'meadow', 'orchard']);
const PAVED = new Set(['residential', 'retail', 'cemetery', 'farmyard']);
const ASPHALT = new Set(['parking', 'industrial', 'military', 'aerodrome']);
function pointDistanceSquared(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  const t = length ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / length, 0, 1) : 0;
  return (x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2;
}
// Surface classification is an art decision. The urban underlay is inferred
// solely from the actual building footprints, not a new road/land polygon.
// Explicit natural and paved OSM areas always override this underlay.
export function illustratedSurfaceAt(world, x, y) {
  const index = geometry(world), point = { x, y, w: 0, h: 0 };
  if (!index.land.some(ring => contains(ring, x, y)) || index.sea.some(ring => contains(ring, x, y))) return 'sea';
  const areas = nearby(index.areas, point).filter(({ item }) => contains(item.polygon, x, y) && !(item.holes || []).some(ring => contains(ring, x, y)));
  const nature = areas.find(({ item }) => GREEN.has(item.areaKind || item.kind) || (item.areaKind || item.kind) === 'beach');
  if (nature) return nature.item.areaKind || nature.item.kind;
  const area = areas.find(({ item }) => ASPHALT.has(item.areaKind || item.kind)) || areas.at(-1);
  if (area) return area.item.areaKind || area.item.kind;
  for (const { building } of nearby(index.buildings, point)) {
    if (contains(building.polygon, x, y)) return 'urban-paving';
    const p = building.polygon;
    if (p.some((a, i) => pointDistanceSquared(x, y, a, p[(i + 1) % p.length]) <= URBAN_FRINGE ** 2)) return 'urban-paving';
  }
  return 'gravel';
}
// Four world pixels equal a metre. All marks are fixed in world coordinates;
// a cached 32 m ground tile uses a few dozen broad marks, never a stone grid.
function groundMarks(ctx, b, kind, daylight) {
  const green = GREEN.has(kind), rock = ['rock', 'bare_rock', 'scree', 'cliff'].includes(kind);
  const pitch = green ? 32 : rock ? 40 : 48;
  ctx.save(); ctx.globalAlpha *= green ? .17 : rock ? .18 : .1;
  for (let y = Math.floor(b.y / pitch) * pitch; y < b.y + b.h; y += pitch)
    for (let x = Math.floor(b.x / pitch) * pitch; x < b.x + b.w; x += pitch) {
      const n = hash(x, y, 114); if (n < .34) continue;
      const px = x + 5 + n * 19, py = y + 4 + hash(x, y, 115) * 21;
      if (green) {
        // Low, uneven patches suggest Corsican scrub; surveyed crowns are
        // drawn separately and retain their precise source polygons.
        ctx.beginPath(); ctx.ellipse(px, py, 3 + n * 5, 2 + n * 2.4, n, 0, Math.PI * 2);
        ctx.fillStyle = mix('#30473d', kind === 'wood' ? '#485e43' : '#7a7b54', daylight); ctx.fill();
        line(ctx, [px - 2, py - 1], [px + 3, py - 1.5], mix('#596d58', '#b3b185', daylight), .45);
      } else if (rock) {
        const w = 5 + n * 10, h = 3 + n * 5;
        path(ctx, [[px - w, py], [px - w * .3, py - h], [px + w * .7, py - h * .6], [px + w, py + h * .2], [px, py + h]]);
        ctx.fillStyle = mix('#354b4d', '#a6a392', daylight); ctx.fill();
        line(ctx, [px - w * .3, py - h], [px + w * .7, py - h * .6], mix('#65746c', '#d9d3bb', daylight), .6);
      } else {
        // Small weathered limestone/gravel marks, not oversized pebbles.
        line(ctx, [px, py], [px + 1.8 + n, py - .2], mix('#4f5a54', '#958f78', daylight), .5);
      }
    }
  ctx.restore();
}
function drawUrbanUnderlay(ctx, index, b, daylight) {
  const buildings = nearby(index.buildings, b); if (!buildings.length) return;
  // Only a six-metre fringe is inferred around real footprints. A source
  // residential land-use polygon is not assumed to be one giant paved plaza.
  // One combined stroke replaces a temporary 2x canvas and its material mask.
  ctx.save(); ctx.strokeStyle = mix('#52616a', '#c3bba5', daylight);
  ctx.lineWidth = URBAN_FRINGE * 2; ctx.lineJoin = 'round';
  ctx.beginPath(); for (const { building } of buildings) append(ctx, building.polygon); ctx.stroke();
  strokeMaterialGrain(ctx, URBAN_FRINGE * 2, { material: 'pavers', strength: .3 }); ctx.restore();
}
function materialFor(kind, daylight) {
  if (GREEN.has(kind)) return mix('#2b4841', kind === 'wood' ? '#63785b' : kind === 'scrub' ? '#989775' : '#8c9c71', daylight);
  if (kind === 'aerodrome') return mix('#3e5148', '#b2b49a', daylight);
  if (ASPHALT.has(kind)) return mix('#2b3c47', kind === 'parking' ? '#747c7d' : '#87877e', daylight);
  if (PAVED.has(kind)) return mix('#556168', kind === 'residential' ? '#b7b19c' : '#c4bca8', daylight);
  if (kind === 'beach') return mix('#68685e', '#e1d3af', daylight);
  if (['rock', 'bare_rock', 'scree', 'cliff'].includes(kind)) return mix('#4b5a56', '#b3afa0', daylight);
  return mix('#4b5950', '#b0a789', daylight);
}
function paintArea(ctx, item, b, daylight) {
  const box = boundsOf(item.polygon), clipped = { x: Math.max(box.x, b.x), y: Math.max(box.y, b.y) };
  clipped.w = Math.min(box.x + box.w, b.x + b.w) - clipped.x; clipped.h = Math.min(box.y + box.h, b.y + b.h) - clipped.y;
  if (!(clipped.w > 0 && clipped.h > 0)) return;
  const kind = item.areaKind || item.kind;
  ctx.save();
  if (typeof Path2D !== 'undefined') {
    let retained = areaPaths.get(item); if (!retained) { retained = retainedPath([item.polygon, ...(item.holes || [])]); areaPaths.set(item, retained); }
    ctx.clip(retained, 'evenodd');
  } else { path(ctx, item.polygon, item.holes || []); ctx.clip('evenodd'); }
  // Broad residential source areas include gardens and paths. Preserve a
  // little of the footprint-based limestone fringe instead of stamping tiles.
  if (kind === 'residential') ctx.globalAlpha *= .52;
  fill(ctx, clipped, materialFor(kind, daylight));
  drawMaterialGrain(ctx, clipped.x, clipped.y, clipped.w, clipped.h, { material: kind === 'retail' || kind === 'cemetery' ? 'pavers' : kind === 'parking' ? 'asphalt' : GREEN.has(kind) ? 'foliage' : 'stone', strength: kind === 'beach' ? .2 : .3 });
  if (!ASPHALT.has(kind)) groundMarks(ctx, clipped, kind, daylight);
  if (kind === 'vineyard' || kind === 'farmland') {
    ctx.globalAlpha *= .2;
    // Planting rows every six metres, with no animated/screen-anchored noise.
    for (let y = Math.floor(clipped.y / 24) * 24; y < clipped.y + clipped.h; y += 24)
      line(ctx, [clipped.x, y], [clipped.x + clipped.w, y], mix('#354f40', '#6c7951', daylight), 1.1);
  }
  ctx.restore();
}

function drawAirportSurfaces(ctx, world, bounds, daylight) {
  for (const surface of airportSurfacesFor(world)) {
    if (!intersects(surface.bounds, bounds, surface.sourceDimensions?.widthWorld || 1)) continue;
    const points = surface.points, width = surface.sourceDimensions?.widthWorld;
    const pavement = mix('#40505a', surface.kind === 'runway' ? '#777f7e' : '#9ba29b', daylight);
    if (surface.geometryType === 'polygon') {
      path(ctx, points); ctx.fillStyle = pavement; ctx.fill();
      ctx.save(); path(ctx, points); ctx.clip();
      const area = surface.bounds; drawMaterialGrain(ctx, area.x, area.y, area.w, area.h, { material: 'asphalt', strength: .25 }); ctx.restore();
      line(ctx, points[0], points[1], mix('#5e6d67', '#b9bcb0', daylight), .55);
    } else if (width > 0) {
      ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.strokeStyle = pavement; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'butt'; ctx.stroke();
    }
    if (surface.geometryType !== 'polyline') continue;
    // Absent widths remain absent: only a thin decorative guidance line is
    // shown on an unmeasured taxiway, never an invented broad asphalt strip.
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.strokeStyle = mix('#7d866e', surface.kind === 'runway' ? '#deded0' : '#e0cf82', daylight);
    ctx.lineWidth = surface.kind === 'runway' ? 1.6 : .75;
    if (surface.kind === 'runway') ctx.setLineDash([24, 18]); ctx.stroke(); ctx.setLineDash([]);
    if (surface.kind === 'runway' && width > 0) {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!length) continue;
        const nx = -(b[1] - a[1]) / length * (width / 2 - 3), ny = (b[0] - a[0]) / length * (width / 2 - 3);
        for (const side of [-1, 1]) line(ctx, [a[0] + nx * side, a[1] + ny * side], [b[0] + nx * side, b[1] + ny * side], mix('#788a89', '#d1d5c8', daylight), .85);
      }
    }
  }
}

export function drawIllustratedGround(ctx, world, bounds, { lighting = {}, textures = null } = {}) {
  const index = geometry(world), daylight = lighting.daylight || 0;
  const shores = nearby(index.coast, bounds), areas = nearby(index.areas, bounds);
  ctx.save(); ctx.beginPath(); ctx.rect(bounds.x, bounds.y, bounds.w, bounds.h); ctx.clip();
  // Quiet Mediterranean blue: no repeated caustic atlas, rectangular patches
  // or invented bathymetry. Small dynamic glints remain owned by the renderer.
  const seaTone = ctx.createLinearGradient(0, 0, world.width || 1500, world.height || 1400);
  seaTone.addColorStop(0, mix('#123648', '#23596f', daylight)); seaTone.addColorStop(1, mix('#173d4c', '#296d7c', daylight));
  ctx.fillStyle = seaTone; ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
  drawMaterialGrain(ctx, bounds.x, bounds.y, bounds.w, bounds.h, { material: 'water', strength: .3 });
  ctx.save(); clipWater(ctx, index, bounds); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // Artistic shallow-water shading, not measured seabed/depth. The broad
  // bands follow the source shoreline and are clipped strictly to real sea.
  for (const s of shores) {
    ctx.globalAlpha = .055; line(ctx, s.a, s.b, mix('#255064', '#5eacaa', daylight), 150);
    ctx.globalAlpha = .08; line(ctx, s.a, s.b, mix('#265a6c', '#57a4a5', daylight), 64);
    ctx.globalAlpha = .22; line(ctx, s.a, s.b, mix('#175369', '#45949a', daylight), 14);
    ctx.globalAlpha = .28; line(ctx, s.a, s.b, mix('#297284', '#86b8b1', daylight), 5);
    ctx.globalAlpha = .36; line(ctx, s.a, s.b, mix('#3a7d89', '#c0d4c5', daylight), .9);
  }
  ctx.restore();
  ctx.save();
  if (clipLand(ctx, index, bounds)) {
    fill(ctx, bounds, mix('#4d5750', '#b7af99', daylight));
    drawMaterialGrain(ctx, bounds.x, bounds.y, bounds.w, bounds.h, { material: 'stone', strength: .3 });
    groundMarks(ctx, bounds, 'gravel', daylight);
    drawUrbanUnderlay(ctx, index, bounds, daylight);
    const priority = item => GREEN.has(item.areaKind || item.kind) || (item.areaKind || item.kind) === 'beach' ? 3 : ASPHALT.has(item.areaKind || item.kind) ? 2 : 1;
    for (const { item } of areas.sort((a, b) => priority(a.item) - priority(b.item))) paintArea(ctx, item, bounds, daylight);
    drawAirportSurfaces(ctx, world, bounds, daylight);
    // The land-side edge stays on the very same coast. No widened quay is
    // used as a substitute for missing geometry or as an extra walkable deck.
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const s of shores) {
      const mx = (s.a[0] + s.b[0]) / 2, my = (s.a[1] + s.b[1]) / 2;
      const kind = areas.find(({ item, bounds: box }) => intersects(box, { x: mx - 4, y: my - 4, w: 8, h: 8 }) && contains(item.polygon, mx, my))?.item.areaKind;
      const urban = ASPHALT.has(kind) || PAVED.has(kind);
      line(ctx, s.a, s.b, mix('#263e43', urban ? '#887e68' : '#7a805f', daylight), urban ? 3.5 : 2.4);
      line(ctx, s.a, s.b, mix('#758984', urban ? '#eadbbb' : '#c4c7a3', daylight), .72);
    }
  }
  ctx.restore(); ctx.restore();
}

export function drawIllustratedPiers(ctx, world, bounds, { lighting = {}, textures = null } = {}) {
  const daylight = lighting.daylight || 0;
  for (const { pier } of nearby(geometry(world).piers, bounds)) {
    const width = pier.width;
    ctx.save(); ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    ctx.beginPath(); pier.points.forEach(([x, y], i) => i ? ctx.lineTo(x, y + 1.2) : ctx.moveTo(x, y + 1.2));
    ctx.strokeStyle = mix('#172d38', '#4e6665', daylight); ctx.lineWidth = width + 1.2; ctx.stroke();
    ctx.beginPath(); pier.points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.strokeStyle = mix('#5a6264', '#d4c5a5', daylight); ctx.lineWidth = width; ctx.stroke();
    for (let i = 1; i < pier.points.length; i++) {
      const a = pier.points[i - 1], b = pier.points[i], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (length < .01) continue;
      const co = dx / length, si = dy / length, radius = width / 2;
      const left = [a[0] - si * radius, a[1] + co * radius], right = [b[0] - si * radius, b[1] + co * radius];
      ctx.save(); path(ctx, [left, right, [b[0] + si * radius, b[1] - co * radius], [a[0] + si * radius, a[1] - co * radius]]); ctx.clip();
      const box = boundsOf([a, b], radius), region = { x: Math.max(box.x, bounds.x), y: Math.max(box.y, bounds.y) };
      region.w = Math.min(box.x + box.w, bounds.x + bounds.w) - region.x; region.h = Math.min(box.y + box.h, bounds.y + bounds.h) - region.y;
      drawMaterialGrain(ctx, region.x, region.y, region.w, region.h, { material: 'pavers', strength: .3 });
      for (let distance = 3; distance < length; distance += 12) {
        const x = a[0] + co * distance, y = a[1] + si * distance;
        if (!intersects({ x, y, w: 1, h: 1 }, bounds, width)) continue;
        line(ctx, [x - si * (radius - .8), y + co * (radius - .8)], [x + si * (radius - .8), y - co * (radius - .8)], mix('#3b5259', '#9c9b86', daylight), .55);
      }
      ctx.restore();
      line(ctx, left, right, mix('#8b9a97', '#f0e2bd', daylight), .7);
      line(ctx, [a[0] + si * radius, a[1] - co * radius], [b[0] + si * radius, b[1] - co * radius], mix('#253e46', '#727d72', daylight), .8);
    }
    ctx.restore();
  }
}
