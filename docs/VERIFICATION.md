# Vérifications — v17 Calvi et objets photographiques

La version **v17-calvi-solid-world** améliore les passages au port, les observations photographiques, la végétation et les déplacements à pied. Les sources, la flotte, l’installation locale, les captures et **32 scénarios Chromium uniques** sont vérifiés. Les deux séries de mesure v17 sont conservées avec leur méthode d’observation. Le contrôle propre à l’archive livrée est consigné séparément dans `blue-night-release-validation.json`, fourni à côté du ZIP ; il identifie l’archive par son empreinte SHA-256.

## Contrôles v17 déjà obtenus

Le script exact `/workspace/blue-night-install.sh`, journalisé dans `/tmp/blue-night-install-v17-release.log`, se termine avec le **code 0**. Il exécute **190 tests Node et 92 tests Python, soit 282 tests locaux distincts réussis**, sans échec ni test ignoré. Avec les **32 scénarios Chromium uniques vérifiés**, le bilan compte **314 contrôles uniques**. L’environnement utilise Node.js **24.19.0**, Python **3.12.14** et **Pillow 12.3.0** dans son environnement virtuel ; `npm ci` suit le fichier de verrouillage.

| Vérification locale | Résultat |
|---|---:|
| Moteur, combat, police, mobilité, rendu, imagerie, végétation et population | 190/190 |
| Import OSM, contour, SRTM et protocole d’image | 7 + 6 + 7 + 5 |
| Tuiles photographiques | 30/30 |
| Objets photographiques | 13/13 |
| Cellules de clapotis | 8/8 |
| Hauteurs BD TOPO et MNT LiDAR | 11 + 5 |
| Contrôles exhaustifs des données | 698 tuiles, 178 originaux, 12 000 groupes végétaux, 251 véhicules admissibles et 20 exclusions conformes |

La commande finale Chromium est `BLUE_NIGHT_TEST_PORT=4182 npm run test:browser -- --workers=1`. La passe complète a réussi **31 scénarios et rencontré un échec**, en environ **huit minutes**. Dans le scénario bateau, le point de freinage au large était à 27 pixels d’une autre embarcation : l’interaction permettait un transfert légitime alors que le test attendait de rester dans le même bateau, sans sortie ni transfert. Après correction du freinage et du point d’arrêt au large dans le contrôleur, **ce scénario a réussi lors d’une reprise isolée**, avec le code 0 en environ 35 secondes. Le bilan est donc **31 dans la passe complète + un rejoué**, soit 32 scénarios distincts vérifiés ; il ne prétend pas à une passe unique de 32 réussites. Les répétitions ne sont pas ajoutées au total.

Les **13 audits Python des objets photographiques** réussissent avec Pillow : 78 empreintes de photographies originales, vrai calage source, groupes végétaux, 32 couronnes manuelles, annotations de véhicules, six axes OSM de pontons, coques blanches, patches voisins, avions hors commune et limites de couverture. Le corps non dilaté des bateaux est vérifié sur les pixels blancs des vrais JPEG natifs, y compris les images voisines qui complètent une coque coupée. Ce contrôle de données ne constitue pas une passe complète du jeu.

L’audit de la population initiale confirme **251 observations admissibles converties sur 251**, **251 masques persistants** et **291 véhicules au total**. Le nombre admis dans le fichier source est distingué du nombre effectivement accepté par la population. Aucune position de remplacement n’est fabriquée pour contourner un obstacle.

Le parcours moteur de l’installation finale réalise trois missions, poursuite armée et extraction à pied en **71,417 secondes actives**, avec **trois vies et 1 406 points**, puis vérifie la reprise. La passe ciblée précédente, consignée dans `/tmp/blue-night-solid-calvi-public.log`, faisait **71,767 secondes** avec les mêmes vies et points. Les deux passent sans modification de position, santé, mission ou horloge ; leur durée n’est pas assimilée à une mesure déterministe. Le contrôleur utilise la voiture de départ issue de `photo-car-port-04` et les commandes publiques de marche, conduite, frein, tir, bouteille et interaction. Ce parcours prouve une réalisation automatique et ne valide pas le confort d’un joueur humain.

Les passes ciblées ne sont pas additionnées au total distinct. Un vrai parcours à pied sur le quai embarque dans le bateau observé `photo-boat-port-016-01`, puis le déplace d’environ **53,25 pixels du monde** par accélération et direction publiques, avec masque persistant et corps physique valide. Aucune position n’est injectée. Le serveur de développement préexistant sur 4173 est préservé.

Une voiture fictive, `calvi-car-4`, a été retirée pour préserver le vrai corridor du port, les réserves de départ et les véhicules observés. Les empreintes routières et positions photographiques ne sont pas déformées pour conserver cet acteur. La configuration cloud est enregistrée en **brouillon, révision 14**, avec scripts d’installation et de démarrage correspondants, relus après sauvegarde ; elle n’est pas publiée.

## Règles locales et validation finale du navigateur

Les petits troncs et les bases des buissons hauts sont des obstacles au sol ; une couronne entière ne devient pas un mur. Le maquis bas reste traversable, avec un facteur de marche **×0,62**. Joueur, passants et agents à pied peuvent contourner localement les obstacles sur un sol libre, au-delà du seul graphe routier, en respectant le contour communal. Les anciens arbres artistiques remplacés au rendu par l’inventaire photographique ne laissent pas d’obstacle invisible.

La couronne conserve la texture photographique et son contour. Pied du tronc et ombre restent au sol ; les feuilles occultent localement la partie d’acteur réellement derrière elles. Le maquis bas couvre seulement les jambes. Aucun effet de transparence spécial autour du personnage n’est appliqué au feuillage ; la transparence de confort concerne les bâtiments.

Les six pontons utilisent leurs axes OSM réels et une largeur estimée de **10 pixels du monde / 2,5 m**. Le corps entier des acteurs à pied doit tenir dans leur corridor ; ils ne deviennent ni des routes pour voitures, ni des zones d’atterrissage. L’embarquement vérifie un vrai bord de coque et un passage depuis quai ou ponton. Le transfert entre deux bateaux demande faible vitesse, coques proches et absence d’un autre obstacle. Le scénario Chromium du bateau observe vol, navigation réelle, retour et sortie après accostage ; les règles locales contrôlent les passages, corps physiques et refus d’interaction obstruée.

Les règles moteur des six armes, six étoiles de recherche, dégâts, cycles jour/nuit, modes exploration et missions passent dans la suite Node. Les protections d’altitude, décollages, atterrissages, sortie sûre et destruction sans téléportation restent des règles d’arcade. Les scénarios Chromium vérifient commandes, visée, armes, moto, bateau, effets, pauses, interruptions et les deux chemins de secours `Image`. Les nouvelles observations contrôlent l’arbre sombre, sa couronne, son tronc et le véhicule photographique qui part en laissant son masque.

Une chaîne réelle de **126 explosions** dépassait le budget de **64 effets** ; l’ancienne file supprimait l’explosion proche qui l’avait déclenchée avant sa première image. Le jeu retient maintenant en priorité les effets proches du joueur, en tenant compte de l’altitude, et conserve l’effet antérieur à distance égale. **Le plafond reste 64, avec les mêmes dégâts et coordonnées.** Un test dans le vrai `Game`, déclenché par neuf tirs ordinaires, vérifie que l’origine reste visible. Il complète la validation de l’incendie puis de l’explosion secondaire.

## Sources, flotte et limites

La relation OSM **1151255 / INSEE 2B050** décrit cinq polygones, environ **31,614 km²**. Le rectangle photographié est distinct de cette superficie. Les rues et bâtiments restent ceux des sources archivées : **1 552 tronçons** et **3 893 empreintes**. Les missions sont fictives et ne décrivent pas les occupants réels.

L’atlas IGN conserve **288 JPEG communaux** à environ **0,50 m/pixel**, référence **17 884×15 466 pixels**, et **410 JPEG fins** demandés à **0,25 m/pixel** sur deux régions de **23,875 km²**. Les **698 tuiles** représentent **122 108 095 octets** compressés ; les **178 réponses originales** restent archivées sans retouche. Le pas d’export ne certifie pas la résolution native ou la précision locale. Les découpes sont réencodées sans redimensionnement ni ajout de détails géographiques. Le navigateur ne demande jamais les originaux de 2 048 pixels. Les comparaisons réellement demandées à 0,50, 0,25 et 0,20 m/pixel restent séparées du jeu ; 0,25 m est retenu. Voir [CALVI_IMAGERY_TILES.md](../data/CALVI_IMAGERY_TILES.md).

La végétation compte **12 000 groupes : 8 475 couronnes ou groupes boisés et 3 525 groupes bas**. Les **32 observations manuelles** comprennent **28 arbres sombres du square, du quai et des abords de la gare**, ainsi que quatre palmiers. Les hauteurs, volumes et implantations des troncs sont artistiques ou estimés. Ces groupes ne sont pas un inventaire de 12 000 arbres individuels, ni une mesure LiDAR de leur hauteur.

Les **251 acteurs photographiques** comprennent **96 voitures, 153 bateaux et deux avions**. Les **40 autres véhicules** sont des placements fictifs et du trafic, pour **291 au départ**. Le véhicule possédé correspond à `photo-car-port-04` ; `photo-car-port-05` est une autre voiture volable. Les **20 observations exclues** restent archivées : douze candidates de voiture non confirmées, deux surfaces de deck, un ponton, une coque stockée à terre et quatre avions hors commune. La couverture concerne les secteurs inspectés du port, des parkings et de l’aéroport ; elle n’est pas exhaustive sur toute Calvi.

Au port, **107 groupes de pixels inspectés** ont donné **157 observations de bateaux**, dont 153 admissibles. Les coques distinctes sont séparées et un vrai catamaran reste un objet unique. Pour chaque bateau, `bodyPolygonWorld` est l’enveloppe convexe non dilatée de vrais pixels de coque. Le moteur emploie une **capsule centrée maximale inscrite dans cette enveloppe**, avec rayon et demi-longueur distincts des dimensions visuelles. Il n’utilise pas le polygone entier comme corps de collision. La marge de **1,4 pixel du monde** du masque photographique ne grossit pas ce corps. Cette construction géométrique n’est pas une mesure maritime professionnelle.

Les **251 masques** copient une petite matière voisine terrestre ou marine et restent au lieu d’origine lorsque l’acteur se déplace ou est détruit. Le fond caché sous le véhicule étant inconnu, cette retouche est artistique ; les originaux ne sont pas modifiés. Les six axes de pontons proviennent des voies OSM `115676052`, `115676056`, `115676057`, `115676059`, `115676060` et `1089398758`, avec nœuds et empreintes archivés. Largeur et élévation de leur deck sont artistiques ; leur corridor ne réécrit ni littoral ni frontière. Voir [CALVI_AERIAL_OBJECTS.md](../data/CALVI_AERIAL_OBJECTS.md).

Les accès des **153 bateaux photographiques** se répartissent en **sept depuis la côte, 110 depuis les six pontons et 36 par approche maritime ou transfert entre embarcations**. Les centres et contours de coques conservent leur position photographique observée. Les points d’embarquement sont dérivés des vrais axes ou bords accessibles et restent explicitement des **positions estimées**, distinctes du calage source des coques.

Le relief communal est **449×388** à environ 20 m, avec **79 276 valeurs terrestres** et **94 936 nulles** en mer/hors commune. L’extrait urbain réel est **173×224** à environ 5 m, raccordé sur 40 m. Les **1 355 hauteurs BD TOPO** sont distinguées des **2 538 hauteurs IGN inconnues** et des indications d’étages OSM. Les façades et gabarits sans hauteur mesurée restent artistiques. Dates locales d’acquisition IGN et référence verticale exacte restent inconnues ; la géographie actuelle ne reconstitue pas Calvi en 1994.

## Budgets et cache

Le streaming retient au maximum **quatre tuiles / 16 Mio RGBA, tous niveaux confondus, réservations des décodages en cours comprises**. L’aperçu ajoute environ **3,46 Mio**. Fond projeté, toits et houppiers ont respectivement des caches plafonnés à **32, 16 et 4 Mio**. Ces budgets décrivent les textures suivies par le jeu, pas toute la mémoire du navigateur ni les allocations internes du décodeur. Deux décodages peuvent être en cours ; indisponibilité du détail et erreurs transitoires conservent leurs mécanismes de retour et reprise.

Le clapotis utilise **698 grilles de 32×32 cellules**, dont **69 166 cellules conservatrices** retenues sous condition marine OSM indépendante. Un pixel qui échoue aux seuils refuse sa cellule ; un refus fin n’est pas remplacé par une acceptation communale. Les animations suivent le temps actif et se figent en pause. Ce masque n’est ni une reconnaissance parfaite de toutes les embarcations, ni une bathymétrie, ni une collision navigable. Voir [CALVI_WATER_SURFACE.md](../data/CALVI_WATER_SURFACE.md).

Le service worker **v17-calvi-solid-world** conserve les tuiles photographiques à la demande, avec les modules et données nécessaires au jeu. Un secteur HD non visité reste à la résolution de l’aperçu hors ligne ; les originaux ne sont pas précachés. Les scénarios v17 vérifient le rechargement hors ligne des données et tuiles visitées, ainsi que l’arrivée d’une image pendant une pause sans changement de pixels ou d’horloge. Le navigateur peut évincer les caches. Les photographies originales restent livrées séparément dans `blue-night-imagery-sources.zip` ; l’archive de sources n’est pas nécessaire pour jouer.

## Mesures de fluidité v17 et coût d’observation

[PERFORMANCE.json](PERFORMANCE.json) conserve **deux séries v17**, les empreintes vérifiées de **14 modules et fichiers de données**, ainsi que la référence historique v13 inchangée. Chaque série couvre quatre configurations, avec **100 intervalles RAF en marche, 100 en conduite avec virage et 100 en tirs/poursuite** : douze phases et **1 200 intervalles actifs par série**. Les passes sont séquentielles, sans navigateur concurrent, sans frame de menu et sans erreur JavaScript.

La première série sérialise le snapshot public complet par CDP. La seconde calcule toujours ce même snapshot, puis ne transfère que les positions, états scalaires et compteurs utiles. **Le code du jeu ne change pas entre les deux séries.** Les séquences de touches et le nombre d’intervalles sont conservés ; les positions espacées sont relevées après les pas impairs pour observer aussi les excursions de marche, plutôt que seulement leurs retours.

| Configuration | Snapshot complet, images/s | Snapshot complet, p95 ms | Diagnostic compact, images/s | Diagnostic compact, p95 ms |
|---|---:|---:|---:|---:|
| Ordinateur, CPU normal | 28,48 | 66,8 | 30,98 | 66,7 |
| Portrait émulé, CPU normal | 40,45 | 50,0 | 46,75 | 50,0 |
| Ordinateur, CPU ×4 | 4,56 | 750,0 | 6,73 | 199,9 |
| Portrait émulé, CPU ×4 | 6,55 | 666,5 | 9,74 | 149,9 |

La réduction du diagnostic s’accompagne d’à-coups plus courts, surtout sous stress CPU, et montre que le banc d’observation pèse sur le relevé. Avec le diagnostic compact, le secteur de départ atteint environ **31 images/s sur bureau et 47 en portrait émulé au CPU normal**. Le stress CPU ×4 reste très lent ; les 300 intervalles de chaque configuration dépassent 50 ms. Ces résultats conservent les deux observations au lieu de retenir seulement le chiffre le plus élevé.

Les mesures utilisent **Chromium Linux**, fenêtres **1280×800** et **390×844** émulées. Les observations, contenus du monde, trajets, collisions et états diffèrent des anciennes versions : **aucun gain ou recul contrôlé par rapport à v13/v16 n’est établi**. Les mêmes touches ne garantissent pas les mêmes positions ni durées. Le relevé porte sur le secteur de départ, avec diagnostic actif ; il ne représente ni toute la commune, ni un téléphone physique, ni Mac/Safari. La cadence dépend encore de l’appareil.

## Captures et limites

Les six captures générales sont renouvelées sur v17. Les effets finaux sont issus de commandes publiques : **neuf tirs ordinaires**, avec **deux vies**, produisent l’incendie et l’explosion secondaire ; **un tir**, avec **trois vies**, produit le sang sur une personne réellement touchée. Quatre autres captures montrent la voiture `photo-car-port-03` réellement volée et conduite, son emplacement après départ, la moto pilotée et le bateau `photo-boat-port-016-01` navigué. Elles conservent **trois vies et 251 masques persistants**. Les vues [devant l’arbre](blue-night-tree-front.png) et [sous sa couronne](blue-night-tree-canopy.png) proviennent d’un parcours à pied autour de `photo-tree-square-19`, avec contact et contournement de son tronc, puis passage sous son feuillage photographique ; les trois vies sont conservées. Aucun état n’est injecté et aucune erreur JavaScript n’est observée. La vue d’hélicoptère conserve son étiquette v15. Le rapport de livraison distinct permet de vérifier les résultats de l’archive exacte sans ajouter une empreinte autoréférente à son contenu.

**Mac/Safari réel n’est pas validé ici.** Le téléchargement de WebKit a reçu HTTP 403 de la politique réseau sur les hôtes officiels Playwright. Les chemins de décodage compatibles contrôlés dans Chromium ne prouvent ni le comportement ni la fluidité de Safari. Aucun essai de téléphone physique, séance humaine, publication en ligne ou restauration dans une nouvelle tâche n’est revendiqué. Le protocole humain figure dans [PLAYTEST.md](PLAYTEST.md).
