# Objets observés dans les photographies de Calvi

[calvi-aerial-objects.js](calvi-aerial-objects.js) contient **12 000 groupes végétaux** et **251 observations de véhicules admissibles avant validation physique** : 96 voitures, 153 bateaux et 2 avions. Les 20 observations exclues restent archivées avec leur géoréférencement et une raison explicite. Le moteur publie séparément le nombre effectivement converti ; un objet refusé ne reçoit aucun masque de remplacement.

## Sources et géoréférencement

Aucune photographie originale n’est effacée ni retouchée. [calvi-aerial-objects-source.json](calvi-aerial-objects-source.json) archive les emprises, dimensions, URL IGN et SHA-256 des 72 sources à environ 0,5 m/pixel, ainsi que six sources originales à 0,25 m/pixel utilisées pour les observations manuelles : `detail-urban-c2-r1`, `detail-urban-c2-r2`, `detail-urban-c3-r1`, `detail-urban-c3-r2`, `detail-airport-c3-r2` et `detail-airport-c3-r3`.

Le monde couvre le rectangle WGS84 ouest 8,7063593 ; sud 42,5150237 ; est 8,8153936 ; nord 42,5844865. Ses dimensions sont 35 766,74 × 30 930,25 unités, soit 4 unités par mètre. Pour l’atlas initial de 17 884 × 15 466 pixels, `x = pixelX × 35766.74 / 17884` et `y = pixelY × 30930.25 / 15466`. Une annotation fine utilise l’emprise `boundsWorld` et les dimensions de son original : `x = boundsWorld.x + pixelX × boundsWorld.w / imageWidth`, de même pour `y`. Le changement de résolution du rendu ne déplace pas les objets.

Attribution : © IGN — BD ORTHO — Licence Ouverte / Open Licence. Les contours et axes proviennent d’OpenStreetMap, © OpenStreetMap contributors, ODbL 1.0. La date locale de prise de vue n’a pas été établie. La photographie représente une mosaïque actuelle ; les modèles et l’univers gardent la direction artistique du jeu.

## Végétation

[import-aerial-objects.py](../tools/import-aerial-objects.py) examine des cellules de 2 m issues des vrais pixels originaux. Il conserve les signatures de feuillage, rejette les observations isolées et masque la mer, l’extérieur de la commune, les bâtiments et les routes selon les véritables contours OSM. Des dégagements protègent les troncs et les accès. Chaque centre automatique est un pixel réellement classifié du groupe, jamais le centre vide d’une boîte. Aucun arbre n’est semé aléatoirement sur une zone verte.

Les 12 000 objets comprennent **8 475 couronnes ou groupes boisés** et **3 525 groupes de végétation basse**. La végétation rurale de nature inconnue reste du maquis bas. Les **32 couronnes annotées manuellement** comprennent quatre palmiers gris du quai et 28 arbres sombres, gris ou bordeaux du square, du quai et des abords de la gare. Leur teinte échappait au détecteur vert ; leurs couronnes et positions sont désormais de vrais objets du jeu. L’arbre de preuve `photo-tree-square-19` est placé à `(16308,8855)`, pixel natif `(1212,259)` de `detail-urban-c2-r2`.

La position, les contours et les textures de couronnes suivent la photographie. La hauteur est **une estimation artistique**, généralement 5 à 6,5 m pour les groupes automatiques, 6 à 10 m pour les couronnes manuelles et 1,2 m pour le maquis. Ces données ne mesurent pas les hauteurs LiDAR, les troncs ou les espèces ; un groupe peut réunir plusieurs arbres voisins. Le plafond de 12 000 privilégie les observations urbaines et boisées. Les objets sont indexables pour limiter les recherches aux environs du joueur.

## Véhicules photographiés

[calvi-aerial-annotations.json](../tools/calvi-aerial-annotations.json) conserve les centres natifs, orientations, dimensions, silhouettes et petits patches voisins. Les 60 anciennes observations de voitures sont conservées ; leurs paires ambiguës ont été corrigées sur les vraies carrosseries, sans déplacer artificiellement un véhicule pour contourner une collision. Des observations supplémentaires couvrent le port, le quai, les rues proches, les parkings et le terminal de l’aéroport. Douze candidates supplémentaires correspondant à une place vide, un élément de quai, une ombre ou un corps insuffisamment identifiable restent exclues et traçables.

Au port, **107 groupes de pixels de coques blanches ont été inspectés**, puis séparés en **157 observations de bateaux** quand la photo montrait des embarcations distinctes. Les groupes 45/60/71/79/80 contiennent respectivement 4/6/4/8/7 coques vérifiées. Les vrais catamarans conservent un seul objet. Les originaux voisins ont permis de compléter les coques coupées par la fenêtre d’inspection. Parmi ces 157 observations, 153 sont admissibles ; deux surfaces de deck, un ponton et une coque stockée à terre restent exclus. Le corps physique `bodyPolygonWorld` est l’enveloppe convexe non dilatée de vrais pixels de coque ; sa forme pointue est distincte de la marge visuelle de 1,4 unité ajoutée au masque. Chaque masque marin couvre une silhouette observée, et son patch provient d’un petit carré d’eau voisin, jamais du pavement. Les limites de l’emprise inspectée sont enregistrées dans `metadata.coverageRegions`.

Six petits avions distincts sont observés à l’aéroport. **Deux se trouvent dans la commune réelle de Calvi** ; les quatre situés hors frontière administrative restent dans `excludedObservations` avec leur source complète. Aucun avion n’est déplacé et la frontière du terrain n’est pas élargie.

La couleur du sol ou de l’eau cachée sous un véhicule n’est pas connue. Le rendu copie une petite texture voisine, puis dessine l’objet utilisable par-dessus : c’est une reconstruction artistique locale. Le modèle peut s’éloigner de cette silhouette quand il est conduit ; le masque photographique reste au lieu d’origine pour éviter une deuxième copie immobile.

Ces observations n’établissent pas un recensement de toutes les voitures ou embarcations de toute la commune. Les véhicules non observés ailleurs, les coques sombres non détectées ou les minuscules embarcations non identifiables peuvent rester visibles dans la photographie. Les exclusions des zones inspectées sont explicites. Le moteur vérifie le calage source, les surfaces réelles, les obstacles, les autres objets et l’accès avant de convertir un véhicule ; il n’invente pas de position de remplacement.

## Pontons réels

Six axes OSM inchangés sont archivés : `115676052`, `115676056`, `115676057`, `115676059`, `115676060` et `1089398758`. Leurs nœuds WGS84 proviennent de `data/calvi-osm-parts/part-2.osm.xml.gz` et leurs SHA-256 sont conservés. La largeur retenue, environ 2,5 m, est une **estimation visuelle de la photographie**, pas un tag OSM ou un relevé topographique. L’élévation du deck est également artistique.

Les points d’embarquement sont les projections sur ces vrais axes. Le jeu peut autoriser la marche dans leur corridor étroit, y compris au-delà du contour côtier : cette exception ne réécrit ni les polygones terrestres ni la frontière administrative. Un bateau plus distant peut aussi être abordé depuis une autre embarcation ; aucune île ou jetée fictive n’est créée pour rapprocher le joueur.

## Reproduire et contrôler

Les outils nécessitent Pillow et les originaux archivés. Le ZIP de jeu suffit pour jouer ; l’archive distincte des sources contient les photographies nécessaires au réimport.

```sh
python3 -m pip install -r requirements-dev.txt
python3 tools/import-aerial-objects.py
python3 tools/import-aerial-objects.py --check
python3 tools/test-import-aerial-objects.py
```

L’import ne télécharge aucune image et ne modifie aucun original. Les 13 audits contrôlent les 78 empreintes photographiques, le repère et la source vectorielle, les vrais pixels verts et leurs exclusions géographiques, le maquis conservateur, les palmiers et 28 couronnes sombres, les annotations de véhicules, les sources OSM des pontons, les 107 groupes marins et leurs patches d’eau, les avions hors commune et les limites artistiques explicites.
