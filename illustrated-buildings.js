/**
 * Original painted Mediterranean buildings; no photographic roof assets.
 *
 * drawIllustratedBuilding(ctx, b, options)
 *   footprint / holes: roof rings in LOCAL coordinates (world point - b.x/y).
 *   profile: { height, floors }, preserved from the renderer's buildingProfile.
 *   The roof is at (0,0); the physical wall base is translated by
 *   (offsetX=4, profile.height). The caller supplies world lift, shadow and cache.
 *   lighting: { daylight, night, shadowX, shadowY, lamps }.
 *   textureFill(ctx, col, row, x, y, w, h, size, opacity): optional painted atlas.
 *
 * drawIllustratedRubble(ctx, b, options) uses the same local footprint / holes,
 * but at GROUND level (no projection). The caller translates to b.x/y.
 * Both functions preserve ctx state, accept missing art, and never mutate b.
 */

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const seed = (x, y, salt = 0) => {
  let n = Math.imul(Math.round(x * 3) + salt * 433, 374761393) ^ Math.imul(Math.round(y * 3) + salt * 79, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const validColour = c => /^#[0-9a-f]{6}$/i.test(c || '');
function mix(a, b, amount) {
  const t = clamp(amount, 0, 1);
  return '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
}
function palette(building, lighting) {
  const day = clamp(Number.isFinite(lighting?.daylight) ? lighting.daylight : Number.isFinite(lighting?.night) ? 1 - lighting.night : 1, 0, 1);
  const tone = colour => mix(mix(colour, '#29465c', .62), colour, day);
  const wall = mix(validColour(building.wallTone) ? building.wallTone : '#e6ceaa', '#f0d9b0', .46);
  const roof = mix(validColour(building.roofTone) ? building.roofTone : '#c56e41', '#cb703f', .62);
  return {
    day, lamps: lighting?.lamps ?? 1 - day, tone,
    wall: tone(wall), wallLight: tone(mix(wall, '#fff1ce', .35)),
    wallDark: tone(mix(wall, '#806e5e', .28)), stone: tone('#c7b493'),
    mortar: tone('#ad997e'), coping: tone('#f1dfbd'), roof: tone(roof),
    roofLight: tone(mix(roof, '#f9ad69', .46)), roofShade: tone(mix(roof, '#743d31', .48)),
    shutter: tone(validColour(building.shutterTone) ? building.shutterTone : '#426c70'),
    outline: tone('#61584c'), recess: tone('#334856'), glass: tone('#567e87'),
  };
}
function rings(building, options) {
  const outer = options.footprint || (building.polygon
    ? building.polygon.map(([x, y]) => [x - building.x, y - building.y])
    : [[0, 0], [building.w, 0], [building.w, building.h], [0, building.h]]);
  const holes = options.holes || (building.holes || []).map(ring => ring.map(([x, y]) => [x - building.x, y - building.y]));
  return { outer, holes };
}
function ringPath(ctx, outer, holes = []) {
  ctx.beginPath();
  for (const ring of [outer, ...holes]) {
    ring.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
  }
}
function fill(ctx, points, colour) {
  ringPath(ctx, points); ctx.fillStyle = colour; ctx.fill();
}
function stroke(ctx, points, colour, width = .6, close = false) {
  if (!points.length) return;
  ctx.beginPath(); ctx.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
  if (close) ctx.closePath();
  ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.stroke();
}
function rect(ctx, x, y, w, h, colour) {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = colour; ctx.fillRect(x, y, w, h);
}
function roundRect(ctx, x, y, w, h, radius, colour) {
  if (w <= 0 || h <= 0) return;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(radius, w / 2, h / 2));
  else ctx.rect(x, y, w, h);
  ctx.fillStyle = colour; ctx.fill();
}
function ellipse(ctx, x, y, rx, ry, colour) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = colour; ctx.fill();
}
function bounds(points) {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const [x, y] of points) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  return { x: left, y: top, w: right - left, h: bottom - top };
}
function area(ring) {
  return ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
}
function material(b) {
  const tags = b.osmTags || {}, shape = tags['roof:shape'] || b.roofShape;
  if (/metal|steel|tin|zinc/.test(tags['roof:material'] || '') || ['warehouse', 'garage'].includes(b.kind)) return 'metal';
  if (shape === 'flat' || b.roof === 1) return 'terrace';
  return 'terracotta';
}
function texture(ctx, options, col, row, x, y, w, h, opacity = .25, size = 64) {
  const draw = options.textureFill || options.textures?.fill || (typeof options.textures === 'function' ? options.textures : null);
  if (typeof draw === 'function') draw(ctx, col, row, x, y, w, h, size, opacity);
}

// The dominant genuine edge orients ridge and tiles with the actual roof, rather
// than using an axis-aligned fictitious rectangle as the building footprint.
function roofFrame(points, b) {
  let longest = 0, angle = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (length > longest) { longest = length; angle = Math.atan2(q[1] - p[1], q[0] - p[0]); }
  }
  const direction = Number.parseFloat(b.osmTags?.['roof:direction']);
  if (Number.isFinite(direction)) angle = (direction - 90) * Math.PI / 180;
  let ux = Math.cos(angle), uy = Math.sin(angle), vx = -uy, vy = ux;
  let projected = points.map(([x, y]) => [x * ux + y * uy, x * vx + y * vy]);
  let box = bounds(projected);
  if (box.h > box.w) {
    angle += Math.PI / 2; ux = Math.cos(angle); uy = Math.sin(angle); vx = -uy; vy = ux;
    projected = points.map(([x, y]) => [x * ux + y * uy, x * vx + y * vy]); box = bounds(projected);
  }
  return { ux, uy, vx, vy, ...box };
}

function masonry(ctx, b, length, height, p, options, side) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, side ? p.wallDark : p.wallLight);
  gradient.addColorStop(.32, side ? mix(p.wallDark, p.wall, .3) : p.wall);
  gradient.addColorStop(1, p.wallDark);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, length, height);
  texture(ctx, options, 2, 1, 0, 0, length, height, .22, 64);
  const stone = /stone|limestone/.test(b.osmTags?.['building:material'] || '') || ['church', 'chapel', 'castle'].includes(b.style) || seed(b.x, b.y, 301) > .68;
  ctx.save(); ctx.globalAlpha *= stone ? .4 : .12;
  const course = 5.6, block = 11.5;
  for (let y = 3.6, row = 0; y < height; y += course, row++) {
    stroke(ctx, [[0, y], [length, y]], p.mortar, .5);
    for (let x = row % 2 ? 4.2 : 9.4; x < length; x += block) stroke(ctx, [[x, y], [x + .35, y + course]], p.mortar, .4);
  }
  ctx.restore();
  // Stone quoins and a low limestone footing tie plaster façades together.
  for (let y = 1.5, row = 0; y < height; y += 4.6, row++) {
    const width = row % 2 ? 2.1 : 3.5;
    rect(ctx, .3, y, width, 4.2, mix(p.stone, p.coping, row % 3 ? .15 : .35));
    rect(ctx, length - width - .3, y, width, 4.2, mix(p.stone, p.coping, row % 3 ? .15 : .35));
    stroke(ctx, [[.3, y + 4.2], [width + .3, y + 4.2]], p.mortar, .35);
    stroke(ctx, [[length - width - .3, y + 4.2], [length - .3, y + 4.2]], p.mortar, .35);
  }
  rect(ctx, 0, height - 2.7, length, 2.7, p.stone);
  stroke(ctx, [[0, height - 2.7], [length, height - 2.7]], p.coping, .5);
  // Slight chips are fixed per building; there is no animated texture noise.
  const flecks = Math.min(36, Math.ceil(length * height / 160));
  ctx.save(); ctx.globalAlpha *= .13;
  for (let i = 0; i < flecks; i++) {
    const x = seed(b.x, b.y, 351 + i) * length, y = seed(b.y, b.x, 391 + i) * height;
    rect(ctx, x, y, 1.2 + i % 3 * .3, .45, i % 3 ? p.mortar : p.coping);
  }
  ctx.restore();
}

function window(ctx, b, x, y, width, height, p, index, floor) {
  const lit = p.lamps > .12 && seed(b.x + index * 5, b.y + floor * 7, 443) > .42;
  const pane = lit ? mix(p.glass, validColour(b.windowGlow) ? b.windowGlow : '#ffd08a', p.lamps * .85) : p.glass;
  rect(ctx, x - width / 2 - .8, y - height / 2 - .7, width + 1.6, height + 1.5, p.stone);
  rect(ctx, x - width / 2 - .25, y - height / 2, width + .5, height, p.recess);
  rect(ctx, x - width / 2 + .45, y - height / 2 + .35, width - .9, height - .7, pane);
  stroke(ctx, [[x - width / 2 + .7, y - height / 2 + .8], [x - width / 2 + .7, y + height / 2 - .7]], lit ? '#ffe8b6' : p.tone('#c0d8d5'), .5);
  stroke(ctx, [[x, y - height / 2], [x, y + height / 2]], p.recess, .4);
  stroke(ctx, [[x - width / 2, y], [x + width / 2, y]], p.recess, .35);
  for (const side of [-1, 1]) {
    const sx = side < 0 ? x - width / 2 - 2.1 : x + width / 2 + .8;
    rect(ctx, sx, y - height / 2, 1.2, height, p.shutter);
    stroke(ctx, [[sx + .15, y - height / 2 + .3], [sx + .15, y + height / 2 - .3]], p.tone('#82988d'), .25);
    for (let yy = y - height / 2 + 1; yy < y + height / 2; yy += 1.3) stroke(ctx, [[sx, yy], [sx + 1.2, yy]], p.recess, .2);
  }
  rect(ctx, x - width / 2 - 1.2, y + height / 2 + .2, width + 2.4, .85, p.coping);
}
function balcony(ctx, x, y, p) {
  fill(ctx, [[x - 4.6, y], [x + 4.6, y], [x + 5.7, y + 2.8], [x - 3.5, y + 2.8]], p.stone);
  stroke(ctx, [[x - 3.5, y + 3], [x + 5.6, y + 3]], p.tone('#47605d'), .65);
  for (let dx = -3; dx < 6; dx += 1.7) stroke(ctx, [[x + dx, y + .8], [x + dx, y + 3]], p.tone('#33494b'), .45);
}
function facadeOpenings(ctx, b, length, height, profile, p, edgeIndex, side, options) {
  const floors = clamp(Math.round(profile.floors || 2), 1, 6), rowHeight = height / floors;
  if (length < 9 || rowHeight < 4.5) return;
  const count = clamp(Math.floor((length - 7) / 14), 1, 18);
  for (let floor = 0; floor < floors; floor++) {
    if (floor > 0) {
      stroke(ctx, [[0, floor * rowHeight], [length, floor * rowHeight]], p.coping, .65);
      stroke(ctx, [[0, floor * rowHeight + .6], [length, floor * rowHeight + .6]], p.mortar, .35);
    }
    for (let i = 0; i < count; i++) {
      const x = (i + .5) / count * length, y = (floor + .43) * rowHeight;
      const width = Math.min(4.6, length / (count + .8) * .42), paneHeight = Math.min(7.2, rowHeight * .47);
      if (width < 1.8) continue;
      window(ctx, b, x, y, width, paneHeight, p, edgeIndex * 19 + i, floor);
      if (!side && floor < floors - 1 && i % 3 === 1 && (b.balcony || seed(b.x, b.y, 487) > .66)) balcony(ctx, x, y + paneHeight / 2 + .9, p);
    }
  }
  // A door ends on the true ground edge of its own face.
  if (!side && length > 17 && height > 11) {
    const x = length * .52, doorHeight = Math.min(10, rowHeight * .77), doorWidth = Math.min(5.8, length * .19);
    roundRect(ctx, x - doorWidth / 2 - .9, height - doorHeight - 1.1, doorWidth + 1.8, doorHeight + 1.1, 1.4, p.stone);
    roundRect(ctx, x - doorWidth / 2, height - doorHeight, doorWidth, doorHeight, .8, p.recess);
    rect(ctx, x - doorWidth / 2 + .45, height - doorHeight + .5, doorWidth - .9, doorHeight - .7, p.shutter);
    stroke(ctx, [[x, height - doorHeight + .4], [x, height - .4]], p.recess, .4);
    rect(ctx, x + doorWidth * .22, height - doorHeight * .42, .65, .65, p.tone('#cfb476'));
  }
  if (!side && b.awning && length > 23) {
    const colours = b.awning.colors || ['#ecdcb6', '#4e7a72'];
    const x = 4.3, y = height - Math.min(rowHeight, 11.5), w = length - 8.6;
    fill(ctx, [[x, y], [x + w, y], [x + w + .65, y + 3.8], [x + .65, y + 3.8]], p.recess);
    for (let xx = x; xx < x + w; xx += 3.7) {
      const colour = validColour(colours[Math.floor((xx - x) / 3.7) % colours.length]) ? colours[Math.floor((xx - x) / 3.7) % colours.length] : '#ecdcb6';
      rect(ctx, xx, y + .35, Math.min(3.7, x + w - xx), 2.6, p.tone(colour));
    }
    rect(ctx, x + .65, y + 3.1, w, .85, p.shutter);
  }
  if (!side && b.sign && !b.neon && length > 29 && height > 15 && options.signEdge === edgeIndex) {
    const text = String(b.sign).toUpperCase().slice(0, 22), size = text.length > 15 ? 3.4 : 4;
    ctx.font = `bold ${size}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const plaqueWidth = Math.min(length - 7, ctx.measureText(text).width + 6), y = height - Math.min(rowHeight * .84, 11);
    roundRect(ctx, length / 2 - plaqueWidth / 2, y - 2.9, plaqueWidth, 5.8, .6, p.shutter);
    stroke(ctx, [[length / 2 - plaqueWidth / 2 + .6, y - 2.4], [length / 2 + plaqueWidth / 2 - .6, y - 2.4]], p.coping, .35);
    ctx.fillStyle = p.tone('#faeac2'); ctx.fillText(text, length / 2, y + .25, plaqueWidth - 3);
  }
}

function facades(ctx, b, outer, holes, profile, p, options) {
  const height = profile.height, ox = options.offsetX ?? 4;
  let signEdge = -1, signLength = 0;
  const faces = [];
  for (let r = 0; r < 1 + holes.length; r++) {
    const ring = r === 0 ? outer : holes[r - 1], orientation = area(ring) >= 0 ? 1 : -1;
    for (let i = 0; i < ring.length; i++) {
      let a = ring[i], c = ring[(i + 1) % ring.length];
      let dx = c[0] - a[0], dy = c[1] - a[1];
      const length = Math.hypot(dx, dy);
      if (length < .2) continue;
      const normal = orientation * (r ? -1 : 1), nx = dy / length * normal, ny = -dx / length * normal;
      if (nx * ox + ny * height <= .05) continue;
      if (dx < 0 || Math.abs(dx) < .01 && dy < 0) { [a, c] = [c, a]; dx *= -1; dy *= -1; }
      const side = Math.abs(dy) > Math.abs(dx) * 1.3;
      const index = faces.length;
      if (!r && !side && length > signLength) { signLength = length; signEdge = index; }
      faces.push({ a, c, dx, dy, length, side, index });
    }
  }
  for (const face of faces) {
    const { a, c, dx, dy, length, side, index } = face;
    const shape = [a, c, [c[0] + ox, c[1] + height], [a[0] + ox, a[1] + height]];
    ctx.save(); ringPath(ctx, shape); ctx.clip();
    ctx.transform(dx / length, dy / length, ox / height, 1, a[0], a[1]);
    masonry(ctx, b, length, height, p, options, side);
    facadeOpenings(ctx, b, length, height, profile, p, index, side, { ...options, signEdge });
    // A limestone cornice immediately below the eave adds a separate volume.
    rect(ctx, 0, .3, length, 1.2, p.coping);
    rect(ctx, 0, 1.5, length, .8, p.outline);
    ctx.restore();
    stroke(ctx, [[a[0] + ox, a[1] + height], [c[0] + ox, c[1] + height]], p.outline, .55);
  }
}

function roofFacet(ctx, points, bright, dark, bounds) {
  ctx.save(); ringPath(ctx, points); ctx.clip();
  const gradient = ctx.createLinearGradient(bounds.x, bounds.y, bounds.x + bounds.w * .2, bounds.y + bounds.h);
  gradient.addColorStop(0, bright); gradient.addColorStop(1, dark);
  ctx.fillStyle = gradient; ctx.fillRect(bounds.x - 1, bounds.y - 1, bounds.w + 2, bounds.h + 2); ctx.restore();
}
function tileRoof(ctx, b, box, p, options) {
  const { x, y, w, h } = box;
  const hip = Math.min(w * .24, h * .44), ridgeY = y + h * .5;
  const tl = [x, y], tr = [x + w, y], br = [x + w, y + h], bl = [x, y + h];
  const a = [x + hip, ridgeY], c = [x + w - hip, ridgeY];
  rect(ctx, x, y, w, h, p.roof);
  roofFacet(ctx, [tl, tr, c, a], p.roofLight, p.roof, box);
  roofFacet(ctx, [bl, br, c, a], p.roof, p.roofShade, box);
  roofFacet(ctx, [tl, bl, a], mix(p.roofLight, p.roof, .4), p.roofShade, box);
  roofFacet(ctx, [tr, br, c], p.roof, p.roofShade, box);
  texture(ctx, options, 2, 0, x, y, w, h, .28, 64);
  const stepX = Math.max(4.8, Math.sqrt(w * h / 1700) * 1.35), stepY = stepX * .66;
  ctx.save(); ctx.globalAlpha *= .8;
  for (let yy = y + .6, row = 0; yy < y + h; yy += stepY, row++) {
    for (let xx = x + (row % 2 ? -stepX * .5 : 0); xx < x + w; xx += stepX) {
      const n = seed(xx + b.x, yy + b.y, 524), top = yy < ridgeY;
      const shade = top ? mix(p.roof, p.roofLight, .36 + n * .24) : mix(p.roofShade, p.roof, .36 + n * .24);
      roundRect(ctx, xx + .35, yy + .22, stepX - .65, stepY - .38, .6, shade);
      stroke(ctx, [[xx + .6, yy + stepY - .2], [xx + stepX - .5, yy + stepY - .2]], p.roofShade, .35);
      ctx.beginPath(); ctx.moveTo(xx + .8, yy + stepY - .8);
      ctx.quadraticCurveTo(xx + stepX * .38, yy + .25, xx + stepX * .74, yy + .7);
      ctx.strokeStyle = top ? p.roofLight : mix(p.roofLight, p.roof, .46); ctx.lineWidth = .36; ctx.stroke();
    }
  }
  ctx.restore();
  const ridge = [a, c];
  for (const corners of [[tl, a], [bl, a], [tr, c], [br, c]]) {
    stroke(ctx, corners, p.roofShade, 1.45);
    stroke(ctx, corners.map(([px, py]) => [px - .3, py - .45]), p.roofLight, .6);
  }
  stroke(ctx, ridge.map(([px, py]) => [px, py + .7]), p.roofShade, 2.2);
  stroke(ctx, ridge, p.roofLight, 1.9);
  for (let xx = a[0] + 1; xx < c[0]; xx += stepX * 1.15) stroke(ctx, [[xx, ridgeY - .8], [xx + .35, ridgeY + .85]], p.roof, .42);
}
function flatRoof(ctx, b, box, p, options) {
  const { x, y, w, h } = box;
  const slab = p.tone('#d8c9a9'), joint = p.tone('#b4a586');
  rect(ctx, x, y, w, h, slab); texture(ctx, options, 2, 1, x, y, w, h, .18, 64);
  for (let yy = y + 5.5, row = 0; yy < y + h; yy += 7, row++) {
    stroke(ctx, [[x, yy], [x + w, yy]], joint, .42);
    for (let xx = x + (row % 2 ? 3 : 7); xx < x + w; xx += 12) stroke(ctx, [[xx, yy], [xx + .2, yy + 7]], joint, .35);
  }
  stroke(ctx, [[x + 2, y + 2], [x + w - 2, y + 2], [x + w - 2, y + h - 2], [x + 2, y + h - 2]], p.outline, 2.8, true);
  stroke(ctx, [[x + 1.1, y + 1.1], [x + w - 1.1, y + 1.1], [x + w - 1.1, y + h - 1.1], [x + 1.1, y + h - 1.1]], p.coping, 2.1, true);
  if (w > 25 && h > 24) {
    const px = x + w * .64, py = y + h * .65;
    roundRect(ctx, px + .9, py + 1.6, 8, 6, .6, p.outline);
    roundRect(ctx, px, py, 8, 6, .6, p.tone('#d5d6c3'));
    ellipse(ctx, px + 4, py + 3, 2.1, 2, p.tone('#607781'));
    for (let xx = px + 1.1; xx < px + 7; xx += 1.3) stroke(ctx, [[xx, py + .8], [xx, py + 5.1]], p.mortar, .25);
    if (seed(b.x, b.y, 587) > .5) {
      rect(ctx, x + w * .23, y + h * .74, 4.1, 3.2, p.tone('#a96e4a'));
      ellipse(ctx, x + w * .23 + 2, y + h * .74, 3.2, 2.5, p.tone('#608458'));
      ellipse(ctx, x + w * .23 + 1, y + h * .74 - .7, 1.8, 1.3, p.tone('#96ad6f'));
    }
  }
}
function metalRoof(ctx, b, box, p) {
  const { x, y, w, h } = box;
  const light = p.tone('#a9b6ae'), main = p.tone('#748d87'), dark = p.tone('#4d6666');
  const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
  gradient.addColorStop(0, light); gradient.addColorStop(.42, main); gradient.addColorStop(1, dark);
  ctx.fillStyle = gradient; ctx.fillRect(x, y, w, h);
  for (let xx = x + 1; xx < x + w; xx += 3.5) {
    stroke(ctx, [[xx, y], [xx, y + h]], light, .65);
    stroke(ctx, [[xx + .7, y], [xx + .7, y + h]], dark, .5);
  }
  for (let yy = y + 16; yy < y + h; yy += 24) stroke(ctx, [[x, yy], [x + w, yy]], dark, .65);
  stroke(ctx, [[x, y + h * .5], [x + w, y + h * .5]], p.coping, 1.2);
}
function roofDetails(ctx, b, box, p, type) {
  const { x, y, w, h } = box;
  if (w < 19 || h < 17) return;
  if (b.roofDetails?.chimney !== false && type === 'terracotta') {
    const px = x + w * (.65 + seed(b.x, b.y, 605) * .16), py = y + h * .28;
    fill(ctx, [[px + 1, py + 2], [px + 7.2, py + 2], [px + 8.8, py + 8.9], [px + 2.1, py + 9]], p.outline);
    rect(ctx, px + .7, py + .3, 5.1, 6.5, p.stone);
    rect(ctx, px + 4.9, py + .8, 1.8, 6, p.wallDark);
    stroke(ctx, [[px + .7, py + 2.7], [px + 5.6, py + 2.7]], p.mortar, .5);
    stroke(ctx, [[px + .7, py + 5], [px + 5.6, py + 5]], p.mortar, .5);
    rect(ctx, px, py - .45, 7, 1.55, p.coping);
    rect(ctx, px + 1.7, py - .25, 3.7, .8, p.recess);
  }
  if (w > 31 && h > 23) {
    const px = x + w * .25, py = y + h * .67;
    fill(ctx, [[px + .6, py + .9], [px + 8.5, py + .9], [px + 9, py + 6.6], [px + 1, py + 6.6]], p.outline);
    rect(ctx, px, py, 8, 6, p.coping);
    rect(ctx, px + .7, py + .7, 6.6, 4.6, p.glass);
    stroke(ctx, [[px + 1.4, py + 1], [px + 1.4, py + 5]], p.tone('#d4e7df'), .65);
    stroke(ctx, [[px + 4.4, py + .7], [px + 4.4, py + 5.3]], p.recess, .4);
  }
  if (b.roofDetails?.antenna !== false && w > 39 && h > 28 && seed(b.x, b.y, 635) > .35) {
    const px = x + w * .72, py = y + h * .72;
    stroke(ctx, [[px + .6, py - 5], [px + .6, py + 3.8]], p.recess, 1);
    stroke(ctx, [[px, py - 5], [px, py + 3.8]], p.tone('#a7b5b3'), .45);
    stroke(ctx, [[px - 3.8, py - 2.6], [px + 3.8, py - 2.6]], p.recess, .7);
    stroke(ctx, [[px - 2.8, py + .1], [px + 2.8, py + .1]], p.tone('#9cacac'), .5);
  }
}

export function drawIllustratedBuilding(ctx, b, options = {}) {
  const { outer, holes } = rings(b, options);
  if (outer.length < 3 || b.w <= 0 || b.h <= 0) return;
  const profile = options.profile || { height: b.visualHeight || 34, floors: 2 };
  const height = Number.isFinite(profile.height) && profile.height > 0 ? profile.height : 34;
  const p = palette(b, options.lighting), type = material(b), frame = roofFrame(outer, b);
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  facades(ctx, b, outer, holes, { ...profile, height }, p, options);
  ctx.save(); ringPath(ctx, outer, holes); ctx.clip('evenodd');
  ctx.transform(frame.ux, frame.uy, frame.vx, frame.vy, 0, 0);
  if (type === 'terrace') flatRoof(ctx, b, frame, p, options);
  else if (type === 'metal') metalRoof(ctx, b, frame, p);
  else tileRoof(ctx, b, frame, p, options);
  roofDetails(ctx, b, frame, p, type); ctx.restore();
  // Eaves follow all genuine outer and inner outlines. No AABB fills a courtyard.
  for (const ring of [outer, ...holes]) {
    stroke(ctx, ring.map(([x, y]) => [x + .45, y + .9]), p.outline, 1.4, true);
    stroke(ctx, ring, p.coping, 1.1, true);
    stroke(ctx, ring.map(([x, y]) => [x - .2, y - .3]), p.wallLight, .35, true);
  }
  ctx.restore();
}

export function drawIllustratedRubble(ctx, b, options = {}) {
  const { outer, holes } = rings(b, options);
  if (outer.length < 3) return;
  const p = palette(b, options.lighting), box = bounds(outer);
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ringPath(ctx, outer, holes); ctx.clip('evenodd');
  rect(ctx, box.x, box.y, box.w, box.h, p.tone('#a59c85'));
  texture(ctx, options, 0, 1, box.x, box.y, box.w, box.h, .32, 64);
  const gradient = ctx.createRadialGradient(box.x + box.w * .48, box.y + box.h * .48, 1, box.x + box.w * .5, box.y + box.h * .5, Math.max(box.w, box.h) * .58);
  gradient.addColorStop(0, p.tone('#534c43')); gradient.addColorStop(1, p.tone('#a39a81'));
  ctx.globalAlpha *= .7; ctx.fillStyle = gradient; ctx.fillRect(box.x, box.y, box.w, box.h); ctx.globalAlpha /= .7;
  const pieces = clamp(Math.ceil(box.w * box.h / 82), 20, 110);
  for (let i = 0; i < pieces; i++) {
    const x = box.x + seed(b.x, b.y, 721 + i) * box.w, y = box.y + seed(b.y, b.x, 861 + i) * box.h;
    const w = 1.8 + seed(b.x, b.y, 991 + i) * 4.8, h = 1.3 + seed(b.y, b.x, 1111 + i) * 2.5;
    const angle = seed(b.x, b.y, 1191 + i) * Math.PI;
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    rect(ctx, -w / 2 + .8, -h / 2 + 1, w, h, p.outline);
    fill(ctx, [[-w / 2, -h / 2], [w / 2 - .5, -h / 2], [w / 2, h / 2], [-w / 2 + .4, h / 2]], i % 4 ? p.stone : p.roof);
    stroke(ctx, [[-w / 2, -h / 2], [w / 2 - .5, -h / 2]], i % 4 ? p.coping : p.roofLight, .65);
    ctx.restore();
  }
  for (let i = 0; i < 4; i++) {
    const x = box.x + box.w * (.16 + i * .22), y = box.y + box.h * (.23 + seed(b.x, b.y, 1391 + i) * .5);
    stroke(ctx, [[x - 3, y - 2], [x + 1, y], [x, y + 4], [x + 5, y + 6]], p.outline, .7);
  }
  ctx.restore();
}
