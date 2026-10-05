// Original small world sprites: 1990s silhouettes, modern material highlights.
// The drawing bounds follow the existing physical bodies. Time comes from the
// game clock, so pause and reduced motion also freeze the visual details.
const INK = '#122231';
const palettes = new Map();
let sceneLight = { daylight: 0, night: 1, sunAngle: -.75 * Math.PI, shadowX: .65, shadowY: .85, shadowOpacity: .2 };
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const hash = (value = '') => {
  let n = 2166136261;
  for (const c of String(value)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
};
function poly(ctx, points, fill) {
  ctx.fillStyle = fill; ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath(); ctx.fill();
}
function box(ctx, x, y, w, h, fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
function oval(ctx, x, y, rx, ry, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
function seam(ctx, points, color, width = .7) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
}
function mix(base, target, amount) {
  const a = /^#[0-9a-f]{6}$/i.test(base) ? base : '#b65b64';
  const number = (s, i) => parseInt(s.slice(i, i + 2), 16);
  return '#' + [1, 3, 5].map(i => Math.round(number(a, i) * (1 - amount) + number(target, i) * amount).toString(16).padStart(2, '0')).join('');
}
function material(color) {
  color = mix(color, '#233c50', (sceneLight.night ?? 1) * .22);
  if (!palettes.has(color)) palettes.set(color, {
    base: color, light: mix(color, '#eee6ca', .3), pale: mix(color, '#c6d8d7', .51),
    dark: mix(color, '#1d2c34', .37), deep: mix(color, '#172735', .64),
  });
  while (palettes.size > 384) palettes.delete(palettes.keys().next().value);
  return palettes.get(color);
}

export const ARCADE_CAR_STYLES = Object.freeze([
  'Petite citadine', 'Berline', 'Break', 'Coupé', 'Fourgon', 'Pick-up',
  'Rallye', 'Tout-terrain', 'Taxi', 'Livraison', 'Cabriolet', 'Fastback',
]);
const CIVILIANS = Object.freeze([
  { shirt: '#df7854', trousers: '#253f5a', hair: '#42313b', skin: '#e9b18c', detail: 'polo' },
  { shirt: '#50b8b5', trousers: '#a98865', hair: '#744b31', skin: '#d7a078', detail: 'stripes' },
  { shirt: '#d7c477', trousers: '#354763', hair: '#e1d4b8', skin: '#eabe9a', detail: 'vest' },
  { shirt: '#ad77ba', trousers: '#634551', hair: '#352936', skin: '#b97e62', detail: 'dress' },
  { shirt: '#6e984e', trousers: '#405264', hair: '#513126', skin: '#d59670', detail: 'jacket' },
  { shirt: '#e7ddd0', trousers: '#517aa0', hair: '#241f29', skin: '#c38a64', detail: 'sailor' },
  { shirt: '#496ab4', trousers: '#2e354c', hair: '#c78d50', skin: '#e5ae8a', detail: 'tracksuit' },
  { shirt: '#c95579', trousers: '#7b684a', hair: '#393137', skin: '#865644', detail: 'bag' },
]);

function star(ctx, x, y, color = '#ffdd8c') {
  poly(ctx, [[x, y - 3], [x + .8, y - .9], [x + 3, y], [x + .8, y + .8], [x, y + 3], [x - .8, y + .8], [x - 3, y], [x - .8, y - .9]], color);
}

function actorBody(ctx, person, time, player, reducedEffects) {
  const uniform = person.kind === 'gendarme' || person.role === 'officer' || person.onFoot;
  const look = CIVILIANS[Math.abs(Math.trunc(person.variant || 0)) % CIVILIANS.length];
  const colors = material(player ? '#63734f' : uniform ? '#3c6988' : mix(person.color || look.shirt, '#697987', .16));
  const trousers = player ? '#414f37' : uniform ? '#213c59' : mix(look.trousers, '#263746', .15);
  const skin = uniform ? '#b9987c' : mix(look.skin, '#8d8275', .18);
  const step = reducedEffects ? 0 : Math.sin((person.walk || 0) * 1.9) * 1.5;
  const armed = player || uniform, recoil = player ? clamp(person.recoil || 0, 0, 1) * .8 : 0;
  const facing = player && Number.isFinite(person.aimAngle) ? person.aimAngle : person.dir ?? person.angle ?? 0;
  const lightSide = Math.sin((sceneLight.sunAngle ?? -.75 * Math.PI) - facing) < 0 ? -1 : 1;

  // From the sky, shoulders, a small crown and a long stride describe an adult.
  // Feet stay behind the head; there is no large face or cartoon eye panel.
  for (const side of [-1, 1]) {
    const stride = side * step, y = side * 1.6;
    poly(ctx, [[-2.8, y - .8], [-4.8 - stride * .65, y - .9], [-7.2 - stride, y - .5], [-7.7 - stride, y + .7], [-5.8 - stride, y + 1], [-3.5, y + .9]], '#192932');
    poly(ctx, [[-2.9, y - .55], [-4.7 - stride * .65, y - .65], [-6.1 - stride, y - .3], [-6.2 - stride, y + .7], [-3.4, y + .6]], trousers);
    seam(ctx, [[-3.4, y - .35], [-4.6 - stride * .55, y - .35], [-5.9 - stride, y -.1]], lightSide === side ? '#87917a' : '#556454', .28);
    box(ctx, -7.4 - stride, y -.45, 1.45, 1.25, '#1b262c');
    box(ctx, -7.25 - stride, y -.4, .35, .8, '#5a6568');
    if (player) {
      box(ctx, -4.9 - stride * .65, y -.55, 1.1, .75, '#5f6e46');
      seam(ctx, [[-4.8 - stride * .65, y -.5], [-3.9 - stride * .65, y -.5]], '#88936a', .23);
    }
  }

  const torso = [[-3.6, -2.2], [-1.2, -3.45], [1.8, -3.25], [2.7, -2.2], [2.55, 2.2], [1.75, 3.2], [-1.5, 3.3], [-3.6, 2.05]];
  poly(ctx, torso, '#192b31');
  poly(ctx, [[-3.3, -1.95], [-1.15, -3.1], [1.65, -2.95], [2.4, -1.9], [2.3, 1.9], [1.55, 2.9], [-1.35, 3], [-3.3, 1.85]], colors.base);
  poly(ctx, [[-3.25, lightSide * 1.8], [-1.1, lightSide * 3.05], [1.65, lightSide * 2.9], [2.2, lightSide * 2.05], [.25, lightSide * 1.6], [-2.9, lightSide * .7]], colors.light);
  poly(ctx, [[-3.2, -lightSide * 1.7], [-1.35, -lightSide * 2.9], [1.45, -lightSide * 2.85], [1.85, -lightSide * 2.05], [-1.1, -lightSide * 1.2]], colors.dark);
  seam(ctx, [[-3, lightSide * 1.55], [-1, lightSide * 2.85], [1.6, lightSide * 2.65]], '#bbc2a8', .28);
  box(ctx, -3.1, -2.1, .65, 4.25, player ? '#333e30' : '#23333d');
  box(ctx, -2.85, -.45, .6, .85, '#ac9f72');
  seam(ctx, [[-.8, -2.1], [-.8, 2.05]], colors.dark, .25);
  if (player) {
    poly(ctx, [[-2.7, -1.8], [-1.6, -2.2], [-.7, -1.5], [-1.35, -.7], [-2.2, -.9]], '#3c4d33');
    poly(ctx, [[.2, .75], [1.1, .45], [1.55, 1.75], [.45, 2.1]], '#858764');
    box(ctx, -.65, -2.45, 1.4, .8, '#728055');
    seam(ctx, [[-.45, -2.3], [.5, -2.3]], '#a1a584', .22);
    box(ctx, -1.9, .7, 1, 1.05, '#4b593c');
    seam(ctx, [[-2, .8], [-1, .8], [-1, 1.65]], '#849270', .23);
    box(ctx, -2.95, 1.55, .8, 1.2, '#293c32');
  } else if (uniform) {
    box(ctx, -.45, -2.35, .85, .7, '#b8b196');
    box(ctx, -1.95, 1.7, .95, 1.15, '#1e3448');
    seam(ctx, [[-2.75, -1.8], [-2.3, -1.9], [-2.3, 1.8]], '#768b9c', .25);
  } else {
    if (look.detail === 'stripes' || look.detail === 'sailor') for (const x of [-2, -.2, 1.4]) box(ctx, x, -2.2, .45, 4.4, look.detail === 'sailor' ? '#354f68' : '#c1bda5');
    if (look.detail === 'vest') { box(ctx, -1.9, -2.5, 1, 5, '#686450'); box(ctx, 1.1, -2.25, .75, 4.5, '#686450'); }
    if (look.detail === 'tracksuit') seam(ctx, [[-3.1, -1.75], [-.8, -2.8], [1.6, -2.6]], '#c6c5b6', .42);
    if (look.detail === 'dress') poly(ctx, [[-2.7, -2], [-4.55, -2.75], [-4.2, 2.7], [-2.5, 2.05]], colors.dark);
    if (look.detail === 'bag') {
      seam(ctx, [[1.7, -2.4], [-2.7, 2.7]], '#b5a17b', .6);
      poly(ctx, [[-4.1, 1.8], [-2.7, 1.65], [-2.15, 3.2], [-3.8, 3.6]], '#83694c');
      seam(ctx, [[-3.85, 1.95], [-2.95, 1.8]], '#c4aa79', .3);
    }
  }

  // Thin bent arms extend naturally to the aiming hand, rather than around a
  // front-facing head. Unarmed pedestrians counter-swing their hands.
  for (const side of [-1, 1]) {
    const swing = armed ? 0 : side * step * .8;
    const handX = armed ? 5.1 - recoil : .7 + swing;
    const handY = armed ? side < 0 ? -.3 : 1.55 : side * 4;
    const elbowX = armed ? 2.7 - recoil * .35 : -.25 + swing * .5;
    const elbowY = armed ? side < 0 ? -3.15 : 3.45 : side * 4.1;
    const shoulderX = .15, shoulderY = side * 2.6;
    poly(ctx, [[shoulderX - .5, shoulderY - .7], [elbowX - .6, elbowY -.7], [handX -.5, handY -.6], [handX + .45, handY + .65], [elbowX + .75, elbowY + .55], [shoulderX + .65, shoulderY + .65]], '#1c2a30');
    poly(ctx, [[shoulderX -.25, shoulderY -.4], [elbowX -.4, elbowY -.4], [handX -.6, handY -.35], [handX -.15, handY + .4], [elbowX + .45, elbowY + .32], [shoulderX + .4, shoulderY + .4]], lightSide === side ? colors.light : colors.dark);
    oval(ctx, handX, handY, .72, .7, player ? '#25362f' : skin);
    seam(ctx, [[elbowX -.05, elbowY -.15], [handX -.55, handY -.1]], player ? '#a5ad8d' : '#c4b69b', .23);
  }

  // Crown and neck are seen from directly above. Face features are deliberately
  // absent; the hood, hair and kepi are recognizable from shape and lighting.
  oval(ctx, 2.15, 0, 2.6, 2.45, '#15232b');
  if (player) {
    oval(ctx, 2.05, -.05, 2.28, 2.12, '#1a252c');
    poly(ctx, [[.2, -.7], [.95, -1.75], [2.6, -1.85], [3.2, -1.1], [1.7, -.9], [.8, .6]], '#344047');
    seam(ctx, [[.65, -1.1], [1.3, -1.8], [2.6, -1.75]], '#626d71', .32);
    seam(ctx, [[1.1, 1.6], [2.55, 1.8], [3.7, .8]], '#0e171d', .4);
    box(ctx, 3.93, -.8, .32, 1.6, '#9e9b85');
    box(ctx, 4.16, -.4, .28, .8, '#161f26');
  } else if (uniform) {
    oval(ctx, 2.1, 0, 2.15, 2.03, '#213c53');
    poly(ctx, [[.3, -.7], [1.1, -1.65], [2.6, -1.7], [3.4, -.8], [2.1, -.8], [1.1, .65]], '#416179');
    seam(ctx, [[3.7, -1.1], [3.95, -.3], [3.9, .65], [3.65, 1.15]], '#c4bba0', .45);
    poly(ctx, [[3.65, -1.05], [4.8, -.65], [4.8, .65], [3.65, 1.05]], '#142c3b');
    box(ctx, 2.1, -.35, .6, .6, '#b9ae73');
  } else {
    const hair = mix(look.hair, '#56606b', .12);
    oval(ctx, 2.1, 0, 2.1, 2.05, hair);
    poly(ctx, [[.45, -.85], [1.3, -1.75], [2.9, -1.55], [3.75, -.35], [2.3, -.5], [1.45, .7], [.35, .6]], mix(hair, '#c3ad8d', .28));
    seam(ctx, [[1.1, -1.5], [2.2, -1.6], [3.1, -.85]], mix(hair, '#dfd2b9', .25), .25);
    if (['dress', 'bag'].includes(look.detail)) poly(ctx, [[.9, 1.15], [2.7, 1.3], [3.3, 2.3], [1.8, 2.75], [.25, 1.9]], hair);
    if (look.detail === 'sailor') { oval(ctx, 2.05, -.15, 1.9, 1.75, '#c8c7b3'); seam(ctx, [[.3, .2], [1.4, 1.35], [3, 1.2]], '#7f92a2', .4); }
    box(ctx, 3.95, -.5, .48, 1, skin);
  }
  if (person.damageFlash > 0) {
    ctx.save(); ctx.globalAlpha *= .45;
    seam(ctx, [[-3, -1.8], [-1, -3], [1.7, -2.8]], '#ffe7ad', .65); ctx.restore();
  }
}

function actorDown(ctx, person, player, uniform, look) {
  const color = player ? '#536143' : uniform ? '#355c7e' : mix(person.color || look.shirt, '#657987', .15);
  const trousers = player ? '#3b4a34' : uniform ? '#243d54' : look.trousers;
  poly(ctx, [[-5.5, -1.7], [-.8, -2.6], [2.1, -1.55], [3.1, .35], [.6, 2.3], [-4.7, 1.8]], '#192830');
  poly(ctx, [[-5.1, -1.35], [-.8, -2.2], [1.75, -1.3], [2.4, .25], [.5, 1.85], [-4.4, 1.4]], color);
  seam(ctx, [[-4.6, -1.2], [-1, -1.9], [1.3, -1]], mix(color, '#b8bca4', .33), .3);
  poly(ctx, [[-5, -.9], [-8.1, -2.6], [-9.4, -2.25], [-9.3, -1.35], [-5.8, .3]], trousers);
  poly(ctx, [[-4.7, .4], [-7.6, 2.6], [-8.8, 2.65], [-8.9, 1.7], [-5.4, -.35]], trousers);
  box(ctx, -9.9, -2.5, 1.35, .9, '#1a252b'); box(ctx, -9.4, 1.85, 1.35, .9, '#1a252b');
  oval(ctx, 3.35, -.1, 2.28, 2.03, player ? '#1c2930' : uniform ? '#243c50' : look.hair);
  seam(ctx, [[2, -.8], [3.1, -1.65], [4.6, -.6]], player ? '#4b5a63' : uniform ? '#657c8d' : mix(look.hair, '#c2b49c', .35), .4);
  if (uniform) seam(ctx, [[4.6, -1], [4.9, 0], [4.6, 1]], '#b8b5a0', .35);
  poly(ctx, [[-1.6, -1.8], [-.9, -3.5], [.2, -3.9], [.65, -3.2], [-.4, -1.7]], color);
  poly(ctx, [[-.8, 1.4], [1.1, 2.7], [1.4, 3.6], [.6, 3.9], [-1.5, 1.9]], color);
  oval(ctx, .3, -3.5, .6, .55, player ? '#22382e' : mix(look.skin, '#9b8c7b', .2));
  oval(ctx, 1.1, 3.5, .6, .55, player ? '#22382e' : mix(look.skin, '#9b8c7b', .2));
}

export function drawArcadeActor(ctx, person, time = 0, { player = false, reducedEffects = false, lighting = null } = {}) {
  if (!person || person.dead && Number.isFinite(person.deathTimer) && person.deathTimer <= 0) return;
  sceneLight = lighting || { daylight: 0, night: 1, sunAngle: -.75 * Math.PI, shadowX: .65, shadowY: .85, shadowOpacity: .2 };
  const angle = player && Number.isFinite(person.aimAngle) ? person.aimAngle : person.dir ?? person.angle ?? 0;
  const uniform = person.kind === 'gendarme' || person.role === 'officer' || person.onFoot;
  const look = CIVILIANS[Math.abs(Math.trunc(person.variant || 0)) % CIVILIANS.length];
  ctx.save(); ctx.translate(person.x, person.y);
  if (person.dead && person.deathTimer < 1.2) ctx.globalAlpha *= clamp(person.deathTimer / 1.2, 0, 1);
  ctx.save(); ctx.globalAlpha *= .3 + (sceneLight.daylight || 0) * .18;
  oval(ctx, (sceneLight.shadowX ?? .65) * 3, (sceneLight.shadowY ?? .85) * 3, person.dead || person.knockedDown ? 8.3 : 6.1, person.dead || person.knockedDown ? 3.1 : 3.45, '#162730'); ctx.restore();
  if (player && !person.dead) {
    ctx.save(); ctx.globalAlpha *= .4; ctx.strokeStyle = '#c7bc94'; ctx.lineWidth = .35;
    ctx.beginPath(); ctx.ellipse(0, 0, 7.5, 6.1, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  ctx.save(); ctx.rotate(angle);
  if (person.dead || person.knockedDown) actorDown(ctx, person, player, uniform, look);
  else actorBody(ctx, person, time, player, reducedEffects);
  ctx.restore();
  if (person.knockedDown && !person.dead) {
    const wave = reducedEffects ? 0 : Math.sin(time * 5) * 1.2;
    ctx.save(); ctx.globalAlpha *= .65; star(ctx, 1 + wave, -7.5, '#d5c58d'); ctx.restore();
  }
  ctx.restore();
}

// Coordinates stay on the ground plane. The renderer supplies terrain and
// altitude exactly once, while the wing sits above the suspended shoulders.
export function drawArcadeAirborneActor(ctx, person, time = 0, { reducedEffects = false, lighting = null } = {}) {
  if (!person) return;
  sceneLight = lighting || { daylight: 0, night: 1, sunAngle: -.75 * Math.PI };
  const angle = person.dir ?? person.angle ?? 0;
  const inflation = person.airborneMode === 'parachute' ? clamp(person.parachuteInflation ?? 1, 0, 1) : 0;
  const opened = inflation * inflation * (3 - 2 * inflation);
  const cloth = material('#cf9c6b'), olive = material('#71815b'), cream = material('#e0d4b1');
  const sway = reducedEffects ? 0 : Math.sin(time * 3.2) * .45;
  const co = Math.cos(angle), si = Math.sin(angle);
  ctx.save(); ctx.translate(person.x, person.y);
  if (opened > .001) {
    const span = 3 + opened * 19, depth = 2 + opened * 6;
    const wingX = -co * 5 * opened, wingY = -si * 5 * opened - 22 * opened;
    // The raised arch reads as a parachute at every heading. Steering banks
    // the wing gently while the body and ground motion retain their direction.
    const wingAngle = -co * .16 + sway * .015 * opened;
    const wc = Math.cos(wingAngle), ws = Math.sin(wingAngle);
    const wingPoint = (x, y) => [wingX + x * wc - y * ws, wingY + x * ws + y * wc];
    const handPoint = side => [1.1 * co - side * 4.9 * si, 1.1 * si + side * 4.9 * co];
    // Pale cords retain a dark underside against both bright roofs and sea.
    for (const u of [-1, -.48, .48, 1]) {
      const from = wingPoint(u * span, depth * (.32 + .3 * Math.sqrt(1 - u * u)));
      const to = handPoint((Math.sin(angle) < 0 ? -1 : 1) * (u < 0 ? 1 : -1));
      seam(ctx, [from, to], '#25383b', .9);
      seam(ctx, [from, to], cream.pale, .38);
    }
    ctx.save(); ctx.translate(wingX, wingY); ctx.rotate(wingAngle);
    const top = u => -depth * (.42 + .72 * Math.sqrt(Math.max(0, 1 - u * u)));
    const bottom = u => depth * (.32 + .3 * Math.sqrt(Math.max(0, 1 - u * u)));
    const contour = [];
    for (let i = 0; i <= 14; i++) { const u = i / 7 - 1; contour.push([u * span, top(u)]); }
    for (let i = 14; i >= 0; i--) { const u = i / 7 - 1; contour.push([u * span, bottom(u)]); }
    poly(ctx, contour, INK);
    for (let i = 0; i < 7; i++) {
      const u = i / 3.5 - 1, v = (i + 1) / 3.5 - 1;
      const panel = i === 3 ? olive : i % 2 ? cream : cloth;
      poly(ctx, [[u * span, top(u) + .5], [v * span, top(v) + .5], [v * span, bottom(v) - .45], [u * span, bottom(u) - .45]], panel.base);
      seam(ctx, [[u * span + .15, top(u) + .85], [u * span + .15, bottom(u) - .65]], panel.light, .38);
      seam(ctx, [[u * span, bottom(u) - .2], [v * span, bottom(v) - .2]], panel.deep, .7);
    }
    seam(ctx, contour.slice(0, 15), cream.pale, .55);
    ctx.restore();
  }
  ctx.save(); ctx.rotate(angle);
  const suit = material('#63734f'), reach = (1 - opened) * 4.7;
  for (const side of [-1, 1]) {
    const knee = side * (2 + (1 - opened) * 1.8), foot = side * (3 + (1 - opened) * 1.9);
    seam(ctx, [[-2.4, side * 1.5], [-5.9, knee], [-8.5, foot]], INK, 2.65);
    seam(ctx, [[-2.4, side * 1.5], [-5.9, knee], [-8.1, foot]], suit.dark, 1.65);
    seam(ctx, [[-7.7, foot], [-9.2, foot + side * .35]], '#15242b', 1.5);
    const elbow = [1.3 + reach * .23, side * (4.2 + reach * .63) + sway * (1 - opened)];
    const hand = [1.1 + reach * .55, side * (4.9 + reach) + sway * (1 - opened)];
    seam(ctx, [[.8, side * 2.3], elbow, hand], INK, 2.35);
    seam(ctx, [[.8, side * 2.3], elbow, hand], side < 0 ? suit.light : suit.base, 1.35);
    oval(ctx, hand[0], hand[1], .75, .72, '#273c33');
  }
  poly(ctx, [[-3.5, -2.1], [-1.8, -3], [1.9, -2.65], [2.7, -1.5], [2.6, 1.6], [1.8, 2.8], [-1.8, 3], [-3.5, 2.1]], INK);
  poly(ctx, [[-3.1, -1.8], [-1.65, -2.65], [1.65, -2.3], [2.2, -1.25], [2.15, 1.3], [1.6, 2.4], [-1.6, 2.65], [-3.1, 1.8]], suit.base);
  // The packed harness stays visible in freefall and under the open wing.
  poly(ctx, [[-2.7, -1.75], [.4, -2], [1.35, -1.2], [1.35, 1.3], [.3, 2], [-2.7, 1.75]], suit.deep);
  seam(ctx, [[-2.45, -1.5], [.25, -1.7], [1.05, -.85]], suit.light, .45);
  seam(ctx, [[-2.7, -2.05], [-1.35, -.4], [-2.7, 2.05]], '#c2b28b', .58);
  seam(ctx, [[1.45, -2.15], [-.35, -.25], [1.45, 2.15]], '#c2b28b', .58);
  oval(ctx, 3.2, 0, 2.35, 2.15, '#14232b');
  poly(ctx, [[1.25, -.5], [2.05, -1.55], [3.65, -1.7], [4.4, -.85], [3.1, -.75], [2.1, .65]], '#405056');
  seam(ctx, [[2, -1.25], [3.6, -1.45], [4.55, -.4]], '#819091', .35);
  box(ctx, 4.95, -.75, .4, 1.5, '#b7b098');
  ctx.restore(); ctx.restore();
}

export function drawArcadeAirborneShadow(ctx, person, { lighting = null } = {}) {
  if (!person || !(person.altitude > 0)) return;
  const light = lighting || {}, altitude = Math.max(0, person.altitude);
  const inflation = person.airborneMode === 'parachute' ? clamp(person.parachuteInflation ?? 1, 0, 1) : 0;
  const expansion = 1 + Math.min(.15, altitude / 600);
  const angle = person.dir ?? person.angle ?? 0;
  ctx.save(); ctx.translate(person.x + altitude * .2 * (light.shadowX ?? .65), person.y + altitude * .2 * (light.shadowY ?? .85));
  ctx.scale(expansion, expansion); ctx.save(); ctx.rotate(angle);
  ctx.globalAlpha *= Math.max(.07, .23 - altitude / 1500);
  oval(ctx, 0, 0, 7.6, 3.3, '#132b31');
  ctx.restore(); ctx.globalAlpha *= Math.max(.07, .23 - altitude / 1500);
  if (inflation > .01) {
    ctx.translate(-Math.cos(angle) * 5 * inflation, -Math.sin(angle) * 5 * inflation); ctx.rotate(-Math.cos(angle) * .16);
    oval(ctx, 0, 0, 3 + inflation * 19, 2 + inflation * 6.2, '#132b31');
  }
  ctx.restore();
}

const MODELS = [
  { rear: 13, front: 14, cabin: [-7, 4], nose: 3, hatch: true },
  { rear: 15, front: 15, cabin: [-7, 3], nose: 2 },
  { rear: 15, front: 15, cabin: [-10, 4], nose: 2, wagon: true },
  { rear: 14, front: 15, cabin: [-6, 4], nose: 4, coupe: true },
  { rear: 14, front: 14, cabin: [1, 9], nose: 1, van: true },
  { rear: 15, front: 15, cabin: [-1, 6], nose: 2, pickup: true },
  { rear: 13, front: 14, cabin: [-7, 4], nose: 3, rally: true },
  { rear: 14, front: 14, cabin: [-7, 4], nose: 1, suv: true },
  { rear: 15, front: 15, cabin: [-7, 3], nose: 2, taxi: true },
  { rear: 14, front: 14, cabin: [1, 9], nose: 1, van: true, delivery: true },
  { rear: 14, front: 15, cabin: [-7, 4], nose: 3, cabrio: true },
  { rear: 15, front: 15, cabin: [-8, 4], nose: 4, fastback: true },
];
const bodyPoints = (model) => [[-model.rear, -5.5], [-model.rear + 2, -7.5], [model.front - model.nose, -7.5], [model.front, -4.5], [model.front, 4.5], [model.front - model.nose, 7.5], [-model.rear + 2, 7.5], [-model.rear, 5.5]];

function carWheels(ctx, angle, model, dark = false) {
  for (const x of [-9, 8]) {
    const turn = x > 0 ? clamp(angle || 0, -.18, .18) : 0;
    for (const y of [-7.3, 7.3]) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(turn);
      poly(ctx, [[-3, -1.8], [2.4, -1.8], [3, -1], [3, 1], [2.4, 1.8], [-3, 1.8]], '#0b1724');
      box(ctx, -1.2, y < 0 ? -1.8 : 1.05, 3, .7, dark ? '#455260' : '#93adba');
      box(ctx, -2, -.4, 3.9, .8, dark ? '#20363f' : '#35515e'); ctx.restore();
    }
  }
  if (model.suv) { oval(ctx, -13.5, 0, 1.6, 3.2, '#162331'); box(ctx, -14, -1.5, 1, 3, '#718594'); }
}

function glass(ctx, x, y, w, h, rim, diagonal = true) {
  poly(ctx, [[x + .45, y], [x + w - .45, y], [x + w, y + .45], [x + w, y + h - .45], [x + w - .45, y + h], [x + .45, y + h], [x, y + h - .45], [x, y + .45]], '#172c35');
  const pane = ctx.createLinearGradient(x, y, x + w, y + h);
  pane.addColorStop(0, '#758e98'); pane.addColorStop(.24, '#395966'); pane.addColorStop(1, '#1e3644');
  box(ctx, x + .35, y + .35, Math.max(.5, w -.7), Math.max(.5, h -.7), pane);
  if (diagonal) {
    ctx.save(); ctx.globalAlpha *= .44;
    poly(ctx, [[x + .4, y + .45], [x + w -.5, y + .45], [x + w -.5, y + h * .17], [x + .4, y + h * .43]], '#b7c6c4'); ctx.restore();
  }
  seam(ctx, [[x + .3, y + .45], [x + .3, y + h -.45]], rim, .28);
  seam(ctx, [[x + w -.3, y + .5], [x + w -.3, y + h -.5]], '#122732', .32);
  if (h > 7) {
    seam(ctx, [[x + w -.5, y + h -.85], [x + .75, y + h * .58]], '#17272e', .25);
    seam(ctx, [[x + w -.5, y + h -.85], [x + w -.9, y + h * .36]], '#82928f', .15);
  }
}

function carCabin(ctx, model, colors, police, occupied) {
  const [back, front] = model.cabin;
  if (model.pickup) {
    box(ctx, -12, -5.6, 10.2, 11.2, colors.dark);
    box(ctx, -11, -4.7, 8.4, 9.4, '#42515b');
    for (const y of [-3, 0, 3]) box(ctx, -10.5, y, 7.2, .3, '#687985');
    box(ctx, -11, -4.6, 8.4, .3, '#a3b7b8');
  }
  if (model.van) {
    poly(ctx, [[-12, -5.8], [0, -5.8], [.6, -4.8], [.6, 4.8], [0, 5.8], [-12, 5.8]], colors.light);
    box(ctx, -11, -5, 10.1, .4, colors.pale); box(ctx, -10.7, 4.4, 10.1, .4, colors.dark);
    box(ctx, -6.8, -3.1, 4.8, 6.2, colors.base); box(ctx, -6.3, -2.6, 3.8, .25, colors.pale);
    seam(ctx, [[-11, -.2], [-.7, -.2]], colors.dark, .3);
    if (model.delivery) { box(ctx, -9.2, -1.6, 5.2, 3.2, '#edd385'); box(ctx, -8.5, -1.1, 3.8, 1.8, '#4484a1'); }
  }
  if (model.cabrio) {
    poly(ctx, [[back, -5.9], [front, -5.9], [front + .7, -4.8], [front + .7, 4.8], [front, 5.9], [back, 5.9]], '#192f41');
    for (const x of [back + 1.5, back + 5]) for (const y of [-3.6, 1.7]) {
      box(ctx, x, y, 2.7, 2.2, '#765848'); box(ctx, x, y + .2, .3, 1.8, '#b49373');
      seam(ctx, [[x + .6, y + .5], [x + 2.1, y + .5]], '#493e38', .2);
    }
    glass(ctx, front - .8, -5.4, 2.3, 10.8, colors.pale);
  } else {
    poly(ctx, [[back, -5.7], [front, -5.7], [front + 1.1, -4.7], [front + 1.1, 4.7], [front, 5.7], [back, 5.7], [back - .8, 4.7], [back - .8, -4.7]], '#163445');
    glass(ctx, back -.5, -4.9, 2.7, 9.8, colors.pale);
    glass(ctx, front -.2, -5.1, 2.7, 10.2, colors.pale);
    const roofX = back + 2.4, roofWidth = front - back - 2.7;
    const roofPaint = ctx.createLinearGradient(roofX, -5, roofX + roofWidth * .25, 5);
    roofPaint.addColorStop(0, police ? '#e2e0d3' : colors.pale);
    roofPaint.addColorStop(.28, police ? '#d4d8d1' : colors.light);
    roofPaint.addColorStop(1, police ? '#a1afb4' : colors.base);
    poly(ctx, [[roofX, -5], [roofX + roofWidth, -5], [roofX + roofWidth + .35, -4], [roofX + roofWidth + .35, 4], [roofX + roofWidth, 5], [roofX, 5], [roofX -.35, 4], [roofX -.35, -4]], roofPaint);
    seam(ctx, [[roofX + .25, -4.7], [roofX + roofWidth -.2, -4.7]], police ? '#eee9d9' : colors.pale, .28);
    seam(ctx, [[roofX + .25, 4.7], [roofX + roofWidth -.2, 4.7]], police ? '#889ba4' : colors.dark, .3);
    if (model.wagon || model.suv) {
      seam(ctx, [[back + 1, -5.5], [front + .4, -5.5]], '#b4c1be', .32);
      seam(ctx, [[back + 1, 5.3], [front + .4, 5.3]], '#607888', .32);
    }
    if (model.coupe || model.fastback) {
      glass(ctx, roofX + .8, -2.4, Math.max(2, roofWidth - 1.5), 4.8, '#8eafbd');
    }
    if (occupied) oval(ctx, front + .5, -2.4, .95, .9, '#18252c');
  }
  // Tiny door joints, chrome handles and mirrors make model scale convincing.
  for (const side of [-1, 1]) {
    box(ctx, back + 1, side < 0 ? -6.5 : 5.9, 1.9, .3, '#c3c8b8');
    seam(ctx, [[back + .35, side * 6.1], [back + .3, side * 6.85]], colors.dark, .23);
    seam(ctx, [[front -.6, side * 5.6], [front + .5, side * 6.6]], colors.deep, .23);
    poly(ctx, [[front + 1, side * 6], [front + 1.4, side * 8], [front + 3.3, side * 7.8], [front + 3, side * 6.3]], '#203b4e');
    box(ctx, front + 1.6, side < 0 ? -7.9 : 7.2, 1.2, .3, colors.pale);
  }
}

function carBody(ctx, vehicle, time, model, colors, police, occupied, reducedEffects) {
  const points = bodyPoints(model), front = model.front, rear = model.rear;
  // Small extruded lower shell and a world-lit metal gradient add 2.5D volume.
  ctx.save(); ctx.translate(.45, .85); poly(ctx, points, '#162b35'); ctx.restore();
  carWheels(ctx, Math.sin(vehicle.steering || 0) * .1, model);
  poly(ctx, points, '#1c3038');
  const lightX = Math.cos((sceneLight.sunAngle ?? -.75 * Math.PI) - (vehicle.angle || 0)), lightY = Math.sin((sceneLight.sunAngle ?? -.75 * Math.PI) - (vehicle.angle || 0));
  const finish = ctx.createLinearGradient(lightX * 15, lightY * 8, -lightX * 15, -lightY * 8);
  finish.addColorStop(0, colors.light); finish.addColorStop(.35, colors.base); finish.addColorStop(1, colors.dark);
  poly(ctx, [[-rear + .35, -5.35], [-rear + 2.2, -7.15], [front - model.nose -.15, -7.15], [front -.45, -4.35], [front -.45, 4.35], [front - model.nose -.15, 7.15], [-rear + 2.2, 7.15], [-rear + .35, 5.35]], finish);
  seam(ctx, [[-rear + 2.25, -6.95], [front - model.nose -.15, -6.95], [front -.6, -4.25]], colors.pale, .3);
  seam(ctx, [[-rear + 2.4, 6.7], [front - model.nose -.3, 6.7]], colors.deep, .35);
  box(ctx, -rear -.35, -4.9, .7, 9.8, '#657b84'); box(ctx, -rear -.35, -4.2, .25, 8.4, '#aebbb4');
  box(ctx, front -.1, -4.6, .45, 9.2, '#899b9d'); box(ctx, front -.1, -3.6, .25, 7.2, '#c3c9bd');
  box(ctx, front - 1.9, -5.1, 1.5, 2.5, '#fff1bd'); box(ctx, front - 1.9, 2.6, 1.5, 2.5, '#fff1bd');
  box(ctx, front - 1.7, -4.8, .9, 1.7, '#ffffd8'); box(ctx, front - 1.7, 3, .9, 1.7, '#ffffd8');
  box(ctx, -rear + .1, -4.7, .9, 2.4, '#a85757'); box(ctx, -rear + .1, 2.3, .9, 2.4, '#a85757');
  box(ctx, -rear + .25, -4.25, .3, 1.4, '#ce8880'); box(ctx, -rear + .25, 2.75, .3, 1.4, '#ce8880');
  box(ctx, -rear -.2, -.8, .5, 1.6, '#aebbb7');
  box(ctx, front - 1.4, -2.1, .65, 4.2, '#293c46');
  for (const y of [-1.5, -.5, .5, 1.5]) box(ctx, front - 1.2, y, .3, .23, '#bac4b8');
  const hoodBack = model.cabin[1] + 2.2;
  seam(ctx, [[hoodBack, -5.1], [front - 2.8, -5.1], [front - 2.1, -3.9]], colors.deep, .28);
  seam(ctx, [[hoodBack + .4, -4.4], [front - 3.5, -4.4]], colors.pale, .24);
  seam(ctx, [[hoodBack, 5.1], [front - 2.8, 5.1]], colors.dark, .28);
  for (const y of [-2.9, 2.9]) seam(ctx, [[hoodBack + .6, y], [front - 2.7, y]], colors.light, .22);
  for (const y of [-3.4, -2.4, -1.4, -.4, .6, 1.6, 2.6, 3.6]) box(ctx, hoodBack -.25, y, .55, .22, colors.dark);
  if (model.rally) {
    box(ctx, -rear + 3, -1.8, front + rear - 6, 1.1, '#efefe4');
    box(ctx, -rear + 3, .8, front + rear - 6, 1.1, '#efefe4');
  }
  carCabin(ctx, model, colors, police, occupied);
  if (police) {
    for (const y of [-6.1, 5.6]) box(ctx, -11, y, 22, .35, '#b3c6c6');
    box(ctx, -1.2, -5.3, 2.3, 10.6, '#213a4a');
    const phase = reducedEffects || Math.floor(time * 7 + hash(vehicle.id) % 3) % 2 === 0;
    box(ctx, -.85, -5, 1.6, 4.1, phase ? '#aad5e5' : '#427da4');
    box(ctx, -.85, .9, 1.6, 4.1, phase ? '#447ba2' : '#a2cfdf');
    box(ctx, -.85, -.4, 1.6, .8, '#889fa9');
  } else if (model.taxi) {
    box(ctx, -.6, -2.4, 3, 4.8, '#172c40'); box(ctx, -.2, -1.8, 2.2, 3.6, '#ffe49a');
  }
  if (Number.isFinite(vehicle.hp) && vehicle.maxHp && vehicle.hp < vehicle.maxHp * .4) {
    seam(ctx, [[front - 4.6, -2.7], [front - 5.8, -.4], [front - 3.9, .6], [front - 5.5, 2.5]], '#334652', .4);
    box(ctx, front - 4.2, 1, 1.7, 1.4, '#5f594f');
  }
  if (vehicle.damageFlash > 0) {
    ctx.save(); ctx.globalAlpha *= .45;
    seam(ctx, [[-rear + 2, -6.7], [front - model.nose, -6.7], [front -.3, -4.1], [front -.3, 4.1]], '#fff6be', 1.6); ctx.restore();
  }
}

function wreckBody(ctx, model, colors) {
  carWheels(ctx, -.18, model, true);
  poly(ctx, [[-14, -4], [-11, -7], [-3, -6.1], [2, -7], [10, -5.8], [14, -2.5], [12, 5.6], [4, 6.6], [-2, 5.4], [-12, 6.3]], '#172733');
  poly(ctx, [[-12, -3.9], [-9.7, -5.9], [-2, -5.1], [3, -5.9], [9, -4.4], [12.3, -2.3], [10.3, 4.3], [3.8, 5.1], [-2, 3.9], [-10.8, 5]], colors.deep);
  poly(ctx, [[-6, -4], [-2, -4.7], [4.5, -3.5], [5, 3.3], [.8, 4.5], [-6.1, 3]], '#111f2a');
  poly(ctx, [[-5, -3.2], [-3, -3.4], [-.3, -1.1], [-1.4, .6]], '#416474');
  poly(ctx, [[2.1, -2.9], [4.1, -2], [3.9, 1.5], [1.7, .2]], '#5a7882');
  seam(ctx, [[-11.4, -4], [-8.3, -5.4], [-2, -4.6]], '#62797d', .8);
  seam(ctx, [[7, -3.6], [4.6, -.6], [8, .3], [5.5, 3.9]], '#8f6953', 1.3);
  box(ctx, -14, -3, 1.5, 2, '#8d6160'); box(ctx, 12, 1, 1.1, 2.1, '#a1946e');
  box(ctx, 10.5, -3.2, 1.4, 1, '#abd5d1');
}

function vehicleSmoke(ctx, time, reducedEffects, burning, colors) {
  if (burning) {
    const wiggle = reducedEffects ? 0 : Math.sin(time * 8) * 1.2;
    for (let i = 0; i < 3; i++) {
      const x = -4 + i * 4, y = -2;
      poly(ctx, [[x - 3, y + 3], [x - 3.7, y - 3], [x - 1.8, y - 2], [x + wiggle, y - 12 - i % 2 * 3], [x + 1.6, y - 4], [x + 3, y - 1], [x + 2.4, y + 3]], '#e7954d');
      poly(ctx, [[x - 1.7, y + 2], [x + wiggle * .4, y - 7], [x + 1.7, y + 2]], '#ffe6a2');
    }
  }
  const count = burning ? 3 : 1;
  for (let i = 0; i < count; i++) {
    const phase = reducedEffects ? .22 + i / count * .5 : (time * .6 + i / count) % 1;
    ctx.save(); ctx.globalAlpha *= (burning ? .21 : .13) * (1 - phase);
    const x = (burning ? -2 : 10) + phase * 8, y = -8 - phase * 20;
    oval(ctx, x, y, 2.5 + phase * 4.5, 2 + phase * 3.5, burning ? '#657076' : '#7b8386');
    oval(ctx, x - 1.4 - phase, y + .8, 1.8 + phase * 3, 1.4 + phase * 2.6, '#879093');
    ctx.restore();
  }
}

const MOBILITY_TYPES = new Set(['motorcycle', 'boat', 'helicopter', 'plane']);
function mobilityType(vehicle) {
  return MOBILITY_TYPES.has(vehicle.mobilityType) ? vehicle.mobilityType : MOBILITY_TYPES.has(vehicle.model) ? vehicle.model : null;
}
export function photographicVehicleDimensions(vehicle) {
  const width = vehicle?.sourceImage?.width, length = vehicle?.sourceImage?.length;
  const radius = vehicle?.collisionRadius, halfLength = vehicle?.collisionHalfLength;
  const type = mobilityType(vehicle || {});
  if (![width, length, radius, halfLength].every(Number.isFinite) || width <= 0 || length <= 0 || width > 512 || length > 512 || radius <= 0 || halfLength < 0) return null;
  if (type && type !== 'boat' && type !== 'plane') return null;
  // A verified boat's collision capsule fits inside its tapered photo hull;
  // its exterior photograph still determines the full drawn silhouette.
  const hull = vehicle.collisionShape;
  const inscribedBoat = type === 'boat'
    && hull?.method === 'maximum-area centered capsule inscribed in native photo hull'
    && hull.arcadeCollisionApproximation === true
    && Number.isInteger(hull.sourceHullPointCount) && hull.sourceHullPointCount >= 3
    && Number.isFinite(hull.hullArea) && hull.hullArea > 0
    && Number.isFinite(hull.coverageRatio) && hull.coverageRatio > 0 && hull.coverageRatio <= 1.000001
    && Math.abs(hull.radius - radius) < 1e-6 && Math.abs(hull.halfLength - halfLength) < 1e-6
    && radius * 2 <= width + .1 && (radius + halfLength) * 2 <= length + .1
    && typeof vehicle.sourceImage.annotationId === 'string'
    && /^[a-f0-9]{64}$/i.test(vehicle.sourceImage.sha256 || '');
  // Source aircraft may use a conservative capsule around their wings.
  // A legacy car merely associated with a photograph keeps its original body.
  if (!type && (Math.abs(radius * 2 - width) > .1 || Math.abs(radius * 2 + halfLength * 2 - Math.max(length, width)) > .1)) return null;
  if (type && !inscribedBoat && (radius * 2 + .1 < width || radius * 2 + halfLength * 2 + .1 < length)) return null;
  return { width, length, type: type || 'car' };
}
function mobilityRunning(vehicle, occupied, wreck) {
  return !wreck && (occupied || (vehicle.altitude || 0) > 0 || ['air', 'takingOff', 'landing'].includes(vehicle.mobilityMode) || Math.abs(vehicle.speed || 0) > 4);
}
function seatedDriver(ctx, x, y, { helmet = false, jacket = '#63734f', compact = false } = {}) {
  ctx.save(); ctx.translate(x, y);
  if (compact) ctx.scale(.7, .7);
  const colors = material(jacket);
  // Adult shoulders, bent knees and reaching arms retain the pedestrian scale.
  for (const side of [-1, 1]) {
    poly(ctx, [[-3.6, side * 1.1], [-4.6, side * 2.8], [-1.1, side * 4], [.35, side * 3.35], [-2.5, side * 2.5]], '#314238');
    poly(ctx, [[-.9, side * 3.25], [1.8, side * 3.55], [2.3, side * 4.35], [-.45, side * 4.35]], '#17282d');
    poly(ctx, [[.1, side * 2.4], [2.9, side * 3.1], [5.7, side * 2.05], [5.55, side * 1.1], [2.5, side * 2.1], [.15, side * 1.6]], side < 0 ? colors.light : colors.dark);
    oval(ctx, 5.35, side * 1.55, .65, .65, '#26392f');
  }
  poly(ctx, [[-3.9, -1.9], [-1.8, -2.8], [1.1, -2.5], [1.75, -1.25], [1.75, 1.25], [1.1, 2.5], [-1.8, 2.8], [-3.9, 1.9]], colors.base);
  poly(ctx, [[-3.7, -1.65], [-1.7, -2.5], [.95, -2.2], [.25, -.9], [-3, -.5]], colors.light);
  seam(ctx, [[-2.1, -2.3], [-2.1, 2.2]], colors.dark, .3);
  oval(ctx, 1.45, 0, 2.15, 2.05, helmet ? '#142733' : '#26322e');
  poly(ctx, [[-.25, -.7], [.55, -1.65], [1.9, -1.75], [2.8, -.85], [1.1, -.6]], helmet ? '#617a86' : '#4c5b49');
  seam(ctx, [[.3, -1.3], [1.5, -1.65], [2.35, -1]], helmet ? '#a4b9bb' : '#87927b', .3);
  if (helmet) seam(ctx, [[3.1, -1.05], [3.5, -.25], [3.5, .6], [3.05, 1.1]], '#263d48', .55);
  ctx.restore();
}
function motorcycleBody(ctx, vehicle, colors, occupied, wreck) {
  const lean = wreck ? -.3 : clamp(vehicle.lean || 0, -.5, .5);
  // The two inline tyres remain exposed ahead of and behind the narrow frame.
  for (const x of [-9.1, 9.2]) {
    poly(ctx, [[x - 3.8, -1.35], [x - 2.6, -1.9], [x + 2.8, -1.9], [x + 3.8, -1.1], [x + 3.8, 1.1], [x + 2.8, 1.9], [x - 2.6, 1.9], [x - 3.8, 1.35]], '#10222a');
    box(ctx, x - 2.3, -.45, 4.6, .9, '#48616b');
    seam(ctx, [[x - 2.3, -1.5], [x + 2.25, -1.5]], '#789097', .3);
  }
  seam(ctx, [[-9.1, 0], [-3.1, 2.2], [6.8, 0], [9.2, 0]], '#a8b4b3', .8);
  seam(ctx, [[-7.4, 1.2], [-2.6, 3], [3.7, 1.8]], '#334b56', .85);
  box(ctx, -3.5, -2.8, 5.2, 5.6, '#20373c');
  for (const x of [-2.8, -1.7, -.6, .5]) box(ctx, x, -2.8, .4, 5.6, '#71868a');
  ctx.save(); ctx.translate(0, lean * 2.1);
  poly(ctx, [[-7.4, -2.1], [-3.4, -2.6], [-.3, -2], [.3, 2], [-3.4, 2.6], [-7.4, 2.1]], colors.base);
  poly(ctx, [[-6.9, -1.9], [-3.6, -2.3], [-1.1, -1.7], [-1, 1.7], [-6.9, 1.8]], '#243238');
  seam(ctx, [[-6.1, -1.6], [-2, -1.6]], '#5d6b6c', .3);
  poly(ctx, [[-.75, -2.6], [3.4, -2.4], [5.35, -.95], [5.35, .95], [3.4, 2.4], [-.75, 2.6], [-1.7, 1.25], [-1.7, -1.25]], colors.base);
  poly(ctx, [[-1.2, -.9], [-.35, -2.2], [3.25, -2.1], [4.65, -.8], [1.8, -.65]], colors.light);
  oval(ctx, 1.6, 0, .65, .6, '#b0bdb7');
  poly(ctx, [[6.3, -2.1], [8.9, -1.55], [10.5, -.7], [10.5, .7], [8.9, 1.55], [6.3, 2.1]], colors.dark);
  box(ctx, 9.8, -1.1, .8, 2.2, wreck ? '#6f7975' : '#efddb0');
  seam(ctx, [[6.2, -4.1], [5.5, -2.2], [5.5, 2.2], [6.2, 4.1]], '#aebbb5', .65);
  for (const side of [-1, 1]) {
    seam(ctx, [[6.2, side * 3.5], [7.1, side * 4.75]], '#73868b', .35);
    oval(ctx, 7.2, side * 4.85, .95, .65, '#9aadae');
  }
  box(ctx, -9, -1.2, .8, 2.4, wreck ? '#5a514d' : '#b36250');
  seam(ctx, [[-8, 3], [-2.5, 3.9], [.5, 3.6]], '#a6b1ad', 1);
  if (occupied && !wreck) seatedDriver(ctx, -1.5, lean * 1.2, { helmet: true });
  if (wreck) seam(ctx, [[-6, -2], [-2.5, -.3], [.5, -1.7], [4.3, 1.6]], '#a28a69', .65);
  ctx.restore();
}
function boatWake(ctx, vehicle, time, reducedEffects) {
  const speed = Math.hypot(vehicle.vx || 0, vehicle.vy || 0) || Math.abs(vehicle.speed || 0);
  const amount = clamp(Math.max(speed / 140, vehicle.wakeTimer || 0), 0, 1);
  if (amount < .025) return;
  const phase = reducedEffects ? 0 : time * 3.4;
  ctx.save(); ctx.globalAlpha *= amount * (.2 + (sceneLight.daylight || 0) * .12);
  for (const side of [-1, 1]) {
    const points = [];
    for (let i = 0; i <= 7; i++) {
      const x = -17 - i * 6, y = side * (5.2 + i * 2.4) + Math.sin(phase - i * .85) * .65;
      points.push([x, y]);
    }
    seam(ctx, points, '#d8e4df', .9);
  }
  for (let i = 0; i < 4; i++) {
    const wave = reducedEffects ? i / 4 : (time * .85 + i / 4) % 1;
    const x = -19 - wave * 30, width = 2.1 + wave * 3.1;
    ctx.save(); ctx.globalAlpha *= 1 - wave;
    seam(ctx, [[x - 1, -width], [x - 2.5, 0], [x - 1, width]], '#ecede0', .7); ctx.restore();
  }
  ctx.restore();
}
function boatBody(ctx, vehicle, colors, occupied, wreck) {
  const hull = [[-18, -7.8], [-12, -9], [6, -8.6], [15, -5.9], [23, 0], [15, 5.9], [6, 8.6], [-12, 9], [-18, 7.8]];
  ctx.save(); ctx.translate(-.35, .65); poly(ctx, hull, '#243941'); ctx.restore();
  poly(ctx, hull, wreck ? colors.deep : '#d8d8c5');
  poly(ctx, [[-16.7, -6.6], [-11.6, -7.6], [5.8, -7.25], [14.2, -5.1], [21.4, 0], [14.2, 5.1], [5.8, 7.25], [-11.6, 7.6], [-16.7, 6.6]], colors.base);
  poly(ctx, [[1.2, -6.5], [6.2, -6.35], [13.5, -4.7], [19.6, 0], [13.5, 4.7], [6.2, 6.35], [1.2, 6.5]], wreck ? colors.dark : '#c5c5ad');
  seam(ctx, [[-15.5, -7.2], [-11.6, -8], [5.8, -7.6], [14.5, -5.4], [21.7, 0]], wreck ? '#6d7c7a' : '#eeeddb', .45);
  seam(ctx, [[-15.5, 7.2], [-11.6, 8], [5.8, 7.6], [14.5, 5.4], [21.7, 0]], colors.deep, .4);
  poly(ctx, [[-14.5, -5.9], [-4, -6.15], [2, -4.9], [2, 4.9], [-4, 6.15], [-14.5, 5.9]], '#263c43');
  for (const side of [-1, 1]) {
    box(ctx, -12.7, side < 0 ? -5.3 : 3.1, 5.7, 2.2, wreck ? '#56625c' : '#bcb79a');
    seam(ctx, [[-12.4, side * 4.8], [-7.3, side * 4.8]], '#e0d5b5', .3);
    box(ctx, -5.5, side < 0 ? -4.8 : 2.1, 3.3, 2.7, wreck ? colors.deep : '#a59177');
    seam(ctx, [[-5.15, side * 4.25], [-2.7, side * 4.25]], '#dac6a6', .3);
  }
  poly(ctx, [[-.8, -5.5], [2.6, -5.9], [4.6, -4.3], [4.6, 4.3], [2.6, 5.9], [-.8, 5.5]], '#273d45');
  glass(ctx, .4, -4.9, 2.5, 9.8, '#c3d0c9');
  seam(ctx, [[3.6, -4.5], [3.6, 4.5]], '#c7d1c8', .45);
  seam(ctx, [[6.3, -4.8], [12.9, -3.8], [17, 0], [12.9, 3.8], [6.3, 4.8]], '#f0e8cd', .3);
  for (const y of [-1.8, 0, 1.8]) seam(ctx, [[7, y], [12.8, y * .75]], colors.dark, .25);
  oval(ctx, 15.4, 0, 1.2, .85, '#758b91');
  box(ctx, -21.5, -2.7, 4.8, 5.4, '#26353b');
  box(ctx, -20.8, -2.3, 3.3, 4.6, '#465c61');
  seam(ctx, [[-20.2, -1.65], [-17.9, -1.65]], '#a0b1af', .4);
  box(ctx, -21.2, -.4, 3.6, .8, colors.base);
  oval(ctx, 4.8, -6.2, .6, .45, wreck ? '#656c66' : '#a97865');
  oval(ctx, 4.8, 6.2, .6, .45, wreck ? '#656c66' : '#91aa89');
  if (occupied && !wreck) seatedDriver(ctx, -4.4, -2.8, { jacket: '#6a7857', compact: true });
  if (wreck) {
    poly(ctx, [[8, -5.8], [12, -3.2], [9.8, -.5], [14.4, 1.5], [9.7, 5.4], [6.8, 2]], '#243a40');
    seam(ctx, [[-14, -5], [-11, -1.6], [-7.5, -3], [-5.5, .6]], '#a29b81', .8);
  }
}
function helicopterRotor(ctx, angle, running, reducedEffects, wreck) {
  ctx.save(); ctx.translate(-1.5, 0);
  if (running && !reducedEffects) {
    ctx.save(); ctx.globalAlpha *= .09;
    oval(ctx, 0, 0, 25, 25, '#bac9c3'); ctx.restore();
  }
  ctx.rotate(angle);
  for (const side of [-1, 1]) {
    poly(ctx, [[side * 2, -.7], [side * 23.8, -1.1], [side * (wreck ? 19.3 : 25), .15], [side * 3, .85]], '#304650');
    seam(ctx, [[side * 4, -.45], [side * 22, -.75]], '#9aaead', .4);
    box(ctx, side > 0 ? 22.7 : -24.3, -.9, 1.4, 1.2, wreck ? '#78877e' : '#c5c59d');
  }
  oval(ctx, 0, 0, 1.6, 1.6, '#243b44'); oval(ctx, -.35, -.4, .65, .65, '#bac7be');
  ctx.restore();
}
function helicopterBody(ctx, vehicle, time, colors, occupied, reducedEffects, wreck) {
  const running = mobilityRunning(vehicle, occupied, wreck);
  const rotor = wreck || reducedEffects ? .26 : Number.isFinite(vehicle.rotor) ? vehicle.rotor : running ? time * 27 : .26;
  // A slender boom and exposed skids distinguish the civilian craft from cars.
  for (const side of [-1, 1]) {
    seam(ctx, [[-9.5, side * 6], [-8.5, side * 8.8], [10.8, side * 8.8], [12.3, side * 7.8]], '#20373e', 1.45);
    seam(ctx, [[-8.4, side * 8.35], [10.55, side * 8.35]], '#9eafad', .45);
    seam(ctx, [[-4.7, side * 4], [-5.8, side * 8.6]], '#708789', .7);
    seam(ctx, [[6.8, side * 4], [7.9, side * 8.6]], '#708789', .7);
  }
  poly(ctx, [[-8.1, -3.1], [-28, -1.35], [-29.5, 0], [-28, 1.35], [-8.1, 3.1]], colors.base);
  seam(ctx, [[-10.2, -2.3], [-27.5, -.75]], colors.pale, .45);
  poly(ctx, [[-24, -1.1], [-25.2, -6.2], [-28.2, -6], [-27.2, 1], [-25.8, 2.5]], colors.dark);
  poly(ctx, [[-20.6, -.7], [-24, -7.2], [-26.1, -7.2], [-25.4, .5], [-26.1, 7.2], [-24, 7.2], [-20.6, .7]], colors.light);
  seam(ctx, [[-24.4, -6.5], [-25.1, 6.5]], colors.pale, .4);
  poly(ctx, [[-9.2, -3.6], [-5.8, -5.9], [6.4, -6.15], [12.9, -3.85], [15.4, -.9], [15.4, .9], [12.9, 3.85], [6.4, 6.15], [-5.8, 5.9], [-9.2, 3.6]], '#21363e');
  poly(ctx, [[-8.45, -3.2], [-5.6, -5.15], [6.2, -5.5], [12.1, -3.35], [14.1, 0], [12.1, 3.35], [6.2, 5.5], [-5.6, 5.15], [-8.45, 3.2]], colors.base);
  poly(ctx, [[-7.6, -2.95], [-5.25, -4.7], [4.8, -4.9], [3, -.9], [-6.7, -.6]], colors.light);
  for (const side of [-1, 1]) {
    glass(ctx, -.4, side < 0 ? -4.8 : 1.2, 5.7, 3.6, colors.pale);
    seam(ctx, [[-1.2, side * 4.8], [-1.6, side * 5.3], [-6.1, side * 5], [-6.6, side * 3.3]], colors.dark, .35);
    box(ctx, -2.8, side < 0 ? -5.05 : 4.65, 1.8, .3, '#bcc4b6');
  }
  poly(ctx, [[6, -5.1], [11.7, -3], [13.4, -.4], [6.4, -.4]], '#304e5b');
  poly(ctx, [[6.4, .4], [13.4, .4], [11.7, 3], [6, 5.1]], '#233c4a');
  seam(ctx, [[6.5, -4.7], [11.2, -2.8], [12.5, -1.2]], '#9fbdbe', .5);
  seam(ctx, [[6.4, -4.8], [6.7, 4.8]], '#c0ccc1', .5);
  if (occupied && !wreck) oval(ctx, 8, -2.2, .95, .9, '#26362f');
  box(ctx, -7.4, -2.3, 5.5, 4.6, colors.dark);
  for (const x of [-6.7, -5.7, -4.7, -3.7]) box(ctx, x, -1.7, .4, 3.4, '#24363b');
  oval(ctx, -1.5, 0, 2.7, 2.2, colors.deep);
  oval(ctx, -1.8, -.5, 1.35, 1.05, colors.pale);
  ctx.save(); ctx.translate(-27.2, 1.35); ctx.rotate(reducedEffects ? .4 : rotor * 1.8);
  seam(ctx, [[-3.2, 0], [3.2, 0]], '#899c9e', .65); seam(ctx, [[0, -2.7], [0, 2.7]], '#304851', .6); ctx.restore();
  helicopterRotor(ctx, rotor, running, reducedEffects, wreck);
  if (wreck) seam(ctx, [[-6.3, -4], [-2, -1], [1.3, -3.1], [4, .7], [9, 2.5]], '#988b6e', .9);
}
function planeBody(ctx, vehicle, time, colors, occupied, reducedEffects, wreck) {
  const running = mobilityRunning(vehicle, occupied, wreck);
  const rotor = reducedEffects ? .4 : Number.isFinite(vehicle.rotor) ? vehicle.rotor : running ? time * 36 : .4;
  // Straight high wings, a narrow fuselage and a separate tailplane evoke a
  // small single-engine trainer rather than a jet or a second helicopter.
  for (const side of [-1, 1]) {
    poly(ctx, [[-12.3, side * 1.3], [-17.2, side * 10.9], [-20.6, side * 10.7], [-18.8, side * 1.3]], colors.base);
    seam(ctx, [[-17.7, side * 2.1], [-19.8, side * 10.3]], colors.pale, .35);
    poly(ctx, [[5.5, side * 2.1], [4.5, side * 26.2], [-2.1, side * 26.2], [-5.2, side * 2.1]], colors.light);
    poly(ctx, [[4.1, side * 21.8], [4, side * 25.65], [-1.65, side * 25.65], [-2.3, side * 21.8]], colors.base);
    seam(ctx, [[4.7, side * 3.4], [4.05, side * 25.7], [-1.6, side * 25.7]], colors.pale, .5);
    seam(ctx, [[-2.7, side * 14.5], [-1.45, side * 24.8]], colors.dark, .35);
    seam(ctx, [[-3.3, side * 4.8], [-.4, side * 4.8]], colors.dark, .25);
    oval(ctx, 4.1, side * 25.6, .6, .45, wreck ? '#6c766c' : side < 0 ? '#b17b65' : '#8fba99');
  }
  if ((vehicle.altitude || 0) < .5) {
    for (const side of [-1, 1]) {
      seam(ctx, [[.6, side * 3.5], [-1.4, side * 7.6]], '#7a8d8e', .7);
      box(ctx, -3.1, side < 0 ? -8.5 : 6.8, 3.9, 1.7, '#152830');
      seam(ctx, [[-2.8, side * 7.3], [.25, side * 7.3]], '#a5b5af', .35);
    }
  }
  poly(ctx, [[-21.3, -.9], [-11.4, -2.2], [-4.7, -3.6], [11.4, -3.45], [18.3, -2.2], [21.6, 0], [18.3, 2.2], [11.4, 3.45], [-4.7, 3.6], [-11.4, 2.2], [-21.3, .9]], '#263b41');
  poly(ctx, [[-20.7, -.55], [-11.2, -1.7], [-4.6, -3.05], [11.3, -2.95], [17.9, -1.8], [20.55, 0], [17.9, 1.8], [11.3, 2.95], [-4.6, 3.05], [-11.2, 1.7], [-20.7, .55]], wreck ? colors.dark : '#cbd0bd');
  seam(ctx, [[-18.2, -.5], [-10.8, -1.3], [-4.1, -2.6], [11.2, -2.5], [17.2, -1.5]], '#ecedda', .45);
  seam(ctx, [[-17.3, 1.2], [-8.1, 2.3], [13.5, 2.6]], colors.base, .85);
  poly(ctx, [[-20.8, -.4], [-18.9, -1.7], [-13, -1.55], [-13.8, .65], [-20.8, .65]], colors.base);
  seam(ctx, [[-19.7, -.9], [-14.2, -1.1]], colors.pale, .35);
  glass(ctx, 1.8, -2.7, 8.7, 5.4, colors.pale);
  seam(ctx, [[5, -2.6], [5, 2.6]], '#aebfb7', .4);
  seam(ctx, [[9.8, -2.5], [11.8, -1.55], [11.8, 1.55], [9.8, 2.5]], '#9cafa8', .45);
  if (occupied && !wreck) oval(ctx, 6.9, -1.25, .85, .8, '#28382f');
  box(ctx, 12.5, -1.45, 3.2, 2.9, colors.base);
  for (const x of [13.1, 14.1, 15.1]) box(ctx, x, -.9, .35, 1.8, colors.deep);
  if (running && !reducedEffects) {
    ctx.save(); ctx.globalAlpha *= .13; oval(ctx, 21.6, 0, .85, 7.1, '#d4dfd4'); ctx.restore();
  }
  const reach = running ? 2.1 + Math.abs(Math.cos(rotor)) * 4.6 : 6.3;
  seam(ctx, [[21.8, -reach], [21.2, -1.3], [21.8, 0], [22.35, 1.3], [21.8, reach]], '#344d55', .8);
  seam(ctx, [[21.7, -reach], [21.45, -1.4]], '#a7bab5', .3);
  oval(ctx, 21.4, 0, 1.1, 1, colors.deep);
  if (wreck) {
    poly(ctx, [[-1.4, -3.1], [-3.4, -15.4], [-.7, -17.8], [2.7, -15.7], [1.7, -3]], colors.deep);
    seam(ctx, [[-11, -.8], [-5.3, 1.4], [-2.1, -.5], [3.5, 2.7], [10, .8]], '#9b8e70', .85);
  }
}
function mobilityDamage(ctx, vehicle, type, wreck) {
  if (!wreck && !(Number.isFinite(vehicle.hp) && vehicle.maxHp && vehicle.hp < vehicle.maxHp * .4) && !(vehicle.damageFlash > 0)) return;
  ctx.save();
  const flash = vehicle.damageFlash > 0;
  if (flash) ctx.globalAlpha *= .55;
  const length = type === 'motorcycle' ? 7 : type === 'boat' ? 14 : 12;
  seam(ctx, [[-length, -1.8], [-length * .35, -.4], [1.6, -2.1], [length * .65, .9]], flash ? '#fff0be' : '#685c4b', flash ? .9 : .55);
  ctx.restore();
}

// Airborne sprites stay at vehicle.x/y: render.js supplies the single altitude
// offset and terrain shadow. skipShadow suppresses only this local oval.
export function drawArcadeCar(ctx, vehicle, time = 0, { police = false, occupied = false, reducedEffects = false, externalEffects = false, lighting = null, skipShadow = false } = {}) {
  if (!vehicle) return;
  sceneLight = lighting || { daylight: 0, night: 1, sunAngle: -.75 * Math.PI, shadowX: .65, shadowY: .85, shadowOpacity: .2 };
  const military = vehicle.kind === 'military' || vehicle.faction === 'army' || vehicle.model === 'military', heavy = vehicle.kind === 'heavy' || vehicle.model === 'armoured';
  const modelIndex = military ? 7 : heavy ? 4 : police ? 1 : Number.isFinite(vehicle.model) ? Math.abs(Math.trunc(vehicle.model)) % MODELS.length : hash(vehicle.id || `${vehicle.color || ''}:${vehicle.x}`) % MODELS.length;
  const type = mobilityType(vehicle);
  const photoDimensions = photographicVehicleDimensions(vehicle);
  const model = MODELS[modelIndex], colors = material(military ? '#737d58' : heavy ? '#405e73' : police ? '#368dc0' : vehicle.color || (type === 'boat' ? '#567f7a' : type === 'helicopter' ? '#b38854' : type === 'plane' ? '#6e8b98' : '#bc6860'));
  const wreck = vehicle.destroyed || vehicle.wreck || vehicle.dead || vehicle.kind === 'wreck';
  ctx.save(); ctx.translate(vehicle.x, vehicle.y);
  if (!skipShadow) {
    ctx.save(); ctx.globalAlpha *= .3 + (sceneLight.daylight || 0) * .2;
    const shape = photoDimensions ? [photoDimensions.length * .53, photoDimensions.width * .57] : type === 'motorcycle' ? [12.5, 5.1] : type === 'boat' ? [19.5, 10] : type === 'helicopter' ? [19, 10] : type === 'plane' ? [21, 15] : [15.5, 9.2];
    oval(ctx, (sceneLight.shadowX ?? .65) * 4, (sceneLight.shadowY ?? .85) * 4, ...shape, '#142731'); ctx.restore();
  }
  ctx.save(); ctx.rotate(vehicle.angle || 0);
  if (photoDimensions) {
    const native = type === 'boat' ? { length: 44.5, width: 18, centre: .75 }
      : type === 'plane' ? { length: 44.05, width: 52.4, centre: .725 }
      : { length: model.rear + model.front, width: 15, centre: (model.front - model.rear) / 2 };
    ctx.scale(photoDimensions.length / native.length, photoDimensions.width / native.width);
    ctx.translate(-native.centre, 0);
  }
  if (type === 'motorcycle') motorcycleBody(ctx, vehicle, colors, occupied, wreck);
  else if (type === 'boat') {
    if (!wreck) boatWake(ctx, vehicle, time, reducedEffects);
    boatBody(ctx, vehicle, colors, occupied, wreck);
  } else if (type === 'helicopter') helicopterBody(ctx, vehicle, time, colors, occupied, reducedEffects, wreck);
  else if (type === 'plane') planeBody(ctx, vehicle, time, colors, occupied, reducedEffects, wreck);
  else if (wreck) wreckBody(ctx, model, colors);
  else carBody(ctx, vehicle, time, model, colors, police && !military, occupied, reducedEffects);
  if (type) mobilityDamage(ctx, vehicle, type, wreck);
  if (!type && !wreck && (military || heavy)) {
    box(ctx, -7.5, -4.5, 12, 9, colors.dark); box(ctx, -7, -4, 11, 8, colors.base);
    seam(ctx, [[-6, -3], [3, -3], [3, 3], [-6, 3], [-6, -3]], colors.pale, .4);
    for (const x of [-4, 0]) seam(ctx, [[x, -3], [x, 3]], colors.light, .35);
    if (military) { box(ctx, 7, -2.6, 3, 5.2, '#a8ae86'); box(ctx, 7.6, -1.8, 1.8, 3.6, '#536149'); }
    else { box(ctx, -2.5, -3.4, 2.5, 6.8, '#203945'); box(ctx, -1.8, -3, 1.1, 6, '#60839b'); }
  }
  ctx.restore();
  if (!externalEffects && wreck && vehicle.fireTimer > 0) vehicleSmoke(ctx, time, reducedEffects, true, colors);
  else if (!externalEffects && !wreck && Number.isFinite(vehicle.hp) && vehicle.maxHp && vehicle.hp < vehicle.maxHp * .4) vehicleSmoke(ctx, time, reducedEffects, false, colors);
  if (police && !wreck && vehicle.stun > 0) star(ctx, 0, -17, '#ffe39c');
  if (occupied && !wreck) {
    ctx.save(); ctx.rotate(vehicle.angle || 0);
    const back = photoDimensions ? photoDimensions.length / 2 + 6 : type === 'motorcycle' ? 19 : type === 'boat' ? 28 : type === 'helicopter' ? 35 : type === 'plane' ? 28 : 22;
    seam(ctx, [[-back, -2], [-back + 3.5, 0], [-back, 2]], '#c1bc99', .45); ctx.restore();
  }
  ctx.restore();
}
