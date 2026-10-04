# Cellules photographiques pour les vaguelettes

[calvi-water-surface.js](calvi-water-surface.js) contient **698 grilles de
32 × 32 cellules**, calculées hors ligne à partir des **698 JPEG réels IGN
BD ORTHO** du jeu : 288 tuiles communales et 410 tuiles fines. Le fichier
pèse **388 981 octets**. Il ne modifie ni les photos, ni le manifeste aérien.

Ces grilles servent à placer de petites vaguelettes animées dans des zones
de photographie probablement marines, en évitant notamment les bateaux
blancs et les quais. Elles ne décrivent pas une profondeur, une côte mesurée,
une reconnaissance exhaustive des bateaux ou une collision navigable.
Le masque marin OSM reste une condition indépendante obligatoire.

Chaque cellule candidate exige que **tous ses pixels JPEG originaux**
respectent les quatre conditions suivantes :

- bleu moins rouge ≥ 8 ;
- bleu moins vert ≥ 2 ;
- bleu ≥ 25 ;
- luminance de la conversion Pillow RGB vers L ≤ 110.

Un seul pixel rejeté annule la cellule : les pixels blancs d'un bateau ne
sont pas dilués dans une moyenne d'eau bleue. Ce choix conservateur exclut
également une partie de l'eau claire, de l'écume et des bords de quai. Des
objets sombres bleutés peuvent encore partager les couleurs de l'eau ; il
ne s'agit pas d'une classification sémantique parfaite.

Le découpage en pixels suit les bornes entières
`floor(colonne × largeur / 32)` et `floor(ligne × hauteur / 32)`. Les dernières
colonnes et lignes gardent tous les pixels, y compris dans les tuiles de
bord incomplètes. L'écart entre cette partition entière et une grille
continue reste inférieur à un pixel source.

Chaque entrée conserve `id`, `lod`, `url`, `sha256`, les dimensions réelles,
`boundsWorld`, `columns`, `rows` et `bitsHex`. Les 1 024 bits utilisent
**128 octets**, rangés ligne par ligne, bit de poids fort en premier.
Le niveau fin `lod: 1` prévaut sur `lod: 0` dans son emprise : une cellule
fine refusée ne doit pas être remplacée par une cellule communale acceptée.
Les deux extrémités d'une vaguelette doivent passer les contrôles
photographiques et marins. Les couleurs archivées servent également la
nuit ; le cycle d'éclairage du jeu ne refait pas la classification.

Le navigateur n'a pas besoin de lire les pixels de son canvas ou de
recalculer les grilles. La donnée conserve les bornes WGS84 et dimensions
du monde, les SHA-256 du manifeste aérien et de la carte vectorielle, la
licence et chaque JPEG source, afin de refuser une association à une autre
carte ou photographie.

Développement avec Python 3 et Pillow épinglé dans
[requirements-dev.txt](../requirements-dev.txt), depuis la racine :

```sh
python3 tools/import-water-surface.py
python3 tools/import-water-surface.py --build --workers 2
python3 tools/test-import-water-surface.py
python3 tools/import-water-surface.py --check --workers 2
```

La première commande affiche le plan sans mutation. `--build` est explicite
et n'effectue aucun téléchargement. `--check` relit et vérifie les SHA-256,
les emprises et les dimensions des **698 photos**, puis recalcule toutes les
cellules et les compare à la donnée conservée. Les **8 tests hors réseau**
contrôlent les couleurs connues, le refus d'un unique pixel blanc, les bords
incomplets, l'ordre des bits, les URL locales, les empreintes et la
correspondance géographique. Les images synthétiques de test ne deviennent
jamais des assets du jeu. Sans Pillow, les cinq tests de pixels sont ignorés.

Attribution photographique : **© IGN — BD ORTHO — Licence Ouverte / Open
Licence**. La [fiche ISO IGN archivée](calvi-imagery-tiles-license.xml) et la
[provenance de l'atlas](CALVI_IMAGERY_TILES.md) restent la référence. La donnée
vectorielle marine garde séparément l'attribution OSM et sa licence ODbL.
