# CALVI LA VIE — direction artistique v19

La v19 étend la maquette dessinée à **toute la vraie carte de Calvi**. Le résultat vise une ville d’arcade des années 90, en vue aérienne **2,5D**, avec une matière illustrée et des touches modernes de volume, lumière et profondeur. La configuration géographique reste celle du monde importé ; le traitement graphique habille ses formes.

## Une géographie conservée, des matières dessinées

Les coordonnées, voies, empreintes bâties, littoral, contour communal, relief et observations restent stables. Les **1 552 tronçons routiers**, **3 893 empreintes bâties**, six axes de pontons et repères de Calvi conservent leurs positions source. La ville n’est pas redessinée librement pour composer un joli quartier à la place du vrai plan.

Les matières de `assets/calvi-illustrated-materials.png`, en grille **3 × 3**, réunissent les surfaces de sol, eau, voirie, pierre, toitures et végétation. La photographie IGN reste une source archivée, avec requêtes et empreintes ; elle n’est plus affichée sous le joueur, sur les toits ou dans le feuillage. Elle continue d’expliquer les observations végétales et les positions de véhicules retenues.

L’unité visuelle vient d’une palette commune, de petites variations de matière et d’ombres lisibles. Pierre claire, sable chaud, toits terracotta et végétation olive portent le jour ; bleu pétrole, cyan, corail et fenêtres chaudes portent la nuit. Les silhouettes conservent des contours francs et une animation d’arcade. Aucun sprite, texture, logo ou morceau de GTA ou Nintendo n’est repris.

## Sol, mer et routes

Les surfaces terrestres suivent les contours et emprises importés. Les changements entre pierre urbaine, terre, sable et végétation aident à lire l’espace sans modifier ses accès physiques. Les textures s’ancrent au monde : elles doivent rester stables pendant les mouvements de caméra et le changement de zoom.

La mer est dessinée, avec des variations de bleu et un **clapotis léger**. Les ondulations et reflets suivent le temps actif, s’arrêtent en pause et respectent les zones d’eau. Le rivage, les quais et les pontons doivent rester compréhensibles ; un motif décoratif ne doit pas donner l’impression qu’une coque peut traverser la terre.

Les routes suivent les vrais axes, courbes et raccords du réseau importé. Leur traitement distingue la chaussée, les bords et les intersections selon la catégorie disponible. Largeurs et détails ajoutés pour le jeu restent des estimations artistiques ; ils n’affirment pas un relevé exact de chaque trottoir, marquage ou voie de Calvi.

## Bâtiments et relief

Chaque bâtiment garde son empreinte OSM. Façades, étages, corniches, ouvertures et toits sont dessinés sur le volume correspondant. Les variations de pierre et de toiture renforcent le relief de la ville sans décaler un bâtiment ou étendre arbitrairement sa collision.

Les **1 355 hauteurs IGN BD TOPO raccordées** restent utilisées. Les **2 538 autres empreintes** gardent un gabarit artistique ou une indication OSM exploitable. Une indication d’étages n’est pas une hauteur mesurée. La texture et les détails de façade ne certifient pas l’apparence réelle de chaque construction.

Le terrain conserve le **MNT IGN LiDAR HD**, à environ **20 m**, avec l’extrait urbain à **5 m** et sa transition documentée. Ombres, pentes et bâtiments se lisent sur ce relief ; le dessin ne crée pas une nouvelle montagne ou ne lisse pas les hauteurs pour changer le trajet. La transparence de confort des bâtiments aide à voir le personnage masqué par un toit.

## Végétation et profondeur

Les **12 000 groupes végétaux**, dont 8 475 couronnes ou groupes boisés et 3 525 groupes bas, gardent les emplacements et silhouettes issus des observations. Les **32 observations manuelles** conservent 28 arbres sombres et quatre palmiers. Leur matière devient illustrée, avec petites variations de feuilles, volumes et ombres ; leurs coordonnées ne changent pas pour remplir arbitrairement le décor.

Le petit tronc d’implantation estimée demeure un obstacle physique. Le maquis bas ralentit et couvre les jambes ; les grands buissons peuvent bloquer. Une couronne n’est pas un mur entier : le personnage peut passer dessous, puis être masqué par le feuillage à la bonne profondeur. Pied du tronc et ombre restent ancrés au sol. Ces silhouettes, positions et hauteurs artistiques ne constituent pas un recensement mesuré d’arbres individuels.

## Personnages et transports

Les personnages conservent tenues olive, cagoules noires et regards expressifs. Leurs noms, biographies, répliques et textes de présentation restent retirés. Les portraits et silhouettes sont originaux ; leurs accessoires servent la lecture visuelle sans imposer de nouveau texte narratif.

Les **251 véhicules issus des observations**, dont 96 voitures, 153 bateaux et deux avions, gardent leur position photographique. Ils sont dessinés comme acteurs utilisables ; le sol illustré ne contient plus leurs anciennes silhouettes fixes. Les 40 placements fictifs ou véhicules de trafic restent distincts. La couverture ne prétend pas recenser tous les véhicules de la commune, et vingt observations exclues restent archivées.

La voiture montre carrosserie, vitres et phares ; la moto, roues et pilote ; le bateau, coque et sillage ; l’hélicoptère, patins et rotor ; l’avion, ailes et hélice. Ombre au sol et altitude rendent le vol lisible. Les appareils pilotables restent distincts de l’hélicoptère de recherche.

Un saut en vol utilise **E/Entrée ou SAUTER**. Pendant la chute, **Espace ou PARACHUTE** ouvre la voile, puis le déplacement dirige la descente. Voile, suspentes, silhouette et ombre doivent permettre de lire altitude, direction et retour au sol sans les confondre avec le pilotage. Les six pontons réels gardent leur largeur de jeu estimée de 10 pixels, soit 2,5 m ; ils restent réservés à l’accès à pied.

## Jour, nuit et caméra

Une journée dure **douze minutes actives**. Départs à **06:00, 12:00, 18:30 et 00:00** ; 18:30 est le choix initial. Lumière, ombres, fenêtres, enseignes, lampes et phares évoluent progressivement. Le décor doit conserver une route et des silhouettes lisibles de jour comme de nuit ; la couleur nocturne ne doit pas masquer les obstacles importants.

Le zoom passe d’environ **1,95 à pied à 1,65 en véhicule**. Les distances et coordonnées physiques restent identiques. La matière illustrée se projette sur le monde, sans agrandir la carte ni modifier la vitesse pour donner une impression de détail. Pause et interruption figent lumière, mer, projectiles, feu, chute et voile.

## Interface et effets

Le **logo original fourni** reste le titre du jeu. Le menu conserve mode, heure de départ et bouton de jeu. Le HUD compact affiche les informations nécessaires ; **ⓘ** déplie les détails. Le nouveau dessin n’introduit pas de récits, de noms ou de biographies dans le parcours utilisateur.

Six armes gardent silhouettes et sons distincts. Les six étoiles rendent lisible la réponse policière croissante : patrouilles, barrages, recherche aérienne, unités lourdes puis armée. Les renforts restent annoncés et les véhicules de barrage destructibles.

Le sang temporaire reste rouge sombre au sol. L’explosion passe par éclair, noyau lumineux, feu, onde, débris et fumée ; les incendies ont plusieurs foyers. Une destruction par tirs insiste sur la combustion ou les débris, tandis que les explosifs peuvent déclencher une chaîne immédiate. Les effets réduits diminuent l’animation. La sélection bornée des explosions privilégie celles proches du joueur sans changer les dégâts.

La musique et les bruitages restent originaux, avec une couleur électronique et house des années 90. La présence de cassettes et d’autoradios est un accessoire visuel et musical ; aucun dialogue de personnage ne réapparaît.

## Provenance et preuves

**© OpenStreetMap contributors · ODbL 1.0** et **© IGN · Licence Ouverte** restent les attributions des données utilisées. Requêtes, archives et empreintes restent conservées. Les dates locales IGN sont inconnues ; les références géographiques actuelles ne reconstituent pas Calvi en 1994. Façades, toitures, textures, enseignes, personnages et comportements restent une interprétation de jeu.

Le nouveau rendu v19 doit être observé et vérifié séparément. Les captures, tests et cadences v17/v18 documentent leurs versions ; ils ne certifient ni son résultat ni une performance sur Mac/Safari ou téléphone. Le protocole humain reste à réaliser.

[Conception](CONCEPTION.md) · [Cartographie et provenance](CARTOGRAPHIE.md) · [Relief](../data/ELEVATION.md) · [Hauteurs](../data/BUILDING_HEIGHTS.md) · [Observations](../data/CALVI_AERIAL_OBJECTS.md) · [Vérification v19](VERIFICATION-CALVI-ILLUSTREE.md) · [Historique v18](VERIFICATION-CALVI-LA-VIE.md) · [Historique v17](VERIFICATION.md) · [Essais humains](PLAYTEST.md)
