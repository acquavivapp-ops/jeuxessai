# CALVI LA VIE

**v19 — Calvi illustrée.** Toute la commune devient un décor dessiné en **2,5D** : mer, sol, routes, façades, toits et végétation reprennent une matière d’arcade, avec volumes, ombres et éclairage jour/nuit. Le dessin suit la carte réelle déjà importée. Il garde les coordonnées, le tracé des rues, les empreintes bâties, le littoral, les accès et le relief ; il ne remplace pas Calvi par une ville inventée.

La photographie IGN reste une **source archivée**, utilisée pour les observations et leur provenance. Elle n’est plus le fond de jeu, la texture des toits ou celle des couronnes. Les matières dessinées de `assets/calvi-illustrated-materials.png`, organisées en grille 3 × 3, donnent une palette commune au décor. Le rendu conserve le logo original fourni, les personnages cagoulés, les véhicules et les effets d’action.

L’interface compacte garde les informations de jeu et les commandes. Le bouton **ⓘ** déplie les informations secondaires. Noms des personnages, dialogues, biographies et textes de présentation restent retirés.

Captures du rendu v19 : [jour](docs/calvi-illustrated-day.png) · [nuit](docs/calvi-illustrated-night.png) · [téléphone](docs/calvi-illustrated-phone.png) · [port en paysage](docs/calvi-illustrated-port.png). Vues de secteurs obtenues avec des caméras diagnostiques : [citadelle](docs/calvi-illustrated-citadel-fixture.png) · [aéroport](docs/calvi-illustrated-airport-fixture.png). Ces deux dernières montrent le vrai monde, avec des placements d’essai plutôt qu’un trajet de jeu normal.

## Lancer

Node.js **20 ou supérieur** suffit pour jouer. Décompressez le ZIP du jeu, placez-vous dans le dossier contenant `package.json`, puis :

```bash
npm start
```

Ouvrez l’adresse indiquée dans le terminal, normalement **http://127.0.0.1:4173**, sur la machine qui exécute le serveur. Aucune installation de dépendances n’est nécessaire pour jouer. `Ctrl+C` arrête votre serveur. Une ouverture par `file://` ne charge pas les modules. `PORT=8080 npm start` permet de choisir un autre port.

## Une seule carte : la commune réelle de Calvi

Le contour vient de la **relation OpenStreetMap 1151255 / INSEE 2B050** : environ **31,6 km²**, cinq polygones, îlots compris. Le rectangle cartographique mesure environ **8,94 × 7,73 km**. Port, citadelle, gare, plage, Pinède, Revellata et secteur de l’aéroport restent sur une carte continue, avec **1 552 tronçons routiers et 3 893 empreintes bâties**. Les surfaces dessinées suivent ces formes ; les largeurs de jeu et raccords artistiques ne constituent pas un relevé de voirie.

Le relief reste le **MNT IGN LiDAR HD**, échantillonné à environ **20 m**, avec un extrait urbain à **5 m** et une transition documentée. Les bâtiments gardent leurs **1 355 hauteurs IGN BD TOPO raccordées** ; les **2 538 autres** utilisent un gabarit artistique ou une indication OSM exploitable. Façades, toitures, textures et détails sont dessinés. La vue conserve le nord en haut, une caméra qui se rapproche à pied et recule progressivement en véhicule, et le relief déjà utilisé pour les déplacements.

La végétation conserve les **12 000 groupes observés**, dont **8 475 couronnes ou groupes boisés et 3 525 groupes bas**. Cet ensemble comprend **32 observations manuelles** : 28 arbres sombres et quatre palmiers. Le feuillage est désormais dessiné à leurs positions et selon leurs silhouettes. Les petits troncs d’implantation estimée restent physiques ; le maquis bas ralentit le passage et couvre les jambes, tandis que les grands buissons peuvent faire obstacle. Couronne visuelle et tronc physique restent distincts. Ces groupes et leurs hauteurs ne sont pas un inventaire mesuré d’arbres individuels.

**251 véhicules observés dans la photographie restent jouables aux mêmes positions : 96 voitures, 153 bateaux et deux avions.** Avec les 40 placements fictifs ou véhicules de trafic, la population initiale compte **291 véhicules**. La voiture du départ, observation `photo-car-port-04`, est déjà à vous ; les autres véhicules accessibles se prennent avec **E**. L’observation `photo-car-port-05` reste distincte. L’inventaire couvre des zones inspectées du port, des parkings et de l’aéroport, sans exhaustivité sur toute la commune. Les **20 observations exclues**, leurs raisons et leurs coordonnées restent archivées.

## Cinq moyens de déplacement

| Véhicule | Où le trouver | Utilisation |
|---|---|---|
| Voiture | Port, parkings et rues | Conduite, marche arrière, freinage et vol. |
| Moto | Parking près du départ au port | Plus étroite ; frein puis sortie à l’arrêt. |
| Bateau | Port et pontons | Embarquement depuis un accès libre, navigation et accostage ; transfert entre coques proches et lentes. |
| Hélicoptère | Parking près du port | Décollage, direction libre, atterrissage ou saut en vol. |
| Avion | Aire de stationnement de l’aéroport | Armer le décollage, accélérer, voler puis atterrir ou sauter. |

**Six axes de pontons OSM réels** donnent accès à pied aux bateaux. Leur largeur de jeu de **10 pixels du monde, soit 2,5 m**, reste une estimation photographique ; les axes source sont archivés. Ils ne deviennent pas des routes carrossables. Parmi les bateaux observés, **sept s’abordent depuis la côte, 110 depuis les pontons et 36 par approche maritime ou transfert**. La proximité seule ne permet pas de traverser un mur, un tronc, une autre coque ou la terre.

Les premiers transports ont des placements fictifs sur des surfaces réelles. Les observations ne certifient ni une propriété ni une installation aéronautique. Quatre avions photographiés au sud de l’aéroport restent exclus, hors du contour communal. La navigation et le survol utilisent le rectangle cartographique ; marche, roulage et atterrissages demandent un sol praticable de la commune.

| Action | Téléphone | Clavier / souris |
|---|---|---|
| Marcher / conduire / piloter | Stick gauche | Flèches, ZQSD ou WASD |
| Viser et tirer | Stick droit ou TIRER maintenu | Souris + clic, F ou J maintenu |
| Parcourir les six armes | Bouton d’arme | R ou Tab |
| Monter / voler / sortir | MONTER / VOLER / SORTIR | E ou Entrée |
| Poser une bouteille à pied | POSER | Espace |
| Freiner voiture / moto / bateau | FREIN maintenu | Espace maintenu |
| Décoller / demander l’atterrissage | Bouton contextuel | Espace, une pression |
| Sauter d’un avion / hélicoptère en vol | SAUTER | E ou Entrée |
| Ouvrir le parachute pendant la chute | PARACHUTE | Espace |
| Diriger la descente | Stick gauche | Touches de déplacement |
| Pause / reprise | Pause | Échap |

Il faut ouvrir la voile assez tôt et viser un sol libre. Le bateau demande un accès à terre ou un transfert praticable pour sortir. À bord d’un appareil en vol, le **Lance-BOUM** permet de viser le sol ; les autres armes ne tirent pas sur des cibles terrestres depuis le vol.

## Temps, missions et police

Choisissez exploration libre, sans délai, ou trois missions en **180 secondes**. Les trois dépôts fictifs restent facultatifs en exploration. Une bouteille explose après **2,6 secondes** ; éloignez-vous du cercle annoncé. Après les missions, revenez au rendez-vous du port. Trois vies s’appliquent dans les deux modes.

Le départ peut se faire à **06:00, 12:00, 18:30 ou 00:00**. Une journée dure **douze minutes actives** ; éclairage, ombres, lampes et phares suivent l’heure. Tutoriel, pause et interruptions figent la simulation.

Les six armes sont **Pistolet, Rafale, Lance-BOUM, Fusil à pompe, Fusil de précision et Carabine**. Les munitions suivent des règles d’arcade. Tirs et collisions rencontrent les volumes physiques ; les morts laissent du sang temporaire. Les voitures détruites par tirs brûlent puis explosent après **1,4 seconde active** ; les explosifs peuvent déclencher une chaîne immédiate. Les bâtiments ont une résistance finie.

La recherche compte **six étoiles**, selon la gravité des incidents : patrouilles, renforts, **barrages dès 3**, **hélicoptère de recherche dès 4**, **unités lourdes dès 5**, **armée à 6**. Les renforts sont annoncés. Les agents à pied respectent bâtiments, végétation physique, littoral et contour. La recherche baisse après une fuite hors de vue sans nouvel incident.

## Sources et limites

**© OpenStreetMap contributors · ODbL 1.0** pour vecteurs et contour ; **© IGN · Licence Ouverte** pour MNT, hauteurs et orthophotographies. Archives, requêtes, empreintes et fiches de droits restent conservées. L’illustration ne change pas la provenance des coordonnées et ne transforme pas les estimations en mesures.

Les photographies IGN ont servi à repérer des silhouettes végétales et des véhicules ; leurs pixels ne constituent plus le décor affiché. Leur pas d’export ne certifie pas une résolution native ou une précision locale. Le contour OSM n’est pas un relevé cadastral certifié. Les dates locales de prise de vue et de levé IGN, ainsi que la référence verticale précise du MNT, restent inconnues. La géographie actuelle n’est pas une reconstruction de 1994. Missions, personnages, enseignes et comportements sont fictifs ; aucun graphisme ou morceau de GTA ou Nintendo n’est repris.

Les archives facultatives `blue-night-imagery-sources.zip` conservent les réponses JPEG originales : copiez leur contenu `blue-night/assets/aerial/source-2048/` dans le dossier `assets/aerial/source-2048/` du projet pour les contrôles de provenance. Ces originaux ne sont pas nécessaires pour jouer. Les importeurs ne téléchargent rien automatiquement au démarrage.

## Développement et vérification

Pour les tests : `npm ci`, puis `npm test`. Les contrôles géographiques sont lancés par `npm run test:map`, `test:boundary`, `test:terrain`, `test:imagery`, `test:imagery:tiles`, `test:heights` et `test:lidar`. Les contrôles des observations utilisent `tools/test-import-aerial-objects.py` et `tools/import-aerial-objects.py --check`. Les tests JPEG nécessitent **Pillow 12.3.0**, déclaré dans [requirements-dev.txt](requirements-dev.txt), à installer dans un environnement virtuel Python.

Pour Chromium : `BLUE_NIGHT_TEST_PORT=4182 npm run test:browser -- --workers=1`, avec un port libre. Cet environnement utilise `/usr/bin/chromium` ; ailleurs, installez-le avec `npx playwright install chromium`. Les fixtures synthétiques restent privées et absentes des imports du jeu.

La comparaison géographique et l’état des vérifications du nouveau rendu sont consignés dans [VERIFICATION-CALVI-ILLUSTREE.md](docs/VERIFICATION-CALVI-ILLUSTREE.md). Un correctif évite la reconstruction répétée des toits dans les vues stables testées ; des saccades restent observées pendant les premières créations de cache en conduite et les changements de zoom. La v19 ne reprend pas les chiffres des versions précédentes comme preuve de son résultat. Aucun essai physique Mac/Safari, téléphone ou séance humaine n’est revendiqué pour ce rendu. Le projet reste un jeu Web local, sans application native.

## Historique des versions précédentes

- **v18 — logo, interface compacte et parachute :** [rapport](docs/VERIFICATION-CALVI-LA-VIE.md), [accueil](docs/calvi-la-vie-title.png), [téléphone](docs/calvi-la-vie-phone.png), [parachute](docs/calvi-la-vie-parachute.png).
- **v17 — ancien décor photographique :** [rapport et limites](docs/VERIFICATION.md), [jour](docs/blue-night-day.png), [nuit](docs/blue-night-afterhours.png), [port](docs/blue-night-photo-origin.png).

Ces rapports, captures et mesures documentent leur version ; ils ne montrent pas le nouveau décor illustré.

[Conception](docs/CONCEPTION.md) · [Cartographie et provenance](docs/CARTOGRAPHIE.md) · [Observations photographiques](data/CALVI_AERIAL_OBJECTS.md) · [Relief](data/ELEVATION.md) · [Hauteurs](data/BUILDING_HEIGHTS.md) · [Direction artistique](docs/DIRECTION-ARTISTIQUE.md) · [Essais humains](docs/PLAYTEST.md)
