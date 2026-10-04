// Original cinematic effects in world coordinates. Cached, twice-resolution
// Canvas artwork keeps the game responsive without external animation assets.
// Every phase uses the supplied game clock; pause never advances an effect.
const sprites = new Map();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const fract = n => n - Math.floor(n);
const hash = value => {
  let n = 2166136261;
  for (const c of String(value ?? '')) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
};
const seedFor = item => Number.isFinite(item.seed) ? item.seed >>> 0 : hash(item.id ?? `${item.x}:${item.y}:${item.cause || item.destructionCause || ''}`);
const noise = (seed, n) => fract(Math.sin((seed % 65521) * .127 + n * 12.9898) * 43758.5453);
const phaseFor = (time, seed, frames = 24) => ((Math.floor((Number.isFinite(time) ? time : 0) * 18 + seed % frames) % frames) + frames) % frames;
const ageFor = effect => Math.max(0, (effect.maxLife || 1) - (effect.life ?? effect.maxLife ?? 1));
const progressFor = effect => clamp(ageFor(effect) / (effect.maxLife || 1), 0, 1);

function ellipse(ctx, x, y, rx, ry, fill) {
  ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}
function polygon(ctx, points, color) {
  ctx.fillStyle = color; ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath(); ctx.fill();
}
function organic(ctx, points, color) {
  // Closed Catmull–Rom contour: one coherent volume with irregular shoulders,
  // rather than a repeated radial arrangement of circular petals.
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(...points[0]);
  for (let i = 0; i < points.length; i++) {
    const a = points[(i + points.length - 1) % points.length], b = points[i];
    const c = points[(i + 1) % points.length], d = points[(i + 2) % points.length];
    ctx.bezierCurveTo(b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6, c[0] - (d[0] - b[0]) / 6, c[1] - (d[1] - b[1]) / 6, c[0], c[1]);
  }
  ctx.closePath(); ctx.fill();
}
function ringPath(ctx, ring) {
  ring.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
}
function inside(x, y, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
function footprint(object) {
  return object.polygon || [[object.x, object.y], [object.x + object.w, object.y], [object.x + object.w, object.y + object.h], [object.x, object.y + object.h]];
}
function materialPoint(object, x, y) {
  return inside(x, y, footprint(object)) && !(object.holes || []).some(ring => inside(x, y, ring));
}
function hotspot(object, seed, index, building) {
  if (!building) return { x: object.x + Math.cos(object.angle || 0) * 6, y: object.y + Math.sin(object.angle || 0) * 6 };
  for (let attempt = 0; attempt < 28; attempt++) {
    const x = object.x + object.w * (.12 + noise(seed, index * 71 + attempt * 2) * .76);
    const y = object.y + object.h * (.12 + noise(seed, index * 71 + attempt * 2 + 1) * .76);
    if (materialPoint(object, x, y)) return { x, y };
  }
  const ring = footprint(object);
  return { x: (ring[0][0] + ring[1][0]) / 2, y: (ring[0][1] + ring[1][1]) / 2 };
}

function sprite(ctx, key, width, height, anchorX, anchorY, paint) {
  if (sprites.has(key)) { const result = sprites.get(key); sprites.delete(key); sprites.set(key, result); return result; }
  let canvas;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(width * 2, height * 2);
  else if (ctx.canvas?.ownerDocument) {
    canvas = ctx.canvas.ownerDocument.createElement('canvas'); canvas.width = width * 2; canvas.height = height * 2;
  }
  if (!canvas) return null;
  const paintCtx = canvas.getContext('2d');
  paintCtx.scale(2, 2); paintCtx.translate(anchorX, anchorY); paint(paintCtx);
  const result = { canvas, width, height, anchorX, anchorY };
  sprites.set(key, result);
  while (sprites.size > 72) sprites.delete(sprites.keys().next().value);
  return result;
}
function stamp(ctx, art, x, y, scale = 1) {
  ctx.drawImage(art.canvas, x - art.anchorX * scale, y - art.anchorY * scale, art.width * scale, art.height * scale);
}

function flameVolume(ctx, frame) {
  const t = frame / 24 * Math.PI * 2;
  const wind = Math.sin(t) * 1.8 + Math.sin(t * 3) * .7;
  const height = 23 + Math.sin(t * 2) * 2;
  const glow = ctx.createRadialGradient(0, -2, 1, 0, -2, 12);
  glow.addColorStop(0, 'rgba(255,180,66,.35)'); glow.addColorStop(.45, 'rgba(228,113,35,.13)'); glow.addColorStop(1, 'rgba(139,57,28,0)');
  ellipse(ctx, 0, -1, 12, 6, glow);
  const flame = ctx.createLinearGradient(0, 2, wind, -height);
  flame.addColorStop(0, '#fff1cc'); flame.addColorStop(.2, '#ffe199');
  flame.addColorStop(.54, '#e99238'); flame.addColorStop(.84, '#a94921'); flame.addColorStop(1, 'rgba(102,53,33,.1)');
  ctx.fillStyle = flame; ctx.beginPath(); ctx.moveTo(-4.5, 1.5);
  ctx.bezierCurveTo(-7, -4, -2.5, -6, -4.8 + wind, -13);
  ctx.bezierCurveTo(-3.1 + wind, -11, -1.3 + wind, -8, wind, -height);
  ctx.bezierCurveTo(3.4 + wind, -16, 1.3, -9.6, 3.6, -14);
  ctx.bezierCurveTo(6, -7, 6, -3, 3.3, 2); ctx.closePath(); ctx.fill();
  const core = ctx.createLinearGradient(0, 2, 0, -15);
  core.addColorStop(0, '#fff8df'); core.addColorStop(.32, '#ffedb1'); core.addColorStop(1, 'rgba(255,173,74,0)');
  ctx.fillStyle = core; ctx.beginPath(); ctx.moveTo(-2.6, 1);
  ctx.bezierCurveTo(-3, -4.5, -1.2, -4, -.4 + wind * .4, -15);
  ctx.bezierCurveTo(2.6, -8.6, .5, -6, 2.4, -8.8);
  ctx.bezierCurveTo(3.6, -4.5, 2.6, -.6, 1.8, 1.3); ctx.closePath(); ctx.fill();
}
function flameSprite(ctx, frame) { return sprite(ctx, `flame:${frame}`, 40, 44, 20, 34, paint => flameVolume(paint, frame)); }

function smokeVolume(ctx, variant, dust = false) {
  const seed = 911 + variant * 769;
  const centers = [[-6, 1, 12], [3, -6, 14], [11, -2, 9], [-10, -7, 8]];
  for (const [cx, cy, radius] of centers) {
    const gradient = ctx.createRadialGradient(cx - radius * .3, cy - radius * .4, 1, cx, cy, radius * 1.1);
    gradient.addColorStop(0, dust ? 'rgba(190,173,143,.39)' : 'rgba(126,131,127,.51)');
    gradient.addColorStop(.6, dust ? 'rgba(125,112,93,.23)' : 'rgba(57,64,63,.43)');
    gradient.addColorStop(1, 'rgba(29,35,36,0)');
    const points = Array.from({ length: 13 }, (_, i) => {
      const angle = i / 13 * Math.PI * 2, r = radius * (.73 + noise(seed, i + cx) * .37);
      return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r * .78];
    });
    organic(ctx, points, gradient);
  }
}
function smokeSprite(ctx, variant = 0, dust = false) {
  return sprite(ctx, `cloud:${dust ? 1 : 0}:${variant % 4}`, 64, 56, 32, 32, paint => smokeVolume(paint, variant % 4, dust));
}

export function drawBloodDecal(ctx, decal, time = 0, { reducedEffects = false } = {}) {
  if (!decal || decal.life <= 0) return;
  const runover = /runover|crash|vehicle/.test(decal.cause || '');
  const seed = seedFor(decal), size = clamp((decal.size || 5) * (runover ? 1.65 : 1.85), 3, 14);
  const age = ageFor(decal), spread = reducedEffects ? 1 : .75 + clamp(age / .6, 0, 1) * .25;
  const fade = clamp((decal.life ?? 35) / Math.min(7, decal.maxLife || 35), 0, 1);
  ctx.save(); ctx.translate(decal.x + .8, decal.y + 2); ctx.scale(1, .75); ctx.rotate(decal.angle || 0);
  // Blood seeps around the fallen silhouette instead of disappearing beneath
  // its ground shadow; the decal's world position and physics stay unchanged.
  ctx.globalAlpha *= fade * .94;
  const outline = Array.from({ length: 12 }, (_, i) => {
    const a = i / 12 * Math.PI * 2, r = Math.min(size * 1.15, 14) * spread * (.54 + noise(seed, i) * .46);
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
  organic(ctx, outline, '#56252c');
  organic(ctx, outline.map(([x, y]) => [x * .87, y * .86]), age > 12 ? '#682b32' : '#96303a');
  if (runover) {
    const trail = size * 2.1;
    organic(ctx, [[-size * .3, -size * .22], [-trail, -size * .15], [-trail * 1.16, .05], [-trail * .73, size * .13], [-size * .24, size * .35]], '#87313b');
    ctx.strokeStyle = '#61252e'; ctx.lineWidth = .45;
    for (const y of [-size * .17, size * .13]) { ctx.beginPath(); ctx.moveTo(-size * .4, y); ctx.lineTo(-trail * 1.16, y - .1); ctx.stroke(); }
  }
  const flecks = reducedEffects ? 3 : 7;
  for (let i = 0; i < flecks; i++) {
    const a = noise(seed, 30 + i) * Math.PI * 2, r = size * (1.15 + noise(seed, 50 + i) * .65);
    ellipse(ctx, Math.cos(a) * r, Math.sin(a) * r, .45 + noise(seed, 70 + i) * .65, .4 + noise(seed, 90 + i) * .5, '#98333e');
  }
  ctx.globalAlpha *= .23;
  ellipse(ctx, -size * .15, -size * .18, size * .31, size * .13, '#bc7d6b'); ctx.restore();
}

export function drawFire(ctx, object, time = 0, { building = false, reducedEffects = false } = {}) {
  if (!object || !(object.fireTimer > 0 || object.smokeTimer > 0)) return;
  const seed = seedFor(object), shot = /shot|bullet|gun|pistol|smg/.test(object.destructionCause || object.cause || '');
  const count = building ? shot ? 1 : reducedEffects ? 2 : 3 : 1;
  const height = building ? clamp(Math.sqrt((object.w || 40) * (object.h || 40)) / 3.5, 13, 30) : 23;
  const intensity = clamp((object.fireTimer || 0) / 3.5, 0, 1), smoke = clamp((object.smokeTimer || object.fireTimer || 0) / 5, 0, 1);
  const supplied = object.fireHotspots?.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  const points = supplied?.length ? supplied.slice(0, reducedEffects ? 2 : 4) : Array.from({ length: count }, (_, i) => hotspot(object, seed, i, building));
  if (object.fireTimer > 0) {
    ctx.save();
    if (building) { ctx.beginPath(); ringPath(ctx, footprint(object)); for (const hole of object.holes || []) ringPath(ctx, hole); ctx.clip('evenodd'); }
    ctx.globalAlpha *= intensity;
    for (const p of points) {
      const glow = ctx.createRadialGradient(p.x, p.y, .5, p.x, p.y, height * .8);
      glow.addColorStop(0, 'rgba(232,128,51,.21)'); glow.addColorStop(1, 'rgba(116,66,36,0)');
      ellipse(ctx, p.x, p.y, height * .8, height * .48, glow);
      ellipse(ctx, p.x + 1, p.y + 1, height * .18, height * .1, '#302a25');
    }
    ctx.restore();
  }
  // Layer smoke behind the hottest tongues and give each hotspot its own phase.
  if (smoke > 0) for (const [i, p] of points.entries()) {
    const layers = reducedEffects ? 1 : 3;
    for (let layer = 0; layer < layers; layer++) {
      const phase = reducedEffects ? .45 : fract(time * .36 + layer / layers + noise(p.seed ?? seed, i + 121));
      const art = smokeSprite(ctx, (seed + i + layer) % 4);
      const spotHeight = clamp(p.size ? p.size * 4 : height, 9, 34);
      const scale = spotHeight / 24 * (.46 + phase * .8);
      ctx.save(); ctx.globalAlpha *= smoke * (.45 - phase * .22) * (reducedEffects ? .5 : 1);
      if (art) stamp(ctx, art, p.x + phase * spotHeight * .55, p.y - spotHeight * .65 - phase * spotHeight * 1.15, scale);
      ctx.restore();
    }
  }
  if (object.fireTimer > 0) for (const [i, p] of points.entries()) {
    const frame = reducedEffects ? 0 : phaseFor(time, p.seed ?? seed + i * 47), art = flameSprite(ctx, frame);
    const spotHeight = clamp(p.size ? p.size * 4 : height, 9, 34);
    const scale = spotHeight / 24 * (.72 + noise(seed, i + 31) * .28) * (reducedEffects ? .82 : 1);
    ctx.save(); ctx.globalAlpha *= intensity * (reducedEffects ? .72 : 1);
    if (art) stamp(ctx, art, p.x, p.y, scale);
    else { ctx.translate(p.x, p.y); ctx.scale(scale, scale); flameVolume(ctx, frame); }
    ctx.restore();
    if (!reducedEffects) {
      const phase = fract(time * .8 + noise(seed, i + 213));
      ctx.save(); ctx.globalAlpha *= (1 - phase) * .65 * intensity;
      ctx.fillStyle = '#deb66d'; ctx.fillRect(p.x + Math.sin(phase * 4 + i) * 3, p.y - phase * spotHeight * 1.5 - 2, .65, .9); ctx.restore();
    }
  }
}

function explosionVolume(ctx, progress, variation) {
  const seed = 359 + variation * 477, radius = 48;
  const opening = clamp(progress / .14, 0, 1), fade = clamp((.62 - progress) / .3, 0, 1);
  if (progress < .68) {
    const fireRadius = radius * (.12 + Math.sin(Math.min(1, progress / .47) * Math.PI * .5) * .71);
    const points = Array.from({ length: 19 }, (_, i) => {
      const angle = i / 19 * Math.PI * 2;
      const irregular = .74 + noise(seed, i) * .28 + Math.sin(progress * 8 + i * 1.6) * .04;
      return [Math.cos(angle) * fireRadius * irregular, Math.sin(angle) * fireRadius * irregular * .78 - fireRadius * .13];
    });
    const fire = ctx.createRadialGradient(-fireRadius * .12, -fireRadius * .26, 1, 0, -fireRadius * .1, fireRadius);
    fire.addColorStop(0, progress < .15 ? '#fff9e6' : '#ffe6a1');
    fire.addColorStop(.26, '#f6cc78'); fire.addColorStop(.58, '#db8036');
    fire.addColorStop(.82, '#8c422b'); fire.addColorStop(1, 'rgba(42,33,31,0)');
    ctx.save(); ctx.globalAlpha *= fade; organic(ctx, points, fire);
    if (progress < .28) {
      const white = ctx.createRadialGradient(-3, -5, .2, -3, -5, fireRadius * .43);
      white.addColorStop(0, 'rgba(255,255,238,.9)'); white.addColorStop(.3, 'rgba(255,239,183,.7)'); white.addColorStop(1, 'rgba(243,173,75,0)');
      ellipse(ctx, -3, -5, fireRadius * .48, fireRadius * .37, white);
    }
    ctx.restore();
  }
  // A rapidly expanding pressure front is transparent and close to the ground.
  if (progress < .42) {
    const shock = radius * (.16 + opening * .65 + progress * .75);
    ctx.save(); ctx.globalAlpha *= clamp((.42 - progress) * .8, 0, .3);
    ctx.strokeStyle = '#c0a27c'; ctx.lineWidth = .7;
    ctx.beginPath(); ctx.ellipse(0, 1, shock, shock * .67, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  if (progress > .12) {
    const smokeAge = clamp((progress -.12) / .88, 0, 1), fadeSmoke = Math.sin(Math.PI * smokeAge) * .7;
    for (let i = 0; i < 4; i++) {
      const x = (noise(seed, i + 41) -.5) * radius * .9 + smokeAge * 13;
      const y = (noise(seed, i + 61) -.5) * radius * .38 - smokeAge * (13 + i * 5);
      const scale = .72 + smokeAge * .95;
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.globalAlpha *= fadeSmoke * (i % 2 ? .75 : 1);
      smokeVolume(ctx, (variation + i) % 4, false); ctx.restore();
    }
    ctx.save(); ctx.globalAlpha *= Math.sin(Math.PI * smokeAge) * .35;
    ctx.translate(0, 6); ctx.scale(1.65 + smokeAge * .7, .55 + smokeAge * .3); smokeVolume(ctx, variation, true); ctx.restore();
  }
  if (progress > .04 && progress < .82) for (let i = 0; i < 9; i++) {
    const angle = noise(seed, i + 91) * Math.PI * 2, length = radius * (.5 + noise(seed, i + 101) * .65) * progress;
    const x = Math.cos(angle) * length, y = Math.sin(angle) * length * .7 - Math.sin(Math.PI * progress) * (4 + noise(seed, i + 111) * 10);
    ctx.save(); ctx.globalAlpha *= (1 - progress) * .75; ctx.translate(x, y); ctx.rotate(angle + progress * 3);
    ctx.fillStyle = i < 6 ? '#dba969' : '#4a3a2c'; ctx.fillRect(-.6, -.3, i < 6 ? 1.6 : 2.4, i < 6 ? .65 : .9); ctx.restore();
  }
}

export function drawExplosion(ctx, effect, time = 0, { reducedEffects = false } = {}) {
  if (!effect || effect.life <= 0) return;
  const progress = progressFor(effect), radius = clamp(effect.radius || 58, 6, 130), seed = seedFor(effect);
  ctx.save();
  if (reducedEffects) {
    ctx.globalAlpha *= (1 - progress) * .33;
    ctx.strokeStyle = '#b6a07f'; ctx.lineWidth = .6;
    ctx.beginPath(); ctx.ellipse(effect.x, effect.y, radius * .58, radius * .42, 0, 0, Math.PI * 2); ctx.stroke();
    ellipse(ctx, effect.x, effect.y - 2, radius * .16, radius * .12, '#d49d56');
    ctx.fillStyle = '#c4aa77'; ctx.fillRect(effect.x - 3, effect.y - 3, .7, .7); ctx.fillRect(effect.x + 3, effect.y + 1, .7, .7);
  } else {
    const frame = Math.min(27, Math.floor(progress * 28)), variation = seed % 2;
    const art = sprite(ctx, `explosion:${variation}:${frame}`, 176, 170, 88, 106, paint => explosionVolume(paint, frame / 28, variation));
    if (art) stamp(ctx, art, effect.x, effect.y, radius / 48);
    else { ctx.translate(effect.x, effect.y); ctx.scale(radius / 48, radius / 48); explosionVolume(ctx, progress, variation); }
  }
  ctx.restore();
}

export function drawDestructionDust(ctx, effect, time = 0, { reducedEffects = false } = {}) {
  if (!effect || effect.life <= 0) return;
  const progress = progressFor(effect), seed = seedFor(effect), radius = clamp(effect.radius || 30, 8, 90);
  const fade = Math.sin(Math.PI * clamp(progress, .08, 1)) * .42;
  for (let i = 0; i < (reducedEffects ? 2 : 3); i++) {
    const art = smokeSprite(ctx, (seed + i) % 4, true);
    if (!art) continue;
    const drift = reducedEffects ? .2 : progress;
    const x = effect.x + (noise(seed, i + 221) - .5) * radius * .8 + drift * 8;
    const y = effect.y + (noise(seed, i + 241) - .5) * radius * .35 - drift * 11;
    ctx.save(); ctx.globalAlpha *= fade * (reducedEffects ? .55 : 1);
    stamp(ctx, art, x, y, radius / 28 * (.52 + drift * .35)); ctx.restore();
  }
}
