import { Game, createWorld, DURATION, MAX_BOTTLES } from './engine.js';
import { render, renderMinimap, renderCelebration, artReady, cameraFor, worldToScreen, screenToWorld, imageryStats, rendererStats } from './render.js';
import { AudioEngine } from './audio.js';
import { UNIVERSE, MISSIONS, CAMEOS, missionFor, districtFor, STREET_RADIO } from './universe.js';
import { sampleElevation } from './terrain.js';
import { timeOfDay, START_TIMES, DEFAULT_START_MINUTES } from './game-time.js';
import { WEAPONS } from './combat.js';

const $ = id => document.getElementById(id);
const weaponNames = { shotgun: 'POMPE', rifle: 'PRÉCISION' };
const vehicleNames = { motorcycle: 'MOTO', boat: 'BATEAU', helicopter: 'HÉLICOPTÈRE', plane: 'AVION' };
const aircraft = vehicle => vehicle?.mobilityType === 'helicopter' || vehicle?.mobilityType === 'plane';
function mobilityActionName(vehicle) { return aircraft(vehicle) ? vehicle.altitude > 0 || vehicle.takeoffRequested ? vehicle.landingRequested ? 'ANNULER' : 'ATTERRIR' : 'DÉCOLLER' : 'FREIN'; }
const weaponIcons = {
  pistol: 'M4 8h16v5h-8l-2 7H5l2-8H4zM15 8V5M18 8V5',
  smg: 'M3 8h18v5H9l-2 6H3l2-8M12 13v7h4v-7M18 8V5',
  launcher: 'M2 9h19v5H2zM5 14l-1 5h4l2-5M15 9V5h4v4',
  shotgun: 'M2 10h20v3H8l-4 5H2l4-6M9 13v3M13 9h8',
  rifle: 'M2 11h20M3 11l-2 5h4l4-4h9M10 7h7v3h-7zM12 13v6',
  carbine: 'M2 10h20v3H9l-4 4H2l3-6M12 13l-1 6h4v-6M17 7v3',
};
const safeRead = () => { try { return JSON.parse(localStorage.getItem('blue-night-save') || '{}') || {}; } catch { return {}; } };
const saved = safeRead();
let best = saved.version === 4 && Number.isFinite(saved.best) ? saved.best : 0;
let muted = saved.muted === true;
let reduced = typeof saved.reduced === 'boolean' ? saved.reduced : matchMedia('(prefers-reduced-motion: reduce)').matches;
let tutorialSeen = saved.version === 4 && saved.tutorialSeen === true, storageWorks = true;
function save() { try { localStorage.setItem('blue-night-save', JSON.stringify({ version: 4, best, muted, reduced, tutorialSeen, startClockMinutes: chosenStartMinutes })); } catch { storageWorks = false; } }
const audio = new AudioEngine({ muted });
const keys = new Set(), pointers = new Map();
const input = { x: 0, y: 0, aimAngle: undefined, shootHeld: false, brake: false };
let mouseAim = null;
let nextStreetRadio = 9, streetRadioCursor = 0, lastDistrict = '';
let lastMode = '', lastFrame = 0, uiClock = 0, noticeUntil = 0, radioUntil = 0;
let activeDialog = null, resumeAfterDialog = false;
const radioShown = new Set();
let chosenMode = 'free';
let chosenStartMinutes = START_TIMES.some(time => time.minutes === saved.startClockMinutes) ? saved.startClockMinutes : DEFAULT_START_MINUTES;
let viewZoom = 1.95, zoomElapsed = 0;
let canvasRect = null, sceneDirty = true, hudDirty = false, lastRenderedMode = '', lastImageryRevision = -1, minimapClock = 0;
const calviWorld = (() => {
  try { return createWorld(); }
  catch (error) {
    $('overlay').innerHTML = '<div class="menu-card"><h2>CALVI INDISPONIBLE</h2><p>Recharge le jeu ou réinstalle ses fichiers pour retrouver la carte.</p></div>';
    throw error;
  }
})();
const canvas = $('game'), ctx = canvas.getContext('2d', { alpha: false });
const mapCtx = $('minimap').getContext('2d');
mapCtx.imageSmoothingEnabled = false;
function notice(message, seconds = 4) { $('notice').textContent = message; noticeUntil = performance.now() + seconds * 1000; }
function resetInput() {
  keys.clear(); input.x = input.y = 0; input.shootHeld = input.brake = false; input.aimAngle = undefined;
  mouseAim = null;
  const captures = [...pointers]; pointers.clear();
  for (const [id, state] of captures) if (state.owner.hasPointerCapture(id)) state.owner.releasePointerCapture(id);
  $('knob').style.transform = ''; $('aim-knob').style.transform = '';
}
function showRadio(index) {
  const person = CAMEOS[index]; $('radio-portrait').src = `assets/${person.id}.svg`;
  $('radio-portrait').alt = `Caricature de ${person.name}`;
  $('radio-name').textContent = person.name; $('radio-line').textContent = person.line;
  $('radio').classList.remove('hidden'); radioUntil = game.elapsed + 6; audio.play('radio');
}
function showStreetRadio(entry) {
  $('radio-portrait').src = entry.avatar || 'assets/icon.svg'; $('radio-portrait').alt = `Radio : ${entry.speaker}`;
  $('radio-name').textContent = entry.speaker; $('radio-line').textContent = entry.line;
  $('radio').classList.remove('hidden'); radioUntil = game.elapsed + 6; audio.play('radio');
}
function updateDistrict() {
  const district = districtFor(game.world, game.player.x, game.player.y);
  if (district.id !== lastDistrict) {
    lastDistrict = district.id; $('district-name').textContent = district.name;
    $('district-line').textContent = district.tagline;
    document.querySelector('.district-badge').style.setProperty('--district-accent', district.accent);
    audio.setDistrict?.(district.id);
  }
  return district;
}
const game = new Game({ world: calviWorld, onEvent(name, data = {}) {
  if (['win', 'lose'].includes(name)) audio.setPlaying(false);
  if (['plant', 'explosion', 'demolish', 'hurt', 'win', 'lose', 'start', 'hit', 'car', 'heat', 'shoot', 'vehicleFire', 'vehicleExplosion', 'buildingDestroyed', 'weapon'].includes(name)) audio.play(name, data.audioVariant ?? (data.explosive ? 2 : data.weapon === 'smg' ? 1 : data.multiplier || 0));
  if (name === 'notice') notice(data.message);
  if (name === 'demolish') { notice(`${data.name || 'Un dépôt'} : mission accomplie.`); const friend = UNIVERSE.crew[game.demolished % 2]; showStreetRadio({ speaker: friend.name, avatar: friend.avatar, line: missionFor(game.world.buildings.find(b => b.id === data.id)?.missionId || data.id)?.line || friend.line }); }
  if (name === 'hurt') notice(data.cause === 'blast' ? 'Trop près du souffle ! Garde tes distances.' : 'La patrouille te rattrape. Change de rue !');
  if (name === 'car') notice(game.vehicleId ? aircraft(game.vehicle) ? `${vehicleNames[game.vehicle.mobilityType]}. Espace : décoller ou atterrir · E : sortir une fois posé.` : game.vehicle?.mobilityType === 'boat' ? 'À bord. Direction : naviguer · Espace : freiner · E près d’un quai : descendre.' : 'Au volant. E : sortir · Espace : frein · direction opposée : reculer.' : 'À pied. Vise avec la souris ou le stick droit.');
  if (name === 'missionComplete') notice('Les trois affaires sont réglées. La ville reste à explorer !', 6);
  if (name === 'vehicleFire') notice('La voiture brûle ! Éloigne-toi avant l’explosion.', 2);
  if (name === 'vehicleExplosion') notice('Voiture détruite ! Attention aux explosions en chaîne.', 2);
  if (name === 'policeResponse') notice(data.message || 'Des renforts arrivent. Change de secteur !', 5);
  if (['win', 'lose'].includes(name)) { best = Math.max(best, game.score); save(); resetInput(); $('radio').classList.add('hidden'); }
  if (['plant', 'demolish', 'hurt', 'car', 'heat', 'win', 'lose', 'weapon', 'buildingDestroyed'].includes(name)) hudDirty = true;
} });
game.startClockMinutes = chosenStartMinutes;
let dataset, city;
function updateSetting() {
  dataset = game.world.visualMeta?.dataset;
  city = 'Calvi';
  $('map-credit').classList.remove('hidden');
  $('setting-copy').textContent = `Commune de Calvi : rues et limite administrative OpenStreetMap, relief et photographie aérienne IGN. Ambiance 1994 et missions fictives. Les hauteurs de ${game.world.buildingHeights?.sourceCount || 0} bâtiments viennent d’IGN ; les autres volumes sont dessinés pour le jeu.`;
}
// Calvi is the game's only playable municipality.
function cityLabel() { document.querySelector('.brand small').textContent = `${city.toUpperCase()} · 1994`; $('map-city').textContent = city.toUpperCase(); }
function resizeCanvas(refreshRect = false) {
  if (refreshRect || !canvasRect) canvasRect = canvas.getBoundingClientRect();
  const rect = canvasRect;
  const width = Math.max(140, rect.width / viewZoom), height = Math.max(180, rect.height / viewZoom);
  canvas.viewZoom = viewZoom;
  const backingWidth = Math.max(1, Math.round(rect.width)), backingHeight = Math.max(1, Math.round(rect.height));
  if (canvas.viewWidth === width && canvas.viewHeight === height && canvas.width === backingWidth && canvas.height === backingHeight) return;
  canvas.viewWidth = width; canvas.viewHeight = height;
  // Zoom changes the logical camera, not the canvas allocation. Reallocating
  // its backing bitmap during every zoom frame clears it and stalls raster work.
  if (canvas.width !== backingWidth) canvas.width = backingWidth;
  if (canvas.height !== backingHeight) canvas.height = backingHeight;
  canvas.renderScale = canvas.renderScaleX = backingWidth / width;
  canvas.renderScaleY = backingHeight / height;
  ctx.imageSmoothingEnabled = true;
  sceneDirty = true;
}
function updateCameraZoom() {
  const dt = Math.max(0, Math.min(.1, game.elapsed - zoomElapsed));
  zoomElapsed = game.elapsed;
  const target = game.vehicle ? 1.65 : 1.95;
  viewZoom += (target - viewZoom) * (1 - Math.exp(-dt * 5));
  if (Math.abs(target - viewZoom) < .001) viewZoom = target;
  resizeCanvas();
}
async function startGame() {
  resetInput(); await Promise.all([audio.unlock(), artReady]); audio.setPlaying(false);
  game.tutorial = !tutorialSeen; game.start({ mode: chosenMode }); radioShown.clear(); radioUntil = 0; nextStreetRadio = 9; streetRadioCursor = 0; lastDistrict = ''; updateDistrict();
  game.startClockMinutes = chosenStartMinutes; viewZoom = 1.95; zoomElapsed = 0; resizeCanvas();
  $('radio').classList.add('hidden'); audio.setCombo(0); audio.setPlaying(!game.tutorial);
  notice(chosenMode === 'free' ? `Exploration libre. Prends un véhicule, choisis ton arme et parcours ${city}.` : 'Trois dépôts, 180 secondes, puis retour au rendez-vous.', 5);
  renderOverlay(true); updateHUD();
}
function beginTutorial() { tutorialSeen = true; save(); game.dismissTutorial(); audio.unlock(); audio.setPlaying(true); renderOverlay(true); updateHUD(); }
function setPause() {
  if (activeDialog) return;
  if (game.mode === 'playing') { game.pause(); resetInput(); audio.setPlaying(false); }
  else if (game.mode === 'paused') { game.resume(); audio.unlock(); audio.setPlaying(!game.tutorial); }
  renderOverlay(true); updateHUD();
}
function renderOverlay(force = false) {
  const mode = `${game.mode}:${game.tutorial}`; if (!force && mode === lastMode) return; lastMode = mode;
  sceneDirty = true;
  const overlay = $('overlay');
  if (game.mode === 'title') {
    overlay.innerHTML = `<div class="menu-card title-card"><span class="eyebrow">${city.toUpperCase()} · 1994 · ARCADE</span><h2 class="illustrated-title"><img class="arcade-logo" src="assets/blue-night-logo.svg" alt="Blue Night"></h2><div class="subtitle">${UNIVERSE.tagline}</div><p>${city}, des cassettes et des mauvaises idées.</p><div class="edition-pills"><span>CALVI · COMMUNE ENTIÈRE</span><span>TERRE · MER · AIR</span><span>6 ARMES</span></div><div class="title-crew">${UNIVERSE.crew.map(p => `<div><img src="${p.avatar}" alt=""><b>${p.name.toUpperCase()}</b></div>`).join('')}</div><div class="session-settings"><label class="map-choice">MODE DE JEU<select id="game-mode" aria-label="Mode de jeu"><option value="free" ${chosenMode === 'free' ? 'selected' : ''}>EXPLORATION LIBRE</option><option value="missions" ${chosenMode === 'missions' ? 'selected' : ''}>MISSIONS · 180 S</option></select></label><label class="map-choice">HEURE DU DÉPART<select id="start-time" aria-label="Heure du départ">${START_TIMES.map(time => `<option value="${time.minutes}" ${chosenStartMinutes === time.minutes ? 'selected' : ''}>${time.name}</option>`).join('')}</select></label></div><button class="primary" data-action="start">JOUER <svg class="play-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2l7 4-7 4z"/></svg></button><div class="record">ARCADE 90 · CALVI OUVERTE · JOUR & NUIT</div></div>`;
  } else if (game.mode === 'paused') {
    overlay.innerHTML = `<div class="menu-card"><span class="eyebrow">MOTEUR COUPÉ</span><h2>PAUSE</h2><p>La circulation, les tirs et les poursuites sont arrêtés.</p><button class="primary" data-action="resume">REPRENDRE</button><button class="secondary" data-action="restart">RECOMMENCER</button></div>`;
  } else if (game.mode === 'result') {
    const r = game.result, causes = { crash: 'Véhicule détruit sans issue sûre. Accoste ou atterris avant de descendre.', blast: 'Pris dans le souffle. Éloigne-toi des explosions.', gendarme: 'Les képis t’ont rattrapé. Utilise les rues parallèles.', time: 'Le temps est écoulé ! Les voitures font gagner du temps.', complete: 'Les trois missions sont accomplies. Retour au maquis réussi !' };
    overlay.innerHTML = `<div class="menu-card result-card ${r.won ? 'won' : 'lost'}"><span class="eyebrow">${r.won ? 'RETOUR AU MAQUIS' : 'FIN DE PARTIE'}</span><h2 class="illustrated-title"><img class="arcade-result" src="assets/${r.won ? 'victory' : 'defeat'}.svg" alt="${r.won ? 'Victoire !' : 'Aïe !'}"></h2>${r.won ? '<canvas id="celebration" width="160" height="76" role="img" aria-label="Deux personnages cagoulés près d’une voiture de fuite"></canvas>' : ''}<div class="result-metrics"><div><strong>${r.score}</strong><small>POINTS</small></div><div><strong>${r.demolished}/3</strong><small>MISSIONS</small></div></div><p>${causes[r.cause] || 'La virée a été mouvementée.'}</p><button class="primary" data-action="restart">REJOUER <span aria-hidden="true">↻</span></button><div class="record">RECORD ${best}${!storageWorks ? ' · SAUVEGARDE INDISPONIBLE' : ''}</div></div>`;
  } else if (game.tutorial) {
    overlay.innerHTML = `<div class="menu-card"><span class="eyebrow">PREMIÈRE VIRÉE</span><h2>${city.toUpperCase()}.<br>À TON HEURE.</h2><div class="howto"><div><b>1</b><span><em>Stick gauche ou flèches : bouger.</em><br>La carte remplit l’écran et te suit.</span></div><div><b>2</b><span><em>E ou MONTER près d’un véhicule.</em><br>Voiture, moto, bateau au quai, hélico ou avion.<br>Espace : frein ou décollage / atterrissage.</span></div><div><b>3</b><span><em>Souris + clic, F ou stick droit : tirer.</em><br>R ou ARME : six armes, du pistolet au fusil à pompe.<br>La gravité des faits fait monter la recherche.</span></div><div><b>4</b><span><em>Trois dépôts jaunes, si tu veux.</em><br>POSER à pied ; éloigne-toi avant 2,6 secondes.<br>En mode libre, le jour et la nuit se succèdent.</span></div></div><button class="primary" data-action="tutorial">C'EST PARTI !</button></div>`;
  } else overlay.innerHTML = '';
  $('pause').disabled = !['playing', 'paused'].includes(game.mode);
  $('pause').setAttribute('aria-label', game.mode === 'paused' ? 'Reprendre la partie' : 'Mettre en pause');
  $('minimap-wrap').classList.toggle('hidden', game.mode === 'title' || game.tutorial);
}
$('overlay').addEventListener('click', e => { const a = e.target.closest('[data-action]')?.dataset.action; if (a === 'start' || a === 'restart') startGame(); else if (a === 'resume') setPause(); else if (a === 'tutorial') beginTutorial(); });
$('overlay').addEventListener('change', e => {
  if (game.mode !== 'title') return;
  if (e.target.id === 'game-mode') { chosenMode = e.target.value; return; }
  if (e.target.id === 'start-time') { chosenStartMinutes = Number(e.target.value); game.startClockMinutes = chosenStartMinutes; sceneDirty = true; save(); updateHUD(); return; }
});
function action(fn) { audio.unlock(); fn.call(game); updateHUD(); }
$('plant').addEventListener('click', () => { if (!game.vehicle) action(game.plant); else if (aircraft(game.vehicle)) action(game.vehicleAction); });
$('boom').addEventListener('click', () => action(game.interact));
$('weapon').addEventListener('click', () => action(game.cycleWeapon));
$('pause').addEventListener('click', setPause);
function updateSound() { audio.setMuted(muted); $('sound').setAttribute('aria-pressed', String(muted)); $('sound').setAttribute('aria-label', muted ? 'Activer le son' : 'Couper le son'); $('mute-setting').checked = muted; }
function updateEffects() { document.body.classList.toggle('reduced', reduced); $('reduced').checked = reduced; sceneDirty = true; }
$('sound').addEventListener('click', () => { audio.unlock(); muted = !muted; updateSound(); save(); });
$('mute-setting').addEventListener('change', e => { muted = e.target.checked; updateSound(); save(); });
$('reduced').addEventListener('change', e => { reduced = e.target.checked; updateEffects(); save(); });
function openDialog(id) { if (activeDialog) return; resumeAfterDialog = game.mode === 'playing'; if (resumeAfterDialog) { game.pause(); audio.setPlaying(false); } resetInput(); activeDialog = $(id); activeDialog.showModal(); renderOverlay(true); }
function closeDialog() { if (!activeDialog) return; const dialog = activeDialog; activeDialog = null; dialog.close(); if (resumeAfterDialog) { game.resume(); audio.unlock(); audio.setPlaying(!game.tutorial); } resumeAfterDialog = false; renderOverlay(true); }
$('options').addEventListener('click', () => openDialog('settings'));
document.querySelectorAll('.dossier-open').forEach(b => b.addEventListener('click', () => openDialog('dossier')));
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeDialog));
document.querySelectorAll('dialog').forEach(d => d.addEventListener('cancel', e => { e.preventDefault(); closeDialog(); }));
$('chapter-copy').textContent = UNIVERSE.opening;
$('dossier-title').textContent = UNIVERSE.chapter;
$('crew').innerHTML = UNIVERSE.crew.map(p => `<article class="crew-card"><img src="${p.avatar}" alt="Portrait de ${p.name}"><div><b>${p.name}</b><small>${p.role}</small><p>${p.bio}</p></div></article>`).join('');
$('cameos').innerHTML = CAMEOS.map(c => `<div class="cameo-card"><img src="assets/${c.id}.svg" alt="Caricature de ${c.name}"><div><b>${c.name}</b><small>${c.role}</small><p>« ${c.line} »</p></div></div>`).join('');
$('mission-stories').innerHTML = MISSIONS.map((m, i) => `<article class="mission-story"><span>0${i + 1} · ${m.place}</span><h3>${m.title}</h3><blockquote>« ${m.line} »</blockquote><p>${m.brief}</p></article>`).join('');
function active() { return game.mode === 'playing' && !game.tutorial && !activeDialog; }
function aimAt(e) {
  if (e.pointerType === 'mouse') mouseAim = { clientX: e.clientX, clientY: e.clientY, pointerType: 'mouse' };
  const r = canvasRect || canvas.getBoundingClientRect(); const target = screenToWorld(game, (e.clientX - r.left) * canvas.viewWidth / r.width, (e.clientY - r.top) * canvas.viewHeight / r.height, canvas);
  input.aimAngle = Math.atan2(target.y - game.player.y, target.x - game.player.x);
}
function refreshPointerInput() {
  input.x = input.y = 0; input.shootHeld = input.brake = false;
  for (const state of pointers.values()) {
    if (state.type === 'move') { input.x = state.x || 0; input.y = state.y || 0; }
    if (state.type === 'aim' && state.length > .18) { input.aimAngle = Math.atan2(state.y, state.x); input.shootHeld = true; }
    if (state.type === 'fire') input.shootHeld = true;
    if (state.type === 'brake') input.brake = true;
  }
}
function pointerMove(e) {
  const state = pointers.get(e.pointerId);
  if (!state) { if (e.currentTarget === canvas && e.pointerType === 'mouse' && active()) aimAt(e); return; }
  e.preventDefault();
  if (state.type === 'fire' && state.owner === canvas) { aimAt(e); return; }
  if (!['move', 'aim'].includes(state.type)) return;
  const dx = (e.clientX - state.origin.x) / 30, dy = (e.clientY - state.origin.y) / 30, length = Math.max(1, Math.hypot(dx, dy));
  state.x = Math.abs(dx / length) < .1 ? 0 : dx / length; state.y = Math.abs(dy / length) < .1 ? 0 : dy / length; state.length = Math.hypot(state.x, state.y);
  $(state.type === 'aim' ? 'aim-knob' : 'knob').style.transform = `translate(${state.x * 23}px,${state.y * 23}px)`;
  refreshPointerInput();
}
function pointerDown(e) {
  if (!active() || e.button > 0) return;
  const owner = e.currentTarget, type = owner === $('joystick') ? 'move' : owner === $('aim-stick') ? 'aim' : owner === $('plant') ? 'brake' : 'fire';
  if (type === 'brake' && (!game.vehicle || aircraft(game.vehicle))) return;
  if ([...pointers.values()].some(state => state.type === type)) return;
  e.preventDefault(); audio.unlock(); const r = owner.getBoundingClientRect();
  pointers.set(e.pointerId, { owner, type, origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, x: 0, y: 0, length: 0 });
  owner.setPointerCapture(e.pointerId); if (owner === canvas) aimAt(e);
  pointerMove(e); refreshPointerInput();
}
function pointerUp(e) {
  const state = pointers.get(e.pointerId); if (!state) return;
  pointers.delete(e.pointerId);
  if (['move', 'aim'].includes(state.type)) $(state.type === 'aim' ? 'aim-knob' : 'knob').style.transform = '';
  if (state.type === 'aim') input.aimAngle = undefined;
  if (state.owner.hasPointerCapture(e.pointerId)) state.owner.releasePointerCapture(e.pointerId);
  refreshPointerInput();
}
for (const target of [$('joystick'), $('aim-stick'), $('fire'), $('plant'), canvas]) {
  target.addEventListener('pointerdown', pointerDown); target.addEventListener('pointermove', pointerMove); target.addEventListener('pointerup', pointerUp); target.addEventListener('pointercancel', pointerUp); target.addEventListener('lostpointercapture', pointerUp);
}
canvas.addEventListener('contextmenu', e => e.preventDefault());
const moveKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'z', 'q']);
window.addEventListener('keydown', e => {
  if (activeDialog || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (moveKeys.has(key) || [' ', 'Enter', 'Escape', 'e', 'f', 'j', 'r'].includes(key) || (key === 'Tab' && active())) e.preventDefault();
  if (active() && (moveKeys.has(key) || ['f', 'j'].includes(key) || key === ' ' && !aircraft(game.vehicle))) keys.add(key);
  if (e.repeat) return;
  if (key === 'Escape') setPause();
  else if (key === ' ' && !game.vehicle) action(game.plant);
  else if (key === ' ' && aircraft(game.vehicle) && active()) action(game.vehicleAction);
  else if (key === 'e') action(game.interact);
  else if ((key === 'r' || key === 'Tab') && active()) action(game.cycleWeapon);
  else if (key === 'Enter') { if (game.mode === 'title' || game.mode === 'result') startGame(); else if (game.tutorial && game.mode === 'playing') beginTutorial(); else if (game.mode === 'paused') setPause(); else action(game.interact); }
});
window.addEventListener('keyup', e => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
function interruption() { resetInput(); if (game.mode === 'playing') { game.pause(); audio.setPlaying(false); renderOverlay(true); } if (activeDialog) resumeAfterDialog = false; }
window.addEventListener('blur', interruption); window.addEventListener('pagehide', interruption);
document.addEventListener('visibilitychange', () => { if (document.hidden) interruption(); });
window.addEventListener('resize', () => { resizeCanvas(true); renderOverlay(true); });
function updateHUD() {
  hudDirty = false;
  const text = (target, value) => { const element = typeof target === 'string' ? $(target) : target; const next = String(value); if (element.textContent !== next) element.textContent = next; };
  const attribute = (id, name, value) => { const element = $(id); if (element.getAttribute(name) !== value) element.setAttribute(name, value); };
  const left = game.timeLeft ?? Math.max(0, DURATION - game.elapsed), free = game.sessionMode === 'free';
  text('score', String(game.score).padStart(5, '0'));
  const timer = free ? '∞' : `${Math.ceil(left)}<small>s</small>`; if ($('timer').innerHTML !== timer) $('timer').innerHTML = timer;
  text('time-label', free ? 'LIBRE' : 'TEMPS');
  document.querySelector('.timer-stat').classList.toggle('urgent', !free && left < 20);
  text('lives', Array.from({ length: 3 }, (_, n) => n < game.hearts ? '♥' : '·').join(' ')); attribute('lives', 'aria-label', `${game.hearts} vie${game.hearts > 1 ? 's' : ''}`);
  const vehicle = game.vehicle, kmh = Math.round(Math.abs(vehicle?.speed || 0) * (dataset?.pixelsPerMetre ? 3.6 / dataset.pixelsPerMetre : 1));
  text('location', vehicle ? `${vehicleNames[vehicle.mobilityType] || 'AU VOLANT'} · ${kmh} KM/H${aircraft(vehicle) ? ` · ${Math.round(vehicle.altitude || 0)} M` : ''}` : `${city.toUpperCase()} · À PIED`);
  text('heat', '★'.repeat(game.heat) + '☆'.repeat(6 - game.heat)); attribute('heat', 'aria-label', `Recherche : ${game.heat} étoile${game.heat > 1 ? 's' : ''}`);
  const clock = timeOfDay(game);
  text('game-clock', clock.label); text('time-phase', clock.phase.toUpperCase());
  text('district-time', `${clock.label} · ${clock.phase.toUpperCase()}`);
  text('police-response', game.wanted?.state === 'search' || game.wanted?.state === 'cooling' ? 'RECHERCHE EN COURS' : ['AUCUNE ALERTE', 'PATROUILLES', 'RENFORTS', 'BARRAGES', 'HÉLICOPTÈRE', 'UNITÉS LOURDES', 'ARMÉE'][game.heat]);
  const objective = game.objective, story = missionFor(objective?.missionId || objective?.id);
  text('missiontext', objective ? `${story?.title || objective.name} · ${Math.ceil(objective.distance / (dataset?.pixelsPerMetre || 1))} m` : 'Explore la ville');
  text('progress', `${game.demolished}/3`); text('stock', `BOUTEILLES ${game.bottles.length}/${MAX_BOTTLES}`); text('best', `RECORD ${best}`);
  const nearby = game.interactionTarget();
  const transfer = vehicle?.mobilityType === 'boat' && nearby;
  const theft = nearby && !nearby.owned && !nearby.stolen && nearby.id !== 'car-start';
  const interaction = transfer ? 'PRENDRE' : vehicle ? 'SORTIR' : theft ? 'VOLER' : 'MONTER';
  const kind = nearby?.mobilityType === 'boat' ? 'ce bateau' : nearby?.mobilityType === 'plane' ? 'cet avion' : nearby?.mobilityType === 'helicopter' ? 'cet hélicoptère' : nearby?.mobilityType === 'motorcycle' ? 'cette moto' : 'une voiture';
  text($('boom').querySelector('b'), interaction);
  attribute('boom', 'aria-label', transfer ? 'Prendre le bateau voisin' : vehicle ? 'Sortir du véhicule' : `${theft ? 'Voler' : 'Monter dans'} ${kind}`);
  attribute('boom', 'title', transfer ? 'E · Passer dans le bateau voisin.' : nearby?.name ? `E · ${nearby.name}` : 'E · Monter ou descendre à proximité.');
  const mobilityAction = mobilityActionName(vehicle);
  text($('plant').querySelector('b'), vehicle ? mobilityAction : 'POSER');
  attribute('plant', 'aria-label', !vehicle ? 'Poser une bouteille' : aircraft(vehicle) ? mobilityAction === 'DÉCOLLER' ? 'Décoller' : mobilityAction === 'ANNULER' ? 'Annuler l’atterrissage' : 'Atterrir' : 'Freiner');
  text('weapon-name', weaponNames[game.weapon?.id] || (game.weapon?.name || 'Pistolet').toUpperCase());
  attribute('weapon', 'title', `${game.weapon?.name || 'Pistolet'} · ${(game.weaponIndex || 0) + 1}/${WEAPONS.length} · R / Tab`);
  if ($('weapon-icon').dataset.weapon !== game.weapon?.id) {
    $('weapon-icon').innerHTML = `<path d="${weaponIcons[game.weapon?.id] || weaponIcons.pistol}"/>`;
    $('weapon-icon').dataset.weapon = game.weapon?.id;
  }
  const disabled = !active(); for (const id of ['plant', 'boom', 'weapon']) if ($(id).disabled !== disabled) $(id).disabled = disabled;
  const airWeaponBlocked = (vehicle?.altitude || 0) > 8 && !game.weapon?.explosive;
  if ($('fire').disabled !== (disabled || airWeaponBlocked)) $('fire').disabled = disabled || airWeaponBlocked;
  attribute('fire', 'title', airWeaponBlocked ? 'En vol, utilise le Lance-BOUM pour viser le sol.' : 'Maintenir pour tirer');
  text('movement-label', vehicle ? vehicle.mobilityType === 'boat' ? 'NAVIGUER' : aircraft(vehicle) ? 'PILOTER' : 'CONDUIRE' : 'MARCHER');
  updateDistrict();
  text('altitude', `${Math.round(sampleElevation(game.world, game.player.x, game.player.y) + (vehicle?.altitude || 0))} M`);
  if (active()) audio.setVehicle(vehicle ? vehicle.speed : null);
}
function frame(now) {
  const dt = Math.min(.05, (now - (lastFrame || now)) / 1000); lastFrame = now;
  const keyboard = { x: (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') || keys.has('q') ? 1 : 0), y: (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('w') || keys.has('z') ? 1 : 0) };
  const keyboardMoves = keyboard.x || keyboard.y;
  if (active() && mouseAim && ![...pointers.values()].some(pointer => pointer.type === 'aim')) aimAt(mouseAim);
  game.update(dt, { x: keyboardMoves ? keyboard.x : input.x, y: keyboardMoves ? keyboard.y : input.y, aimAngle: input.aimAngle, shootHeld: input.shootHeld || keys.has('f') || keys.has('j'), brake: input.brake || keys.has(' ') });
  updateCameraZoom(); renderOverlay();
  const sceneMode = `${game.mode}:${game.tutorial}`;
  const imageryRevision = imageryStats().revision;
  const paint = active() || sceneDirty || sceneMode !== lastRenderedMode || (game.mode === 'title' && imageryRevision !== lastImageryRevision);
  minimapClock += dt;
  if (paint) {
    render(ctx, game, { reducedEffects: reduced, time: game.elapsed });
    if (!$('minimap-wrap').classList.contains('hidden') && (sceneDirty || minimapClock >= .1)) { renderMinimap(mapCtx, game); minimapClock = 0; }
    const celebration = $('celebration'); if (celebration) renderCelebration(celebration.getContext('2d'), { time: game.elapsed * 1000, reducedEffects: reduced });
    lastRenderedMode = sceneMode; sceneDirty = false;
  }
  lastImageryRevision = imageryRevision;
  uiClock += dt;
  if (hudDirty || (active() && uiClock > .1)) { updateHUD(); uiClock = 0; audio.setIntensity(Math.max(game.heat / 6, game.sessionMode !== 'free' && game.elapsed > 140 ? .9 : .1)); if (now > noticeUntil) { const hint = game.vehicleId ? aircraft(game.vehicle) ? 'Direction : piloter · Espace : décoller / atterrir · E une fois posé : sortir' : 'E : sortir · Espace : frein · F : tirer · R : arme' : 'Vise avec la souris ou le stick droit. F : tirer · E : véhicule'; if ($('notice').textContent !== hint) $('notice').textContent = hint; } }
  if (active()) { if (game.elapsed > radioUntil) $('radio').classList.add('hidden'); for (const [index, at] of [[2, 18], [3, 46], [0, 82], [1, 120]]) if (game.elapsed > at && !radioShown.has(index)) { showRadio(index); radioShown.add(index); } if (game.elapsed >= nextStreetRadio && game.elapsed > radioUntil) { const district = districtFor(game.world, game.player.x, game.player.y); const pool = STREET_RADIO.filter(entry => !entry.district || entry.district === district.id); showStreetRadio(pool[streetRadioCursor++ % pool.length]); nextStreetRadio = game.elapsed + 16; } }
  requestAnimationFrame(frame);
}
updateSetting(); cityLabel(); resizeCanvas(); updateSound(); updateEffects(); updateHUD(); renderOverlay(); requestAnimationFrame(frame);
artReady.then(() => { if (game.mode === 'title') sceneDirty = true; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
window.blueNight = { screenPoint: (x, y) => { const p = worldToScreen(game, x, y, canvas), r = canvas.getBoundingClientRect(); return { x: r.left + p.x * r.width / canvas.viewWidth, y: r.top + p.y * r.height / canvas.viewHeight }; }, snapshot: () => structuredClone({ imagery: imageryStats(), renderer: rendererStats(), aerial: { vegetationCount: game.world.vegetation?.length || 0, pierCount: game.world.piers?.length || 0, vehicleCoverage: game.world.visualMeta?.aerialVehicleCoverage || null, vehicleMasks: game.world.visualMeta?.aerialVehicleMasks || [] }, interactionTarget: (() => { const target = game.interactionTarget(); return target ? { id: target.id, type: target.mobilityType || 'car', name: target.name || null, owned: Boolean(target.owned), stolen: Boolean(target.stolen), transfer: game.vehicle?.mobilityType === 'boat' } : null; })(), graphics: { backingWidth: canvas.width, backingHeight: canvas.height, viewWidth: canvas.viewWidth, viewHeight: canvas.viewHeight, scaleX: canvas.renderScaleX, scaleY: canvas.renderScaleY }, map: { city: game.world.metadata?.city, source: game.world.metadata?.source, status: game.world.mapStatus, bounds: game.world.metadata?.bounds, municipalBoundary: game.world.municipalBoundary ? { insee: game.world.municipalBoundary.insee, sourceId: game.world.municipalBoundary.sourceId, areaSquareKm: game.world.municipalBoundary.areaSquareKm } : null, width: game.world.width, height: game.world.height }, timeOfDay: timeOfDay(game), wanted: game.wanted || null, roadblocks: game.roadblocks || [], helicopter: game.helicopter || null, mode: game.mode, sessionMode: game.sessionMode, elapsed: game.elapsed, score: game.score, hearts: game.hearts, tutorial: game.tutorial, player: { ...game.player }, bottles: game.bottles.map(b => ({ ...b })), demolished: game.demolished, destroyedBuildings: game.destroyedBuildings, eliminated: { ...game.eliminated }, heat: game.heat, vehicleId: game.vehicleId, vehicle: game.vehicle ? { ...game.vehicle } : null, cars: game.cars.map(c => ({ ...c })), police: game.police.length, policeActors: game.police.map(p => ({ ...p })), blood: game.blood || [], explosionEffects: game.explosionEffects || [], destructionDust: game.destructionDust || [], burningBuildings: game.world.buildings.filter(b => b.fireTimer > 0 || b.smokeTimer > 0).map(b => ({id:b.id,x:b.x,y:b.y,w:b.w,h:b.h,destroyed:b.destroyed,destructionCause:b.destructionCause,fireTimer:b.fireTimer,smokeTimer:b.smokeTimer})), pedestrians: game.world.scenery.filter(p => p.kind === 'pedestrian').map(p => ({ ...p })), projectiles: game.projectiles.map(p => ({ ...p })), weapon: { ...game.weapon }, weaponIndex: game.weaponIndex, shotsFired: game.shotsFired, district: { ...districtFor(game.world, game.player.x, game.player.y) }, radio: { visible: !$('radio').classList.contains('hidden'), speaker: $('radio-name').textContent, line: $('radio-line').textContent, until: radioUntil }, camera: (() => { const { x, y, width, height, elapsed } = cameraFor(game, canvas); return { x, y, width, height, elapsed, zoom: viewZoom }; })(), objective: game.objective, muted, reduced, audioState: audio.context?.state || 'locked', result: game.result }) };
