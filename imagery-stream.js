const DEFAULT_BYTES = 16 * 1024 * 1024;
const intersects = (a, b) => a.x < b.x + b.w && a.y < b.y + b.h && a.x + a.w > b.x && a.y + a.h > b.y;
const finiteBounds = bounds => bounds && ['west', 'south', 'east', 'north'].every(key => Number.isFinite(bounds[key]))
  && bounds.east > bounds.west && bounds.north > bounds.south;
function overlap(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y };
}
function coveredBy(area, covers) {
  let remaining = [area];
  for (const cover of covers) remaining = remaining.flatMap(rect => {
    const cut = overlap(rect, cover);
    if (cut.w <= 0 || cut.h <= 0) return [rect];
    return [{ x: rect.x, y: rect.y, w: rect.w, h: cut.y - rect.y },
      { x: rect.x, y: cut.y + cut.h, w: rect.w, h: rect.y + rect.h - cut.y - cut.h },
      { x: rect.x, y: cut.y, w: cut.x - rect.x, h: cut.h },
      { x: cut.x + cut.w, y: cut.y, w: rect.x + rect.w - cut.x - cut.w, h: cut.h }].filter(piece => piece.w > .001 && piece.h > .001);
  });
  return remaining.length === 0;
}

export function validImageryManifest(manifest) {
  return manifest?.status === 'ready' && finiteBounds(manifest.boundsWGS84)
    && Number.isFinite(manifest.worldWidth) && manifest.worldWidth > 0
    && Number.isFinite(manifest.worldHeight) && manifest.worldHeight > 0
    && Array.isArray(manifest.tiles) && manifest.tiles.length > 0
    && (manifest.detailTiles === undefined || Array.isArray(manifest.detailTiles))
    && [...manifest.tiles, ...(manifest.detailTiles || [])].every(tile => typeof tile.id === 'string' && /^\.\/assets\/aerial\/[\w.-]+\.jpg$/.test(tile.url)
      && Number.isInteger(tile.width) && tile.width > 0 && tile.width <= 2048
      && Number.isInteger(tile.height) && tile.height > 0 && tile.height <= 2048
      && tile.boundsWorld && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(tile.boundsWorld[key]))
      && tile.boundsWorld.x >= 0 && tile.boundsWorld.y >= 0 && tile.boundsWorld.w > 0 && tile.boundsWorld.h > 0
      && tile.boundsWorld.x + tile.boundsWorld.w <= manifest.worldWidth + .05
      && tile.boundsWorld.y + tile.boundsWorld.h <= manifest.worldHeight + .05);
}

export function imageryManifestMatches(world, manifest) {
  const bounds = world?.metadata?.bounds;
  return world?.metadata?.city === 'Calvi' && !!bounds && !!manifest
    && Math.abs(world.width - manifest.worldWidth) < .05 && Math.abs(world.height - manifest.worldHeight) < .05
    && ['west', 'south', 'east', 'north'].every(key => Number.isFinite(bounds[key])
      && Number.isFinite(manifest.boundsWGS84?.[key]) && Math.abs(bounds[key] - manifest.boundsWGS84[key]) < 1e-7);
}

async function decodeLocalImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Local imagery HTTP ${response.status}`);
  const blob = await response.blob();
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob); } catch { /* WebKit may only support the Image decoder for a given resource. */ }
  }
  return new Promise((resolve, reject) => {
    const image = new Image(), objectURL = URL.createObjectURL(blob);
    image.onload = async () => {
      try { await image.decode?.(); } catch { /* onload already supplies a usable image. */ }
      URL.revokeObjectURL(objectURL);
      if (image.naturalWidth > 0 && image.naturalHeight > 0) resolve(image); else reject(new Error('Local imagery has no decoded pixels'));
    };
    image.onerror = () => { URL.revokeObjectURL(objectURL); reject(new Error('Local imagery decoding failed')); };
    image.src = objectURL;
  });
}

/** Local, bounded and asynchronous: no imagery service is contacted in play. */
export class ImageryStream {
  constructor({ loadImage = decodeLocalImage, baseURL = import.meta.url, maximumBytes = DEFAULT_BYTES, maximumResident = 4, maximumPending = 2, now = () => Date.now() } = {}) {
    this.loadImage = loadImage; this.baseURL = baseURL;
    this.maximumBytes = maximumBytes; this.maximumResident = maximumResident; this.maximumPending = maximumPending;
    this.manifest = null; this.tiles = []; this.resident = new Map(); this.pending = new Map(); this.failed = new Set(); this.desired = [];
    this.bytes = 0; this.reservedBytes = 0; this.revision = 0; this.requests = 0; this.overviewImage = null;
    this.now = now; this.retryAfter = new Map(); this.retryAttempts = new Map();
  }
  install(manifest) {
    if (!validImageryManifest(manifest)) return false;
    for (const entry of this.resident.values()) entry.image.close?.();
    this.overviewImage?.close?.(); this.overviewImage = null;
    this.resident.clear(); this.bytes = 0; this.manifest = manifest; this.failed.clear(); this.retryAfter.clear(); this.retryAttempts.clear(); this.desired = []; this.revision++;
    this.tiles = [...manifest.tiles.map(tile => ({ ...tile, detail: false })), ...(manifest.detailTiles || []).map(tile => ({ ...tile, detail: true }))];
    return true;
  }
  async loadOverview() {
    const generation = this.manifest, source = generation?.overview;
    if (!source || !/^\.\/assets\/(?:aerial\/)?[\w.-]+\.jpg$/.test(source.url)
      || !Number.isInteger(source.width) || !Number.isInteger(source.height)
      || source.width <= 0 || source.height <= 0 || source.width > 2048 || source.height > 2048) return false;
    try {
      const image = await this.loadImage(new URL(source.url, this.baseURL).href);
      if (generation !== this.manifest || (image.width || image.naturalWidth) !== source.width || (image.height || image.naturalHeight) !== source.height) { image.close?.(); return false; }
      this.overviewImage = image; this.revision++; return true;
    } catch { return false; }
  }
  request(world, bounds) {
    if (!imageryManifestMatches(world, this.manifest)) return;
    this.lastRequest = { world, bounds: { ...bounds } };
    const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
    const requestTime = this.now();
    const visible = this.tiles.filter(tile => intersects(tile.boundsWorld, bounds)
      && (!this.failed.has(tile.id) || this.retryAfter.has(tile.id) && requestTime >= this.retryAfter.get(tile.id)));
    const fineAreas = visible.filter(tile => tile.detail).map(tile => tile.boundsWorld);
    // The overview is already visible during loading. Decoding a coarse image
    // hidden by fine photographs wastes Safari's decoder work and memory.
    const candidates = visible.filter(tile => tile.detail || !coveredBy(overlap(tile.boundsWorld, bounds), fineAreas))
      .sort((a, b) => Number(b.detail) - Number(a.detail) || Math.hypot(a.boundsWorld.x + a.boundsWorld.w / 2 - cx, a.boundsWorld.y + a.boundsWorld.h / 2 - cy)
        - Math.hypot(b.boundsWorld.x + b.boundsWorld.w / 2 - cx, b.boundsWorld.y + b.boundsWorld.h / 2 - cy));
    let desiredBytes = 0;
    this.desired = candidates.filter(tile => {
      const bytes = tile.width * tile.height * 4;
      if (desiredBytes + bytes > this.maximumBytes) return false;
      desiredBytes += bytes; return true;
    }).slice(0, this.maximumResident);
    for (const tile of this.desired) {
      const entry = this.resident.get(tile.id);
      if (entry) { this.resident.delete(tile.id); this.resident.set(tile.id, entry); }
    }
    this.pump();
  }
  pump() {
    for (const tile of this.desired) {
      if (this.pending.size >= this.maximumPending) break;
      if (this.resident.has(tile.id) || this.pending.has(tile.id)) continue;
      if (this.failed.has(tile.id)) {
        const retryAt = this.retryAfter.get(tile.id);
        if (retryAt === undefined || this.now() < retryAt) continue;
        this.failed.delete(tile.id); this.retryAfter.delete(tile.id);
      }
      const generation = this.manifest, url = new URL(tile.url, this.baseURL).href;
      const reservation = tile.width * tile.height * 4;
      // Make room before decoding, not only after a large bitmap is allocated.
      while (this.bytes + this.reservedBytes + reservation > this.maximumBytes
        || this.resident.size + this.pending.size >= this.maximumResident) {
        const oldest = this.resident.keys().next().value;
        if (oldest === undefined) break;
        const entry = this.resident.get(oldest);
        entry.image.close?.(); this.bytes -= entry.bytes; this.resident.delete(oldest);
      }
      if (this.bytes + this.reservedBytes + reservation > this.maximumBytes) continue;
      this.reservedBytes += reservation;
      let reserved = true;
      const release = () => { if (reserved) { this.reservedBytes -= reservation; reserved = false; } };
      this.requests++;
      const job = Promise.resolve().then(() => this.loadImage(url)).then(image => {
        release();
        const width = image.width || image.naturalWidth, height = image.height || image.naturalHeight;
        if (generation !== this.manifest || width !== tile.width || height !== tile.height || !this.desired.some(item => item.id === tile.id)) {
          image.close?.();
          if (generation === this.manifest && (width !== tile.width || height !== tile.height)) this.failed.add(tile.id);
          return;
        }
        const bytes = width * height * 4;
        if (bytes > this.maximumBytes) { image.close?.(); this.failed.add(tile.id); return; }
        while (this.resident.size >= this.maximumResident || this.bytes + bytes > this.maximumBytes) {
          const oldest = this.resident.keys().next().value, entry = this.resident.get(oldest);
          entry.image.close?.(); this.bytes -= entry.bytes; this.resident.delete(oldest);
        }
        this.resident.set(tile.id, { tile, image, bytes, revision: ++this.revision }); this.bytes += bytes;
        this.retryAttempts.delete(tile.id);
      }).catch(() => {
        release();
        if (generation !== this.manifest) return;
        this.failed.add(tile.id);
        const attempt = (this.retryAttempts.get(tile.id) || 0) + 1;
        this.retryAttempts.set(tile.id, attempt);
        this.retryAfter.set(tile.id, this.now() + Math.min(30000, 1000 * 2 ** Math.min(attempt - 1, 5)));
      })
        .finally(() => { release(); if (this.pending.get(tile.id) === job) this.pending.delete(tile.id); this.pump(); });
      this.pending.set(tile.id, job);
    }
  }
  retryTransient() {
    for (const id of this.retryAfter.keys()) this.retryAfter.set(id, 0);
    if (this.lastRequest) this.request(this.lastRequest.world, this.lastRequest.bounds); else this.pump();
  }
  signature(world, bounds) {
    if (!imageryManifestMatches(world, this.manifest)) return '';
    return [...this.resident.values()].filter(entry => intersects(entry.tile.boundsWorld, bounds))
      .map(entry => `${entry.tile.id}:${entry.revision}`).sort().join('|');
  }
  draw(ctx, world, bounds) {
    if (!imageryManifestMatches(world, this.manifest)) return;
    // Coarse images always precede finer photographs, even after an LRU touch.
    const layers = [...this.resident.values()].sort((a, b) => Number(a.tile.detail) - Number(b.tile.detail));
    for (const { tile, image } of layers) {
      const area = tile.boundsWorld;
      if (!intersects(area, bounds)) continue;
      const x = Math.max(area.x, bounds.x), y = Math.max(area.y, bounds.y);
      const w = Math.min(area.x + area.w, bounds.x + bounds.w) - x, h = Math.min(area.y + area.h, bounds.y + bounds.h) - y;
      ctx.drawImage(image, (x - area.x) / area.w * tile.width, (y - area.y) / area.h * tile.height,
        w / area.w * tile.width, h / area.h * tile.height, x, y, w, h);
    }
  }
  drawOverview(ctx, world, bounds) {
    if (!this.overviewImage || !imageryManifestMatches(world, this.manifest)) return false;
    const image = this.overviewImage, x = Math.max(0, bounds.x), y = Math.max(0, bounds.y);
    const w = Math.min(world.width, bounds.x + bounds.w) - x, h = Math.min(world.height, bounds.y + bounds.h) - y;
    if (w > 0 && h > 0) ctx.drawImage(image, x / world.width * image.width, y / world.height * image.height,
      w / world.width * image.width, h / world.height * image.height, x, y, w, h);
    return true;
  }
  stats() {
    const detailResident = [...this.resident.values()].filter(entry => entry.tile.detail).length;
    const detailPending = this.tiles.filter(tile => tile.detail && this.pending.has(tile.id)).length;
    return Object.freeze({ status: this.manifest ? 'ready' : 'fallback', available: this.tiles.length,
      baseAvailable: this.manifest?.tiles.length || 0, detailAvailable: this.manifest?.detailTiles?.length || 0,
      detailResident, detailPending, detailMetresPerPixel: this.manifest?.detailMetresPerPixel || null,
      bestMetresPerPixel: detailResident ? this.manifest?.detailMetresPerPixel || null : this.manifest?.metresPerPixel || null,
      resident: this.resident.size, pending: this.pending.size, failed: this.failed.size, decodedBytes: this.bytes,
      reservedDecodeBytes: this.reservedBytes,
      maximumBytes: this.maximumBytes, maximumResident: this.maximumResident, requests: this.requests,
      revision: this.revision, overviewReady: !!this.overviewImage,
      overviewBytes: this.overviewImage ? this.overviewImage.width * this.overviewImage.height * 4 : 0 });
  }
}

export const aerialImagery = new ImageryStream();
export const imageryStreamReady = typeof fetch === 'function' && typeof Image !== 'undefined'
  ? fetch(new URL('./data/calvi-imagery-tiles.json', import.meta.url)).then(response => response.ok ? response.json() : null)
    .then(async manifest => aerialImagery.install(manifest) && await aerialImagery.loadOverview()).catch(() => false)
  : Promise.resolve(false);
export const imageryStats = () => aerialImagery.stats();
if (typeof window !== 'undefined') window.addEventListener('online', () => aerialImagery.retryTransient());
