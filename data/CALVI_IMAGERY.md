# Orthophotographie authentique et atlas détaillé de Calvi

L’[atlas local détaillé](calvi-imagery-tiles.json) couvre toute l’emprise
communale à environ **0,5 m par pixel** : **17 884 × 15 466 pixels** au total,
répartis en **288 tuiles de jeu de 1 024 pixels au maximum**. Les vrais toits,
arbres, routes et quais viennent de nouvelles réponses aériennes IGN ; ils ne
sont pas extrapolés depuis l’ancienne image de 4 096 pixels. Un aperçu de
**1 024 × 886 pixels** sert de fond léger pendant le chargement local.

Les **72 réponses originales de 2 048 pixels au maximum** restent archivées.
Leur découpage conserve les pixels et les coordonnées ; seul un réencodage
JPEG intervient. Les données occupent **54,40 Mo pour les tuiles de jeu**,
**0,27 Mo pour l’aperçu** et **55,28 Mo pour les réponses originales**.
Le [dossier de l’atlas](CALVI_IMAGERY_TILES.md) décrit les emprises, la mémoire
de décodage, les transformations, les contrôles et les commandes reproductibles.
Les archives originales peuvent être distribuées séparément du ZIP jouable ;
elles sont nécessaires pour vérifier tous les octets source ou réimporter
hors ligne, mais le jeu ne les charge pas.

## Image municipale conservée

**Une vraie orthophoto IGN couvre désormais le rectangle englobant toute la commune de Calvi, INSEE 2B050.** Le fichier [calvi-orthophoto.jpg](../assets/calvi-orthophoto.jpg), **4 096 × 3 542 pixels**, a été décodé et inspecté : citadelle, port, plages, Revellata et aéroport sont reconnaissables. Le [registre de provenance](calvi-imagery-provenance.json) porte le statut `ready`, avec emprise, dimensions, source et SHA-256. Le JPEG original de **2 890 277 octets** est conservé sans retouche. Téléchargement : **4 octobre 2026, 10:50 UTC** ; la date locale de prise de vue reste inconnue.

La source est **IGN GeoPlateforme, BD ORTHO**, couche `ORTHOIMAGERY.ORTHOPHOTOS`. Il s’agit de **photographies aériennes orthorectifiées**. La configuration officielle IGN identifie cette couche, son producteur et son catalogue. La documentation officielle décrit BD ORTHO comme un fond aérien haute résolution, nominalement 20 cm ; cela ne détermine ni le millésime local ni la résolution native disponible sur Calvi dans la mosaïque actuelle.

## Emprise et placement

L’importeur lit l’emprise et les dimensions du module [calvi-map.js](calvi-map.js). Pour la version livrée :

| Champ | Valeur |
|---|---|
| Ouest, sud, est, nord | `8.7063593, 42.5150237, 8.8153936, 42.5844865` |
| Export demandé | `4096 × 3542` pixels JPEG |
| Système | WGS84, `EPSG:4326` |
| Protocole | WMS 1.3.0, axes latitude puis longitude |
| BBOX du service | `42.5150237,8.7063593,42.5844865,8.8153936` |
| Orientation de l’image | Est à droite, sud en bas |
| Dimensions du monde | `35766.74 × 30930.25` pixels |
| Placement dans le jeu | `x = u × worldWidth / imageWidth`, `y = v × worldHeight / imageHeight` |

Cet export correspond approximativement à **2,18 m par pixel** sur le terrain. Le nombre de pixels de l’export ne constitue pas une mesure de précision. La projection locale du jeu conserve des coordonnées linéaires en longitude/latitude ; l’image WMS demandée dans le même système se place donc sans rotation ni recadrage manuel. Une mosaïque WMTS en Web Mercator nécessiterait une transformation différente et ne peut pas être substituée avec cette formule sans reprojection.

Le WMS fournit un rectangle, qui comprend aussi de la mer et du terrain extérieur à Calvi. **Ce rectangle photographique ne devient pas une nouvelle limite jouable.** La carte et son rendu utilisent le contour communal OSM documenté dans [SOURCES.md](SOURCES.md), ainsi que les masques de terre et d’eau. Les bâtiments et routes restent ceux des vecteurs ; la photographie ne sert pas à tracer une rue supplémentaire.

## Droits et dates

Le raster et sa provenance sont disponibles localement ; le jeu ne dépend pas du service IGN pour démarrer ou fonctionner. Son SHA-256 vérifié est `4a60ad0c960bafcc2673563e9cfae4a7a774ef23f344f6c41fcff735628fa19b`.

**La fiche ISO officielle BD ORTHO confirme « Licence Ouverte / Open License (compatible ODC-BY, CC-BY 2.0) ».** Le registre conserve cette déclaration exacte, le lien PDF fourni par IGN et l’empreinte SHA-256 de la fiche. Le numéro **2.0** de cette phrase désigne la licence CC-BY compatible ; il ne prouve pas un numéro de version de Licence Ouverte. Le champ `license.version` reste donc `null`. L’attribution à conserver est **« © IGN — BD ORTHO — Licence Ouverte / Open Licence »**, avec la source et les informations de date. L’importeur refuse d’installer un raster si sa fiche officielle n’établit pas de licence ouverte.

La couche courante est une mosaïque : **la date locale de prise de vue est inconnue**. Le téléchargement ne constitue pas une date de capture et l’imagerie actuelle n’est pas une reconstitution de 1994. La configuration IGN renvoie au document des dates de prise de vue ; sa date locale devra être vérifiée séparément. Une orthophoto reste un fond 2D : elle ne fournit pas, à elle seule, la hauteur mesurée des bâtiments ou un relevé de relief au sol.

## Commandes et validation

Depuis le dossier du projet :

```bash
# Afficher la requête officielle exacte, sans accès réseau ni changement.
python3 tools/import-imagery.py --width 4096 --height 3542

# Tester la validation du protocole, des réponses et de la préservation.
python3 tools/import-imagery.py --self-test

# Importer lorsque l’environnement peut joindre data.geopf.fr.
python3 tools/import-imagery.py --download --width 4096 --height 3542

# Vérifier le JPEG local, sans le retoucher ni le remplacer.
python3 tools/import-imagery.py --check-image assets/calvi-orthophoto.jpg
```

Les dimensions sont explicites pour reproduire l’image livrée : la largeur par défaut du CLI est encore `1024`. Le téléchargement n’est jamais exécuté par le jeu ni par son démarrage. L’importeur utilise HTTPS avec vérification TLS et un délai de 20 secondes par requête. Il refuse les documents XML/HTML et erreurs OGC, les tailles incohérentes, les images vides, et les métadonnées de licence insuffisantes. Si Pillow est disponible, le JPEG est entièrement décodé pour vérifier son contenu et sa taille ; ce contrôle ne modifie pas les octets d’origine. Les sorties sont préparées avant remplacement ; un échec conserve l’image et la provenance existantes.

Les fichiers conservés sont [calvi-orthophoto.jpg](../assets/calvi-orthophoto.jpg) et [calvi-imagery-provenance.json](calvi-imagery-provenance.json), avec dimensions, emprise, requête, SHA-256, provenance des droits et date de téléchargement. La date de capture reste inconnue tant qu’elle n’est pas établie. Cette image fournit l’aperçu de l’atlas et reste un secours compatible ; son archive originale est intacte. Les tuiles détaillées possèdent leur propre manifeste et leurs nouvelles requêtes IGN. Les vecteurs et volumes superposés utilisent la même projection géographique. Les photographies restent un fond 2D ; leurs ombres ne servent pas à inventer des altitudes.

## Sources officielles consultées

- [Configuration IGN : couche, catalogue et dates des photographies aériennes](https://github.com/IGNF/geoportal-configuration/blob/9e6cf3d372aff08d5266d90d52be25e42e1043b1/entreeCarto.json).
- [Configuration IGN : point d’accès public WMS raster](https://github.com/IGNF/geoportal-configuration/blob/9e6cf3d372aff08d5266d90d52be25e42e1043b1/core/requester.py).
- [Documentation IGN du produit BD ORTHO](https://github.com/IGNF/cartes.gouv.fr-documentation/blob/56ad829110d4d64e3832810b15f9ae0460bda8f2/content/fr/partenaires/ign/observations-regulieres-territoire/imagerie/bd-ortho.md).
- [Fiche catalogue BD ORTHO](https://cartes.gouv.fr/rechercher-une-donnee/dataset/IGNF_BD-ORTHO) et [fiche ISO téléchargée](https://data.geopf.fr/csw?REQUEST=GetRecordById&SERVICE=CSW&VERSION=2.0.2&OUTPUTSCHEMA=http%3A%2F%2Fstandards.iso.org%2Fiso%2F19115%2F-3%2Fmdb%2F2.0&elementSetName=full&ID=IGNF_BD-ORTHO).
- [Licence Ouverte : document exact référencé par IGN](https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf) ; [texte général actuel Etalab](https://github.com/etalab/licence-ouverte/blob/master/LO.md).

Les contrôles de l’importeur couvrent les axes WMS, le rejet XML/HTML, les tailles incohérentes, la licence explicite et la préservation en cas d’échec. Le JPEG communal livré a également été décodé en entier, contrôlé visuellement, et son SHA-256 concorde avec la provenance.
