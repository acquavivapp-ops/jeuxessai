# Hauteurs réelles des bâtiments de Calvi

**1 355 des 3 893 bâtiments de la commune disposent d’une hauteur provenant d’IGN BD TOPO. Les 2 538 autres restent explicitement inconnus.** L’extrait officiel du rectangle communal contient 5 147 objets, dont 38 sans hauteur exploitable. Une empreinte IGN n’est retenue que lorsqu’elle correspond sans ambiguïté à une empreinte OpenStreetMap du jeu ; les deux bases découpent parfois différemment un même ensemble bâti. Les bâtiments du jeu appartiennent à l’extraction de la commune de Calvi, INSEE `2B050`.

L’extrait a été importé le **4 octobre 2026 à 10:50 UTC** depuis le WFS GeoPlateforme, couche `BDTOPO_V3:batiment`, sur l’emprise WGS84 `8.7063593, 42.5150237, 8.8153936, 42.5844865` (ouest, sud, est, nord). Six requêtes paginées de 1 000 objets au maximum sont enregistrées dans le [registre de provenance](calvi-building-heights-provenance.json), avec les comptes, l’emprise et les empreintes SHA-256. La date générale du relevé n’est pas établie : `sourceDate` reste `null`. Les dates de modification des fiches, conservées séparément, ne constituent ni une date de mesure ni une reconstitution de 1994.

## Mesures et raccord aux empreintes

Dans la version livrée, les **1 355 hauteurs viennent directement du champ IGN `hauteur`, en mètres**, entre **1,0 et 22,3 m** ; aucune n’est dérivée. L’importeur peut aussi calculer `altitude_maximale_toit − altitude_minimale_sol` lorsque ces deux altitudes sont présentes et que le champ `hauteur` est absent. Cette méthode est alors explicitement enregistrée sous `roof-max-minus-ground-min`.

Les valeurs disponibles d’altitude minimale et maximale du sol et du toit sont conservées, ainsi que l’identifiant IGN, la méthode d’acquisition et la précision altimétrique annoncée par la source. Les champs absents restent `null`. Une hauteur de catalogue ne décrit pas la forme complète du toit et les méthodes ou précisions peuvent varier entre bâtiments.

Le raccord utilise les polygones réels, avec leurs concavités et leurs trous. Après projection dans le repère local de la carte, il calcule le rapport **intersection / union (IoU)**. Une association doit satisfaire trois conditions :

- Chaque empreinte est le meilleur correspondant de l’autre, dans les deux directions.
- Leur IoU atteint au moins **0,70**.
- L’écart d’IoU avec le deuxième candidat atteint au moins **0,15**, dans les deux directions.

Les correspondances ambiguës, les empreintes trop différentes et les objets sans mesure exploitable restent inconnus. Aucune hauteur n’est empruntée au bâtiment voisin. Les empreintes, voies et collisions de la carte restent celles d’OpenStreetMap.

L’extrait OSM livré ne contient **aucun tag `height`** et possède **24 tags `building:levels`**. Le bilan de chargement est donc **1 355 hauteurs IGN, zéro hauteur OSM déclarée et 2 538 inconnues**. Ces étages ne sont jamais convertis en mètres pour produire une mesure. La photographie aérienne et le modèle de terrain ne servent pas non plus à inventer les hauteurs manquantes.

## Utilisation dans le jeu

Le module [building-height.js](../building-height.js) vérifie la ville, l’emprise, les dimensions du monde et l’empreinte du bâtiment avant de fournir une hauteur. `buildingHeightInfo` distingue une hauteur IGN sourcée (`source`), un éventuel tag OSM en mètres (`reported`) et une hauteur inconnue (`unknown`). Les inconnues portent `heightMeters: null`.

Le rendu utilise les hauteurs connues pour ses volumes, avec une amplitude limitée pour conserver la lisibilité du jeu. Les volumes des bâtiments inconnus, les rangées de fenêtres et les formes de toit restent des choix graphiques. Le jeu présente donc un décor stylisé enrichi de mesures réelles, sans prétendre reproduire un relevé architectural complet. Les altitudes du terrain sont gérées séparément.

## Source, licence et fichiers conservés

La [fiche ISO officielle archivée](calvi-building-heights-license.xml) du produit **IGN BD TOPO** indique : « Licence Ouverte / Open License (compatible ODC-BY, CC-BY 2.0) », et renvoie à [ce document Etalab](https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf). Le numéro `2.0` désigne ici la compatibilité CC-BY ; il n’établit pas une version de Licence Ouverte. `license.version` reste donc `null`.

Attribution à conserver : **« © IGN — BD TOPO — Licence Ouverte / Open Licence »**, accompagnée de la source et des informations de date disponibles. Les empreintes OSM conservent leur attribution distincte **« © OpenStreetMap contributors »** et leur licence ODbL.

| Fichier | Contenu |
|---|---|
| [calvi-building-heights-source.geojson.gz](calvi-building-heights-source.geojson.gz) | Extrait officiel WGS84 archivé, avant raccord aux bâtiments du jeu |
| [calvi-building-heights.js](calvi-building-heights.js) | 1 355 associations avec mesure, empreinte OSM et provenance par objet |
| [calvi-building-heights-provenance.json](calvi-building-heights-provenance.json) | Requête, import, comptes, emprise et SHA-256 |
| [calvi-building-heights-license.xml](calvi-building-heights-license.xml) | Fiche ISO officielle portant la déclaration de licence |

Le GeoJSON décompressé contient **7 056 779 octets**, de SHA-256 `7aa36abcfcbf9bdcc9f34e2619fa32f114fb5a272fc3a4b33dbb5a06dffa3a7a`. Celui de la fiche ISO est `93aaee502a6bbc5b4984f66ae0d3029ab4eae27c35c4260696584be539379b21`. Ces deux empreintes ont été vérifiées sur les fichiers livrés.

## Import et vérification

Depuis le dossier du projet, Python 3 et sa bibliothèque standard suffisent :

```bash
# Consulter les options, sans téléchargement ni modification.
python3 tools/import-building-heights.py --help

# Télécharger explicitement l’extrait officiel et sa fiche de licence.
python3 tools/import-building-heights.py --download

# Refaire le raccord hors ligne depuis l’archive livrée.
# Le fichier d’entrée est positionnel : il n’existe pas d’option --input.
python3 tools/import-building-heights.py \
  data/calvi-building-heights-source.geojson.gz \
  --source-url 'https://data.geopf.fr/wfs' \
  --license-record data/calvi-building-heights-license.xml

# Vérifier les règles de mesure, de raccord et de chargement.
python3 tools/test-import-building-heights.py
node --test tests/building-height.test.js
```

`--source-date` accepte uniquement une date de source documentée ; elle n’est pas renseignée par défaut. `--map` et `--output` permettent de changer les fichiers d’entrée et de sortie. Les GeoJSON locaux peuvent être compressés avec gzip. Pour un autre extrait local, sa source et sa fiche de licence doivent être fournies avec les données : les droits ne se déduisent pas du seul format GeoJSON.

Le téléchargement utilise HTTPS avec vérification TLS, des requêtes bornées et un délai de 30 secondes par requête. Le démarrage du jeu ne lance aucun import. L’importeur valide les coordonnées, les géométries, les mesures et les correspondances avant de remplacer les sorties ; un échec de validation conserve l’extrait existant. Les tests utilisent des géométries synthétiques pour vérifier le calcul, et contrôlent séparément les associations et les inconnues de l’extrait réellement livré.

Sources officielles : [catalogue BD TOPO](https://cartes.gouv.fr/rechercher-une-donnee/dataset/IGNF_BD-TOPO), [WFS GeoPlateforme](https://data.geopf.fr/wfs) et [fiche ISO BD TOPO](https://data.geopf.fr/csw?REQUEST=GetRecordById&SERVICE=CSW&VERSION=2.0.2&OUTPUTSCHEMA=http%3A%2F%2Fstandards.iso.org%2Fiso%2F19115%2F-3%2Fmdb%2F2.0&elementSetName=full&ID=IGNF_BD-TOPO).
