# Calvi : commune réelle et géométrie OpenStreetMap

La carte couvre la **commune de Calvi, INSEE 2B050**, selon sa relation administrative OpenStreetMap **1151255**, avec ses cinq polygones. La surface calculée dans la projection locale est d’environ **31,61441 km²** ; c’est une estimation géométrique du contour OSM, pas une surface cadastrale officielle.

[calvi-map.js](calvi-map.js) conserve **1 552 tronçons de voies, 3 893 empreintes de bâtiments, 313 aires, 28 repères nommés et huit polygones de terre**. Le centre, la citadelle, la gare, le littoral de la Pinède, la Revellata et le secteur de l’aéroport appartiennent à cette extraction. Calvi est la seule carte jouable.

| Champ | Valeur |
|---|---|
| Contour administratif | Relation OSM `1151255`, `admin_level=8`, `ref:INSEE=2B050` |
| Emprise WGS84, ouest / sud / est / nord | `8.7063593, 42.5150237, 8.8153936, 42.5844865` |
| Rectangle englobant sur le terrain | Environ `8,94 × 7,73 km` |
| Dimensions du monde | `35766.74 × 30930.25` pixels |
| Projection | Équirectangulaire locale à la latitude moyenne, nord en haut |
| Échelle | Quatre pixels par mètre |

Le rectangle sert aux requêtes et à la projection. **La limite jouable suit les vrais polygones communaux**, avec leurs trous et îlots. Les routes sont découpées à ce contour ; les empreintes et aires retenues gardent leur géométrie source. Le contour OSM est une représentation administrative actuelle, distincte d’un relevé IGN cadastral ou d’une frontière historique de 1994.

## Extraits archivés et provenance

Le contour a été récupéré le **4 octobre 2026 à 10:32 UTC** depuis [l’API publique OSM de la relation complète](https://api.openstreetmap.org/api/0.6/relation/1151255/full). Tous ses membres et nœuds sont présents ; aucune arête manquante n’est fabriquée pour fermer un polygone.

Le téléchargement des objets a utilisé **quatre requêtes bornées** entre **10:33:57 et 10:34:02 UTC**, sur le rectangle communal légèrement élargi pour conserver les objets de bord. Les réponses originales sont conservées dans [calvi-osm-parts](calvi-osm-parts), avec leurs URL, heures, tailles et SHA-256 dans [calvi-osm-download-provenance.json](calvi-osm-download-provenance.json).

L’assemblage [calvi-osm.xml.gz](calvi-osm.xml.gz) contient **83 877 nœuds, 8 412 chemins et 89 relations** avant filtrage communal. Il déduplique les objets par type et identifiant en gardant la plus haute version réellement téléchargée. Les coordonnées, géométries et tags restent ceux des réponses source. Les quatre requêtes ne forment pas un instantané global atomique : leurs heures individuelles restent documentées et `osmTimestamp` demeure vide.

| Archive | SHA-256 du contenu décompressé |
|---|---|
| [calvi-osm.xml.gz](calvi-osm.xml.gz), `20 322 773` octets XML | `0ba6530cd231d4eb22749450014d9e6ab103359899c22cfeccc276f65bfa6baf` |
| [calvi-boundary-source.osm.xml.gz](calvi-boundary-source.osm.xml.gz), `483 356` octets XML | `afc74c3c2cfcd9f6769be76b76911e6a223a38317e8e888e3ba8d745407246de` |

Ces empreintes ont été vérifiées sur les archives livrées. [calvi-boundary.geojson](calvi-boundary.geojson) contient le contour converti ; [calvi-boundary-provenance.json](calvi-boundary-provenance.json) conserve ses identifiants, tags, source et méthode de calcul de surface. [calvi-provenance.json](calvi-provenance.json) décrit la carte projetée et ses comptes ; [calvi-source-ids.csv](calvi-source-ids.csv) conserve les identifiants des voies et bâtiments.

## Géométrie réelle et interprétation du jeu

Les axes de voies, empreintes obliques, cours intérieures, nœuds, niveaux, ponts, tunnels et littoral viennent des données source. Les largeurs de chaussée sont **illustratives, déduites de la catégorie OSM**, et ne constituent pas une mesure. Les véhicules utilisent une capsule de collision de `16 × 30` pixels choisie pour le jeu. Les approches des trois missions et leurs parkings restent dans la composante routière accessible depuis le départ.

Les sept identités de lieux du jeu sont le port, la citadelle, la gare, la plage, la Pinède, la Revellata et l’aéroport. Leurs étiquettes reprennent des nœuds ou une position sur la géométrie source. Lorsque la moyenne d’une aire tombe hors du contour communal, un sommet source inclus sert d’étiquette. Le bassin du port est hors de certains polygones administratifs côtiers : son **quartier artistique** est indiqué sur un vrai point de rue voisin, avec la méthode et cette approximation enregistrées ; la marina n’est pas déplacée. Ces repères ne prétendent pas mesurer des entrées ou tracer des frontières de quartiers.

Les missions, personnages, enseignes et accessoires des années 1990 restent des créations de fiction. Les cibles de mission ne décrivent pas les occupants réels ; leur sélection exclut les bâtiments nommés, institutions, lieux religieux, patrimoine et empreintes sans mur ou interdites d’accès. Les rues, le bâti et les photographies actuels ne prouvent pas leur état de 1994. Les objets ajoutés restent bornés : jusqu’à 32 voitures garées, six en circulation, 80 passants et 1 100 accessoires terrestres, plutôt qu’une population proportionnelle à toute la surface.

L’orthophoto et les altitudes IGN sont des sources distinctes, documentées dans [CALVI_IMAGERY.md](CALVI_IMAGERY.md), [ELEVATION.md](ELEVATION.md) et [BUILDING_HEIGHTS.md](BUILDING_HEIGHTS.md). Aucun fond Google Maps ou autre jeu de tuiles commerciales n’est utilisé.

## Droits et attribution

Les géométries proviennent des [contributeurs OpenStreetMap](https://www.openstreetmap.org/copyright), sous [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). L’attribution **« © OpenStreetMap contributors »** et la référence à cette licence doivent accompagner leur utilisation. Toute redistribution de la base dérivée doit respecter les conditions ODbL ; les archives et provenances conservées permettent de retrouver les données source. Les graphismes originaux du jeu et les produits IGN gardent leurs droits et attributions distincts.

## Import reproductible

Depuis la racine du projet, Python 3 suffit. Régénération hors ligne depuis les sources livrées :

```sh
python3 tools/import-boundary.py \
  --input data/calvi-boundary-source.osm.xml.gz

python3 tools/import-calvi.py \
  --input data/calvi-osm.xml.gz \
  --boundary data/calvi-boundary.geojson \
  --download-provenance data/calvi-osm-download-provenance.json \
  --source-url 'https://api.openstreetmap.org/api/0.6/map?bbox=8.706159300000001,42.5148237,8.760876450000001,42.5497551'
```

Le champ `sourceRequests` conserve les quatre requêtes, même si `sourceUrl` désigne la première. Pour renouveler explicitement les sources publiques, puis réimporter :

```sh
python3 tools/import-boundary.py --download
python3 tools/download-osm-municipality.py --download
# Exécuter ensuite la commande import-calvi.py ci-dessus.
```

`--boundary` impose l’emprise réelle du contour et remplace un éventuel `--bounds`. L’importeur accepte aussi du JSON Overpass authentique avec `out geom`. Il refuse les membres de bâtiments incomplets et un littoral impossible à reconstituer à partir des seuls tronçons source. Les données et trois approches accessibles doivent être valides pour activer la carte ; sinon elle est signalée indisponible, sans charger de ville de remplacement. Aucun téléchargement n’est exécuté au démarrage ou pendant le jeu.

```sh
python3 tools/test-import-calvi.py
node --test tests/world-population.test.js
```

Les contrôles couvrent l’extraction réelle, les cours, limites et masques côtiers, l’accès aux véhicules, le maintien des voies dégagées, les repères géographiques et les limites de population.
