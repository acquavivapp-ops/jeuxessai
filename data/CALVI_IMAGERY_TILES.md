# Photographie aérienne IGN de Calvi, avec détail urbain renforcé

[calvi-imagery-tiles.json](calvi-imagery-tiles.json) conserve deux niveaux de
photographie réelle **IGN BD ORTHO**, sans génération ni agrandissement de
l'ancienne image pour inventer du détail :

- **Toute la commune et son rectangle englobant : environ 0,50 m par pixel**,
  image de référence **17 884 × 15 466 pixels**, 288 tuiles de jeu.
- **Centre, port, citadelle, pinède, entrée Est et aéroport : 0,25 m par pixel
  demandé**, sur deux régions de **23,875 km²**, 410 tuiles supplémentaires.

L'export à 0,25 m fournit deux fois plus d'échantillons dans chaque direction,
soit quatre fois plus de pixels pour une même surface. Il ne prouve pas à lui
seul une résolution native ou une précision de prise de vue de 25 cm. Le
millésime local reste **inconnu** : la mosaïque actuelle ne reconstitue pas
Calvi en 1994.

Le monde conserve **35 766,74 × 30 930,25 pixels**, à quatre pixels par mètre.
L'emprise commune est ouest `8.7063593`, sud `42.5150237`, est `8.8153936`,
nord `42.5844865`. La photographie couvre le rectangle englobant ; les
trajets à pied et les atterrissages restent dans le contour administratif
OSM de Calvi. Les bateaux naviguent dans la mer adjacente et les appareils
survolent le rectangle photographié.

## Export réellement plus détaillé

La [comparaison des requêtes originales](calvi-imagery-resolution-comparison.json)
archive les URL, bornes, tailles et SHA-256 d'exports des **mêmes emprises de
100 × 100 m**, demandés à 0,50, 0,25 et 0,20 m par pixel. Chaque JPEG conserve
les octets retournés par le WMS officiel ; aucune interpolation ne lui ajoute
de pixels. Le port et la pinède montrent des contours et marquages plus fins
à 0,25 m. Le passage à 0,20 m apporte peu de détail visuel supplémentaire et
nécessiterait 56 % de pixels en plus ; il n'a pas été retenu pour le jeu.
Ces petits exports diagnostiques sont séparés des grilles de l'atlas.

## Deux grilles géographiques explicites

Les fichiers sont importés depuis <https://data.geopf.fr/wms-r/wms>, couche
`ORTHOIMAGERY.ORTHOPHOTOS`. Le WMS utilise **EPSG:4326 / WMS 1.3.0**, avec
les axes BBOX **latitude puis longitude**. Les images vont d'ouest en est
et du nord au sud. Chaque niveau découpe une grille exacte : aucun trou,
aucun chevauchement entre ses cellules et aucun changement de géoréférence.

Le niveau communal original conserve **72 réponses JPEG**, puis
**18 colonnes × 16 lignes = 288 tuiles de jeu**. Ses échantillonnages effectifs
sont **0,499982 m** horizontalement et **0,499972 m** verticalement. Les
colonnes et lignes finales gardent les restes de 476 et 106 pixels. Les
288 entrées `tiles`, 72 entrées `sourceTiles`, leurs octets et leurs empreintes
restent inchangés après l'ajout du détail.

Les champs `detailRegions`, `detailTiles`, `detailSourceTiles`,
`detailRequestedMetresPerPixel` et `detailMetresPerPixel` décrivent séparément
le détail à 0,25 m. Les deux régions ne se chevauchent pas :

| Région | Rectangle dans le monde | Image fine | Tuiles de jeu | Originaux |
| --- | --- | --- | ---: | ---: |
| `urban` : ville, port et pinède | x 11 000, y 4 500 ; 15 500 × 15 500 | 15 500 × 15 500 | 256 | 64 |
| `airport` : aéroport et Cantone | x 21 000, y 20 000 ; 13 500 × 10 500 | 13 500 × 10 500 | 154 | 42 |
| **Total détail** | **23,875 km²** | **382 millions de pixels** | **410** | **106** |

Les emprises WGS84 correspondantes et les rectangles de chaque tuile figurent
dans le manifeste. Les dernières cellules conservent leur vraie taille :
140 pixels au bord de la grille urbaine, 188 pixels à l'est et 260 pixels au
sud de la grille aéroportuaire. Le reste du rectangle communal conserve
l'export réel à 0,50 m.

## Originaux, transformations et fichiers locaux

Les **178 réponses WMS originales** sont conservées sans retouche dans
[assets/aerial/source-2048](../assets/aerial/source-2048), avec leurs fiches
JSON :

- les 72 fichiers `calvi-cN-rN.jpg` du premier niveau ;
- les 106 fichiers `calvi-detail-urban-cN-rN.jpg` et
  `calvi-detail-airport-cN-rN.jpg` du second niveau.

L'atlas et les exports de comparaison ont été téléchargés le **4 octobre
2026**. Les dates de téléchargement ne sont pas les dates de prise de vue.

Chaque réponse mesure au maximum **2 048 × 2 048 pixels**. Les **698 JPEG de
jeu**, au maximum **1 024 × 1 024**, sont des découpes des pixels originaux
sans redimensionnement. Pillow les réencode avec les paramètres de
quantification et de sous-échantillonnage JPEG de la réponse source. La
compression peut introduire de faibles différences de pixels ; les
transformations, SHA-256 source et version de l'encodeur sont documentés.

L'[aperçu léger](../assets/aerial/calvi-overview.jpg), **1 024 × 886 pixels**,
reste une réduction BOX puis JPEG de la
[réponse originale de 4 096 × 3 542 pixels](../assets/calvi-orthophoto.jpg).
Sa transformation et ses empreintes sont documentées dans `overview`.
Il sert au chargement et à l'orientation.

## Stockage et mémoire

| Images de l'atlas | Octets |
| --- | ---: |
| 72 originaux communaux | 55 281 638 |
| 288 tuiles de jeu communales | 54 404 263 |
| 106 originaux de détail | 68 594 287 |
| 410 tuiles de jeu de détail | 67 703 832 |
| Aperçu local | 269 716 |
| **698 tuiles de jeu, deux niveaux** | **122 108 095** |
| **Atlas complet, originaux et aperçu compris** | **246 253 736** |

Les petits JPEG de comparaison sont des preuves distinctes, décrites et
chiffrées dans leur propre fichier JSON. Ils ne sont pas chargés en partie.

Une tuile de jeu représente au maximum **4 MiB en RGBA décodé**. Le flux
asynchrone conserve **quatre tuiles / 16 MiB au maximum, tous niveaux
confondus**. L'aperçu ajoute environ **3,46 MiB**. Ce sont des budgets de
textures photographiques, pas la mémoire totale du navigateur. Les sources
2048 représentent jusqu'à 16 MiB au décodage et ne sont jamais demandées par
le navigateur du jeu.

Le détail est chargé pour la vue visible depuis les fichiers locaux. Aucun
accès IGN n'est nécessaire pendant une partie. Le ZIP jouable peut contenir
seulement les 698 tuiles, l'aperçu, le manifeste et la licence. Les originaux
peuvent être livrés dans un ZIP source séparé. Pour `--check` exhaustif ou un
réimport hors ligne, remettre cette archive dans `assets/aerial/source-2048/`.

## Licence et limites

La [fiche ISO officielle BD ORTHO archivée](calvi-imagery-tiles-license.xml)
confirme **Licence Ouverte / Open Licence**. Le manifeste conserve la clause,
le lien Etalab et le SHA-256 du document. `license.version` reste `null` : la
compatibilité CC-BY 2.0 déclarée par l'IGN ne prouve pas une version de Licence
Ouverte. Attribution : **© IGN — BD ORTHO — Licence Ouverte / Open Licence**.
La carte vectorielle garde séparément son attribution OSM et son ODbL.

Une orthophoto reste une source aérienne 2D. Les mesures LiDAR du terrain et
BD TOPO des bâtiments sont distinctes. La photographie ne mesure pas les
hauteurs manquantes. Des millésimes et découpage différents peuvent décaler
localement un toit photographié et son empreinte vectorielle actuelle.

## Import reproductible et contrôles

Depuis la racine du projet, afficher les plans sans téléchargement ni mutation :

```sh
python3 tools/import-imagery-tiles.py
python3 tools/import-imagery-tiles.py --detail
```

Le jeu n'a pas besoin de Pillow. Les imports de développement utilisent
Python 3 et [Pillow épinglé](../requirements-dev.txt). Réimport explicite du
premier niveau, puis ajout du second en conservant le premier :

```sh
python3 tools/import-imagery-tiles.py --download --workers 4 --max-total-bytes 125000000
python3 tools/import-imagery-tiles.py --detail --download --workers 4 --max-total-bytes 300000000
```

Une réponse valide déjà archivée avec la même URL et le même SHA-256 est
réutilisée. Les quatre téléchargements simultanés et la limite de stockage
sont bornés. Un manifeste prêt est publié seulement après contrôle de tous
les fichiers ; une erreur n'écrase pas le manifeste prêt existant.

```sh
python3 tools/test-import-imagery-tiles.py
python3 tools/import-imagery-tiles.py --check
```

Les **30 tests hors réseau** vérifient la couverture des deux grilles, les
bords incomplets, les dimensions, la projection WMS, les bornes physiques,
les URL locales, les découpes, les budgets et le refus de JPEG invalides.
Les images synthétiques des tests valident les formats et n'entrent jamais
dans l'atlas. Sans Pillow, les cinq tests qui décodent réellement des JPEG
sont ignorés. Le contrôle réel `--check`, exécuté avec Pillow installé,
vérifie les **698 tuiles**, les **178 originaux**, chaque taille/SHA-256,
l'aperçu et la licence, sans réseau.
