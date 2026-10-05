import { clipIllustratedLand } from './illustrated-ground.js';

/**
 * Explicit, isolated photographic ground study. Importing this module loads no
 * photograph or manifest. Await loadHybridGroundDetail before passing its result
 * as render(..., {groundDetailSource}). All coordinates remain world coordinates.
 *
 * Four archived detail JPEGs / 16 MiB decoded RGBA maximum; a separate reusable
 * 256² RGBA scratch canvas is at most 256 KiB. Photos are immutable after loading.
 * Known objects are removed, rather than replaced with invented photographic
 * ground. Unannotated objects and baked photographic shadows can remain.
 */
const SOURCE_ID = 'calvi-hybrid-ground-v1';
const MAX_IMAGES = 4, MAX_BYTES = 16 * 1024 * 1024, BUFFER_EDGE = 256, CELL = 256;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const validBounds = b => b && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(b[key])) && b.w > 0 && b.h > 0;
const intersects = (a, b) => a.x < b.x + b.w && a.y < b.y + b.h && a.x + a.w > b.x && a.y + a.h > b.y;
function overlap(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y };
}
const area = b => Math.max(0, b.w) * Math.max(0, b.h);
const validRing = ring => Array.isArray(ring) && ring.length >= 3
  && ring.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
function ringBounds(ring) {
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const [px, py] of ring) { x = Math.min(x, px); y = Math.min(y, py); right = Math.max(right, px); bottom = Math.max(bottom, py); }
  return { x, y, w: right - x, h: bottom - y };
}
const rectangle = b => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
function appendPath(target, ring) {
  ring.forEach(([x, y], i) => i ? target.lineTo(x, y) : target.moveTo(x, y)); target.closePath();
}
function worldMatches(world, metadata) {
  const bounds = world?.metadata?.bounds, geo = metadata?.boundsWGS84;
  return world?.metadata?.city === 'Calvi' && bounds && geo
    && Math.abs(world.width - metadata.worldWidth) < .05 && Math.abs(world.height - metadata.worldHeight) < .05
    && ['west', 'south', 'east', 'north'].every(key => Number.isFinite(bounds[key]) && Number.isFinite(geo[key]) && Math.abs(bounds[key] - geo[key]) < 1e-7);
}
function validDetail(tile, manifest) {
  return typeof tile?.id === 'string' && /^\.\/assets\/aerial\/[\w.-]+\.jpg$/.test(tile.url)
    && Number.isInteger(tile.width) && tile.width > 0 && tile.width <= 2048
    && Number.isInteger(tile.height) && tile.height > 0 && tile.height <= 2048
    && validBounds(tile.boundsWorld) && tile.boundsWorld.x >= 0 && tile.boundsWorld.y >= 0
    && tile.boundsWorld.x + tile.boundsWorld.w <= manifest.worldWidth + .05
    && tile.boundsWorld.y + tile.boundsWorld.h <= manifest.worldHeight + .05
    && /^[a-f0-9]{64}$/i.test(tile.sha256 || '');
}
function releaseImage(image) {
  if (typeof image?.close === 'function') image.close();
  else if (image && typeof image.src === 'string') image.src = '';
}
async function decodeLocalImage(url, tile) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Local detail JPEG HTTP ${response.status}`);
  const blob = await response.blob();
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== tile.sha256.toLowerCase()) throw new Error('Local detail JPEG checksum mismatch');
  }
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob); } catch { /* Image decoding fallback. */ }
  }
  if (typeof Image === 'undefined') throw new Error('No image decoder available');
  return new Promise((resolve, reject) => {
    const image = new Image(), objectURL = URL.createObjectURL(blob);
    image.onload = () => {
      URL.revokeObjectURL(objectURL);
      if (image.naturalWidth && image.naturalHeight) resolve(image); else reject(new Error('Local detail JPEG has no pixels'));
    };
    image.onerror = () => { URL.revokeObjectURL(objectURL); reject(new Error('Local detail JPEG decoding failed')); };
    image.src = objectURL;
  });
}

// A source photograph's georeference covers its entire tile. It is never used
// directly as an object mask: first convert the object's actual pixel rectangle.
function observationBounds(item, dataset, world) {
  const source = item?.sourcePlacement || item?.sourceImage || item?.source;
  const pixel = source?.pixelRect;
  if (!validBounds(pixel)) return null;
  const local = source?.sourceBoundsWorld;
  if (source.pixelCoordinateSpace === 'source-image' && validBounds(local)
    && source.sourceImageWidth > 0 && source.sourceImageHeight > 0) {
    return { x: local.x + pixel.x / source.sourceImageWidth * local.w, y: local.y + pixel.y / source.sourceImageHeight * local.h,
      w: pixel.w / source.sourceImageWidth * local.w, h: pixel.h / source.sourceImageHeight * local.h };
  }
  // Automatic canopy observations use the full observation image's coordinates.
  const image = dataset?.metadata?.observationImage;
  if (!source.pixelCoordinateSpace && !local && image?.width > 0 && image?.height > 0) {
    return { x: pixel.x / image.width * world.width, y: pixel.y / image.height * world.height,
      w: pixel.w / image.width * world.width, h: pixel.h / image.height * world.height };
  }
  return null;
}
function canopyRing(item) {
  if (validRing(item.canopyPolygon)) return item.canopyPolygon;
  if (![item.x, item.y].every(Number.isFinite)) return null;
  const radius = clamp(item.radius || 8, 2, 40), seed = (Math.sin(item.x * .071 + item.y * .137) + 1) * 5;
  return Array.from({ length: 24 }, (_, i) => {
    const a = i / 24 * Math.PI * 2, r = radius * (.89 + .075 * Math.sin(a * 5 + seed) + .035 * Math.sin(a * 9 - seed));
    return [item.x + Math.cos(a) * r, item.y + Math.sin(a) * r * .87];
  });
}
function createMasks(world, bounds, dataset) {
  const entries = [], cells = new Map(), counts = {}, ids = new Set();
  let hash = 2166136261;
  const digest = value => { for (const c of String(value)) { hash ^= c.charCodeAt(0); hash = Math.imul(hash, 16777619); } };
  const add = (id, kind, outer, holes = []) => {
    if (!validRing(outer) || ids.has(id)) return;
    const b = ringBounds(outer); if (!intersects(b, bounds)) return;
    const ring = outer.map(p => [...p]), inner = holes.filter(validRing).map(hole => hole.map(p => [...p]));
    const entry = { id, kind, outer: ring, holes: inner, bounds: b, path: null };
    if (typeof Path2D !== 'undefined') { entry.path = new Path2D(); appendPath(entry.path, ring); for (const hole of inner) appendPath(entry.path, hole); }
    ids.add(id); entries.push(entry); counts[kind] = (counts[kind] || 0) + 1;
    digest(id); digest(kind); for (const contour of [ring, ...inner]) { digest('ring'); for (const point of contour) { digest(point[0]); digest(point[1]); } }
    for (let cy = Math.floor(b.y / CELL); cy <= Math.floor((b.y + b.h) / CELL); cy++)
      for (let cx = Math.floor(b.x / CELL); cx <= Math.floor((b.x + b.w) / CELL); cx++) {
        const key = `${cx},${cy}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(entry);
      }
  };
  // Preserve masks after damage/destruction: the old photographic roof must not
  // reappear when the game replaces its drawn building with rubble.
  for (const b of world.buildings || []) add(`building:${b.id}`, 'building', validRing(b.polygon) ? b.polygon : validBounds(b) ? rectangle(b) : null, b.holes || []);
  for (const item of world.vegetation || []) {
    const r = clamp(item.radius || 8, 2, 40), observed = observationBounds(item, dataset, world);
    const actualCrown = validRing(item.canopyPolygon) ? ringBounds(item.canopyPolygon) : null;
    // Skip distant observations before allocating the decorative crown ring.
    if (!intersects(actualCrown || { x: item.x - r, y: item.y - r, w: r * 2, h: r * 2 }, bounds) && !(observed && intersects(observed, bounds))) continue;
    add(`canopy:${item.id}`, 'canopy', canopyRing(item));
    if (observed) add(`canopy-observation:${item.id}`, 'canopyObservation', rectangle(observed));
  }
  const objectMask = (item, prefix, kind) => {
    const id = item.annotationId || item.id || item.vehicleId;
    const polygon = item.polygon || item.maskPolygon, observed = observationBounds(item, dataset, world);
    add(`${prefix}:${id}`, kind, validRing(polygon) ? polygon : observed ? rectangle(observed) : validBounds(item) ? rectangle(item) : null, item.holes || []);
    // Include the source observation envelope as a union, not even-odd parity.
    if (observed) add(`${prefix}-observation:${id}`, `${kind}Observation`, rectangle(observed));
    const patch = item.groundPatch;
    if (validRing(patch?.polygon)) add(`${prefix}-patch:${id}`, 'groundPatch', patch.polygon, patch.holes || []);
    else if (validBounds(patch?.sourceBoundsWorld)) add(`${prefix}-patch:${id}`, 'groundPatch', rectangle(patch.sourceBoundsWorld));
  };
  for (const item of world.visualMeta?.aerialVehicleMasks || []) objectMask(item, 'vehicle', 'vehicle');
  for (const item of dataset?.excludedObservations || []) objectMask(item, 'excluded', 'excluded');
  return { entries, cells, counts, version: `union-v1-${(hash >>> 0).toString(16)}` };
}
function nearbyMasks(index, bounds) {
  const result = new Set();
  for (let cy = Math.floor(bounds.y / CELL); cy <= Math.floor((bounds.y + bounds.h) / CELL); cy++)
    for (let cx = Math.floor(bounds.x / CELL); cx <= Math.floor((bounds.x + bounds.w) / CELL); cx++)
      for (const entry of index.cells.get(`${cx},${cy}`) || []) if (intersects(entry.bounds, bounds)) result.add(entry);
  return result;
}
function newBuffer(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; }
  throw new Error('A canvas is required to draw hybrid ground');
}
function uncoveredArea(bounds, tiles) {
  let remaining = [bounds];
  for (const tile of tiles) remaining = remaining.flatMap(b => {
    const cut = overlap(b, tile.boundsWorld); if (area(cut) <= 0) return [b];
    return [{ x: b.x, y: b.y, w: b.w, h: cut.y - b.y }, { x: b.x, y: cut.y + cut.h, w: b.w, h: b.y + b.h - cut.y - cut.h },
      { x: b.x, y: cut.y, w: cut.x - b.x, h: cut.h }, { x: cut.x + cut.w, y: cut.y, w: b.x + b.w - cut.x - cut.w, h: cut.h }].filter(piece => area(piece) > 0);
  });
  return remaining.reduce((sum, b) => sum + area(b), 0);
}

/**
 * Awaited factory: reads only the archived detail manifest and up to four local
 * crops intersecting bounds. {manifest,aerialObjects,loadImage} are optional
 * dependency injections for small contract tests, never a streaming service.
 */
export async function loadHybridGroundDetail(world, bounds, options = {}) {
  if (!validBounds(bounds)) throw new TypeError('Hybrid preview requires finite, positive world bounds');
  const preview = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
  let manifest = options.manifest;
  if (!manifest) {
    const response = await fetch(new URL('./data/calvi-imagery-tiles.json', import.meta.url), { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Local imagery manifest HTTP ${response.status}`);
    manifest = await response.json();
  }
  if (manifest.status !== 'ready' || !worldMatches(world, manifest) || !Array.isArray(manifest.detailTiles)
    || !manifest.detailTiles.every(tile => validDetail(tile, manifest))) throw new Error('Hybrid detail imagery does not match the Calvi world');
  const candidates = manifest.detailTiles.filter(tile => intersects(tile.boundsWorld, preview))
    .sort((a, b) => area(overlap(b.boundsWorld, preview)) - area(overlap(a.boundsWorld, preview)) || a.id.localeCompare(b.id));
  let reservation = 0;
  const selected = candidates.filter(tile => {
    const bytes = tile.width * tile.height * 4;
    if (reservation + bytes > MAX_BYTES) return false;
    reservation += bytes; return true;
  }).slice(0, MAX_IMAGES);
  // Selection reserves the entire decoded allocation before starting any JPEG.
  reservation = selected.reduce((sum, tile) => sum + tile.width * tile.height * 4, 0);
  let dataset = options.aerialObjects;
  if (dataset === undefined) dataset = (await import('./data/calvi-aerial-objects.js')).CALVI_AERIAL_OBJECTS;
  if (!worldMatches(world, dataset?.metadata)) dataset = null;
  const maskIndex = createMasks(world, preview, dataset), loaded = [], failed = [];
  let decodeCount = 0, peakDecodedBytes = 0, decodedBytes = 0;
  const loadImage = options.loadImage || decodeLocalImage;
  // Sequential decode keeps staging work small, while retained images still fit
  // the already reserved four-image limit. There is no retry during rendering.
  for (const tile of selected) {
    let image;
    try {
      image = await loadImage(new URL(tile.url, import.meta.url).href, tile);
      decodeCount++;
      if ((image.width || image.naturalWidth) !== tile.width || (image.height || image.naturalHeight) !== tile.height) throw new Error('JPEG dimensions differ from georeferencing');
      const bytes = tile.width * tile.height * 4;
      loaded.push({ tile, image, bytes }); decodedBytes += bytes; peakDecodedBytes = Math.max(peakDecodedBytes, decodedBytes);
    } catch (error) { releaseImage(image); failed.push({ id: tile.id, reason: String(error?.message || error) }); }
  }
  let opacity = clamp(Number.isFinite(options.opacity) ? options.opacity : .65, 0, 1);
  let buffer = null, bufferContext = null, closed = false, bufferPaints = 0, drawCalls = 0, maskPaints = 0, lastDrawMasks = 0;
  const relevant = bounds => validBounds(bounds) && intersects(bounds, preview)
    ? loaded.filter(({ tile }) => intersects(tile.boundsWorld, overlap(bounds, preview))) : [];
  const source = {
    id: SOURCE_ID,
    signatureForBounds(bounds) {
      if (closed || opacity === 0) return '';
      const entries = relevant(bounds); if (!entries.length) return '';
      return `${SOURCE_ID}|opacity:${opacity}|night:#16354a@.75|preview:${preview.x},${preview.y},${preview.w},${preview.h}|${maskIndex.version}|${entries.map(({ tile }) => `${tile.id}:${tile.sha256}`).join(';')}`;
    },
    setOpacity(value) {
      if (!Number.isFinite(value)) throw new TypeError('Hybrid opacity must be finite');
      opacity = clamp(value, 0, 1); return opacity;
    },
    draw(ctx, drawWorld, bounds, daylight = 1) {
      if (closed || opacity === 0 || drawWorld !== world || !relevant(bounds).length) return false;
      const clipped = overlap(bounds, preview); drawCalls++; lastDrawMasks = 0;
      if (!buffer) { buffer = newBuffer(BUFFER_EDGE, BUFFER_EDGE); bufferContext = buffer.getContext('2d'); }
      const light = clamp(Number.isFinite(daylight) ? daylight : 1, 0, 1);
      ctx.save();
      try {
        if (!clipIllustratedLand(ctx, world, clipped)) return false;
        ctx.globalAlpha *= opacity;
        for (let y = clipped.y; y < clipped.y + clipped.h; y += BUFFER_EDGE) for (let x = clipped.x; x < clipped.x + clipped.w; x += BUFFER_EDGE) {
          const region = { x, y, w: Math.min(BUFFER_EDGE, clipped.x + clipped.w - x), h: Math.min(BUFFER_EDGE, clipped.y + clipped.h - y) };
          const entries = relevant(region); if (!entries.length) continue;
          const paint = bufferContext;
          paint.setTransform(1, 0, 0, 1, 0, 0); paint.globalAlpha = 1; paint.globalCompositeOperation = 'source-over';
          paint.clearRect(0, 0, BUFFER_EDGE, BUFFER_EDGE); paint.translate(-x, -y); paint.imageSmoothingEnabled = false;
          for (const { tile, image } of entries) {
            const crop = overlap(region, tile.boundsWorld); if (area(crop) <= 0) continue;
            const b = tile.boundsWorld;
            paint.drawImage(image, (crop.x - b.x) / b.w * tile.width, (crop.y - b.y) / b.h * tile.height,
              crop.w / b.w * tile.width, crop.h / b.h * tile.height, crop.x, crop.y, crop.w, crop.h);
          }
          // Separate destination-out fills implement a union. A combined evenodd
          // path would put photographs back where two removal masks overlap.
          paint.globalCompositeOperation = 'destination-out'; paint.fillStyle = '#000';
          for (const entry of nearbyMasks(maskIndex, region)) {
            if (entry.path) paint.fill(entry.path, 'evenodd');
            else { paint.beginPath(); appendPath(paint, entry.outer); for (const hole of entry.holes) appendPath(paint, hole); paint.fill('evenodd'); }
            maskPaints++; lastDrawMasks++;
          }
          if (light < 1) {
            paint.globalCompositeOperation = 'source-atop'; paint.globalAlpha = .75 * (1 - light); paint.fillStyle = '#16354a';
            paint.fillRect(region.x, region.y, region.w, region.h);
          }
          ctx.drawImage(buffer, 0, 0, region.w, region.h, region.x, region.y, region.w, region.h); bufferPaints++;
        }
      } finally { ctx.restore(); }
      return true;
    },
    stats() {
      const bufferBytes = buffer ? buffer.width * buffer.height * 4 : 0;
      return { id: SOURCE_ID, closed, opacity, maximumImages: MAX_IMAGES, maximumDecodedBytes: MAX_BYTES,
        selected: selected.map(tile => tile.id), loaded: loaded.map(({ tile }) => ({ id: tile.id, boundsWorld: { ...tile.boundsWorld }, bytes: tile.width * tile.height * 4 })),
        failed: failed.map(item => ({ ...item })), decodeCount, decodedBytes, peakDecodedBytes, bufferBytes, estimatedPixelBytes: decodedBytes + bufferBytes,
        reservedBytes: closed ? 0 : reservation, drawCalls, bufferPaints, maskPaints, lastDrawMasks, maskVersion: maskIndex.version,
        maskCount: maskIndex.entries.length, maskCounts: { ...maskIndex.counts }, maskIndexCells: maskIndex.cells.size, previewBounds: { ...preview },
        uncoveredPreviewArea: uncoveredArea(preview, loaded.map(entry => entry.tile)), detailMetresPerPixel: manifest.detailMetresPerPixel ? { ...manifest.detailMetresPerPixel } : null,
        attribution: manifest.attribution, limitations: 'Prototype: unannotated photographic objects and baked shadows can remain; no photographic inpainting.' };
    },
    close() {
      if (closed) return; closed = true;
      for (const { image } of loaded) releaseImage(image);
      loaded.length = 0; decodedBytes = 0;
      if (buffer) { buffer.width = 0; buffer.height = 0; buffer = null; bufferContext = null; }
      maskIndex.cells.clear(); maskIndex.entries.length = 0;
    }
  };
  return source;
}
