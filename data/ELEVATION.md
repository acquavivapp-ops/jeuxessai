# Calvi : terrain communal IGN LiDAR HD, détail urbain et secours SRTM

Le relief principal couvre la **commune réelle de Calvi, INSEE `2B050`**,
sur les mêmes bornes WGS84 que la carte OSM : ouest `8.7063593`, sud
`42.5150237`, est `8.8153936`, nord `42.5844865`. Le
[MNT communal IGN LiDAR HD](calvi-lidar-elevation.js) contient **449 × 388
échantillons**, espacés de **19,959 m** d’est en ouest et **19,981 m** du
nord au sud, première ligne au nord.

Les **79 276 nœuds situés sur les terres de la commune ont tous une
altitude source valide** ; aucun nœud terrestre ne manque. Les **94 936
autres cellules**, en mer ou hors des terres administratives de Calvi,
restent explicitement `null`. Ces cellules ne sont ni une bathymétrie ni
des altitudes de remplacement. Les altitudes terrestres conservées vont
de **−0,440 à 701,625 m**. Le MNT décrit le terrain ; les hauteurs des
bâtiments BD TOPO sont une autre source.

## Détail urbain conservé à ses coordonnées réelles

L’ancien MNT du centre reste disponible dans
[calvi-lidar-urban-elevation.js](calvi-lidar-urban-elevation.js), avec son
[archive BIL](calvi-source-lidar-urban-mnt.bil), sa
[provenance](calvi-lidar-urban-elevation-provenance.json) et sa
[fiche de licence ISO](calvi-lidar-urban-elevation-license.xml).
Il contient **173 × 224 = 38 752 altitudes valides**, à environ **5 m**
(`5,005 m` d’est en ouest, `4,992 m` du nord au sud). Ses bornes restent
ouest `8.7545`, sud `42.560`, est `8.765`, nord `42.570`, et ses altitudes
vont de **−0,466 à 63,857 m**.

[terrain.js](../terrain.js) retrouve ce détail par ses coordonnées WGS84
à l’intérieur du MNT communal. Une bande d’interpolation de **40 m**
rejoint les deux grilles aux bords du détail urbain. Cette grille conserve
son emprise et son échelle propres ; elle n’est jamais étirée sur la
commune. Elle apporte le détail conservé de la citadelle et du port sans
déplacer leurs positions géographiques.

Cette fusion assure la continuité du rendu et des pentes utilisées par le
jeu. Ses valeurs interpolées sont calculées à partir des deux sources ;
elles ne constituent pas de nouvelles mesures du terrain.

## Sources LiDAR, géoréférencement et droits

Couche officielle : `IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G`,
service <https://data.geopf.fr/wms-r/wms>. Les réponses originales sont des
BIL float32 little-endian, une bande, première ligne au nord.

| Source conservée | Taille | SHA-256 |
| --- | ---: | --- |
| [MNT communal](calvi-source-lidar-mnt.bil) | 696 848 octets | `05c32153225330a038e6a32d1e1ad687d5c14265fe8d10649123034f4df13de3` |
| [Détail urbain](calvi-source-lidar-urban-mnt.bil) | 155 008 octets | `f02a99b55ad1e227fff82e56f7c6d277142d03fb186b15df0668b17069d3d83d` |

Les provenances [communale](calvi-lidar-elevation-provenance.json) et
[urbaine](calvi-lidar-urban-elevation-provenance.json) conservent les URL
GetMap complètes, les bornes des nœuds, les bornes des demandes WMS, les
dimensions, les empreintes et les en-têtes reçus. Les téléchargements
archivés datent du **4 octobre 2026**.

En WMS 1.3.0 / EPSG:4326, la BBOX suit l’ordre **latitude, longitude**.
Les altitudes sont au centre des cellules WMS. L’importeur étend donc la
demande d’un **demi-pas** sur chaque bord pour aligner les premiers et
derniers échantillons sur les bornes du monde. La demande WMS est ainsi
légèrement plus large que l’emprise des nœuds, sans déplacer la côte.

La fiche officielle `IGNF_MNT-LIDAR-HD`, archivée pour les deux imports
dans les fichiers ISO [communal](calvi-lidar-elevation-license.xml) et
[urbain](calvi-lidar-urban-elevation-license.xml), autorise la **Licence
Ouverte / Open Licence** et renvoie au
[texte Etalab](https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf).
Son SHA-256 est
`d4aa95cb6a7aee9d968eaa4b4491facabc9be1e3e60c502f15b209ef9c3eef3e`.
La version de cette licence reste **inconnue (`null`)** dans les
métadonnées : la compatibilité CC-BY 2.0 ne précise pas une version de la
Licence Ouverte. Attribution : **© IGN — MNT LiDAR HD — Licence Ouverte /
Open Licence**.

La fiche décrit un produit natif au pas de **50 cm**. Les grilles du jeu
sont les sous-ensembles WMS échantillonnés à environ **20 m** pour la
commune et **5 m** pour le centre ; le rendu ne revendique pas la résolution
native de 50 cm. Aucun nuage COPC complet n’est reconstruit localement.

L’IGN annonce le bloc LiDAR HD **US (Calvi)** dans ses
[publications d’octobre 2025](https://github.com/IGNF/cartes.gouv.fr-documentation/blob/56ad829110d4d64e3832810b15f9ae0460bda8f2/content/fr/partenaires/ign/generalites-ign/actualites/2025-10-mises-a-jour.md).
La [présentation officielle des produits dérivés](https://github.com/IGNF/cartes.gouv.fr-documentation/blob/56ad829110d4d64e3832810b15f9ae0460bda8f2/content/fr/partenaires/ign/generalites-ign/actualites/2025-03-lidarhd-et-produits-derives.md)
confirme leur diffusion en licence ouverte. La date locale de survol et
le référentiel vertical local restent **non établis** dans la provenance.
Une date de publication ou de téléchargement ne constitue pas une date
d’acquisition. Ces données actuelles ne reconstituent pas Calvi en 1994.

## Import LiDAR communal reproductible

Depuis la racine du projet, pour renouveler explicitement le sous-ensemble
de la carte communale et sa fiche de licence :

```sh
python3 tools/import-lidar-elevation.py --download --spacing-metres 20
```

Le pas par défaut de l’option `--spacing-metres` est **20 m**.
`--map` permet de choisir le module cartographique source ; son défaut est
`data/calvi-map.js`.

Pour régénérer la grille communale depuis les sources archivées, sans
réseau, avec les dimensions exactes de la réponse conservée :

```sh
python3 tools/import-lidar-elevation.py \
  --map data/calvi-map.js \
  --columns 449 --rows 388 \
  --input data/calvi-source-lidar-mnt.bil \
  --source-provenance data/calvi-lidar-elevation-provenance.json \
  --license-record data/calvi-lidar-elevation-license.xml
```

Ces commandes ciblent le module communal et ses fichiers compagnons.
L’archive urbaine possède une autre emprise et d’autres dimensions ; elle
ne doit pas être passée à cette commande avec la carte communale.

L’importeur utilise la bibliothèque standard Python. Il vérifie le hash,
l’URL, les dimensions et le géoréférencement lors de l’import hors ligne,
ainsi que la licence officielle du produit. Les réponses XML/HTML, les
images et les BIL tronqués sont refusés. Les valeurs non finies ou nodata
sur les terres de la commune sont refusées avant le remplacement des
sorties ; les cellules hors de ce masque terrestre restent `null`.
Aucune altitude générée ne comble un trou dans la source.

## Secours SRTM communal compatible

Le [module SRTM](calvi-elevation.js) a lui aussi été régénéré sur les
**bornes communales exactes** : **394 × 252 échantillons**, espacés de
**22,752 m** d’est en ouest et **30,807 m** du nord au sud. Sa
[provenance](calvi-elevation-provenance.json) enregistre un import le
**4 octobre 2026 à 10:50 UTC**, avec des altitudes de **−8,408 à 702,519 m**.
La tuile source comporte **3 601 × 3 601 nœuds**, au pas d’une seconde
d’arc. L’ancienne découpe urbaine de 39 × 37 nœuds n’est pas étirée pour
produire cette nouvelle grille.

Par défaut, `terrain.js` choisit le MNT LiDAR communal lorsqu’il est valide,
puis le SRTM s’il ne l’est pas. L’attachement vérifie les bornes WGS84 et
les dimensions physiques de la carte : une grille d’une autre emprise
reste non attachée. Le secours SRTM actuel passe cette vérification pour
la carte communale. Le détail urbain LiDAR s’ajoute seulement au MNT IGN
compatible, sans se substituer au SRTM.

Source : **Shuttle Radar Topography Mission (NASA/NGA)**, campagne de
février 2000, produit **SRTM GL1** distribué par l’USGS, altitude
orthométrique en mètres, référence verticale **EGM96**. Les données sont
dans le **domaine public**. Attribution conservée : **SRTM data courtesy
of the U.S. Geological Survey**.

Le [GeoTIFF source](calvi-source-N42E008.tif), de **2 994 792 octets**, reste
conservé sans modification. SHA-256 :
`cdc460b1feadf3c59d257d16714bfc694bf98aacbdb98765b9a3af5617ee9cf1`.
Il provient du [miroir public SRTM](https://github.com/fafa1899/SRTM),
au commit immuable `fd7a14a17517ab31798b7ace0a5d1fe8a8416433` :

<https://raw.githubusercontent.com/fafa1899/SRTM/fd7a14a17517ab31798b7ace0a5d1fe8a8416433/SRTM-GL1/Eurasia/N42E008.tif>

La politique SRTM figure dans les
[attributions des données terrain Tilezen](https://github.com/tilezen/joerd/blob/master/docs/attribution.md#srtm),
qui renvoient à l’USGS et à la publication NASA des données mondiales à
30 m. Les droits des importeurs et des dessins originaux sont distincts
de ceux des données géographiques ; l’attribution OSM/ODbL reste applicable
à la carte.

Pour régénérer le secours communal hors ligne depuis la racine du projet :

```sh
python3 tools/import-elevation.py \
  --input data/calvi-source-N42E008.tif \
  --bounds 8.7063593,42.5150237,8.8153936,42.5844865 \
  --downloaded-at '2026-10-04T06:35:09.677001+00:00'
```

Pour renouveler explicitement le téléchargement depuis le même commit :

```sh
python3 tools/import-elevation.py --download \
  --bounds 8.7063593,42.5150237,8.8153936,42.5844865
```

Les bornes explicites sont nécessaires : le défaut de l’importeur SRTM
reste l’ancien centre urbain. Ces commandes n’écrivent pas le module
LiDAR. L’importeur accepte également les tuiles HGT `.hgt` ou `.hgt.gz`
de 1 201 × 1 201 ou 3 601 × 3 601 échantillons. Pour une autre archive,
indiquer l’URL réelle avec `--source-url` et le chemin correspondant avec
`--archive`. Il respecte les pixels `PixelIsPoint`/`PixelIsArea` et refuse
les extraits incomplets et les valeurs manquantes avant l’écriture.

## Limites physiques et vérifications

SRTM mesure une **surface radar** : végétation, toitures, bruit côtier et
interpolation peuvent influencer ses altitudes. Il ne constitue pas un
relevé au sol IGN. Les grilles de 20 m et de 5 m et leur interpolation
lissent les marches, les remparts verticaux et les petits détails de
voirie. L’arrondi au millimètre sert au stockage et ne garantit aucune
précision de mesure au millimètre. Les tags OSM `ele` ne fabriquent pas
le relief.

Les faibles altitudes côtières négatives restent conservées. L’eau utilise
un masque côtier et un niveau plat. Les collisions et la conduite se
déroulent dans le plan, avec un effet modéré des pentes sur la vitesse.
Aux bords côtiers, l’interpolation utilise les échantillons terrestres
valides sans transformer les cellules `null` en mesures à zéro mètre.

Les contrôles disponibles depuis la racine du projet sont :

```sh
node --test tests/terrain.test.js
python3 tools/import-lidar-elevation.py --self-test
python3 tools/test-import-elevation.py
```

Ils couvrent le géoréférencement, les unités, les pixels des archives,
les valeurs manquantes, la licence IGN et la compatibilité des emprises.
Les fixtures synthétiques restent des données de test.
