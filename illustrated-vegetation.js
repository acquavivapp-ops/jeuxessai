// Illustrated foliage over the existing Calvi observations. Positions, source
// contours, gameplay trunks and estimated heights remain owned by the world.
const TAU = Math.PI * 2;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const layouts = new WeakMap();

function hash(x, y, salt = 0) {
  let n = Math.imul(Math.round(x) + salt * 419, 374761393) ^ Math.imul(Math.round(y) + salt * 71, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function colour(day, night, daylight) {
  const a = day.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16));
  const b = night.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16));
  return '#' + a.map((v, i) => Math.round(b[i] + (v - b[i]) * daylight).toString(16).padStart(2, '0')).join('');
}
function profile(tree) {
  const kind = tree.kind || tree.type;
  const scrub = kind === 'scrub' && !(tree.heightMeters > 1.6);
  const bush = ['bush', 'shrub', 'hedge'].includes(kind) || kind === 'scrub' && tree.heightMeters > 1.6;
  const species = tree.species || '';
  // These are drawing treatments, never an inferred botanical inventory.
  const style = scrub ? 'scrub' : bush ? 'bush' : /palm/i.test(species) ? 'palm'
    : /olive|olivier/i.test(species) ? 'olive'
    : /pin|pine/i.test(species) || (tree.sourcePlacement || tree.source)?.osmVegetationClass === 1 ? 'pine' : 'broadleaf';
  return { radius: clamp(tree.radius || 8, 2, 40), scrub, style };
}
function palette(style, lighting = {}, sourceColour = '') {
  const daylight = clamp(lighting.daylight ?? (1 - (lighting.night ?? 0)), 0, 1);
  let values = style === 'olive' ? ['#607964', '#8fa48b', '#c6cca7', '#334b40']
    : style === 'pine' ? ['#426844', '#698e50', '#a1af6b', '#1c3e32']
    : style === 'palm' ? ['#416a35', '#719347', '#bac56c', '#1f3c2d']
    : style === 'scrub' ? ['#68724b', '#94916a', '#b9ae7c', '#414d36']
    : style === 'bush' ? ['#4d6746', '#899462', '#bec28a', '#314d3b']
    : ['#496b46', '#789365', '#b0bb86', '#253e32'];
  if (style === 'broadleaf' && /^#[a-f\d]{6}$/i.test(sourceColour)) {
    const [r, g, b] = sourceColour.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16));
    if (r > g * 1.08 && r > b * 1.03) values = ['#715a54', '#96806b', '#c2ac8a', '#3b3b3b'];
    else if (Math.max(r, g, b) - Math.min(r, g, b) < 12) values = ['#69776a', '#96a08c', '#c5c5a4', '#354b44'];
  }
  const night = ['#203b40', '#395954', '#718577', '#142932'];
  const [base, mid, light, shade] = values.map((v, i) => colour(v, night[i], daylight));
  return { base, mid, light, shade, edge: colour('#263f2c', '#172d38', daylight), daylight };
}
function localContour(tree, radius) {
  if (Array.isArray(tree.canopyPolygon) && tree.canopyPolygon.length >= 3)
    return tree.canopyPolygon.map(([x, y]) => [x - tree.x, y - tree.y]);
  const seed = hash(tree.x, tree.y) * 10;
  // Matches the renderer's existing artistic fallback shape exactly.
  return Array.from({ length: 24 }, (_, i) => {
    const angle = i / 24 * TAU;
    const r = radius * (.89 + .075 * Math.sin(angle * 5 + seed) + .035 * Math.sin(angle * 9 - seed));
    return [Math.cos(angle) * r, Math.sin(angle) * r * .87];
  });
}
function polygon(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
}
function roundedMass(ctx, x, y, rx, ry, seed, begin = true) {
  const points = Array.from({ length: 28 }, (_, i) => {
    const a = i / 28 * TAU;
    const edge = 1 + Math.sin(a * 5 + seed) * .11 + Math.sin(a * 9 + seed * .7) * .13 + Math.sin(a * 17 - seed) * .09;
    return [x + Math.cos(a) * rx * edge, y + Math.sin(a) * ry * edge];
  });
  if (begin) ctx.beginPath();
  const last = points.at(-1), first = points[0];
  ctx.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  });
  ctx.closePath();
}
function layout(tree, radius, style) {
  let value = layouts.get(tree);
  if (value?.radius === radius && value.style === style) return value;
  const rand = salt => hash(tree.x, tree.y, salt);
  const count = style === 'scrub' ? 21 : style === 'bush' ? 9 : style === 'olive' ? 13 : 12;
  const lobes = [];
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996323 + rand(14) * TAU;
    const distance = Math.sqrt((i + .6) / count) * radius * .75;
    const size = radius * (style === 'scrub' ? .09 + rand(i + 44) * .11 : .23 + rand(i + 44) * .13);
    lobes.push({ x: Math.cos(a) * distance, y: Math.sin(a) * distance * .84,
      rx: size, ry: size * (style === 'scrub' ? .6 + rand(i + 64) * .16 : .72 + rand(i + 64) * .18), seed: rand(i + 84) * TAU });
  }
  lobes.sort((a, b) => a.y - b.y);
  const fringe = Array.from({ length: 21 }, (_, i) => {
    const a = i / 21 * TAU + rand(106) * TAU, distance = radius * (.7 + rand(i + 1100) * .15);
    return { x: Math.cos(a) * distance, y: Math.sin(a) * distance * .87,
      rx: radius * (.065 + rand(i + 1150) * .07), ry: radius * (.055 + rand(i + 1190) * .055), seed: rand(i + 1250) * TAU };
  });
  const flecks = Array.from({ length: Math.round(clamp(radius * radius * .3, 25, 290)) }, (_, i) => {
    const a = rand(i + 130) * TAU, distance = Math.sqrt(rand(i + 360)) * radius * .97;
    return { x: Math.cos(a) * distance, y: Math.sin(a) * distance * .88,
      size: (.48 + rand(i + 580) * .58) * Math.max(.65, Math.sqrt(radius / 18)),
      angle: rand(i + 800) * TAU, light: rand(i + 1030) };
  });
  value = { radius, style, lobes, fringe, flecks, seed: rand(12) * TAU };
  layouts.set(tree, value); return value;
}
function fillTexture(ctx, textures, column, row, radius, opacity) {
  const fill = typeof textures === 'function' ? textures : textures?.textureFill;
  if (typeof fill === 'function') fill(ctx, column, row, -radius, -radius, radius * 2, radius * 2, 48, opacity);
}
function leafyCrown(ctx, tree, radius, style, colours, textures) {
  const { lobes, fringe, flecks, seed } = layout(tree, radius, style);
  const base = ctx.createLinearGradient(-radius * .5, -radius, radius * .6, radius);
  base.addColorStop(0, colours.mid); base.addColorStop(.5, colours.base); base.addColorStop(1, colours.shade);
  roundedMass(ctx, 0, 0, radius * .75, radius * .64, seed);
  ctx.fillStyle = base; ctx.fill();
  // Small interior forks are visible between the foliage masses, without
  // painting a new ground trunk or changing the source crown footprint.
  if (style !== 'scrub') {
    ctx.strokeStyle = colours.shade; ctx.lineWidth = Math.max(.38, radius * .035); ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a = seed + i * 1.6;
      ctx.beginPath(); ctx.moveTo(0, radius * .12);
      ctx.quadraticCurveTo(Math.cos(a) * radius * .18, Math.sin(a) * radius * .18,
        Math.cos(a) * radius * .72, Math.sin(a) * radius * .62); ctx.stroke();
    }
  }
  for (const lobe of [...fringe, ...lobes]) {
    roundedMass(ctx, lobe.x + lobe.rx * .065, lobe.y + lobe.ry * .11, lobe.rx, lobe.ry, lobe.seed);
    ctx.save(); ctx.globalAlpha *= .32; ctx.fillStyle = colours.shade; ctx.fill(); ctx.restore();
    roundedMass(ctx, lobe.x, lobe.y, lobe.rx, lobe.ry, lobe.seed);
    const volume = ctx.createRadialGradient(lobe.x - lobe.rx * .28, lobe.y - lobe.ry * .4, .1,
      lobe.x + lobe.rx * .12, lobe.y + lobe.ry * .15, lobe.rx * 1.05);
    volume.addColorStop(0, colours.mid); volume.addColorStop(.42, colours.mid);
    volume.addColorStop(.78, colours.base); volume.addColorStop(1, style === 'scrub' ? colours.base : colours.shade);
    ctx.fillStyle = volume; ctx.fill();
  }
  // The material is restricted to foliage masses. Filling the entire source
  // polygon would expose its straight survey edges as a flat green badge.
  ctx.save(); ctx.beginPath(); roundedMass(ctx, 0, 0, radius * .75, radius * .64, seed, false);
  for (const lobe of [...fringe, ...lobes]) roundedMass(ctx, lobe.x, lobe.y, lobe.rx, lobe.ry, lobe.seed, false);
  ctx.clip(); ctx.globalCompositeOperation = 'soft-light';
  fillTexture(ctx, textures, 1, style === 'scrub' ? 1 : 2, radius, style === 'scrub' ? .45 : .8); ctx.restore();
  for (const leaf of flecks) {
    ctx.save(); ctx.translate(leaf.x, leaf.y); ctx.rotate(leaf.angle);
    ctx.globalAlpha *= .48 + leaf.light * .28;
    ctx.strokeStyle = leaf.light > .48 ? colours.light : colours.shade;
    ctx.fillStyle = leaf.light > .55 ? colours.light : colours.mid;
    if (style === 'pine') {
      ctx.lineWidth = .28; ctx.beginPath(); ctx.moveTo(-leaf.size, .3);
      ctx.lineTo(0, -.45); ctx.lineTo(leaf.size, .25); ctx.moveTo(0, -.45); ctx.lineTo(.25, leaf.size); ctx.stroke();
    } else {
      // Pointed, paired leaves; no single flat circular tree symbol.
      ctx.beginPath(); ctx.moveTo(-leaf.size, 0);
      ctx.quadraticCurveTo(-leaf.size * .15, -leaf.size * .65, leaf.size, 0);
      ctx.quadraticCurveTo(leaf.size * .15, leaf.size * .35, -leaf.size, 0); ctx.fill();
      if (style === 'scrub' && leaf.light > .91) {
        ctx.fillStyle = '#cbbb88'; ctx.fillRect(.1, -.3, .42, .42);
      }
    }
    ctx.restore();
  }
}
function palmCrown(ctx, tree, radius, colours) {
  const seed = hash(tree.x, tree.y, 14) * TAU;
  for (let i = 0; i < 14; i++) {
    const angle = seed + i / 14 * TAU, length = radius * (.78 + hash(tree.x, tree.y, 70 + i) * .23);
    const bend = radius * (.04 + hash(tree.x, tree.y, 95 + i) * .12);
    ctx.save(); ctx.rotate(angle);
    ctx.beginPath(); ctx.moveTo(-radius * .035, 0);
    ctx.quadraticCurveTo(length * .32, -radius * .17, length, bend);
    ctx.quadraticCurveTo(length * .53, radius * .08, 0, radius * .06); ctx.closePath();
    ctx.fillStyle = i % 3 === 0 ? colours.mid : colours.base; ctx.fill();
    for (let j = 1; j <= 9; j++) {
      const t = j / 10, x = length * t, spineY = bend * t * t;
      const spread = Math.sin(t * Math.PI) * radius * .15;
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(x - radius * .07, spineY);
        ctx.quadraticCurveTo(x - radius * .08, spineY + side * spread * .6,
          x + radius * .03, spineY + side * spread);
        ctx.quadraticCurveTo(x + radius * .06, spineY + side * spread * .36,
          x + radius * .07, spineY + radius * .015); ctx.closePath();
        ctx.fillStyle = side < 0 ? colours.mid : colours.shade; ctx.fill();
        ctx.beginPath(); ctx.moveTo(x, spineY);
        ctx.lineTo(x + radius * .02, spineY + side * spread * .87);
        ctx.strokeStyle = side < 0 ? colours.light : colours.base; ctx.lineWidth = .25; ctx.stroke();
      }
    }
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(length * .5, -.2, length, bend);
    ctx.strokeStyle = colours.light; ctx.lineWidth = .33; ctx.stroke(); ctx.restore();
  }
  const heart = ctx.createRadialGradient(-.4, -.7, .1, 0, 0, radius * .2);
  heart.addColorStop(0, colours.light); heart.addColorStop(1, colours.shade);
  ctx.beginPath(); ctx.arc(0, 0, radius * .135, 0, TAU); ctx.fillStyle = heart; ctx.fill();
}

/** Crown only, local centre (0,0). `contour` is LOCAL; ground shadow, trunk,
 * terrain/crown lift and actor occlusion stay in the renderer's existing phases. */
export function drawIllustratedCanopy(ctx, tree, { lighting = {}, textures, contour, radius } = {}) {
  if (!ctx || !tree || tree.destroyed) return false;
  const p = profile(tree); radius = radius ?? p.radius;
  const outline = contour?.length >= 3 ? contour : localContour(tree, radius);
  const colours = palette(p.style, lighting, tree.color);
  ctx.save(); polygon(ctx, outline); ctx.clip();
  if (p.style === 'palm') palmCrown(ctx, tree, radius, colours);
  else leafyCrown(ctx, tree, radius, p.style, colours, textures);
  ctx.restore();
  return true;
}

/** Crown in WORLD coordinates. Caller applies terrain lift; `native` restores
 * foliage at ground level for the existing actor occlusion pass. No geometry
 * or provenance on `tree` is changed. Trunk and ground shadow are external. */
export function drawIllustratedVegetation(ctx, tree, options = {}) {
  if (!ctx || !tree || tree.destroyed) return false;
  const p = profile(tree);
  const height = options.native || p.scrub ? 0 : Math.max(0, tree.heightMeters || 4) * 1.4;
  const contour = options.contour?.map(([x,y]) => [x-tree.x,y-tree.y]) || localContour(tree, options.radius ?? p.radius);
  ctx.save(); ctx.translate(tree.x, tree.y - height);
  const drawn = drawIllustratedCanopy(ctx, tree, { ...options, contour }); ctx.restore(); return drawn;
}
