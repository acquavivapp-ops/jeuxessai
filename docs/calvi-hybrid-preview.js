import { Game } from '../engine.js';
import * as renderer from '../render.js';
import { loadHybridGroundDetail } from '../hybrid-ground-detail.js';

const $ = id => document.getElementById(id);
const game = new Game();
// This fixture has its own world and camera. No running game is imported.
Object.assign(game.player, { x: 16510, y: 8734 });
game.startClockMinutes = 720;
for (const id of ['drawn', 'hybrid']) {
  const canvas = $(id);
  canvas.viewWidth = canvas.width / 1.95;
  canvas.viewHeight = canvas.height / 1.95;
  canvas.renderScaleX = canvas.renderScaleY = canvas.renderScale = 1.95;
}
let source = null, ready = false, failure = null;
let baselinePixels = null;
const shape = () => ({
  width: game.world.width, height: game.world.height, bounds: game.world.metadata.bounds,
  roads: game.world.roads.map(r => ({ id: r.id, points: r.points, width: r.width, type: r.type })),
  buildings: game.world.buildings.map(b => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, polygon: b.polygon, holes: b.holes, heightMeters: b.heightMeters })),
  land: game.world.landPolygons, sea: game.world.seaPolygons,
  vegetation: game.world.vegetation.map(t => ({ id: t.id, x: t.x, y: t.y, radius: t.radius, canopyPolygon: t.canopyPolygon, trunk: t.trunk })),
  piers: game.world.piers,
});
const observedVehicles = () => game.cars.filter(c => c.sourceImage).map(c => ({ id: c.id, x: c.x, y: c.y, angle: c.angle, sourceImage: c.sourceImage }));
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(b => b.toString(16).padStart(2, '0')).join('');
const initial = { geometry: await digest(shape()), vehicles: await digest(observedVehicles()) };

function drawBase() {
  game.startClockMinutes = Number($('light').value);
  for (let i = 0; i < 24; i++) renderer.render($('drawn').getContext('2d'), game);
  baselinePixels = $('drawn').getContext('2d').getImageData(0, 0, 1280, 800).data;
}
function drawHybrid() {
  if (!source) return;
  game.startClockMinutes = Number($('light').value);
  source.setOpacity(Number($('photo').value) / 100);
  renderer.render($('hybrid').getContext('2d'), game, { groundDetailSource: source });
  $('amount').textContent = `${$('photo').value} %`;
}
function wipe() {
  const amount = Number($('compare').value);
  $('hybrid').style.clipPath = `inset(0 0 0 ${amount}%)`;
  $('divider').style.left = `${amount}%`;
}
function snapshot() {
  const pixels = $('hybrid').getContext('2d').getImageData(0, 0, 1280, 800).data;
  let changedPixels = 0;
  if (baselinePixels) for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i] !== baselinePixels[i] || pixels[i + 1] !== baselinePixels[i + 1] || pixels[i + 2] !== baselinePixels[i + 2]) changedPixels++;
  return { ready, failure, fixture: true, liveGameLoaded: typeof window.blueNight !== 'undefined',
    initial, source: source?.stats(), renderer: renderer.rendererStats(),
    changedPixels, opacity: Number($('photo').value) / 100, startClockMinutes: game.startClockMinutes,
    camera: renderer.cameraFor(game, $('hybrid')), observedVehicleCount: observedVehicles().length };
}
// Explicit fixture diagnostics, used only by the isolated preview checks.
window.hybridPreview = { snapshot, async fingerprints() { return { geometry: await digest(shape()), vehicles: await digest(observedVehicles()) }; },
  fixture: { game, renderer, get source() { return source; } } };
$('compare').addEventListener('input', wipe);
$('photo').addEventListener('input', () => { $('amount').textContent = `${$('photo').value} %`; });
$('photo').addEventListener('change', drawHybrid);
$('light').addEventListener('change', () => { drawBase(); drawHybrid(); });
try {
  await renderer.artReady;
  drawBase();
  source = await loadHybridGroundDetail(game.world, { x: 16080, y: 8200, w: 1060, h: 1050 }, { opacity: .65 });
  if (!source.stats().loaded.length) throw new Error('Aucune photographie locale disponible');
  drawHybrid();
  // A few warm paints finish the existing bounded sprite preparation quota.
  for (let i = 0; i < 24; i++) renderer.render($('hybrid').getContext('2d'), game, { groundDetailSource: source });
  ready = true;
  $('status').textContent = 'Déplacez la séparation pour comparer exactement le même endroit.';
} catch (error) {
  failure = error.message;
  $('status').textContent = 'L’aperçu photo est indisponible. Le dessin reste affiché.';
  $('hybrid').style.clipPath = 'inset(0 0 0 100%)';
  console.error(error);
}
window.addEventListener('pagehide', event => { if (!event.persisted) source?.close(); });
