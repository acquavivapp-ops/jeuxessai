// Synthetic test fixture decoration only; no runtime imports.
// Original afterhours art for the small fictional Corsican town, circa 1994.
// This layer only decorates the engine's existing solid footprints. Streets,
// mission approaches, navigation and collision rectangles remain unchanged.
const WALLS = ['#b1bbb8', '#aaaeb5', '#c3bbaa', '#a9b2b3', '#b9aaa6'];
const SHUTTERS = ['#3a5b64', '#526355', '#735466', '#4d647c', '#5b5d70'];
const ROOFS = ['#a26963', '#8c626c', '#aa776b', '#816276', '#9c706b'];
const SHOP_NAMES = ['ÉPICERIE', 'BAR TABAC', 'PAIN DE MINUIT', 'VIDÉO · K7', 'POISSONNERIE', 'CAFÉ DU QUAI'];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (point, rect, margin = 0) => point.x >= rect.x - margin && point.x <= rect.x + rect.w + margin && point.y >= rect.y - margin && point.y <= rect.y + rect.h + margin;
const intersects = (a, b, margin = 0) => a.x < b.x + b.w + margin && a.x + a.w > b.x - margin && a.y < b.y + b.h + margin && a.y + a.h > b.y - margin;

function districtFor(building) {
  if (building.y > 1100 || (building.x < 700 && building.y > 920)) return 'port';
  if (building.x > 1200) return 'maquis';
  if (building.x > 800 && building.y > 280 && building.y < 730) return 'market';
  return 'citadelle';
}

/** Add a dense, deterministic decorative layer without affecting gameplay. */
export function decorateWorld(world) {
  if (world.visualMeta?.artRevision === 'corsica-afterhours-1994-v2') return world;
  const scenery = world.scenery || (world.scenery = []);
  const buildings = world.buildings || [];
  const roads = world.roads || [];
  const width = world.width || 1500;
  const height = world.height || 1400;
  const approaches = buildings.filter((b) => b.target).map((b) => b.approach).filter(Boolean);
  const rendezvous = { x: 252, y: 1142 };
  let serial = 0;

  // Tiny props live beside the roads and between buildings. In particular the
  // narrow pedestrian route west of the port depot stays visibly clear.
  function safePoint(x, y, radius = 5, { atSea = false } = {}) {
    const point = { x, y };
    if (x - radius < 0 || y - radius < 0 || x + radius > width || y + radius > height) return false;
    if (atSea) return y - radius >= 1340;
    if (y + radius > 1338 || roads.some((r) => inside(point, r, radius + 1))) return false;
    if (buildings.some((b) => inside(point, b, radius + 1))) return false;
    if (approaches.some((p) => distance(point, p) < 31 + radius) || distance(point, rendezvous) < 43 + radius) return false;
    if (x > 291 - radius && x < 335 + radius && y > 996 - radius && y < 1152 + radius) return false;
    return true;
  }

  function add(kind, x, y, extras = {}, radius = 5) {
    x = Math.round(x); y = Math.round(y);
    if (extras.w && extras.h && !extras.atSea) {
      const footprint = { x, y, w: extras.w, h: extras.h };
      if (x < 0 || y < 0 || x + extras.w > width || y + extras.h > 1338) return false;
      if (roads.some((r) => intersects(footprint, r, 2)) || buildings.some((b) => intersects(footprint, b, 2))) return false;
      if (approaches.some((p) => inside(p, footprint, 31)) || inside(rendezvous, footprint, 43)) return false;
      if (intersects(footprint, { x: 291, y: 996, w: 44, h: 156 })) return false;
      scenery.push({ id: `detail-${++serial}`, kind, x, y, ...extras });
      return true;
    }
    if (!safePoint(x, y, radius, extras)) return false;
    if (kind === 'pedestrian') extras = { homeX: x, homeY: y, axis: extras.variant % 2 ? 'vertical' : 'horizontal', ...extras };
    scenery.push({ id: `detail-${++serial}`, kind, x, y, ...extras });
    return true;
  }

  function patch(kind, x, y, w, h, extras = {}) {
    if (x < 0 || y < 0 || x + w > width || y + h > height) return;
    if (roads.some((road) => intersects({ x, y, w, h }, road))) return;
    scenery.push({ id: `detail-${++serial}`, kind, x, y, w, h, ground: true, ...extras });
  }

  buildings.forEach((b, index) => {
    const district = districtFor(b);
    b.district = district;
    b.style = b.target ? 'depot' : district === 'maquis' ? 'country-house' : 'town-house';
    b.wallTone = WALLS[index % WALLS.length];
    b.shutterTone = SHUTTERS[(index + (district === 'port' ? 2 : 0)) % SHUTTERS.length];
    b.roofTone = ROOFS[(index + (district === 'citadelle' ? 1 : 0)) % ROOFS.length];
    b.roofDetails = { chimney: !b.target && index % 4 === 0, antenna: !b.target && index % 4 === 1, satellite: !b.target && index % 13 === 7, waterTank: !b.target && index % 17 === 4 };
    b.balcony = !b.target && index % 7 === 3;
    b.windowGlow = index % 3 === 0 ? '#e9b981' : null;
    if (b.kind === 'shop') {
      b.storefront = true;
      b.sign = SHOP_NAMES[index % SHOP_NAMES.length];
      b.signSource = 'fictional-game-art';
      b.awning = { colors: index % 2 ? ['#426975', '#b9c9c8'] : ['#956272', '#d3b7b3'], edge: 'south' };
    }
    if (b.target) {
      b.sign = { port: 'DÉPÔT DU PORT', village: 'DÉPÔT CITADELLE', market: 'DÉPÔT MARCHÉ' }[b.id] || 'DÉPÔT';
      b.roofDetails = { antenna: true, chimney: false, waterTank: false };
    }
  });

  // Landmarks reuse ordinary house rectangles; a church and a gendarmerie do
  // not acquire a decorative solid extension or an invisible collision wall.
  const landmarks = {
    'house-1': { style: 'mairie', sign: 'MAIRIE', shutterTone: '#375f75', wallTone: '#dbd6b6' },
    'house-2': { style: 'church', sign: 'SANTA MARIA', roofTone: '#bb8058', roofDetails: { chimney: false, antenna: false, waterTank: false } },
    'house-5': { style: 'gendarmerie', sign: 'GENDARMERIE', shutterTone: '#395f83', wallTone: '#ded4b4', roofTone: '#b8704a' },
    'house-9': { style: 'bar', sign: 'BAR DU PORT', storefront: true, awning: { colors: ['#b25242', '#efdbac'], edge: 'south' } },
    'house-10': { style: 'school', sign: 'ÉCOLE', wallTone: '#e2c994' },
    'house-22': { style: 'garage', sign: 'GARAGE 90', shutterTone: '#527674', roofTone: '#8b9690', storefront: true },
    'house-33': { style: 'shop', sign: 'LA MARINE', awning: { colors: ['#416f86', '#e9d8ad'], edge: 'south' } },
    'house-34': { style: 'fishmonger', sign: 'POISSONNERIE', storefront: true, awning: { colors: ['#417986', '#e6dcc1'], edge: 'south' } },
    'house-37': { style: 'cinema', sign: 'CINÉMA REX', shutterTone: '#805045', wallTone: '#dac6a0' },
    'house-40': { style: 'bakery', sign: 'BOULANGERIE', storefront: true, awning: { colors: ['#bc6c49', '#f0dcb0'], edge: 'south' } },
    'house-49': { style: 'post-office', sign: 'LA POSTE', storefront: true, awning: { colors: ['#c99b43', '#eee1b0'], edge: 'south' } },
    'house-60': { style: 'shop', sign: 'CASSETTES · HI-FI', storefront: true },
    'house-61': { style: 'bar', sign: 'CAFÉ DES PÊCHEURS', storefront: true },
    'house-64': { style: 'country-house', sign: 'OLIU · VINU', storefront: true },
  };
  for (const b of buildings) if (landmarks[b.id]) Object.assign(b, landmarks[b.id]);
  const featureSpecs = [
    { id: 'maquis-fm', title: 'MAQUIS FM', theme: 'radio-kiosk', color: '#55d7d2', x: 330, y: 1180 },
    { id: 'pizza-panique', title: 'PIZZA PANIQUE', theme: 'pizzeria', color: '#ff8078', x: 590, y: 1250 },
    { id: 'k7-club', title: 'K7 CLUB', theme: 'cassette-stall', color: '#b09cff', x: 930, y: 540 },
    { id: 'apero-minuit', title: 'APÉRO MINUIT', theme: 'cafe', color: '#ffb488', x: 460, y: 450 },
    { id: 'garage-cousin', title: 'GARAGE DU COUSIN', theme: 'garage', color: '#55d7d2', x: 710, y: 880 },
    { id: 'radio-cassettes', title: 'RADIO · CASSETTES', theme: 'cassette-stall', color: '#b09cff', x: 1370, y: 380 },
  ];
  const used = new Set(), afterhoursScenes = [];
  for (const feature of featureSpecs) {
    const b = buildings.filter((building) => !building.target && !used.has(building.id)
      && !['mairie', 'church', 'gendarmerie', 'school', 'post-office'].includes(building.style))
      .sort((a, c) => distance({ x: a.x + a.w / 2, y: a.y + a.h / 2 }, feature) - distance({ x: c.x + c.w / 2, y: c.y + c.h / 2 }, feature))[0];
    if (!b) continue;
    used.add(b.id);
    Object.assign(b, { sign: feature.title, signSource: 'fictional-game-art', storefront: true,
      neon: { color: feature.color, label: feature.title, side: 'south', intensity: .7 },
      awning: { colors: [feature.color, '#233747'], edge: 'south' }, windowGlow: '#e9b981',
      afterhours: { sceneId: feature.id, theme: feature.theme, fictional: true } });
    afterhoursScenes.push({ ...feature, district: b.district, x: b.x + b.w / 2, y: b.y + b.h, buildingId: b.id, fictional: true });
  }
  roads.forEach((road, index) => { road.name = ['AV. DE LA CITADELLE', 'BOULEVARD PAOLI', 'RUE DU PORT', 'CARRUGHJU VECCHJU', 'RUE DU MARCHÉ', 'STRADA DI U MAQUIS'][index % 6]; });

  // The old citadel and market have broad patterned stone squares. They are
  // flat paving: the engine's existing buildings continue to cover their roofs.
  patch('courtyard', 304, 282, 382, 326, { material: 'limestone', variant: 0 });
  patch('courtyard', 810, 282, 384, 326, { material: 'cobbles', variant: 1 });
  patch('courtyard', 332, 922, 196, 95, { material: 'limestone', variant: 2 });
  patch('courtyard', 116, 946, 63, 146, { material: 'cobbles', variant: 2 });
  patch('courtyard', 301, 1215, 385, 116, { material: 'brick', variant: 3 });
  patch('courtyard', 810, 1215, 384, 116, { material: 'limestone', variant: 2 });
  patch('courtyard', 114, 282, 64, 328, { material: 'limestone', variant: 1 });
  patch('courtyard', 642, 282, 44, 326, { material: 'garden', variant: 4 });
  patch('courtyard', 641, 760, 45, 333, { material: 'garden', variant: 5 });
  patch('courtyard', 1146, 760, 49, 333, { material: 'garden', variant: 5 });
  for (const [y, h] of [[14, 142], [282, 332], [744, 348], [1218, 114]]) {
    patch('courtyard', 1431, y, 64, h, { material: 'garden', variant: 4 });
  }
  patch('courtyard', 1320, 574, 107, 40, { material: 'garden', variant: 6 });

  // Lamps, cast-iron bollards and flower pots repeat as a street vocabulary,
  // rather than placing unconnected random dots throughout the map.
  const verticalSidewalks = [177, 303, 687, 813, 1197, 1323];
  verticalSidewalks.forEach((x, column) => {
    for (let y = 100; y < 1330; y += 114) {
      add('lamppost', x, y, { variant: column % 3 }, 2);
      if ((Math.floor(y / 114) + column) % 2 === 0) add('planter', x, y + 38, { variant: column % 4 }, 3);
    }
  });
  const horizontalSidewalks = [156, 284, 616, 744, 1096, 1224];
  horizontalSidewalks.forEach((y, row) => {
    for (let x = 140; x < 1440; x += 122) {
      if ((row + Math.floor(x / 122)) % 3 === 0) add('tree', x, y, { scale: 0.62, variant: row % 3 }, 8);
      else add('bollard', x, y, { variant: row % 2 }, 2);
    }
  });

  // Back yards and service alleys bring detail to every residential block.
  buildings.filter((b) => !b.target).forEach((b, index) => {
    const sideX = b.x + b.w + 11;
    const sideY = b.y + b.h * 0.65;
    const belowX = b.x + b.w * 0.68;
    const belowY = b.y + b.h + 11;
    add(index % 4 === 0 ? 'parkedbike' : index % 4 === 1 ? 'barrel' : 'planter', sideX, sideY, { variant: index % 5 }, 4);
    if (index % 3 === 0) add('poster', sideX, b.y + 12, { variant: index % 4, text: ['BAL · 94', 'CINÉMA', 'TOURNOI', 'FESTA'][index % 4] }, 4);
    else add('planter', belowX, belowY, { variant: index % 4 }, 4);
    if (index % 7 === 0) add('pedestrian', sideX, b.y + b.h + 11, { variant: index % 8, dir: index % 2 ? 0 : Math.PI, walk: 0, home: { x: sideX, y: b.y + b.h + 11 } }, 5);
  });

  // Immediate surroundings of the start and the port mission are deliberately
  // authored: crates, cafe tables, cyclists and an olive-lined quay.
  [
    ['telephone', 169, 1086, { variant: 1 }, 7],
    ['poster', 177, 1032, { text: 'BAL DU PORT', variant: 1 }, 4],
    ['bench', 153, 1004, { variant: 1 }, 9],
    ['tree', 151, 971, { scale: 0.8, variant: 1 }, 11],
    ['planter', 165, 1074, { variant: 2 }, 4],
    ['parkedbike', 157, 1219, { variant: 0 }, 7],
    ['terrace', 132, 1246, { w: 37, h: 29, variant: 0 }, 20],
    ['pedestrian', 166, 1286, { variant: 3, dir: -Math.PI / 2 }, 5],
    ['pedestrian', 137, 1083, { variant: 6, dir: Math.PI / 2 }, 5],
    ['pedestrian', 177, 1261, { variant: 2, dir: -Math.PI / 2 }, 5],
    ['pedestrian', 383, 1223, { variant: 7, dir: 0 }, 5],
    ['bench', 371, 973, { variant: 0 }, 9],
    ['fountain', 469, 970, { variant: 1 }, 14],
    ['tree', 517, 973, { scale: 0.85, variant: 2 }, 11],
    ['pedestrian', 352, 996, { variant: 5, dir: Math.PI / 2 }, 5],
    ['pedestrian', 408, 967, { variant: 1, dir: 0 }, 5],
    ['barrel', 468, 1042, { variant: 2 }, 5],
    ['barrel', 468, 1057, { variant: 0 }, 5],
    ['parkedbike', 477, 1084, { variant: 1 }, 7],
    ['poster', 466, 1020, { text: '1994', variant: 2 }, 4],
    ['planter', 485, 1100, { variant: 2 }, 4],
    ['pedestrian', 491, 1070, { variant: 4, dir: Math.PI }, 5],
    ['market', 403, 1220, { w: 26, h: 15, variant: 2 }, 10],
    ['terrace', 651, 1253, { w: 32, h: 24, variant: 1 }, 16],
    ['pedestrian', 663, 1290, { variant: 0, dir: Math.PI / 2 }, 5],
  ].forEach(([kind, x, y, extras, radius]) => add(kind, x, y, extras, radius));

  // A market scene around the mission depot and an intimate citadel courtyard.
  [
    ['fountain', 468, 410, { variant: 0 }, 14],
    ['bench', 471, 453, { variant: 0 }, 9],
    ['tree', 482, 325, { scale: 0.8, variant: 1 }, 11],
    ['tree', 658, 336, { scale: 0.9, variant: 2 }, 12],
    ['tree', 663, 577, { scale: 0.9, variant: 2 }, 12],
    ['terrace', 439, 321, { w: 40, h: 29, variant: 1 }, 21],
    ['pedestrian', 475, 373, { variant: 7, dir: Math.PI / 2 }, 5],
    ['pedestrian', 451, 434, { variant: 2, dir: 0 }, 5],
    ['pedestrian', 653, 486, { variant: 0, dir: -Math.PI / 2 }, 5],
    ['pedestrian', 493, 468, { variant: 6, dir: 0 }, 5],
    ['market', 826, 407, { w: 25, h: 18, variant: 0 }, 14],
    ['market', 871, 407, { w: 25, h: 18, variant: 1 }, 14],
    ['market', 917, 407, { w: 25, h: 18, variant: 2 }, 14],
    ['market', 963, 407, { w: 25, h: 18, variant: 3 }, 14],
    ['barrel', 969, 434, { variant: 1 }, 5],
    ['barrel', 981, 434, { variant: 2 }, 5],
    ['pedestrian', 853, 443, { variant: 3, dir: 0 }, 5],
    ['pedestrian', 905, 449, { variant: 0, dir: Math.PI }, 5],
    ['pedestrian', 972, 484, { variant: 5, dir: Math.PI / 2 }, 5],
    ['pedestrian', 982, 565, { variant: 4, dir: Math.PI }, 5],
    ['pedestrian', 1014, 424, { variant: 1, dir: Math.PI / 2 }, 5],
    ['bench', 1006, 585, { variant: 0 }, 9],
    ['tree', 1168, 578, { scale: 0.9, variant: 1 }, 12],
    ['telephone', 1023, 326, { variant: 0 }, 7],
    ['poster', 997, 291, { variant: 3, text: 'FESTA · 94' }, 4],
  ].forEach(([kind, x, y, extras, radius]) => add(kind, x, y, extras, radius));

  // Layered maquis occupies the eastern verge and connected pocket gardens.
  // Individual canopies stay small and leave gaps, unlike a fake solid forest.
  for (let row = 0; row < 24; row++) {
    const y = 33 + row * 54;
    for (let col = 0; col < 2; col++) {
      const x = 1444 + col * 29 + (row % 2 ? 3 : 0);
      add(row % 4 === 0 ? 'tree' : 'bush', x, y + col * 17, { scale: row % 4 === 0 ? 0.85 : 0.7, variant: (row + col) % 3 }, 11);
    }
  }
  for (const x of [662, 1172]) for (let y = 789; y < 1080; y += 47) {
    add('tree', x, y, { scale: 0.78, variant: Math.floor(y / 47) % 3 }, 10);
    add('bush', x - 5, y + 25, { scale: 0.62, variant: 1 }, 7);
  }
  [
    [645, 312, 18, 47], [646, 502, 17, 65], [1155, 805, 23, 41],
    [1438, 596, 43, 25], [118, 505, 29, 16], [116, 920, 39, 15],
    [402, 112, 52, 15], [944, 115, 59, 16], [523, 123, 72, 16],
  ].forEach(([x, y, w, h], i) => patch('flowerbed', x, y, w, h, { variant: i % 4 }));

  // Fishing boats and mooring detail belong exclusively to the sea band.
  for (const [i, x] of [94, 369, 635, 932, 1226, 1418].entries()) {
    const w = i % 2 ? 35 : 29, h = i % 2 ? 14 : 12;
    scenery.push({ id: `detail-${++serial}`, kind: 'boat', x, y: 1363 + (i % 2) * 12, w, h, variant: i % 4, atSea: true });
  }
  for (let x = 39; x < width - 25; x += 123) add('bollard', x, 1330, { variant: 2 }, 3);

  // Reuse the authored street furniture as coherent little business scenes.
  // No new physical footprints, road decorations or actor obstacles are added.
  for (const item of scenery) {
    const scene = afterhoursScenes.reduce((best, candidate) => !best || distance(item, candidate) < distance(item, best) ? candidate : best, null);
    if (scene && distance(item, scene) < 155 && ['market', 'terrace', 'parkedbike', 'poster', 'bench'].includes(item.kind)) {
      item.sceneId = scene.id; item.lightColor = scene.color;
      if (item.kind === 'poster') { item.text = scene.title; item.color = scene.color; }
    }
    if (item.kind === 'parkedbike') { item.theme = item.variant % 3 ? 'scooter' : 'bicycle'; item.color = scene?.color || '#55d7d2'; }
    if (item.kind === 'market') item.theme = item.y > 1100 ? 'radio-kiosk' : 'cassette-stall';
    if (item.kind === 'terrace') item.theme = item.y > 1100 ? 'pizzeria' : 'cafe';
    if (item.kind === 'lamppost') item.lightColor = item.y < 620 ? '#ecc08b' : '#bfd0e5';
  }
  for (const scene of afterhoursScenes) scene.props = scenery.filter((item) => item.sceneId === scene.id).map((item) => item.kind);

  world.visualMeta = {
    artRevision: 'corsica-afterhours-1994-v2', year: 1994,
    setting: 'Ville corse fictive, port, citadelle, marché et maquis',
    layers: ['stone-courtyards', 'terracotta-roofs', 'shopfronts', 'street-furniture', 'clustered-gardens', 'fishing-quay'],
    decorativeOnly: true,
    afterhoursScenes,
    lightingPalette: { moon: '#bfd0e5', warm: '#ecc08b', cyan: '#55d7d2', coral: '#ff8078', violet: '#b09cff' },
  };
  return world;
}
