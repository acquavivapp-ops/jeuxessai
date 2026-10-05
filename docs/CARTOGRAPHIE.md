# Calvi v20 : commune, repères et limites

La carte couvre la commune de **Calvi, INSEE 2B050**, selon la **relation administrative OpenStreetMap 1151255**. Le contour comprend cinq polygones, îlots compris, pour environ **31,614 km²** calculés dans la projection locale. Il s’agit d’une représentation OSM, pas d’un relevé cadastral certifié.

La v20 affine le décor **dessiné en 2,5D** de ce monde existant : sol, routes, mer, toits, façades et végétation sont illustrés. La [comparaison historique v19](calvi-illustrated-geometry-validation.json) documente la conservation des coordonnées, tracés, empreintes, relief, silhouettes et observations face à v18. La [comparaison v20](calvi-v20-geometry-validation.json), code 0, confirme la même géométrie physique de base, les 41 sources et les 251 placements observés. La v20 ajoute des repères visuels issus des archives, distincts de cette géométrie conservée ; les autres contrôles finaux sont consignés séparément. La photographie IGN reste une source archivée ; elle ne constitue plus le fond, les toits ou le feuillage affichés. L’atlas de matières est une illustration, jamais une source de géométrie.

L’emprise rectangulaire en WGS84 est **8.7063593, 42.5150237, 8.8153936, 42.5844865** (ouest, sud, est, nord). Elle mesure environ **8,94 × 7,73 km**, soit **35 766,74 × 30 930,25 pixels logiques** à quatre pixels par mètre. Ce rectangle ne doit pas être confondu avec la superficie du polygone communal. Les déplacements à pied, les véhicules terrestres et les atterrissages respectent le contour et ses trous. Le littoral limite la marche, avec une exception étroite pour les six pontons OSM réels décrits ci-dessous ; leurs corridors ne réécrivent pas les polygones terrestres. Les bateaux peuvent naviguer dans la mer adjacente du rectangle ; les appareils peuvent le survoler. Calvi est l’unique carte ; une géométrie communale absente ou invalide bloque le démarrage.

## Vecteurs et reproduction

Quatre téléchargements OSM couvrent la commune, car une requête unique dépassait la limite de nœuds du service. Les objets sont fusionnés par type, identifiant et version source ; aucune géométrie manquante n’est fabriquée. Les requêtes ne constituent pas un instant global unique. Archives séparées, archive fusionnée, identifiants et empreintes sont fournis.

Le module charge **1 552 tronçons routiers, 3 893 empreintes bâties, 313 aires et 28 repères source** sur l’emprise. Les contours littoraux et cours intérieures sont conservés. Le port de départ et les trois dépôts de fiction gardent leurs coordonnées géographiques et leurs empreintes source malgré le changement d’origine du monde.

Reproduction hors réseau depuis la racine :

```bash
python3 tools/import-calvi.py \
  --input data/calvi-osm.xml.gz \
  --boundary data/calvi-boundary.geojson \
  --download-provenance data/calvi-osm-download-provenance.json \
  --source-url 'https://api.openstreetmap.org/api/0.6/map?bbox=8.706159300000001,42.5148237,8.760876450000001,42.5497551'
```

La dernière URL désigne la première requête ; le manifeste conserve les quatre et leurs dates. Pour actualiser explicitement les sources, exécuter `python3 tools/download-osm-municipality.py --download`, puis l’import ci-dessus. Le contour et sa provenance sont fournis dans [calvi-boundary.geojson](../data/calvi-boundary.geojson) et [calvi-boundary-provenance.json](../data/calvi-boundary-provenance.json). Les commandes complètes figurent dans [SOURCES.md](../data/SOURCES.md).

## Repères source ajoutés en v20

[calvi-architecture.js](../data/calvi-architecture.js) reprend le périmètre des murailles sur **67 nœuds de l’archive OSM**, projetés par la même formule que la carte. Leur **largeur de 3 m et hauteur de 10 m sont estimées**. Le tracé décoratif conserve les collisions de base. Huit bâtiments repères sont identifiés dans les empreintes déjà présentes ; le tag source de la cathédrale signale lui-même un contour approximatif.

L’aéroport reçoit **30 références OSM : deux pistes, deux aires et 26 taxiways, soit 376 points source**. Dix références possèdent une largeur explicite. La piste 8113537 porte le tag **45 m** ; un segment sans largeur peut recevoir un raccord artistique, sans transformer cette décision en dimension source. Les axes fermés ne sont pas remplis comme des surfaces en l’absence d’un tag approprié. Ces couches sont visuelles et ne remplacent pas les rues, bâtiments, littoral ou collisions importés.

[calvi-roof-observations.js](../data/calvi-roof-observations.js) conserve **3 219 palettes de couleur retenues**, sur les identifiants et empreintes bâties existants. Elles proviennent de **83 200 échantillons dans 193 JPEG IGN dont les SHA-256 sont vérifiés**. Les échantillons de végétation et pixels très sombres sont écartés ; les profils de faible confiance ne sont pas utilisés. La couleur ne mesure ni matériau ni forme : un gris ne prouve pas un toit plat ou métallique. Les toits sans information exploitable restent artistiques. Les pixels photographiques ne sont pas affichés dans le jeu.

## Relief, hauteurs et photographie archivée

Le **MNT IGN LiDAR HD** couvre la commune sur **449 × 388** points, à environ **20 mètres**. Ses **79 276 nœuds terrestres communaux sont tous valides** ; les **94 936 autres** sont explicitement nuls, hors commune ou en mer. Les altitudes importées vont de **−0,440 à 701,625 mètres**. Les cellules manquantes offshore ne sont ni interprétées comme une bathymétrie ni remplacées par des montagnes inventées.

L’ancien extrait LiDAR urbain **173 × 224 à environ 5 mètres** reste à ses véritables bornes. Le moteur y échantillonne en WGS84 et interpole une bande de transition de 40 mètres avec le fond communal ; cette fusion est dérivée, pas une nouvelle précision de relevé. Le **SRTM de secours**, extrait de la source archivée N42E008, est régénéré sur la commune en **394 × 252** points. Voir [ELEVATION.md](../data/ELEVATION.md).

L’atlas aérien archivé **IGN BD ORTHO**, affiché par les versions v17/v18 et utilisé comme référence pour les observations, conserve deux niveaux de photographie réelle :

| Couverture | Pas d’export demandé | Tuiles locales |
|---|---:|---:|
| Rectangle communal entier, référence de 17 884 × 15 466 pixels | Environ 0,50 m/pixel | 288 |
| Centre, port, citadelle, pinède, entrée Est et aéroport, sur deux régions de 23,875 km² | 0,25 m/pixel | 410 |
| **Total** | **Deux niveaux** | **698** |

Ces pas décrivent les exports WMS demandés ; ils ne certifient ni la résolution native ni la précision locale de la photographie. Les **178 réponses JPEG originales**, leurs requêtes et leurs empreintes sont conservées. Elles sont découpées sans redimensionnement en tuiles de 1 024 × 1 024 pixels au maximum. Les **122 108 095 octets** de tuiles compressées correspondent au stockage local, pas à la mémoire résidente. Le réencodage JPEG peut introduire de faibles différences de pixels ; aucun détail géographique n’est généré. Voir [CALVI_IMAGERY_TILES.md](../data/CALVI_IMAGERY_TILES.md).

Des [exports diagnostiques des mêmes petites emprises](../data/calvi-imagery-resolution-comparison.json), réellement demandés à 0,50, 0,25 et 0,20 m/pixel, conservent leurs réponses originales. Le détail à 0,25 m rend mieux les contours et marquages du port et de la pinède. Le passage à 0,20 m ajoute peu de détail visuel pour davantage de pixels ; il n’a pas été retenu dans l’ancien fond photographique. Aucun de ces niveaux n’est utilisé comme matière visible par le rendu v20.

Le sol v20 est dessiné selon les surfaces et contours importés ; les routes suivent leurs axes, et les bâtiments gardent leurs empreintes OSM, cours intérieures comprises. Toits et façades sont illustrés sur leurs volumes ; le terrain reste projeté selon le MNT. Ces couches conservent des sources distinctes : l’image aérienne archivée ne mesure ni l’altitude du terrain, ni la hauteur des bâtiments ou des arbres. Des décalages locaux entre catalogues restent possibles, notamment lorsque leurs millésimes diffèrent. Le traitement graphique ne les transforme pas en correspondances certifiées.

Les positions et silhouettes de végétation s’appuient sur les observations des pixels IGN et des masques OSM, complétées par **28 couronnes sombres observées près de la place du port**, absentes du détecteur de verts. Les houppiers v20 sont dessinés sur ces silhouettes conservées, avec un volume artistique. Ces groupes ne constituent pas un inventaire exact d’arbres individuels ; leurs hauteurs et les implantations des petits troncs restent estimées. Le corps du tronc fait obstacle sans transformer toute la couronne en mur. Le maquis bas ralentit la traversée et masque les jambes ; les grands buissons peuvent faire obstacle. Le feuillage masque localement les acteurs à la profondeur appropriée. Pied du tronc et ombre restent au sol ; la couronne élevée passe devant les acteurs concernés.

Certains véhicules visibles dans les parkings, le port et l’aéroport ont été repérés manuellement sur la photographie. Ils restent des voitures, bateaux ou avions physiques accessibles avec **E**, à leurs positions source. Seuls les placements retenus après contrôle de leur source et de leur accès sont utilisés ; cette couverture n’est pas exhaustive sur toute la commune. Le sol dessiné ne contient plus les silhouettes fixes de la photographie ; les masques de remplacement historiques restent des métadonnées archivées, sans application au rendu v20. Les photographies sources restent intactes. La voiture possédée au départ correspond à l’observation `photo-car-port-04` ; l’observation `photo-car-port-05` fournit une autre voiture volable.

Les observations d’avions sont distinguées du contour administratif : **deux avions photographiés dans Calvi** peuvent rejoindre le jeu, tandis que **quatre observations au sud de l’aéroport, hors des polygones INSEE 2B050**, sont conservées dans les archives sans être activées. Leur présence dans le rectangle photographique ne les rend pas communales. Les dates locales de prise de vue restent inconnues.

L’ancien aperçu photographique de **1 024 × 886 pixels**, dérivé de la réponse réelle de **4 096 × 3 542 pixels**, couvrait la commune pendant l’arrivée des tuiles v17/v18 et les secteurs HD non consultés hors ligne. Cette réponse et sa provenance restent archivées ; elle n’était pas agrandie pour fabriquer du détail et n’est plus le fond de secours v20. Voir [CALVI_IMAGERY.md](../data/CALVI_IMAGERY.md).

Les sources **IGN BD TOPO** donnent **1 355 hauteurs raccordées** par correspondance conservatrice des empreintes. Les **2 538 autres** gardent une hauteur IGN inconnue et utilisent un gabarit artistique ou une indication OSM exploitable. L’extrait OSM contient 24 indications d’étages, aucune hauteur en mètres. Les façades, les toits dessinés, leur organisation visuelle et les volumes non renseignés restent artistiques ; le nouvel habillage ne constitue pas un relevé 3D de leur forme. Voir [BUILDING_HEIGHTS.md](../data/BUILDING_HEIGHTS.md).

Les dates locales d’acquisition IGN et la référence verticale exacte du MNT ne sont pas établies. La géographie actuelle ne prouve pas l’état de Calvi en 1994.

## Rendu et jouabilité

La projection garde le nord en haut. Le relief produit un décalage vertical de **1,4 pixel par mètre**, distinct de l’échelle horizontale. Ce facteur est artistique. Les déplacements et collisions terrestres restent calculés dans le plan ; l’altitude des appareils est suivie séparément pour le vol, la projection, les tirs et l’atterrissage. Il n’y a pas de caméra 3D libre ni de niveaux de bâtiments superposés.

Les routes visibles ont une matière dessinée, ancrée sur leurs tracés conservés. Les largeurs des voies utilisées pour circulation et collisions restent estimées par catégorie, pas mesurées sur un cadastre. **Six axes de pontons OSM réels** sont archivés et accessibles à pied avec une largeur de jeu estimée sur la photographie de **10 pixels du monde, soit 2,5 m**. Cette largeur n’est pas une mesure topographique et les axes ne deviennent pas des routes pour les voitures. Les volumes se règlent sur les hauteurs disponibles, avec transparence du toit lorsqu’il masque le joueur dans la rue.

Le rendu v20 désactive le flux photographique et utilise le PNG local de matières dessinées. Ses caches sont bornés à **32 Mio pour le sol, 16 Mio pour les toits et carrosseries réunis et 4 Mio pour le feuillage**. Les carrosseries occupent **au plus 4 Mio inclus dans les 16 Mio**, sans enveloppe supplémentaire ; ces plafonds ne représentent pas la mémoire totale du navigateur et n’annoncent pas une cadence. L’ancien flux v17/v18 à quatre tuiles photographiques et son aperçu ne sont plus demandés pour afficher la partie. La v20 ajoute la réutilisation des carrosseries et palettes pour limiter le travail répété. La comparaison isolée est liée dans le rapport v20 ; ses courtes fenêtres ne constituent pas une preuve générale de conduite fluide. Le bitmap de l’écran garde une taille stable pendant le zoom et le jeu ne crée pas un canevas géant de Calvi. La mini-carte garde une vue d’ensemble.

La mer utilise une matière dessinée, avec un léger clapotis animé sur les surfaces d’eau conservées. Cette animation suit le temps actif du jeu et se fige en pause ; elle ne représente ni une bathymétrie ni une mesure météorologique réelle.

Les voitures garées et passants sont placés pour le jeu sur des accès vérifiés. Des stationnements utilisent des aires OSM ; leurs acteurs fictifs restent distingués des observations photographiques. Une **moto**, un **bateau de départ** et un **hélicoptère** sont accessibles dans le secteur du port ; un **avion initial** se trouve sur une aire réelle de l’aéroport. Bateaux et avions observés complètent ces placements après contrôle d’accès. Aucun héliport ou accès aéronautique certifié n’est revendiqué.

La coque du bateau respecte le vrai littoral ; embarquer et sortir demandent un accès proche et praticable, sans traverser mur ou tronc par simple proximité. Un appareil peut atterrir sur un sol dégagé de la commune avant la sortie ; l’avion demande aussi une approche libre. Il est également possible de sauter en vol avec **E/Entrée ou SAUTER**, puis d’ouvrir le parachute avec **Espace ou PARACHUTE** et de diriger la descente. La chute ne crée ni sol praticable en mer ni téléportation vers la terre : le contact doit respecter les contraintes du monde. Passants et policiers à pied se déplacent sur le sol praticable au-delà du seul graphe routier, en respectant bâtiments, végétation physique, littoral et limite communale. Les barrages exigent une largeur suffisante, une clairance et un préavis ; leurs véhicules sont destructibles. Le terrain influe modérément sur la vitesse, tandis que les règles de poursuite et dégâts restent arcade.

## Inventaire photographique v17

Cette section décrit les observations et traitements du décor photographique v17. Positions, sources et corps physiques restent conservés en v20 ; les découpes photographiques et masques décrits ici ne sont plus appliqués à son décor dessiné.

Les données comptent **12 000 groupes végétaux : 8 475 couronnes ou groupes boisés et 3 525 groupes bas**. Les **32 observations manuelles** comprennent quatre palmiers et 28 couronnes sombres du square, du quai et des abords de la gare. Leurs pixels et positions sont sourcés ; hauteurs, volumes et implantations des troncs restent estimés.

La population accepte les **251 observations admissibles de véhicules**, soit **96 voitures, 153 bateaux et deux avions**, avec **251 masques persistants**. Les 40 placements fictifs et véhicules de trafic donnent une flotte initiale de **291 véhicules**. Les **20 observations exclues** restent géoréférencées : douze candidates de voiture non confirmées, deux surfaces de deck, un ponton, une coque stockée à terre et quatre avions hors commune. Ce bilan concerne les zones inspectées ; il n’est pas un recensement de toute Calvi.

Les objets conservent **78 photographies sources**, soit 72 communales et six originaux à 0,25 m/pixel, avec emprises et SHA-256. Les six vrais axes OSM de pontons gardent leurs nœuds archivés. Leur corridor estimé de **10 pixels / 2,5 m** doit contenir tout le corps à pied ; largeur et élévation du deck sont artistiques. Ils ne deviennent ni routes pour voitures ni zones d’atterrissage.

Pour chaque bateau photographique, le moteur dimensionne une **capsule centrée maximale inscrite dans l’enveloppe convexe non dilatée des vrais pixels de coque** (`bodyPolygonWorld`). Rayon et demi-longueur restent distincts des dimensions visuelles et de la marge de **1,4 pixel du monde** du masque. Le moteur n’utilise pas le polygone entier comme corps de collision ; cette géométrie photographique n’est pas une mesure maritime professionnelle. Embarquer demande un vrai bord de coque et un passage depuis le quai ou le ponton. Le transfert entre bateaux exige faible vitesse, coques proches et passage sans autre obstacle. Les patches de matière voisine restent au lieu d’origine sur terre ou en mer ; les originaux photographiques restent intacts. Voir [CALVI_AERIAL_OBJECTS.md](../data/CALVI_AERIAL_OBJECTS.md).

Les accès des bateaux photographiques se répartissent en **sept côtiers, 110 sur pontons et 36 par approche maritime ou transfert**. Les points d’embarquement sont des projections ou des positions estimées sur les vrais bords accessibles ; ils sont distingués de la position photographique de la coque, qui reste inchangée.

## Sources et droits

| Source | Usage et attribution |
|---|---|
| OpenStreetMap | Rues, bâti, littoral, repères et contour. © OpenStreetMap contributors, ODbL 1.0. Archives et base transformée disponibles avec le projet. |
| IGN | MNT LiDAR HD, BD TOPO et BD ORTHO effectivement importés. Licence Ouverte nommée dans les fiches ISO archivées ; version exacte non établie. |
| SRTM NASA/NGA–USGS | Source radar de secours archivée, domaine public, attribution et provenance conservées. |

Les licences des bases ne s’étendent pas automatiquement au code, aux portraits et aux musiques. Les missions, accessoires et personnages sont fictifs ; les anciens dialogues ne sont plus affichés. Aucun fond Google Maps ou Street View n’est extrait ou utilisé. La [piste Street View](STREET-VIEW.md) reste une proposition séparée.

Les contrôles de la v20 sont consignés dans [VERIFICATION-CALVI-FLUIDITE.md](VERIFICATION-CALVI-FLUIDITE.md). [VERIFICATION-CALVI-ILLUSTREE.md](VERIFICATION-CALVI-ILLUSTREE.md) conserve ceux de v19, [VERIFICATION.md](VERIFICATION.md) ceux de v17 et [VERIFICATION-CALVI-LA-VIE.md](VERIFICATION-CALVI-LA-VIE.md) ceux de v18. Leurs cadences ne sont pas des mesures du rendu v20. Aucun essai sur Mac/Safari réel n’est revendiqué ; les essais Chromium ne le remplacent pas.

[Vérification v20](VERIFICATION-CALVI-FLUIDITE.md) · [Historique v19](VERIFICATION-CALVI-ILLUSTREE.md) · [Protocole humain](PLAYTEST.md) · [Lancement](../README.md)
