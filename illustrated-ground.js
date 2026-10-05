// Painted materials follow the archived Calvi geometry. This module changes
// only pixels: it never edits roads, shores, areas, piers or physical bodies.
const CELL = 512, indexes = new WeakMap();
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
function geometry(world) {
  let index = indexes.get(world); if (index) return index;
  const areas = new Map(), coast = new Map(), piers = new Map(), buildings = new Map();
  for (const item of world.scenery || []) if (Array.isArray(item.polygon)) insert(areas, { item, bounds: boundsOf(item.polygon) });
  // Shorelines are the original coastline ways, not edges of the map rectangle.
  for (const ring of rings(world.shorelines)) for (let i = 1; i < ring.length; i++) insert(coast, { a: ring[i - 1], b: ring[i], bounds: boundsOf([ring[i - 1], ring[i]], 34) });
  for (const pier of world.piers || []) if (pier.width > 0 && Array.isArray(pier.points)) insert(piers, { pier, bounds: boundsOf(pier.points, pier.width / 2 + 4) });
  for (const building of world.buildings || []) if (building.polygon?.length >= 3) insert(buildings, { building, bounds: boundsOf(building.polygon, 96) });
  index = { areas, coast, piers, buildings, land: rings(world.landPolygons), sea: rings(world.seaPolygons) }; indexes.set(world, index); return index;
}
function clipLand(ctx, index, b) {
  if (!index.land.length) return false;
  ctx.beginPath(); for (const ring of index.land) append(ctx, ring); ctx.clip();
  if (index.sea.length) {
    path(ctx, [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]], index.sea); ctx.clip('evenodd');
  }
  return true;
}
function clipWater(ctx, index, b) {
  // Start from the precise sea polygons, then subtract every land contour.
  if (index.sea.length) { ctx.beginPath(); for (const ring of index.sea) append(ctx, ring); ctx.clip(); }
  path(ctx, [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]], index.land); ctx.clip('evenodd');
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
    if (p.some((a, i) => pointDistanceSquared(x, y, a, p[(i + 1) % p.length]) <= 96 ** 2)) return 'urban-paving';
  }
  return 'gravel';
}
function drawUrbanUnderlay(ctx, index, b, daylight, textures) {
  const buildings = nearby(index.buildings, b);
  if (!buildings.length) return;
  const density = 2, width = Math.ceil(b.w * density), height = Math.ceil(b.h * density);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : ctx.canvas?.ownerDocument?.createElement('canvas');
  if (!canvas) return;
  canvas.width = width; canvas.height = height;
  const paint = canvas.getContext('2d'); if (!paint) return;
  paint.scale(density, density); paint.translate(-b.x, -b.y);
  fill(paint, b, mix('#56606a', '#c7b899', daylight));
  textures?.(paint, 0, 0, b.x, b.y, b.w, b.h, 112, .64);
  // Rasterise only a material mask, using exact source paths. It is clipped
  // again by the original coastline in the caller and by OSM areas below.
  paint.globalCompositeOperation = 'destination-in'; paint.fillStyle = '#fff'; paint.strokeStyle = '#fff';
  paint.lineWidth = 192; paint.lineJoin = 'round';
  paint.beginPath();
  for (const { building } of buildings) append(paint, building.polygon);
  paint.stroke();
  // One stroke combines the exterior fringes. Roofs are drawn above their
  // original footprints; no physical building or coastline changes here.
  ctx.drawImage(canvas, b.x, b.y, b.w, b.h);
}
function materialFor(kind, daylight) {
  if (GREEN.has(kind)) return { colour: mix('#294b42', kind === 'wood' ? '#5c7650' : '#829364', daylight), cell: [1, 1], opacity: .52 };
  if (ASPHALT.has(kind)) return { colour: mix('#293d49', '#626967', daylight), cell: [1, 0], opacity: .57 };
  if (PAVED.has(kind)) return { colour: mix('#56606a', '#c7b899', daylight), cell: [0, 0], opacity: .64 };
  if (kind === 'beach') return { colour: mix('#676359', '#decc9e', daylight), cell: [0, 1], opacity: .28 };
  return { colour: mix('#485448', '#b5a07d', daylight), cell: [0, 1], opacity: .43 };
}
function paintArea(ctx, item, b, daylight, textures) {
  const box = boundsOf(item.polygon), clipped = { x: Math.max(box.x, b.x), y: Math.max(box.y, b.y) };
  clipped.w = Math.min(box.x + box.w, b.x + b.w) - clipped.x; clipped.h = Math.min(box.y + box.h, b.y + b.h) - clipped.y;
  if (!(clipped.w > 0 && clipped.h > 0)) return;
  const kind = item.areaKind || item.kind, material = materialFor(kind, daylight);
  ctx.save(); path(ctx, item.polygon, item.holes || []); ctx.clip('evenodd'); fill(ctx, clipped, material.colour);
  textures?.(ctx, ...material.cell, clipped.x, clipped.y, clipped.w, clipped.h, kind === 'wood' ? 96 : 112, material.opacity);
  if (GREEN.has(kind)) {
    for (let y = Math.floor(clipped.y / 22) * 22; y < clipped.y + clipped.h; y += 22)
      for (let x = Math.floor(clipped.x / 24) * 24; x < clipped.x + clipped.w; x += 24) {
        const n = hash(x, y, 114); if (n < .63) continue;
        const px = x + n * 14, py = y + hash(x, y, 115) * 14;
        ctx.globalAlpha = .35;
        line(ctx, [px - 2, py + 1.5], [px + 1.5, py], mix('#1b3b35', '#486245', daylight), .9);
        line(ctx, [px - 1.5, py], [px + 1, py - 1.5], mix('#45655b', '#b0b57b', daylight), .55);
      }
  } else if (kind === 'vineyard' || kind === 'farmland') {
    ctx.globalAlpha = .3;
    for (let y = Math.floor(clipped.y / 18) * 18; y < clipped.y + clipped.h; y += 18) {
      line(ctx, [clipped.x, y], [clipped.x + clipped.w, y], mix('#354f40', '#6c7951', daylight), 2);
      line(ctx, [clipped.x, y + 2], [clipped.x + clipped.w, y + 2], mix('#536153', '#a6a56b', daylight), .65);
    }
  }
  ctx.restore();
}

export function drawIllustratedGround(ctx, world, bounds, { lighting = {}, textures = null } = {}) {
  const index = geometry(world), daylight = lighting.daylight || 0;
  const shores = nearby(index.coast, bounds), areas = nearby(index.areas, bounds);
  ctx.save(); ctx.beginPath(); ctx.rect(bounds.x, bounds.y, bounds.w, bounds.h); ctx.clip();
  // Broad hand-painted water contains fine restrained caustics. Repetition is
  // anchored to world coordinates so cached neighbours meet without seams.
  fill(ctx, bounds, mix('#103548', '#125d72', daylight));
  textures?.(ctx, 2, 2, bounds.x, bounds.y, bounds.w, bounds.h, 168, .54);
  ctx.save(); clipWater(ctx, index, bounds); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const s of shores) {
    ctx.globalAlpha = .2; line(ctx, s.a, s.b, mix('#175369', '#3b98a1', daylight), 54);
    ctx.globalAlpha = .28; line(ctx, s.a, s.b, mix('#297284', '#75c4bb', daylight), 17);
    ctx.globalAlpha = .48; line(ctx, s.a, s.b, mix('#3a7d89', '#c0e0cf', daylight), 2.2);
  }
  ctx.restore();
  ctx.save();
  if (clipLand(ctx, index, bounds)) {
    fill(ctx, bounds, mix('#4d5750', '#b9ad8c', daylight));
    textures?.(ctx, 0, 1, bounds.x, bounds.y, bounds.w, bounds.h, 112, .45);
    drawUrbanUnderlay(ctx, index, bounds, daylight, textures);
    const priority = item => GREEN.has(item.areaKind || item.kind) || (item.areaKind || item.kind) === 'beach' ? 3 : ASPHALT.has(item.areaKind || item.kind) ? 2 : 1;
    for (const { item } of areas.sort((a, b) => priority(a.item) - priority(b.item))) paintArea(ctx, item, bounds, daylight, textures);
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
      textures?.(ctx, 0, 0, region.x, region.y, region.w, region.h, 96, .35);
      for (let distance = 3; distance < length; distance += 7) {
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
