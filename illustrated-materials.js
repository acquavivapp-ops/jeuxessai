// Shared, quiet surface grain. One 32px source per material, retained per paint
// context as a CanvasPattern. A world pixel is 0.25m: no giant atlas stones,
// photographic caustics, animation or per-surface loops of tiny rectangles.
const tiles = new Map(), patterns = new WeakMap();
const hash = (x, y, salt) => {
  let n = Math.imul(x + salt * 433, 374761393) ^ Math.imul(y + salt * 79, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
function source(ctx, material) {
  if (tiles.has(material)) return tiles.get(material);
  const tile = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(32, 32) : ctx.canvas?.ownerDocument?.createElement('canvas');
  if (!tile) return null; tile.width = tile.height = 32;
  const paint = tile.getContext('2d'), pixels = paint?.createImageData(32, 32); if (!pixels) return null;
  const salt = material === 'water' ? 13 : material === 'foliage' ? 29 : 41;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const n = hash(x, y, salt), index = (y * 32 + x) * 4;
    let value = 128 + (n - .5) * 52;
    if (material === 'tiles') value += y % 2 ? 6 : -6;
    if (material === 'pavers') {
      // Mortar hints at 0.5×0.75m; very low opacity avoids a paving grid.
      if (y % 2 === 0 || (x + (Math.floor(y / 2) % 2)) % 3 === 0) value -= 24;
    } else if (material === 'foliage') value += (hash(x >> 1, y >> 1, 47) - .5) * 36;
    else if (material === 'water') value = 128 + (n - .5) * 30;
    pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = Math.round(value);
    pixels.data[index + 3] = 255;
  }
  paint.putImageData(pixels, 0, 0); tiles.set(material, tile); return tile;
}
/** Caller clips to the painted surface. Neutral soft-light grain preserves its
 * underlying hue/gradient. Strength .25 adds only a few RGB steps in midtones. */
function patternFor(ctx, material) {
  if (typeof ctx.createPattern !== 'function') return null;
  let table = patterns.get(ctx); if (!table) { table = new Map(); patterns.set(ctx, table); }
  let pattern = table.get(material);
  if (!pattern) { const tile = source(ctx, material); if (!tile) return null; pattern = ctx.createPattern(tile, 'repeat'); table.set(material, pattern); }
  return pattern;
}
export function drawMaterialGrain(ctx, x, y, w, h, { material = 'stone', strength = .25 } = {}) {
  if (!(w > 0 && h > 0)) return false;
  const pattern = patternFor(ctx, material); if (!pattern) return false;
  ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha *= strength;
  ctx.fillStyle = pattern; ctx.fillRect(x, y, w, h); ctx.restore(); return true;
}
/** Adds fine grain to the caller's current stroked source path, without a
 * temporary mask canvas or a changed physical footprint. */
export function strokeMaterialGrain(ctx, width, { material = 'pavers', strength = .25 } = {}) {
  const pattern = patternFor(ctx, material); if (!pattern) return false;
  ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha *= strength;
  ctx.strokeStyle = pattern; ctx.lineWidth = width; ctx.stroke(); ctx.restore(); return true;
}
