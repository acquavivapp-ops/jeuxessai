// Original Calvi afterhours art placed around imported geographic footprints.
// Furniture, shop names and costumes are fictional; they are not OSM POIs.
import { districtFor, calviLandmarks, calviPoint } from './universe.js';
const REVISION = 'calvi-municipal-1994-v3';
const CELL = 96;
const LIMITS = Object.freeze({ total: 1100, pedestrian: 80, lamppost: 240, planter: 280, tree: 140, bush: 80, terrace: 24, telephone: 12, poster: 26, boat: 12 });
const TAU = Math.PI * 2;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const length = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const point = ([x, y]) => ({ x, y });
const hash = (index, salt = 0) => {
  let n = Math.imul(index + 1, 374761393) ^ Math.imul(salt + 1, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? clamp(((p.x - a[0]) * dx + (p.y - a[1]) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
  return Math.hypot(p.x - a[0] - dx * t, p.y - a[1] - dy * t);
}

function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if (segmentDistance(p, a, b) < 1e-8) return true;
    if ((a[1] > p.y) !== (b[1] > p.y) && p.x < (b[0] - a[0]) * (p.y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function edgeDistance(p, ring) {
  let nearest = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) nearest = Math.min(nearest, segmentDistance(p, ring[j], ring[i]));
  return nearest;
}

function hitsBuilding(p, radius, b) {
  const ring = b.polygon;
  if (!ring?.length) return p.x > b.x - radius && p.x < b.x + b.w + radius && p.y > b.y - radius && p.y < b.y + b.h + radius;
  if (inRing(p, ring) && !(b.holes || []).some((hole) => inRing(p, hole))) return true;
  return edgeDistance(p, ring) < radius || (b.holes || []).some((hole) => edgeDistance(p, hole) < radius);
}

function gridIndex(items, boundsFor) {
  const cells = new Map();
  items.forEach((item) => {
    const bounds = boundsFor(item);
    for (let y = Math.floor(bounds.y / CELL); y <= Math.floor((bounds.y + bounds.h) / CELL); y++) {
      for (let x = Math.floor(bounds.x / CELL); x <= Math.floor((bounds.x + bounds.w) / CELL); x++) {
        const key = `${x},${y}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(item);
      }
    }
  });
  return (p) => cells.get(`${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`) || [];
}

/** Decorate a valid geographic world while preserving its geometry and POIs. */
export function decorateCalviWorld(world, { bodyClear } = {}) {
  if (world?.metadata?.city !== 'Calvi' || !world.landPolygons?.length || !world.buildings?.length || world.visualMeta?.detailRevision === REVISION) return world;
  const scenery = world.scenery || (world.scenery = []);
  const sourceAreas = scenery.filter(item => item.ground && item.polygon?.length);
  const landmarks = calviLandmarks(world);
  world.visualMeta = { ...world.visualMeta, landmarks };
  const start = world.starts?.player || { x: world.width / 2, y: world.height / 2 };
  const rendezvous = world.starts?.rendezvous || start;
  const missionApproaches = world.buildings.filter((b) => b.target && b.approach).map((b) => b.approach);
  const nearBuildings = bodyClear ? () => [] : gridIndex(world.buildings, (b) => ({ x: b.x - 30, y: b.y - 30, w: b.w + 60, h: b.h + 60 }));
  const segments = [];
  (world.roads || []).forEach((road, roadIndex) => {
    const drive = !road.pedestrian && !['pedestrian', 'footway', 'path', 'steps'].includes(road.type) && Number(road.layer || 0) === 0 && road.tunnel !== 'yes';
    for (let i = 1; i < (road.points || []).length; i++) {
      const a = road.points[i - 1], b = road.points[i];
      if (a[0] !== b[0] || a[1] !== b[1]) segments.push({ a, b, drive, width: Math.max(4, Number(road.width) || 20), roadIndex, segmentIndex: i });
    }
  });
  const nearRoads = gridIndex(segments, (s) => {
    const margin = s.width / 2 + 40;
    return { x: Math.min(s.a[0], s.b[0]) - margin, y: Math.min(s.a[1], s.b[1]) - margin, w: Math.abs(s.b[0] - s.a[0]) + margin * 2, h: Math.abs(s.b[1] - s.a[1]) + margin * 2 };
  });
  const occupied = new Map();
  let serial = 0;
  const counts = {};

  function safeLand(p, radius, moving = false) {
    if (p.x - radius < 0 || p.y - radius < 0 || p.x + radius > world.width || p.y + radius > world.height) return false;
    if (bodyClear) {
      if (!bodyClear({ ...p, angle: 0 }, radius + 1, 0)) return false;
    } else {
      if (!world.landPolygons.some((ring) => inRing(p, ring) && edgeDistance(p, ring) >= radius)) return false;
      if ((world.seaPolygons || []).some((ring) => inRing(p, ring) || edgeDistance(p, ring) < radius)) return false;
      const municipal = world.municipalBoundary?.polygons;
      if (municipal?.length && !municipal.some(({ outer, holes = [] }) => inRing(p, outer) && edgeDistance(p, outer) >= radius && !holes.some(ring => inRing(p, ring) || edgeDistance(p, ring) < radius))) return false;
      if (nearBuildings(p).some((b) => hitsBuilding(p, radius + 1, b))) return false;
    }
    if (nearRoads(p).some((s) => segmentDistance(p, s.a, s.b) < s.width / 2 + (s.drive ? 8 + radius : moving ? 0 : radius + 2))) return false;
    if (length(p, rendezvous) < 43 + radius || missionApproaches.some((p2) => length(p, p2) < 27 + radius)) return false;
    for (const car of world.starts?.cars || []) if (length(p, car) < 24 + radius) return false;
    return true;
  }

  function isOccupied(p, radius) {
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      for (const other of occupied.get(`${x},${y}`) || []) if (length(p, other) < radius + other.clearanceRadius + 5) return true;
    }
    return false;
  }

  function add(kind, x, y, radius = 5, extras = {}) {
    if (serial >= LIMITS.total || LIMITS[kind] !== undefined && (counts[kind] || 0) >= LIMITS[kind]) return false;
    const p = { x: Math.round(x), y: Math.round(y) };
    if (!safeLand(p, radius, kind === 'pedestrian') || isOccupied(p, radius)) return false;
    const item = { id: `calvi-detail-${++serial}`, kind, ...p, clearanceRadius: radius, decorativeOnly: true, fictional: true, ...extras };
    if (extras.w && extras.h) item.clearanceCenter = { ...p };
    if (kind === 'pedestrian') Object.assign(item, { homeX: p.x, homeY: p.y, axis: item.axis || 'horizontal', walk: 0 });
    scenery.push(item);
    const key = `${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`;
    if (!occupied.has(key)) occupied.set(key, []);
    occupied.get(key).push({ ...p, clearanceRadius: radius });
    counts[kind] = (counts[kind] || 0) + 1;
    return true;
  }

  // All shop signs below are invented game labels, never imported addresses.
  const signs = ['CAFÉ DU QUAI', 'ÉPICERIE', 'VIDÉO · K7', 'PAIN DE MINUIT', 'GLACES', 'BAR TABAC'];
  const walls = ['#b1bbb8', '#aaaeb5', '#c3bbaa', '#a9b2b3', '#b9aaa6'];
  const shutters = ['#3a5b64', '#526355', '#735466', '#4d647c', '#5b5d70'];
  const roofs = ['#a26963', '#8c626c', '#aa776b', '#816276', '#9c706b'];
  world.buildings.forEach((b, index) => {
    const tags = b.osmTags || {};
    const district = districtFor(world, b.x + b.w / 2, b.y + b.h / 2);
    b.district = district.id;
    b.wallTone = walls[index % walls.length];
    b.shutterTone = shutters[(index + 2) % shutters.length];
    b.roofTone = roofs[index % roofs.length];
    b.windowGlow = index % 3 === 0 ? '#e9b981' : null;
    b.balcony = !b.target && index % 8 === 3;
    b.roofDetails = { ...b.roofDetails, chimney: index % 5 === 0, antenna: index % 4 === 1, satellite: index % 19 === 7, waterTank: index % 23 === 6 };
    if (b.target || tags.name || tags.amenity || tags.historic || tags.tourism || tags.military) return;
    if (b.kind === 'shop' || index % 23 === 2) {
      b.storefront = true;
      b.sign = signs[index % signs.length];
      b.signSource = 'fictional-game-art';
      b.awning = { colors: index % 2 ? ['#426975', '#b9c9c8'] : ['#956272', '#d3b7b3'], edge: 'south' };
    }
  });

  // Prioritize the port arrival so detail is visible from the opening frame.
  const facades = [];
  world.buildings.forEach((b, buildingIndex) => {
    const ring = b.polygon || [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], c = ring[i], dx = c[0] - a[0], dy = c[1] - a[1], size = Math.hypot(dx, dy);
      if (size < 13) continue;
      const p = { x: (a[0] + c[0]) / 2, y: (a[1] + c[1]) / 2 };
      let nx = -dy / size, ny = dx / size;
      if (inRing({ x: p.x + nx * 2, y: p.y + ny * 2 }, ring)) { nx *= -1; ny *= -1; }
      facades.push({ ...p, nx, ny, size, buildingIndex, edge: i, distance: length(p, start) });
    }
  });
  facades.sort((a, b) => a.distance - b.distance || a.buildingIndex - b.buildingIndex || a.edge - b.edge);
  // Round-robin through geographic neighbourhoods, rather than decorating
  // every facade of the greatly enlarged municipal territory.
  const facadeGroups = new Map();
  for (const facade of facades) {
    const id = world.buildings[facade.buildingIndex].district;
    if (!facadeGroups.has(id)) facadeGroups.set(id, []);
    facadeGroups.get(id).push(facade);
  }
  for (const [id, group] of facadeGroups) {
    const anchor = landmarks.find(item => item.id === id) || start;
    group.sort((a, b) => length(a, anchor) - length(b, anchor));
  }
  const distributedFacades = [];
  const groups = [...facadeGroups.values()];
  for (let i = 0; distributedFacades.length < 3200; i++) {
    let found = false;
    for (const group of groups) if (group[i]) { distributedFacades.push(group[i]); found = true; }
    if (!found) break;
  }

  // Six deliberately grouped, fictional businesses provide recognizable
  // night-life scenes. Their host footprints and geography remain untouched.
  const features = [
    { id: 'maquis-fm', title: 'MAQUIS FM', theme: 'radio-kiosk', color: '#55d7d2', anchor: start },
    { id: 'pizza-panique', title: 'PIZZA PANIQUE', theme: 'pizzeria', color: '#ff8078', anchor: { x: start.x, y: start.y - 230 } },
    { id: 'k7-club', title: 'K7 CLUB', theme: 'cassette-stall', color: '#b09cff', anchor: calviPoint(world, 8.756915, 42.5627) },
    { id: 'apero-minuit', title: 'APÉRO MINUIT', theme: 'cafe', color: '#ffb488', anchor: calviPoint(world, 8.7608, 42.5687) },
    { id: 'garage-cousin', title: 'GARAGE DU COUSIN', theme: 'garage', color: '#55d7d2', anchor: calviPoint(world, 8.75639, 42.5635) },
    { id: 'radio-cassettes', title: 'RADIO · CASSETTES', theme: 'cassette-stall', color: '#b09cff', anchor: calviPoint(world, 8.75681, 42.567) },
  ];
  const featureBuildings = new Set(), featureScenes = [];
  for (const feature of features) {
    if (!feature.anchor) continue;
    const candidates = facades.filter((facade) => {
      const b = world.buildings[facade.buildingIndex], tags = b.osmTags || {};
      return !featureBuildings.has(facade.buildingIndex) && !b.target && b.w >= 24 && b.h >= 20
        && !tags.name && !tags.amenity && !tags.historic && !tags.tourism && !tags.religion && !tags.military;
    });
    candidates.sort((a, b) => length(a, feature.anchor) - length(b, feature.anchor));
    const facade = candidates[0];
    if (!facade) continue;
    const b = world.buildings[facade.buildingIndex];
    featureBuildings.add(facade.buildingIndex);
    const side = Math.abs(facade.nx) > Math.abs(facade.ny) ? facade.nx > 0 ? 'east' : 'west' : facade.ny > 0 ? 'south' : 'north';
    Object.assign(b, {
      sign: feature.title, signSource: 'fictional-game-art', storefront: true,
      neon: { color: feature.color, label: feature.title, side, intensity: .7 },
      awning: { colors: [feature.color, '#233747'], edge: side },
      windowGlow: '#e9b981', afterhours: { sceneId: feature.id, theme: feature.theme, fictional: true },
    });
    const scene = { id: feature.id, title: feature.title, theme: feature.theme, district: b.district, color: feature.color, x: facade.x, y: facade.y, buildingId: b.id, fictional: true, props: [] };
    const tx = -facade.ny, ty = facade.nx;
    const compactKiosk = feature.theme === 'radio-kiosk' || feature.id === 'radio-cassettes';
    const props = feature.theme === 'pizzeria' || feature.theme === 'cafe'
      ? [{ kind: 'terrace', radius: feature.theme === 'cafe' ? 14 : 17, along: 0, offset: 35, extras: { w: feature.theme === 'cafe' ? 20 : 26, h: feature.theme === 'cafe' ? 18 : 20, theme: feature.theme } }, { kind: 'parkedbike', radius: 9, along: 33, offset: 27, extras: { theme: 'scooter', color: feature.color } }]
      : [{ kind: 'market', radius: compactKiosk ? 11 : 16, along: 0, offset: 33, extras: { w: compactKiosk ? 16 : 24, h: compactKiosk ? 12 : 18, theme: feature.theme } }, { kind: 'parkedbike', radius: 9, along: 34, offset: 25, extras: { theme: 'scooter', color: feature.color } }];
    props.push({ kind: 'poster', radius: 7, along: -26, offset: 20, extras: { text: feature.title, theme: feature.theme, color: feature.color } });
    props.push({ kind: 'pedestrian', radius: 5, along: 48, offset: 30, extras: { variant: featureScenes.length % 8, axis: Math.abs(tx) > Math.abs(ty) ? 'horizontal' : 'vertical', sceneId: feature.id } });
    for (const prop of props) {
      const preferred = { x: facade.x + facade.nx * prop.offset + tx * prop.along, y: facade.y + facade.ny * prop.offset + ty * prop.along };
      const locations = [preferred];
      for (const along of [-24, 24, -48, 48, -72, 72, -96, 96]) for (const outward of [0, 20, 40]) {
        locations.push({ x: preferred.x + tx * along + facade.nx * outward, y: preferred.y + ty * along + facade.ny * outward });
      }
      locations.sort((a, b) => length(a, preferred) - length(b, preferred));
      for (const { x, y } of locations) {
        const extras = { ...prop.extras, sceneId: feature.id, lightColor: feature.color, variant: featureScenes.length % 4 };
        if (extras.w && extras.h) Object.assign(extras, { x: Math.round(x - extras.w / 2), y: Math.round(y - extras.h / 2) });
        if (add(prop.kind, x, y, prop.radius, extras)) { scene.props.push(prop.kind); break; }
      }
    }
    featureScenes.push(scene);
  }

  const perBuilding = new Map();
  for (const facade of distributedFacades) {
    const placed = perBuilding.get(facade.buildingIndex) || 0;
    if (placed >= (featureBuildings.has(facade.buildingIndex) ? 2 : 1)) continue;
    const seed = facade.buildingIndex * 13 + facade.edge;
    const preferredKind = ['planter', 'parkedbike', 'barrel', 'poster', 'planter', 'telephone', 'bench'][seed % 7];
    const kind = preferredKind === 'telephone' && (counts.telephone || 0) >= 10 || preferredKind === 'poster' && seed % 4 ? 'planter' : preferredKind;
    const radius = { planter: 6, parkedbike: 8, barrel: 6, poster: 7, telephone: 9, bench: 9 }[kind];
    for (const offset of [radius + 4, radius + 11, radius + 19, radius + 31]) {
      if (add(kind, facade.x + facade.nx * offset, facade.y + facade.ny * offset, radius, { variant: seed % 4, ...(kind === 'parkedbike' ? { theme: seed % 3 ? 'scooter' : 'bicycle' } : {}), ...(kind === 'poster' ? { text: ['FESTA · 94', 'BAL', 'K7 CLUB', 'MAQUIS FM'][seed % 4] } : {}) })) {
        perBuilding.set(facade.buildingIndex, placed + 1);
        break;
      }
    }
    if (serial >= 430) break;
  }

  // Locals near the opening port scene make its first streets feel inhabited.
  let portLocals = 0;
  for (const facade of facades) {
    if (facade.distance > 390 || portLocals >= 7) break;
    const side = facade.buildingIndex % 2 ? 1 : -1;
    for (const offset of [23, 38, 53]) {
      const x = facade.x + facade.nx * offset - facade.ny * side * 23;
      const y = facade.y + facade.ny * offset + facade.nx * side * 23;
      if (!add('pedestrian', x, y, 5, { variant: (facade.buildingIndex + facade.edge * 3 + portLocals) % 8, dir: Math.atan2(facade.nx, -facade.ny), axis: Math.abs(facade.nx) > Math.abs(facade.ny) ? 'vertical' : 'horizontal' })) continue;
      portLocals++; break;
    }
  }

  // A handful of actors per named place, on existing clear land. Their
  // presence is fictional; their neighbourhood anchor is source geography.
  for (const landmark of landmarks) {
    let locals = 0;
    const group = facadeGroups.get(landmark.id) || [];
    for (const facade of group) {
      if (length(facade, landmark) > 1000 || locals >= 8) break;
      for (const offset of [24, 40, 57]) {
        const x = facade.x + facade.nx * offset - facade.ny * 22;
        const y = facade.y + facade.ny * offset + facade.nx * 22;
        if (add('pedestrian', x, y, 5, { variant: (facade.buildingIndex + locals) % 8, nearLandmarkId: landmark.id,
          axis: Math.abs(facade.nx) > Math.abs(facade.ny) ? 'vertical' : 'horizontal' })) { locals++; break; }
      }
    }
  }

  // Street lamps follow the actual road polylines. Their silhouettes sit beyond
  // the road apron, and paired planters/pedestrians form small coherent scenes.
  const segmentGroups = new Map();
  for (const segment of segments) {
    const p = { x: (segment.a[0] + segment.b[0]) / 2, y: (segment.a[1] + segment.b[1]) / 2 };
    const id = districtFor(world, p.x, p.y).id;
    if (!segmentGroups.has(id)) segmentGroups.set(id, []);
    segmentGroups.get(id).push({ segment, proximity: Math.min(length(p, start), ...landmarks.map(anchor => length(p, anchor))) });
  }
  for (const group of segmentGroups.values()) group.sort((a, b) => a.proximity - b.proximity);
  const distributedSegments = [];
  const roadGroups = [...segmentGroups.values()];
  for (let i = 0; distributedSegments.length < 1000; i++) {
    let found = false;
    for (const group of roadGroups) if (group[i]) { distributedSegments.push(group[i].segment); found = true; }
    if (!found) break;
  }
  for (const segment of distributedSegments) {
    const dx = segment.b[0] - segment.a[0], dy = segment.b[1] - segment.a[1], size = Math.hypot(dx, dy);
    if (size < 36) continue;
    const nx = -dy / size, ny = dx / size;
    const spacing = segment.drive ? 210 : 170;
    for (let along = 32; along < size - 16; along += spacing) {
      const t = along / size, p = { x: segment.a[0] + dx * t, y: segment.a[1] + dy * t };
      const seed = segment.roadIndex * 37 + segment.segmentIndex * 13 + Math.floor(along);
      const side = seed % 2 ? 1 : -1;
      const offset = segment.width / 2 + 18;
      const x = p.x + nx * offset * side, y = p.y + ny * offset * side;
      add('lamppost', x, y, 5, { variant: seed % 3, lightColor: districtFor(world, x, y).id === 'old-town' ? '#ecc08b' : '#bfd0e5' });
      if (seed % 3 === 0) add('planter', x + dx / size * 22, y + dy / size * 22, 6, { variant: seed % 4 });
      if ((Math.floor(along / spacing) + segment.roadIndex + segment.segmentIndex) % 4 === 0) {
        add('pedestrian', x - dx / size * 23, y - dy / size * 23, 5, { variant: seed % 8, dir: Math.atan2(dy, dx), axis: Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical' });
      }
    }
    if ((counts.lamppost || 0) >= LIMITS.lamppost && (counts.pedestrian || 0) >= LIMITS.pedestrian) break;
  }

  // Sparse pine/maquis silhouettes belong to imported wooded surfaces. The
  // source polygon is retained; each sprite is only an original game accent.
  const wooded = sourceAreas.filter(area => ['wood', 'forest', 'scrub', 'park', 'garden'].includes(area.areaKind)
    || area.osmTags?.natural === 'wood' || area.osmTags?.landuse === 'forest');
  for (const area of wooded) {
    const xs = area.polygon.map(p => p[0]), ys = area.polygon.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const origin = landmarks.find(anchor => anchor.id === 'pine') || start;
    const candidates = [];
    // A fixed sample budget, independent of the area of the commune.
    for (let i = 0; i < 36; i++) {
      const x = minX + hash(i, area.osmId || area.polygon.length) * (maxX - minX);
      const y = minY + hash(i, (area.osmId || area.polygon.length) + 17) * (maxY - minY);
      if (inRing({ x, y }, area.polygon) && !(area.holes || []).some(ring => inRing({ x, y }, ring))) candidates.push({ x, y });
    }
    candidates.sort((a, b) => length(a, origin) - length(b, origin));
    for (const candidate of candidates) {
      const p = { x: Math.round(candidate.x), y: Math.round(candidate.y) };
      if (!inRing(p, area.polygon) || (area.holes || []).some(ring => inRing(p, ring))) continue;
      if (scenery.some(item => item.kind === 'tree' && length(p, item) < 260)) continue;
      const maquis = area.areaKind === 'scrub';
      add(maquis ? 'bush' : 'tree', p.x, p.y, maquis ? 8 : 12,
        { type: maquis ? 'maquis' : 'pine', sourceAreaId: area.id, sourcePlacement: 'inside-imported-wooded-surface', scale: maquis ? .7 : 1.1, variant: (counts.tree || 0) % 3 });
    }
    if ((counts.tree || 0) >= 95) break;
  }

  // Small olive clusters fit open courtyards rather than covering narrow lanes.
  for (const facade of distributedFacades) {
    const seed = facade.buildingIndex * 11 + facade.edge;
    if (seed % 5 || (counts.tree || 0) >= LIMITS.tree) continue;
    for (const offset of [31, 47, 64]) {
      const x = facade.x + facade.nx * offset, y = facade.y + facade.ny * offset;
      if (scenery.some(item => item.kind === 'tree' && length({ x, y }, item) < 230)) continue;
      if (!add('tree', x, y, 12, { type: 'olive', variant: seed % 3, scale: .8 })) continue;
      const angle = hash(seed, 3) * TAU;
      add('bush', x + Math.cos(angle) * 25, y + Math.sin(angle) * 25, 8, { variant: seed % 3, scale: .62 });
      break;
    }
  }

  // Tables require enough actual open land to contain their whole footprint.
  for (const facade of distributedFacades) {
    if (facade.buildingIndex % 11 !== 3 || (counts.terrace || 0) >= LIMITS.terrace) continue;
    for (const offset of [34, 52, 72]) {
      const x = facade.x + facade.nx * offset, y = facade.y + facade.ny * offset;
      if (add('terrace', x, y, 25, { w: 34, h: 25, variant: facade.buildingIndex % 3, x: Math.round(x - 17), y: Math.round(y - 12) })) break;
    }
  }

  // A few fishing boats are original sprites, entirely inside mapped water.
  const boatCandidates = [];
  const boatAnchor = landmarks.find(anchor => anchor.id === 'port') || start;
  for (let y = Math.max(42, boatAnchor.y - 1000); y < Math.min(world.height - 32, boatAnchor.y + 1200); y += 83) for (let x = Math.max(42, boatAnchor.x - 1000); x < Math.min(world.width - 44, boatAnchor.x + 1200); x += 89) {
    const centre = { x: x + 15.5, y: y + 7 };
    if (world.municipalBoundary?.polygons?.length && !world.municipalBoundary.polygons.some(({ outer, holes = [] }) => inRing(centre, outer) && !holes.some(ring => inRing(centre, ring)))) continue;
    if (!(world.seaPolygons || []).some((ring) => inRing(centre, ring) && edgeDistance(centre, ring) > 20)) continue;
    const corners = [{ x, y }, { x: x + 31, y }, { x, y: y + 14 }, { x: x + 31, y: y + 14 }, { x: x + 15, y: y + 7 }];
    if (corners.every((p) => (world.seaPolygons || []).some((ring) => inRing(p, ring) && edgeDistance(p, ring) > 3))) boatCandidates.push({ x, y, distance: length({ x, y }, start) });
  }
  boatCandidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  const boats = [];
  for (const candidate of boatCandidates) {
    if (boats.some((other) => length(candidate, other) < 130)) continue;
    const boat = { id: `calvi-detail-${++serial}`, kind: 'boat', x: candidate.x, y: candidate.y, w: 31, h: 14, atSea: true, variant: boats.length % 4, decorativeOnly: true, fictional: true };
    scenery.push(boat); boats.push(boat);
    if (boats.length >= LIMITS.boat) break;
  }
  counts.boat = boats.length;
  world.visualMeta = {
    ...world.visualMeta, detailRevision: REVISION,
    detailSource: 'Original Calvi afterhours game art, circa 1994; businesses are fictional, not mapped POIs',
    afterhoursScenes: featureScenes,
    lightingPalette: { moon: '#bfd0e5', warm: '#ecc08b', cyan: '#55d7d2', coral: '#ff8078', violet: '#b09cff' },
    detailCounts: counts, detailLimits: LIMITS, detailDecorativeOnly: true,
  };
  return world;
}
