# Blue Night

**Calvi, 1994 : photographie détaillée, végétation en volume et arcade sur terre, en mer et dans les airs.** La commune entière reste l’unique carte jouable. Le fond visible est maintenant une photographie aérienne IGN détaillée : les routes, quais, toits et arbres sont ceux de l’image, superposés au relief du terrain et aux volumes des empreintes bâties.

L’atlas couvre toute l’emprise en **17 884 × 15 466 pixels**, exportés à environ **0,5 m/pixel**, avec **288 tuiles locales**. **410 tuiles supplémentaires à 0,25 m/pixel** améliorent le centre, le port, la Pinède et le secteur de l’aéroport, sur deux rectangles couvrant **23,875 km²**. Le jeu choisit le niveau fin quand il est disponible ; les 698 tuiles occupent environ **122,1 Mo compressés**. Le navigateur charge uniquement la zone affichée : quatre tuiles au maximum, **16 Mio pour les tuiles conservées et les décodages en attente**, plus un aperçu léger. Les réponses originales IGN sont conservées séparément (72 de couverture générale et 106 de détail). Aucun service distant ni clé API n’est nécessaire pendant une partie. Le pas de l’export ne constitue pas une certification de résolution native ou de précision locale.

Les bâtiments conservent leur toit photographique sur un volume issu de leur empreinte OSM. **1 355 hauteurs IGN BD TOPO** sont raccordées ; les **2 538 autres** gardent un gabarit artistique ou une indication OSM exploitable. Les façades et leurs détails sont reconstitués pour le jeu. La végétation compte **12 000 groupes : 8 475 couronnes ou groupes boisés et 3 525 groupes bas**. Les **32 observations manuelles** comprennent **28 arbres sombres du square, du quai et des abords de la gare**, absents du détecteur de verts, et quatre palmiers du port. Les houppiers reprennent la photographie découpée selon leur silhouette, sur un volume artistique. Le petit tronc physique est posé à une position estimée ; la couronne entière ne devient pas un mur. Le maquis bas ralentit le passage et couvre les jambes, tandis que les grands buissons peuvent faire obstacle. Les feuilles masquent localement la partie du personnage réellement derrière leur contour, sans devenir transparentes ni flotter au-dessus de lui. Ces groupes et leurs hauteurs estimées ne constituent pas un inventaire mesuré des arbres individuels.

**251 véhicules photographiés deviennent jouables à leur position source : 96 voitures, 153 bateaux et deux avions.** La voiture du départ, observation `photo-car-port-04`, est déjà à vous, et **E** permet de voler les autres. L’observation `photo-car-port-05` reste une autre voiture accessible. Les **251 petits masques** de matière voisine restent au lieu d’origine après déplacement ou destruction ; les photographies sources restent intactes. Ce traitement couvre les observations vérifiées du port, des parkings et de l’aéroport, sans exhaustivité sur toute la commune. Les **20 observations exclues** restent archivées avec leur raison et leurs coordonnées. La mer conserve sa matière photographique avec un **clapotis léger**, limité à l’eau et figé pendant la pause. Un [masque des pixels bleus](data/CALVI_WATER_SURFACE.md) évite les reflets sur les quais et les bateaux photographiés.

[Jour](docs/blue-night-day.png) · [Nuit](docs/blue-night-afterhours.png) · [Conduite](docs/blue-night-afterhours-driving.png) · [Téléphone](docs/blue-night-afterhours-phone.png) · [Parking avant départ](docs/blue-night-photo-origin.png) · [Après départ](docs/blue-night-photo-pavement.png) · [Moto](docs/blue-night-motorcycle.png) · [Bateau](docs/blue-night-boat.png) · [Devant l’arbre](docs/blue-night-tree-front.png) · [Sous sa couronne](docs/blue-night-tree-canopy.png) · [Hélicoptère — capture v15](docs/blue-night-helicopter.png)

## Lancer

Node.js **20 ou supérieur** suffit pour jouer. Décompressez `blue-night.zip`, puis :

```bash
cd blue-night
npm start
```

Sur la machine qui exécute le serveur, ouvrez **http://127.0.0.1:4173**. Aucune installation de dépendances n’est nécessaire pour jouer. `Ctrl+C` arrête votre serveur. Une ouverture par `file://` ne charge pas les modules. Dans cet environnement, le projet est dans `/workspace/jeuxessai` ; `PORT=8080 npm start` permet un autre port.

Après un premier chargement complet sur localhost ou HTTPS, le fond de carte et les modules sont disponibles hors ligne. Les tuiles HD consultées sont conservées à la demande ; les secteurs HD non encore chargés utilisent l’aperçu en l’absence de connexion au serveur local. Les JPEG sources de 2 048 pixels ne sont jamais demandés par le navigateur.

## Cinq moyens de déplacement

| Véhicule | Où le trouver | Utilisation |
|---|---|---|
| Voitures | Port, parkings et rues | Conduite, marche arrière, freinage et vol. |
| Moto | Parking près du départ au port | Étroite, agile ; frein puis sortie à l’arrêt. |
| Bateau | Quai du port | Embarquement depuis la terre, navigation dans la vraie mer, accostage avant la sortie. |
| Hélicoptère | Parking près du port | Décollage, vol stationnaire et direction libre ; atterrissage sur un sol dégagé. |
| Avion | Aire de stationnement de l’aéroport | Armer le décollage puis accélérer droit devant ; maintenir le vol, aligner et demander l’atterrissage sur une approche libre. |

La moto, le bateau de départ, l’hélicoptère et le premier avion sont placés fictivement sur les surfaces réelles de Calvi. Les observations ne certifient ni une propriété réelle ni une installation aéronautique. Quatre autres avions visibles au sud de l’aéroport sont archivés mais restent hors jeu, car ils sont hors du contour communal importé. Le personnage ne sort pas en plein vol ou en pleine mer. Un avion ou un hélicoptère détruit sans issue terrestre sûre entraîne une défaite, sans téléportation. La coque du bateau respecte le littoral ; les appareils peuvent survoler le rectangle photographié, tandis que sorties et atterrissages exigent un vrai sol praticable de la commune.

Au port, **six axes de pontons OSM réels** donnent accès à pied aux emplacements d’embarquement. Leur largeur de jeu de **10 pixels du monde, soit 2,5 m**, est estimée à partir de la photographie ; les axes source sont archivés. Ces passages n’ouvrent pas une route aux voitures. Monter, voler ou sortir exige un accès réellement libre, sans franchir un mur ou un tronc par simple proximité.

Les bateaux photographiques utilisent un corps physique inscrit dans la vraie forme de coque, distinct du masque visuel. Parmi eux, **sept s’abordent depuis la côte, 110 depuis les pontons et 36 par approche maritime ou transfert**. L’embarquement vérifie le bord de coque et le passage depuis le quai ou le ponton ; ces points d’accès sont estimés sur la géométrie réelle. Un transfert entre deux embarcations demande des coques proches, une faible vitesse et un passage libre.

| Action | Téléphone | Clavier / souris |
|---|---|---|
| Marcher / conduire / piloter | Stick gauche | Flèches, ZQSD ou WASD |
| Viser et tirer | Stick droit ou TIRER maintenu | Souris + clic, F ou J maintenu |
| Parcourir les six armes | Bouton d’arme | R ou Tab |
| Monter / voler / sortir | MONTER / VOLER / SORTIR | E ou Entrée |
| Poser une bouteille à pied | POSER | Espace |
| Freiner voiture / moto / bateau | FREIN maintenu | Espace maintenu |
| Décoller / demander l’atterrissage | Bouton contextuel | Espace, une pression |
| Pause / reprise | Pause | Échap |

Dans les airs, le **Lance-BOUM** permet de viser le sol ; ses projectiles descendent avant leur impact. Les autres armes ne tirent pas sur des cibles terrestres depuis le vol. À pied et dans les véhicules terrestres ou le bateau, les six armes gardent leurs règles d’arcade.

## Temps, missions et police

Choisissez exploration libre (sans délai) ou trois missions en **180 secondes**. Les trois dépôts fictifs sont facultatifs en exploration. Une bouteille explose après **2,6 secondes** : éloignez-vous du cercle annoncé. Après les missions, revenez au rendez-vous du port. Trois vies s’appliquent dans les deux modes.

Le départ peut se faire à **06:00, 12:00, 18:30 ou 00:00**. Une journée dure **douze minutes actives** ; ombres, exposition, lampes et phares suivent l’heure du jeu. Tutoriel, pause et interruptions figent simulation, horloge, poursuites et effets. L’arrivée asynchrone d’une nouvelle image ne repeint pas une partie en pause.

Les armes sont **Pistolet, Rafale, Lance-BOUM, Fusil à pompe, Fusil de précision et Carabine**. Les munitions sont illimitées. Tirs et collisions respectent leurs volumes ; les morts laissent du sang temporaire. Les voitures détruites par tirs brûlent puis explosent après **1,4 seconde active** ; les explosifs peuvent déclencher une chaîne immédiate. Les bâtiments ont une résistance finie. [Incendie](docs/blue-night-fire.png) · [Explosion](docs/blue-night-explosion.png) · [Sang](docs/blue-night-blood.png).

La recherche compte **six étoiles**, selon la gravité des incidents et sans compter plusieurs fois le même événement : patrouilles, renforts, **barrages dès 3**, **hélicoptère de recherche dès 4**, **unités lourdes dès 5**, **armée à 6**. Les renforts sont annoncés ; tirs et véhicules de barrage sont esquivables ou destructibles. Les agents à pied peuvent suivre le joueur sur un sol praticable au-delà du graphe routier, en respectant bâtiments, végétation physique, littoral et contour. La recherche baisse après une fuite hors de vue sans nouveau crime. L’hélicoptère policier est distinct de l’appareil pilotable.

## Carte et univers

Le contour vient de la **relation OSM 1151255 / INSEE 2B050** : environ **31,6 km²**, cinq polygones, îlots compris. Le rectangle photographié mesure environ **8,94 × 7,73 km**. Centre, citadelle, plage, Pinède, Revellata et secteur de l’aéroport forment une carte continue, avec **1 552 tronçons routiers et 3 893 empreintes bâties**.

Le relief est un vrai **MNT IGN LiDAR HD**, échantillonné à environ **20 m** sur **449 × 388** points. **79 276 échantillons terrestres sont valides** ; mer et extérieur restent masqués. Le centre conserve le vrai détail urbain à **5 m**, raccordé par une transition documentée de 40 m. Le terrain atteint environ **702 m** ; le SRTM réel archivé reste fourni en secours.

La caméra se rapproche à pied (**1,95**) et recule progressivement en véhicule (**1,65**). Son bitmap conserve la taille de l’écran pendant le zoom. Le rendu utilise des index et caches bornés ; il ne construit pas un canevas géant de Calvi. Calculs de collisions sur les objets lointains, allocations temporaires, peintures opaques sur la photo et flous permanents de l’interface ont été retirés ou réduits.

Le dernier banc Chromium Linux mesure environ **31 images/s sur bureau et 47 en portrait émulé**, au CPU normal avec diagnostic compact. Le stress CPU ×4 reste lent. Les deux méthodes d’observation et leurs résultats figurent dans [VERIFICATION.md](docs/VERIFICATION.md) ; ils ne constituent pas un essai sur Mac/Safari ni une comparaison contrôlée aux versions précédentes.

La population initiale compte **291 véhicules : 251 issus des observations photographiques et 40 placements fictifs ou véhicules de trafic**. Les passants se déplacent sur un sol libre, au-delà des seuls segments de rue, en respectant les obstacles et le contour communal. Ninu et Antò portent tenues olive et cagoules noires humoristiques. Maquis FM diffuse compositions et publicités originales. Edmond Simeoni, Petru Guelfucci, François Mitterrand et Charles Pasqua apparaissent en caricatures narratives avec des répliques inventées. Missions, comportements, enseignes et commerces sont fictifs. Aucun graphisme, logo ou morceau de GTA ou Nintendo n’est utilisé.

## Sources et développement

**© OpenStreetMap contributors · ODbL 1.0** pour vecteurs et contour ; **© IGN · Licence Ouverte** pour MNT, hauteurs et orthophotographies. Archives, requêtes, empreintes et fiches de droits accompagnent les données. Le contour OSM n’est pas un relevé cadastral certifié. Les dates locales de prise de vue et de levé IGN, ainsi que la référence verticale précise du MNT, restent inconnues. La géographie actuelle n’est pas une reconstruction de 1994.

Le ZIP jouable contient les tuiles de jeu et leurs métadonnées. Pour réimporter ou vérifier toutes les réponses JPEG originales, décompressez également **`blue-night-imagery-sources.zip` dans le même dossier** ; il complète `blue-night/assets/aerial/source-2048/`. Il n’est pas nécessaire pour jouer. Les importeurs ne téléchargent rien automatiquement au démarrage. La végétation et les voitures photographiques sont décrites dans [CALVI_AERIAL_OBJECTS.md](data/CALVI_AERIAL_OBJECTS.md).

Pour les tests : `npm ci`, puis `npm test`. Les tests géographiques sont lancés par `npm run test:map`, `test:boundary`, `test:terrain`, `test:imagery`, `test:imagery:tiles`, `test:heights` et `test:lidar`. Les contrôles des objets photographiques sont `tools/test-import-aerial-objects.py` et `tools/import-aerial-objects.py --check` avec le Python du venv. Les imports standards utilisent Python 3 ; les tests JPEG détaillés nécessitent **Pillow 12.3.0**, déclaré dans [requirements-dev.txt](requirements-dev.txt). Installez-le dans un environnement virtuel, puis utilisez son Python pour `tools/test-import-imagery-tiles.py` et `tools/import-imagery-tiles.py --check`. Les contrôles du clapotis utilisent `tools/test-import-water-surface.py` et `tools/import-water-surface.py --check --workers 2` dans le même environnement virtuel.

Pour Chromium : `BLUE_NIGHT_TEST_PORT=4182 npm run test:browser -- --workers=1`, avec un port libre. Cet environnement utilise `/usr/bin/chromium` ; ailleurs, installez-le avec `npx playwright install chromium`. Les fixtures synthétiques sont privées, refusées par le serveur et absentes du cache et des imports du jeu.

Les contrôles exécutés et leurs limites figurent dans [VERIFICATION.md](docs/VERIFICATION.md). Aucun test physique sur Mac/Safari, téléphone ou séance humaine n’est revendiqué. Le téléchargement de WebKit a été refusé par la politique réseau de l’environnement ; les chemins de décodage compatibles sont contrôlés dans Chromium, ce qui ne remplace pas un essai sur Safari. Le projet reste un jeu Web local en développement, sans application native ni publication en ligne.

[Conception](docs/CONCEPTION.md) · [Cartographie](docs/CARTOGRAPHIE.md) · [Image HD](data/CALVI_IMAGERY_TILES.md) · [Relief](data/ELEVATION.md) · [Hauteurs](data/BUILDING_HEIGHTS.md) · [Essais humains](docs/PLAYTEST.md)
