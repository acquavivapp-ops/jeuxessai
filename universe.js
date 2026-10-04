// Original fictional voices and mission stories for Blue Night.
// Historical cameos deliver invented radio lines, not recorded quotations.
const CREW = Object.freeze([
  Object.freeze({
    id: 'ninu', name: 'Ninu', role: 'Pilote improvisé · calme suspect',
    avatar: 'assets/ninu.svg', accent: '#66e0df',
    line: 'Si le moteur fait du bruit, on baisse la radio.',
    bio: 'Ninu parle peu, freine tard et appelle chaque détour un raccourci. Sous sa cagoule, le même regard tranquille : il a déjà décidé que tout était sous contrôle.',
  }),
  Object.freeze({
    id: 'anto', name: 'Antò', role: 'Voix de Maquis FM · expert en face B',
    avatar: 'assets/anto.svg', accent: '#ff8b7b',
    line: 'J’ai enregistré le plan. Face B. Sous les polyphonies.',
    bio: 'Antò a une cassette pour chaque situation et un commentaire pour chaque silence. Il annonce les virages après les virages, avec une confiance admirable.',
  }),
]);

export const UNIVERSE = {
  city: 'Calvi', region: 'Balagne', year: 1994,
  hero: 'Ninu', companion: 'Antò', radio: 'Radio Maquis FM',
  chapter: 'Calvi Afterhours',
  tagline: 'La nuit est longue. Les raccourcis aussi.',
  crew: CREW,
  opening: 'Été 1994, après minuit. Calvi garde les néons allumés et les volets fermés. Ninu conduit au bruit du moteur ; Antò couvre le moteur avec Maquis FM. Au programme : une cassette coincée, des inaugurations en série et un rendez-vous sur le port. Ils avaient prévu une petite virée. Personne n’a pensé à prévenir les képis.',
};

export const MISSIONS = [
  { id: 'port', title: 'Le hangar fantôme', place: 'Le port', line: 'Trois inaugurations, quatre buffets. Toujours aucun hangar en service.', brief: 'Le dépôt du port collectionne les rubans coupés. Choisis une approche à pied, garde une sortie dégagée et éloigne-toi du cercle orange après la pose. Ninu préfère repartir avant le quatrième discours.' },
  { id: 'village', title: 'Le bureau des tampons', place: 'La vieille ville', line: 'Pour obtenir le formulaire, il faut le formulaire qui autorise les formulaires.', brief: 'Dans les ruelles, le trajet de retour compte autant que l’arrivée. Le bureau conserve le dossier du dossier dans un troisième dossier. Repère la sortie avant d’agir ; les étoiles annoncent la recherche.' },
  { id: 'market', title: 'La réserve de parpaings', place: 'Le marché', line: 'Vue sur mer garantie. Même pour le parpaing du fond.', brief: 'Le dépôt du marché promet une terrasse à chaque bloc. Choisis ta route et ton stationnement. Après les trois affaires, rejoins le point vert du port, à pied ou en voiture. Antò s’occupe de la face B.' },
];

export const CAMEOS = [
  { id: 'simeoni', name: 'Edmond Simeoni', role: 'Médecin et figure de la vie politique corse', line: 'À force d’inaugurer des hangars vides, on finit par manquer de rubans.' },
  { id: 'guelfucci', name: 'Petru Guelfucci', role: 'Chanteur corse', line: 'La cassette grésille, la voiture tousse : un duo prometteur.' },
  { id: 'mitterrand', name: 'François Mitterrand', role: 'Président de la République en 1994', line: 'Le dossier avance. Surtout quand il est dans le coffre.' },
  { id: 'pasqua', name: 'Charles Pasqua', role: 'Ministre de l’Intérieur en 1994', line: 'On m’annonce un rond-point, trois étoiles et beaucoup de demi-tours.' },
];

export function missionFor(id) { return MISSIONS.find(mission => mission.id === id) || null; }

/** Visual neighbourhood identities, not surveyed or administrative boundaries. */
export const DISTRICTS = Object.freeze([
  Object.freeze({ id: 'port', name: 'LE PORT · AFTERHOURS', tagline: 'Néons dans l’eau. Face B dans l’autoradio.', accent: '#66e0df' }),
  Object.freeze({ id: 'citadel', name: 'LA CITADELLE', tagline: 'La vue est calme. La montée, moins.', accent: '#e9c080' }),
  Object.freeze({ id: 'old-town', name: 'LES CARRUGHJI', tagline: 'Chaque ruelle connaît un autre raccourci.', accent: '#c392d9' }),
  Object.freeze({ id: 'market', name: 'LE MARCHÉ · DERNIER SERVICE', tagline: 'Volets baissés. Enseignes encore éveillées.', accent: '#ff8b7b' }),
  Object.freeze({ id: 'station', name: 'LA GARE DE CALVI', tagline: 'Le train a son horaire. Antò a sa cassette.', accent: '#9fb8d1' }),
  Object.freeze({ id: 'beach', name: 'LA PLAGE DE CALVI', tagline: 'Du sable dans les baskets. Des refrains dans la tête.', accent: '#e9c080' }),
  Object.freeze({ id: 'pine', name: 'LA PINÈDE', tagline: 'Les pins font de l’ombre. Ninu cherche une place.', accent: '#83b793' }),
  Object.freeze({ id: 'revellata', name: 'LA REVELLATA', tagline: 'Le chemin est long. La vue le sait.', accent: '#92bcb0' }),
  Object.freeze({ id: 'airport', name: 'CALVI · SAINTE-CATHERINE', tagline: 'Décollages à l’horaire. Départs improvisés.', accent: '#b5bbd4' }),
]);

// WGS84 points read from the archived OSM extract. For ways these are means
// of the source outline's vertices, useful for labels, not surveyed entrances.
const SOURCE_ANCHORS = [
  { id: 'port', name: 'Port de Calvi', longitude: 8.75840376511628, latitude: 42.56531287441861, osmId: 1089009698, osmType: 'way', positionMethod: 'source-outline-centre' },
  { id: 'citadel', name: 'Citadelle de Calvi', longitude: 8.76039021641791, latitude: 42.56835080597015, osmId: 129908171, osmType: 'way', positionMethod: 'source-outline-centre' },
  { id: 'station', name: 'Gare de Calvi', longitude: 8.7559822, latitude: 42.5646305, osmId: 59740284, osmType: 'node', positionMethod: 'source-node' },
  { id: 'beach', name: 'Plage de Calvi', longitude: 8.76006067586207, latitude: 42.558933286206894, osmId: 622379633, osmType: 'way', positionMethod: 'source-outline-centre', displayNameSource: 'game-label-for-unnamed-source-beach' },
  { id: 'pine', name: 'La Pinède', longitude: 8.774430085714284, latitude: 42.55597528412698, osmId: 40323298, osmType: 'way', positionMethod: 'source-outline-centre' },
];
const DISTRICT_CACHE = new WeakMap();

function insideRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], span = dx * dx + dy * dy;
    const t = span ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / span)) : 0;
    // Source vertices and imported boundaries are rounded to hundredths of
    // a map unit. Keep a shared boundary vertex eligible as a map label.
    if ((x - a[0] - dx * t) ** 2 + (y - a[1] - dy * t) ** 2 <= .05 ** 2) return true;
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Same north-up local projection as the imported map, without changing it. */
export function calviPoint(world, longitude, latitude) {
  const b = world?.metadata?.bounds;
  if (world?.metadata?.city !== 'Calvi' || !b || !Number.isFinite(longitude) || !Number.isFinite(latitude)
    || !(b.east > b.west) || !(b.north > b.south) || !(world.width > 0) || !(world.height > 0)) return null;
  const x = (longitude - b.west) / (b.east - b.west) * world.width;
  const y = (b.north - latitude) / (b.north - b.south) * world.height;
  if (x < 0 || y < 0 || x > world.width || y > world.height) return null;
  const polygons = world.municipalBoundary?.polygons;
  if (polygons?.length && !polygons.some(({ outer, holes = [] }) => insideRing(x, y, outer) && !holes.some(ring => insideRing(x, y, ring)))) return null;
  return { x, y };
}

/** Source place labels; they never add buildings or collisions. */
export function calviLandmarks(world) {
  const places = world?.places || [];
  const landmarks = [];
  for (const anchor of SOURCE_ANCHORS) {
    let imported = places.find(place => String(place.osmId) === String(anchor.osmId) && (!place.osmType || place.osmType === anchor.osmType));
    const b = world?.metadata?.bounds;
    const projectSourcePoint = ([x, y]) => calviPoint(world, b.west + x / world.width * (b.east - b.west), b.north - y / world.height * (b.north - b.south));
    // Unnamed beaches are source surfaces rather than named POIs. Keep the
    // chosen label on an actual retained source vertex when the mean is sea.
    if (!imported && b) {
      const area = (world.scenery || []).find(area => area.ground && String(area.osmId) === String(anchor.osmId) && area.polygon?.length);
      const vertex = area?.polygon.find(point => projectSourcePoint(point));
      if (vertex) imported = { x: vertex[0], y: vertex[1], positionMethod: 'actual source-area vertex within municipality; label only' };
    }
    let p = imported && b && Number.isFinite(imported.x) && Number.isFinite(imported.y)
      ? calviPoint(world, b.west + imported.x / world.width * (b.east - b.west), b.north - imported.y / world.height * (b.north - b.south))
      : calviPoint(world, anchor.longitude, anchor.latitude);
    // The administrative coastline can exclude the marina basin. A port
    // neighbourhood label then uses the nearest actual retained street point,
    // explicitly distinct from a surveyed marina position or entrance.
    let sourceRoadId = null;
    if (!p && anchor.id === 'port' && b) {
      const x = (anchor.longitude - b.west) / (b.east - b.west) * world.width;
      const y = (b.north - anchor.latitude) / (b.north - b.south) * world.height;
      const candidates = (world.roads || []).flatMap(road => (road.points || []).map(point => ({ point, roadId: road.id, d: (point[0] - x) ** 2 + (point[1] - y) ** 2 })));
      candidates.sort((a, b) => a.d - b.d);
      for (const candidate of candidates.slice(0, 200)) {
        p = projectSourcePoint(candidate.point);
        if (p) { sourceRoadId = candidate.roadId; break; }
      }
    }
    if (!p) continue;
    const longitude = b.west + p.x / world.width * (b.east - b.west);
    const latitude = b.north - p.y / world.height * (b.north - b.south);
    landmarks.push({ ...anchor, ...p, longitude, latitude, source: 'OpenStreetMap', ...(imported ? { positionMethod: imported.positionMethod || 'imported-source-position' } : {}),
      ...(sourceRoadId ? { sourceRoadId, approximate: true, positionMethod: 'neighbourhood label on nearest actual source street; marina geometry remains unchanged' } : {}) });
  }
  for (const [id, expression] of [['revellata', /(?:pointe|phare|cap).*revellata|^revellata$/i], ['airport', /(?:aéroport|airport|aerodrome).*(?:calvi|sainte.catherine)|calvi.*(?:aéroport|airport|sainte.catherine)/i]]) {
    const imported = places.find(place => expression.test(place.name || place.osmTags?.name || '') && Number.isFinite(place.x) && Number.isFinite(place.y));
    if (!imported) continue;
    const b = world.metadata.bounds;
    const longitude = b.west + imported.x / world.width * (b.east - b.west);
    const latitude = b.north - imported.y / world.height * (b.north - b.south);
    if (!calviPoint(world, longitude, latitude)) continue;
    landmarks.push({ id, name: imported.name || imported.osmTags.name, x: imported.x, y: imported.y,
      longitude, latitude, osmId: imported.osmId, osmType: imported.osmType,
      source: 'OpenStreetMap', positionMethod: imported.positionMethod || 'imported-source-position' });
  }
  return landmarks;
}

/** Deterministic approximate art zones over existing, unchanged geography. */
export function districtFor(world, x, y) {
  const width = world?.width, height = world?.height;
  const bounds = world?.metadata?.bounds;
  if (world?.metadata?.city !== 'Calvi' || !(width > 0) || !(height > 0)
    || !Number.isFinite(x) || !Number.isFinite(y) || !bounds
    || !['west', 'south', 'east', 'north'].every(key => Number.isFinite(bounds[key]))
    || !(bounds.east > bounds.west) || !(bounds.north > bounds.south)) return DISTRICTS[0];
  const landmarkRef = world.visualMeta?.landmarks;
  let cached = DISTRICT_CACHE.get(world);
  if (!cached || cached.bounds !== bounds || cached.width !== width || cached.height !== height || cached.landmarks !== landmarkRef || cached.boundary !== world.municipalBoundary) {
    const landmarks = landmarkRef || calviLandmarks(world);
    cached = { bounds, width, height, landmarks: landmarkRef, boundary: world.municipalBoundary,
      centres: [...landmarks, { id: 'old-town', ...calviPoint(world, 8.75681, 42.567) }, { id: 'market', ...calviPoint(world, 8.756915, 42.5627) }] };
    DISTRICT_CACHE.set(world, cached);
  }
  const centres = cached.centres;
  let closest = 'port', separation = Infinity;
  for (const centre of centres) {
    if (!Number.isFinite(centre.x) || !Number.isFinite(centre.y)) continue;
    const d = (x - centre.x) ** 2 + (y - centre.y) ** 2;
    if (d < separation) { closest = centre.id; separation = d; }
  }
  return DISTRICTS.find(district => district.id === closest) || DISTRICTS[0];
}

// Original station banter and invented local adverts. No historical quotes.
export const STREET_RADIO = Object.freeze([
  Object.freeze({ id: 'station-afterhours', speaker: 'MAQUIS FM · 94.0', line: 'Après minuit, on baisse les lumières. Antò, baisse aussi le volume.' }),
  Object.freeze({ id: 'anto-navigation', speaker: 'ANTÒ · FACE B', avatar: 'assets/anto.svg', line: 'Ninu, j’ai trouvé le plan ! Il était dans la pochette. C’est la liste des chansons.', district: 'old-town' }),
  Object.freeze({ id: 'garage-two-chances', speaker: 'PUB · GARAGE DU COUSIN', line: 'Votre moteur tousse ? On règle l’autoradio jusqu’à ce que vous ne l’entendiez plus.' }),
  Object.freeze({ id: 'port-parking', speaker: 'NINU · AU VOLANT', avatar: 'assets/ninu.svg', line: 'Je ne suis pas mal garé. Je suis prêt à partir.', district: 'port' }),
  Object.freeze({ id: 'club-last-turn', speaker: 'PUB · K7 CLUB', line: 'Au K7 Club, on rembobine vos soirées. Frais de retard : deux jours de polyphonies.', district: 'market' }),
  Object.freeze({ id: 'citadel-lookout', speaker: 'MAQUIS FM · MÉTÉO', line: 'Grand calme sur la citadelle. Sauf la voiture d’Antò, qui tente encore la montée en troisième.', district: 'citadel' }),
  Object.freeze({ id: 'k7-rescue', speaker: 'ANTÒ · SERVICE TECHNIQUE', avatar: 'assets/anto.svg', line: 'La cassette est réparée. Il reste six mètres de chanson sur mes genoux.' }),
  Object.freeze({ id: 'market-last-service', speaker: 'PUB · PIZZA PANIQUE', line: 'Pizza Panique, livraison après minuit. Si le livreur trouve un raccourci, elle arrive avant demain.', district: 'market' }),
  Object.freeze({ id: 'ninu-shortcut', speaker: 'NINU · ITINÉRAIRE BIS', avatar: 'assets/ninu.svg', line: 'Ce n’est pas un détour. Le raccourci prend son temps.', district: 'old-town' }),
  Object.freeze({ id: 'ribbon-services', speaker: 'PUB · RUBANS & CIE', line: 'Une inauguration ratée ? Gardez le buffet. Nous fournissons le deuxième ruban.', district: 'port' }),
  Object.freeze({ id: 'radio-silence', speaker: 'MAQUIS FM · PROGRAMME', line: 'Dans un instant : une minute de silence. Antò a promis d’essayer.' }),
  Object.freeze({ id: 'ninu-reverse', speaker: 'NINU · MÉCANIQUE', avatar: 'assets/ninu.svg', line: 'La marche arrière ? C’est la marche avant avec une meilleure vue sur les problèmes.' }),
  Object.freeze({ id: 'station-timetable', speaker: 'ANTÒ · HORAIRES', avatar: 'assets/anto.svg', line: 'Le train attend rarement les passagers. Ninu, lui, attend que je retrouve la face A.', district: 'station' }),
  Object.freeze({ id: 'beach-sand', speaker: 'NINU · BORD DE MER', avatar: 'assets/ninu.svg', line: 'La mer a fait le plein. Nous, pas encore.', district: 'beach' }),
  Object.freeze({ id: 'pine-parking', speaker: 'MAQUIS FM · LA PINÈDE', line: 'À l’ombre des pins, la cassette chauffe moins vite que le conducteur.', district: 'pine' }),
  Object.freeze({ id: 'revellata-turn', speaker: 'ANTÒ · GRAND TOUR', avatar: 'assets/anto.svg', line: 'La Revellata, c’est le raccourci panoramique. On reconnaît l’idée de Ninu.', district: 'revellata' }),
  Object.freeze({ id: 'airport-arrivals', speaker: 'MAQUIS FM · ARRIVÉES', line: 'À Sainte-Catherine, certains décollent. Antò cherche toujours sa valise.', district: 'airport' }),
]);
