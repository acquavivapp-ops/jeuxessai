import { drawMaterialGrain } from './illustrated-materials.js';
import { fortificationsFor } from './data/calvi-architecture.js';
import { roofObservationFor } from './data/calvi-roof-observations.js';

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
// Typology comes from archived source tags, never an index/random facade.
function typology(b) {
  const t = b.osmTags || {}, kind = t.building || '';
  if (kind === 'cathedral') return 'cathedral';
  if (t.historic === 'tower' || t.man_made === 'tower' && t['tower:type'] === 'defensive') return 'tower';
  if (/castle|fort|fortress|bastion/.test(t.historic || t['disused:building'] || '') || t.castle_type === 'fortress') return 'fort';
  if (/church|chapel/.test(kind) || t.amenity === 'place_of_worship') return 'church';
  if (t.aeroway === 'terminal') return 'terminal';
  if (t.aeroway === 'hangar' || /hangar|warehouse|industrial/.test(kind)) return 'hangar';
  if (kind === 'train_station') return 'station';
  return 'house';
}
function palette(building, lighting) {
  const day = clamp(Number.isFinite(lighting?.daylight) ? lighting.daylight : Number.isFinite(lighting?.night) ? 1 - lighting.night : 1, 0, 1);
  const tone = colour => mix(mix(colour, '#29465c', .62), colour, day);
  const tags = building.osmTags || {}, type = typology(building), observed = roofObservationFor(building) || building.illustratedSourceRoof;
  const sourceWall = tags['building:colour'] || tags.colour;
  const wallDefault = type === 'tower' || type === 'fort' ? '#b8b6a6' : type === 'terminal' || type === 'hangar' ? '#d4d5cf' : '#ded4bd';
  const wall = validColour(sourceWall) ? sourceWall : building.osmId || building.id?.startsWith('osm-') ? wallDefault : validColour(building.wallTone) ? building.wallTone : wallDefault;
  // Aerial colour is an observation, not evidence for a flat roof/material.
  const sourceRoof = tags['roof:colour'] || observed?.colour;
  const roof = validColour(sourceRoof) ? sourceRoof : validColour(building.roofTone) && !building.osmId && !building.id?.startsWith('osm-') ? building.roofTone : '#bf846c';
  return {
    day, lamps: lighting?.lamps ?? 1 - day, tone,
    wall: tone(wall), wallLight: tone(mix(wall, '#fff4df', .16)),
    wallDark: tone(mix(wall, '#6d716c', .25)), stone: tone('#beb8a5'),
    mortar: tone('#8d8d80'), coping: tone('#dedbc9'), roof: tone(roof),
    roofLight: tone(mix(roof, '#eee3cf', .18)), roofShade: tone(mix(roof, '#55574f', .24)),
    shutter: tone(validColour(tags['window:colour']) ? tags['window:colour'] : '#506b6b'),
    outline: tone('#59605a'), recess: tone('#35454c'), glass: tone('#63818a'),
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
  const tags = b.osmTags || {}, shape = tags['roof:shape'] || b.roofShape, type = typology(b);
  if (type === 'tower' || type === 'fort') return 'stone';
  if (type === 'terminal') return 'terminal'; // confirmed by archived IGN view
  if (type === 'hangar' || /metal|steel|tin|zinc/.test(tags['roof:material'] || '')) return 'metal';
  if (shape === 'flat') return 'terrace';
  // Only the legacy fictional world uses its old roof variant. Source Calvi
  // buildings never acquire a flat roof simply from array index or colour.
  if (!b.osmId && !b.id?.startsWith('osm-') && b.roof === 1 && !shape) return 'terrace';
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
  const type = typology(b), stone = /stone|limestone/.test(b.osmTags?.['building:material'] || '') || type === 'tower' || type === 'fort';
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, side ? p.wallDark : p.wallLight);
  gradient.addColorStop(.35, side ? mix(p.wallDark, p.wall, .3) : p.wall);
  gradient.addColorStop(1, p.wallDark);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, length, height);
  drawMaterialGrain(ctx, 0, 0, length, height, { material: stone ? 'stone' : 'plaster', strength: .25 });
  // Mortar courses at 0.45 m, with sparse half-metre block joints. Paths are
  // batched and bounded even on the large airport/citadel faces.
  if (stone) {
    ctx.save(); ctx.globalAlpha *= .2; ctx.strokeStyle = p.mortar; ctx.lineWidth = .3;
    const course = Math.max(1.8, height / 42), block = Math.max(3.2, length / 36);
    ctx.beginPath();
    for (let y = course, row = 0; y < height; y += course, row++) {
      ctx.moveTo(0, y); ctx.lineTo(length, y);
      for (let x = row % 2 ? block * .5 : block; x < length; x += block) {
        ctx.moveTo(x, y); ctx.lineTo(x, Math.min(height, y + course));
      }
    }
    ctx.stroke(); ctx.restore();
  }
  // Plain plaster stays calm. Low footings and true face corners carry relief.
  rect(ctx, 0, height - 1.2, length, 1.2, p.stone);
  stroke(ctx, [[0, height - 1.2], [length, height - 1.2]], p.coping, .4);
  if (type !== 'terminal' && type !== 'hangar' && length > 8) {
    rect(ctx, .2, 0, 1.1, height, mix(p.wall, p.coping, .3));
    rect(ctx, length - 1.3, 0, 1.1, height, mix(p.wallDark, p.stone, .3));
  }
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

  }
  rect(ctx, x - width / 2 - 1.2, y + height / 2 + .2, width + 2.4, .85, p.coping);
}
function balcony(ctx, x, y, p) {
  fill(ctx, [[x - 4.6, y], [x + 4.6, y], [x + 5.7, y + 2.8], [x - 3.5, y + 2.8]], p.stone);
  stroke(ctx, [[x - 3.5, y + 3], [x + 5.6, y + 3]], p.tone('#47605d'), .65);
  for (let dx = -3; dx < 6; dx += 1.7) stroke(ctx, [[x + dx, y + .8], [x + dx, y + 3]], p.tone('#33494b'), .45);
}
function landmarkOpenings(ctx, b, length, height, p, type, side) {
  if (length < 6 || height < 7) return;
  const industrial = type === 'terminal' || type === 'hangar';
  const count = clamp(Math.floor(length / (industrial ? 28 : 30)), 1, industrial ? 14 : 5);
  const glass = p.lamps > .2 ? mix(p.glass, '#d8c9a2', p.lamps * .5) : p.glass;
  if (industrial) {
    if (type === 'terminal') {
      const top = height * .5, wh = Math.min(8, height * .24);
      rect(ctx, 1, top, length - 2, wh, p.recess);
      rect(ctx, 1.4, top + .5, length - 2.8, wh - 1, glass);
      ctx.beginPath(); for (let x = 4; x < length; x += 5.2) { ctx.moveTo(x, top); ctx.lineTo(x, top + wh); }
      ctx.strokeStyle = p.coping; ctx.lineWidth = .45; ctx.stroke();
    } else {
      const doors = side ? 1 : count, width = Math.min(25, length / doors * .66), dh = Math.min(height * .65, 18);
      for (let i = 0; i < doors; i++) {
        const x = (i + .5) * length / doors - width / 2;
        rect(ctx, x - .6, height - dh - .7, width + 1.2, dh + .7, p.outline);
        rect(ctx, x, height - dh, width, dh, p.tone('#909b9b'));
        stroke(ctx, [[x + width / 2, height - dh], [x + width / 2, height]], p.recess, .5);
        for (let y = height - dh + 3; y < height; y += 3) stroke(ctx, [[x, y], [x + width, y]], p.tone('#aeb7b3'), .3);
      }
    }
    return;
  }
  const sacred = type === 'church' || type === 'cathedral';
  for (let i = 0; i < count; i++) {
    const x = (i + .5) * length / count, wh = Math.min(height * (sacred ? .31 : .18), sacred ? 14 : 6), width = sacred ? 4.5 : 2;
    const y = Math.min(height - wh - 3, height * (sacred ? .3 : .48));
    roundRect(ctx, x - width / 2 - .6, y - .6, width + 1.2, wh + 1.2, sacred ? width * .5 : .1, p.stone);
    roundRect(ctx, x - width / 2, y, width, wh, sacred ? width * .5 : .1, p.recess);
    if (sacred) {
      roundRect(ctx, x - width / 2 + .6, y + .7, width - 1.2, wh - 1.4, 1.1, glass);
      stroke(ctx, [[x, y + .8], [x, y + wh - .7]], p.recess, .45);
    }
  }
  if (sacred && !side && length > 20) {
    const width = 7, dh = Math.min(14, height * .45), x = length * .5;
    roundRect(ctx, x - width / 2 - 1, height - dh - 1, width + 2, dh + 1, 3, p.stone);
    roundRect(ctx, x - width / 2, height - dh, width, dh, 2.3, p.tone('#685e50'));
    stroke(ctx, [[x, height - dh + 1], [x, height]], p.recess, .5);
  }
}

function facadeOpenings(ctx, b, length, height, profile, p, edgeIndex, side, options) {
  const type = typology(b);
  if (type !== 'house' && type !== 'station') {
    landmarkOpenings(ctx, b, length, height, p, type, side); return;
  }
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
      if (!side && floor < floors - 1 && i % 3 === 1 && b.balcony) balcony(ctx, x, y + paneHeight / 2 + .9, p);
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
  const { x, y, w, h } = box, shape = b.osmTags?.['roof:shape'] || b.roofShape;
  const hipped = ['hipped', 'pyramidal', 'half-hipped'].includes(shape) || !shape && w < h * 1.28;
  const hip = hipped ? Math.min(w * .24, h * .44) : 0, ridgeY = y + h * .5;
  const tl = [x, y], tr = [x + w, y], br = [x + w, y + h], bl = [x, y + h];
  const a = [x + hip, ridgeY], c = [x + w - hip, ridgeY];
  rect(ctx, x, y, w, h, p.roof);
  if (shape === 'skillion') roofFacet(ctx, [tl, tr, br, bl], p.roofLight, p.roofShade, box);
  else {
    roofFacet(ctx, [tl, tr, c, a], p.roofLight, p.roof, box);
    roofFacet(ctx, [bl, br, c, a], p.roof, p.roofShade, box);
    if (hipped) {
      roofFacet(ctx, [tl, bl, a], mix(p.roofLight, p.roof, .4), p.roofShade, box);
      roofFacet(ctx, [tr, br, c], p.roof, p.roofShade, box);
    }
  }
  drawMaterialGrain(ctx, x, y, w, h, { material: 'tiles', strength: .35 });
  // Fine barrel tiles are 0.2–0.4 m, not the former 1.2 m rectangles. At
  // overview density the courses are grouped. Two batched paths replace up to
  // 1700 rounded tiles and their individual outlines/highlights per roof.
  const stepX = Math.max(.9, w / 96), stepY = Math.max(1.5, h / 64);
  ctx.save(); ctx.globalAlpha *= .17; ctx.strokeStyle = p.roofShade; ctx.lineWidth = .24;
  ctx.beginPath();
  for (let yy = y + stepY; yy < y + h; yy += stepY) { ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); }
  ctx.stroke(); ctx.globalAlpha *= .62; ctx.strokeStyle = p.roofLight; ctx.lineWidth = .22; ctx.beginPath();
  for (let xx = x + stepX; xx < x + w; xx += stepX) { ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); }
  ctx.stroke(); ctx.restore();
  if (shape !== 'skillion') {
    if (hipped) for (const corners of [[tl, a], [bl, a], [tr, c], [br, c]]) {
      stroke(ctx, corners, p.roofShade, .8);
      stroke(ctx, corners.map(([px, py]) => [px - .2, py - .25]), p.roofLight, .35);
    }
    stroke(ctx, [[a[0], ridgeY + .45], [c[0], ridgeY + .45]], p.roofShade, 1.2);
    stroke(ctx, [a, c], p.roofLight, 1.05);
  }
}
function flatRoof(ctx, b, box, p, options) {
  const { x, y, w, h } = box, type = typology(b);
  const slab = type === 'fort' || type === 'tower' ? p.tone('#b7b3a3') : p.roof;
  const gradient = ctx.createLinearGradient(x, y, x + w * .5, y + h);
  gradient.addColorStop(0, mix(slab, p.coping, .2)); gradient.addColorStop(1, mix(slab, p.wallDark, .14));
  ctx.fillStyle = gradient; ctx.fillRect(x, y, w, h);
  drawMaterialGrain(ctx, x, y, w, h, { material: 'stone', strength: .3 });
  // Broad terrace slabs and a few drainage seams. The parapet is drawn on
  // the genuine outer/inner rings by the caller, never an AABB rectangle.
  ctx.save(); ctx.globalAlpha *= .17; ctx.strokeStyle = p.mortar; ctx.lineWidth = .35; ctx.beginPath();
  const pitch = Math.max(12, h / 24);
  for (let yy = y + pitch; yy < y + h; yy += pitch) { ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); }
  if (type === 'house') for (let xx = x + 18; xx < x + w; xx += Math.max(18, w / 14)) { ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); }
  ctx.stroke(); ctx.restore();
}
function metalRoof(ctx, b, box, p) {
  const { x, y, w, h } = box;
  const light = mix(p.roof, p.tone('#e2e6e1'), .4), main = mix(p.roof, p.tone('#a0aba9'), .4), dark = mix(p.roof, p.tone('#6e7b7b'), .4);
  const gradient = ctx.createLinearGradient(x, y, x + w * .2, y + h);
  gradient.addColorStop(0, light); gradient.addColorStop(.45, main); gradient.addColorStop(1, dark);
  ctx.fillStyle = gradient; ctx.fillRect(x, y, w, h);
  drawMaterialGrain(ctx, x, y, w, h, { material: 'metal', strength: .25 });
  // Real corrugations are sub-metre. Group distant ribs rather than drawing
  // high-contrast green stripes or thousands of lines across a hangar.
  ctx.save(); ctx.globalAlpha *= .19; ctx.strokeStyle = light; ctx.lineWidth = .25; ctx.beginPath();
  for (let yy = y + .9; yy < y + h; yy += Math.max(.9, h / 64)) { ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); }
  ctx.stroke(); ctx.strokeStyle = dark; ctx.globalAlpha *= .8; ctx.beginPath();
  for (let xx = x + 24; xx < x + w; xx += Math.max(24, w / 32)) { ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); }
  ctx.stroke(); ctx.restore();
  if (typology(b) !== 'terminal') stroke(ctx, [[x, y + h * .5], [x + w, y + h * .5]], light, .8);
}
// The grey octagonal dome is observed in the archived urban IGN photograph.
// Its drawn centre/radius are illustrative; source footprint/height stay exact.
function cathedralDome(ctx, b, p) {
  if (b.id !== 'osm-building-244735660') return;
  const cx = 17784 - b.x, cy = 7205 - b.y, r = 33;
  const edge = Array.from({ length: 8 }, (_, i) => {
    const a = i / 8 * Math.PI * 2 + Math.PI / 8; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
  for (let i = 0; i < 8; i++) {
    const shade = i < 4 ? p.tone('#bec1b9') : p.tone('#8b9697');
    fill(ctx, [[cx, cy], edge[i], edge[(i + 1) % 8]], shade);
    stroke(ctx, [[cx, cy], edge[i]], p.tone('#d0d3ca'), .65);
  }
  stroke(ctx, edge, p.tone('#69767a'), 1.2, true);
  ellipse(ctx, cx, cy, 3.4, 3.4, p.tone('#6a777b'));
  ellipse(ctx, cx - .5, cy - .6, 1.3, 1.3, p.tone('#d4d5ca'));
}

function roofDetails(ctx, b, box, p, type) {
  const { x, y, w, h } = box;
  if (w < 19 || h < 17 || typology(b) !== 'house') return;
  if (b.roofDetails?.chimney === true && type === 'terracotta') {
    const px = x + w * (.65 + seed(b.x, b.y, 605) * .16), py = y + h * .28;
    fill(ctx, [[px + 1, py + 2], [px + 7.2, py + 2], [px + 8.8, py + 8.9], [px + 2.1, py + 9]], p.outline);
    rect(ctx, px + .7, py + .3, 5.1, 6.5, p.stone);
    rect(ctx, px + 4.9, py + .8, 1.8, 6, p.wallDark);
    stroke(ctx, [[px + .7, py + 2.7], [px + 5.6, py + 2.7]], p.mortar, .5);
    stroke(ctx, [[px + .7, py + 5], [px + 5.6, py + 5]], p.mortar, .5);
    rect(ctx, px, py - .45, 7, 1.55, p.coping);
    rect(ctx, px + 1.7, py - .25, 3.7, .8, p.recess);
  }
  if (b.roofDetails?.skylight === true && w > 31 && h > 23) {
    const px = x + w * .25, py = y + h * .67;
    fill(ctx, [[px + .6, py + .9], [px + 8.5, py + .9], [px + 9, py + 6.6], [px + 1, py + 6.6]], p.outline);
    rect(ctx, px, py, 8, 6, p.coping);
    rect(ctx, px + .7, py + .7, 6.6, 4.6, p.glass);
    stroke(ctx, [[px + 1.4, py + 1], [px + 1.4, py + 5]], p.tone('#d4e7df'), .65);
    stroke(ctx, [[px + 4.4, py + .7], [px + 4.4, py + 5.3]], p.recess, .4);
  }
  if (b.roofDetails?.antenna === true && w > 39 && h > 28 && seed(b.x, b.y, 635) > .35) {
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
  if (type === 'terrace' || type === 'stone') flatRoof(ctx, b, frame, p, options);
  else if (type === 'metal' || type === 'terminal') metalRoof(ctx, b, frame, p);
  else tileRoof(ctx, b, frame, p, options);
  roofDetails(ctx, b, frame, p, type); ctx.restore();
  ctx.save(); ringPath(ctx, outer, holes); ctx.clip('evenodd'); cathedralDome(ctx, b, p); ctx.restore();
  // Eaves follow all genuine outer and inner outlines. No AABB fills a courtyard.
  for (const ring of [outer, ...holes]) {
    stroke(ctx, ring.map(([x, y]) => [x + .45, y + .9]), p.outline, .85, true);
    stroke(ctx, ring, p.coping, .65, true);
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

  const gradient = ctx.createRadialGradient(box.x + box.w * .48, box.y + box.h * .48, 1, box.x + box.w * .5, box.y + box.h * .5, Math.max(box.w, box.h) * .58);
  gradient.addColorStop(0, p.tone('#534c43')); gradient.addColorStop(1, p.tone('#a39a81'));
  ctx.globalAlpha *= .7; ctx.fillStyle = gradient; ctx.fillRect(box.x, box.y, box.w, box.h); ctx.globalAlpha /= .7;
  const pieces = clamp(Math.ceil(box.w * box.h / 180), 12, 40);
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

/** Decorative archived city-wall segments, WORLD coordinates. Width/height are
 * explicitly estimated visual dimensions. projectPoint follows the existing
 * terrain projection; neither this pass nor its source adds a collision body. */
export function drawIllustratedFortifications(ctx, world, bounds, { lighting = {}, projectPoint = (x, y) => [x, y] } = {}) {
  const day = clamp(lighting.daylight ?? 1 - (lighting.night ?? 0), 0, 1);
  const tone = c => mix(mix(c, '#29465c', .62), c, day);
  for (const wall of fortificationsFor(world)) {
    const box = wall.bounds, height = wall.height, width = wall.width;
    if (bounds && (box.x + box.w + width < bounds.x || box.y + box.h + height < bounds.y || box.x - width > bounds.x + bounds.w || box.y - height > bounds.y + bounds.h)) continue;
    const points = wall.points, top = [];
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
    for (const [x, y] of points) { const p = projectPoint(x, y); top.push([p[0] - 4, p[1] - height]); }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (length < .1) continue;
      const segment = bounds ? { x: Math.min(a[0], b[0]) - width, y: Math.min(a[1], b[1]) - height, w: Math.abs(dx) + width * 2, h: Math.abs(dy) + height + width } : null;
      if (segment && (segment.x + segment.w < bounds.x || segment.y + segment.h < bounds.y || segment.x > bounds.x + bounds.w || segment.y > bounds.y + bounds.h)) continue;
      const side = dy * 4 - dx * height >= 0 ? 1 : -1;
      const nx = dy / length * side * width / 2, ny = -dx / length * side * width / 2;
      const aa = projectPoint(a[0] + nx, a[1] + ny), bb = projectPoint(b[0] + nx, b[1] + ny);
      const ta = [aa[0] - 4, aa[1] - height], tb = [bb[0] - 4, bb[1] - height];
      const gradient = ctx.createLinearGradient(ta[0], ta[1], aa[0], aa[1]);
      gradient.addColorStop(0, tone('#c9c6b3')); gradient.addColorStop(.3, tone('#abae9f')); gradient.addColorStop(1, tone('#858d84'));
      ringPath(ctx, [ta, tb, bb, aa]); ctx.fillStyle = gradient; ctx.fill();
      ctx.save(); ringPath(ctx, [ta, tb, bb, aa]); ctx.clip();
      ctx.globalAlpha *= .22; ctx.strokeStyle = tone('#747e75'); ctx.lineWidth = .35; ctx.beginPath();
      for (let h = 3.2; h < height; h += 3.2) { ctx.moveTo(ta[0] + 4 * h / height, ta[1] + h); ctx.lineTo(tb[0] + 4 * h / height, tb[1] + h); }
      ctx.stroke(); ctx.restore();
      stroke(ctx, [aa, bb], tone('#69796d'), .65);
    }
    // The unfilled crest follows the actual 67 source nodes, including bastions.
    stroke(ctx, top, tone('#6d7c72'), width + .7);
    stroke(ctx, top, tone('#c5c5b2'), width - .6);
    stroke(ctx, top.map(([x, y]) => [x - .5, y - .6]), tone('#e0decb'), .9);
    ctx.restore();
  }
}
