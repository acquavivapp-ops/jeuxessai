# Vérification CALVI LA VIE — v19, Calvi illustrée

Révision du 5 octobre 2026. **208 tests Node et 35 scénarios navigateur distincts validés sur le correctif final**, avec comparaison géographique, confirmation de cadence isolée et captures du rendu v19. Les résultats v17 et v18 restent dans leurs rapports historiques et ne sont pas comptés comme de nouvelles vérifications.

## Carte identique au monde v18

Le contrôle compare le monde construit par le moteur à un état de référence v18, section par section. Il vérifie les dimensions et bornes, axes et largeurs des routes, empreintes, cours et hauteurs des bâtiments, contours terrestres et marins, positions et silhouettes végétales, troncs et pontons. Les **41 fichiers de données source contrôlés sont identiques octet pour octet** à la référence. Les **251 véhicules issus des observations** gardent leurs identifiants, positions, orientations et informations de provenance.

| Élément comparé | Résultat |
|---|---|
| Rectangle du monde | **35 766,74 × 30 930,25 pixels logiques**, identique à v18. |
| Bornes WGS84 | Ouest 8,7063593 ; sud 42,5150237 ; est 8,8153936 ; nord 42,5844865. |
| Voies | **1 552 axes**, géométries et largeurs de jeu conservées. |
| Bâtiments | **3 893 empreintes**, contours, cours et hauteurs conservés. |
| Végétation | **12 000 groupes**, positions et formes comparées. |
| Pontons | **6 axes**, données identiques. |
| Véhicules observés | **251**, positions et orientations initiales identiques. |
| Fichiers source | **41**, empreintes SHA-256 inchangées. |

L’empreinte SHA-256 de la représentation géométrique comparée est :

```text
bde3e54d6455fc8507077bf0e5772abfd02bca271450bca33b21e28e837db891
```

L’empreinte des véhicules observés comparés est :

```text
06fa7ae5236cccc8ac10c7dafff7c0958680dda9f12b4d0b41c7c613e9356440
```

Ces résultats sont consignés dans [calvi-illustrated-geometry-validation.json](calvi-illustrated-geometry-validation.json). Ils prouvent la conservation relative au monde v18 contrôlé ; ils ne certifient pas une exactitude cadastrale ou l’apparence de chaque rue réelle. Les largeurs de jeu, hauteurs artistiques, positions estimées des troncs et détails de façade restent des estimations. Le rectangle du monde n’est pas la superficie administrative de la commune. Relief IGN, contour OSM et observations gardent leurs sources et leurs limites.

## Atlas dessiné et logo

L’atlas de matières original `assets/calvi-illustrated-materials.png` est un **PNG de 1 254 × 1 254 pixels**, de **3 783 136 octets**, organisé en **3 colonnes et 3 lignes**. Il contient des matières de dallage, asphalte, tuiles, gravier, herbe, mur, roche, feuillage et eau. Son empreinte, relue depuis le fichier, est :

```text
1f0ff4447eaaafbf27d8d4b588613c07a8bb62885dea14ba6e04368ea6675176
```

La provenance de l’atlas est consignée dans [calvi-illustrated-materials-provenance.json](calvi-illustrated-materials-provenance.json). Cet atlas est une illustration de matières, **jamais une carte géométrique**. Il ne fournit aucune coordonnée, voie, empreinte bâtie, altitude ou position de véhicule. Le rendu dessiné s’applique au monde géographique existant. La photographie IGN reste archivée pour les observations et la provenance ; ses pixels ne constituent plus le fond, les toits ou le feuillage de jeu.

Le logo original fourni reste intact dans `assets/calvi-la-vie-logo.png` : **1 536 × 1 024 pixels, 2 063 004 octets**, SHA-256 :

```text
85a063616229d97c98a85b9729a0e8819c08e7333968965bce595ed902522cb5
```

Les noms des personnages, dialogues, biographies et textes de présentation restent retirés. Le HUD compact, le bouton d’information, les commandes et le parachute sont conservés.

## Tests Node après correction du cache

`npm test` a été refait après correction du cache et gel révisé du code v19, avec le **code de sortie 0** : **208 tests exécutés, 208 réussis, zéro échec, zéro annulation, zéro test ignoré et zéro cas TODO**, en **47,480 secondes**. Le journal final est `calvi-la-vie-v19-node-tests.log`. Cette passe vérifie les règles du moteur, transports, parachute, combat et poursuites ; elle ne remplace pas une observation du nouveau rendu dans le navigateur.

La première passe, avant cette correction, avait aussi réussi 208/208 en 53,926 secondes. Elle reste une trace antérieure et n’est pas ajoutée au nombre de tests uniques.

La comparaison géographique a été reconfirmée après ce premier gel avec le **code de sortie 0** : même empreinte géométrique, 41 fichiers source inchangés et 251 véhicules observés conservés. Les preuves statiques liées dans ce rapport restent identiques à ce résultat.

## Premières observations navigateur

Deux vues préliminaires du port ont été capturées dans Chromium/Linux : **1 280 × 800** et **390 × 844**. Dans les deux cas, le rapport `first-port-report.json` indique **zéro erreur JavaScript, zéro erreur de console, zéro erreur HTTP et zéro requête de photographie JPEG**. Le PNG de matières est demandé et prêt ; le moteur de dessin indique `artMode: illustrated`, `photoMode: false`. Le flux photographique indique `status: disabled`, `reason: illustrated-renderer`, zéro demande et zéro octet décodé.

Les premiers caches observés restent sous leurs plafonds déclarés : **32 Mio pour le sol, 16 Mio pour les toits, 4 Mio pour le feuillage**. Ces plafonds concernent ces caches, pas la mémoire totale du navigateur, et ne constituent pas une mesure de cadence.

Cette première paire montre le port après démarrage. Elle ne démontre pas un parcours dans toute la commune ni une suite de jeu complète. Des ajustements visuels ont lieu après ces captures ; les captures finales et la vérification finale seront consignées séparément.

## Validation finale et captures

La suite finale de **35 scénarios distincts** est validée dans Chromium/Linux, avec un seul worker, en **deux passes ciblées sur le correctif final**. Chaque passe a le **code de sortie 0**, sans test ignoré, échec inattendu ni cas flaky. Il ne s’agit pas d’une exécution unique de 35 tests dans une même commande.

| Passe finale | Scénarios réussis | Durée | Code de sortie |
|---|---:|---:|---:|
| Graphismes, géométrie et rendu | 12/12 | 188,586 s | 0 |
| Jeu et interface mobile | 23/23 | 434,607 s | 0 |

Les reprises et observations antérieures au correctif ne sont pas ajoutées à ces **35 cas uniques**. La suite comprend un scénario sectoriel diagnostique et 34 autres scénarios : logo et textes retirés, interface compacte, contrôles et annulations, véhicules, armes et effets, jour/nuit, pause, parachute, reprise et cache hors ligne.

Le [bilan navigateur compact](calvi-illustrated-browser-validation.json) conserve les deux commandes effectivement exécutées, passes, codes de sortie, empreintes géographiques, observations, preuve de pixels et contrôles des captures. Il confirme la fermeture du navigateur et la fin des captures. Le parcours de saut/parachute dans le navigateur utilise l’hélicoptère ; l’avion est couvert par les tests Node, sans trajet navigateur jusqu’à l’aéroport revendiqué.

Pour rejouer toute la suite avec un port libre : `BLUE_NIGHT_TEST_PORT=4182 npm run test:browser -- --workers=1`. Cette commande de reproduction ne remplace pas la distinction entre les deux passes effectivement exécutées ci-dessus.

Le scénario sectoriel a été refait avec succès sur le correctif final : il utilise le vrai monde de Calvi, avec des placements de caméra et d’acteurs diagnostiques, pour observer port, citadelle et aéroport de jour et de nuit. L’empreinte géographique et les 251 positions initiales observées restent identiques avant/après la capture ; les caches chauds de sol, toits et feuillage conservent le même rendu. Ce cas ne constitue pas un trajet accompli au clavier jusqu’à ces lieux. Il appartient aux 35 cas et n’est pas ajouté une seconde fois au total.

Le parcours arbre utilise les commandes publiques pour approcher, rencontrer le tronc puis le contourner. Une comparaison complémentaire des pixels de tête utilise une fixture de rendu, avec acteur opaque puis clignotant **à la même position** : **49 pixels changent hors couronne et aucun sous le cœur opaque du feuillage**. Les poses proviennent du parcours public ; la comparaison ne déplace pas le personnage de la partie réelle. Elle fait partie du scénario arbre existant, pas d’un cas supplémentaire ni d’un parcours de jeu séparé.

Deux vues de jour obtenues avec ces **fixtures diagnostiques finales** sont produites et inspectées : [citadelle](calvi-illustrated-citadel-fixture.png) et [aéroport](calvi-illustrated-airport-fixture.png), en 1 280 × 800. Elles remplacent les premières images et montrent les géométries source dans le nouveau dessin ; les placements diagnostiques restent distincts d’un parcours de jeu normal.

Quatre captures publiques finales du port sont produites et inspectées : [jour](calvi-illustrated-day.png) et [nuit](calvi-illustrated-night.png), en 1 280 × 800 ; [téléphone, jour](calvi-illustrated-phone.png), en 390 × 844 ; [port en paysage](calvi-illustrated-port.png), en 844 × 390. Elles utilisent le jeu normal après démarrage, sans placement sectoriel injecté. Elles ne prétendent pas constituer une promenade complète dans toute la commune.

## Diagnostic initial et correction du cache

Une première mesure a révélé une saturation du cache de toits d’environ 16 Mio : seuls 28 éléments restaient en cache pour plus de 100 bâtiments visibles à l’aube, provoquant des reconstructions répétées et une cadence de l’ordre de 1 à 2 images/s dans ce diagnostic. Ce résultat est un problème constaté, **pas une validation de fluidité**. Un correctif réduit la densité des surfaces mises en cache et change la réservation des palettes et la priorité aux bâtiments visibles, sans relever les plafonds annoncés de 16 Mio pour les toits et 4 Mio pour le feuillage.

Une première confirmation a chevauché sept secondes de tests Node ; ses chiffres ne sont pas retenus comme résultat final. La confirmation a été **refaite seule dans Chromium/Linux, code de sortie 0**, avec un profileur échantillonnant toutes les 1 000 µs, une lecture légère des compteurs toutes les dix callbacks `requestAnimationFrame` et des snapshots limités avant/après chaque période.

Les trois éclairages — aube, jour et nuit — comprennent chacun trois périodes nominales de trois secondes : immobile en paysage, conduite en paysage, puis changement d’orientation avec la commande de conduite relâchée. Cette dernière phase peut comprendre de l’inertie du véhicule. Les **neuf fenêtres totalisent 522 callbacks observés sur 27,271 secondes** ; les bitmaps sont de 1 920 × 1 080 puis 1 080 × 1 920. Ce sont des formats de rendu instrumentés, pas des essais d’appareils physiques.

| Éclairage | Immobile, paysage | Conduite, nouvelles matières en cache | Après orientation, entrée relâchée |
|---|---:|---:|---:|
| Aube | 21,48 callbacks/s | 11,23 callbacks/s | 18,44 callbacks/s |
| Jour | 25,79 callbacks/s | 15,78 callbacks/s | 20,61 callbacks/s |
| Nuit | 22,53 callbacks/s | 17,06 callbacks/s | 19,39 callbacks/s |

Les trois caches restent sous leurs plafonds pendant les observations, sans éviction d’élément visible. En vue stable et après orientation, les compteurs de peinture du sol, des toits et du feuillage n’augmentent pas. La conduite crée ponctuellement de nouvelles surfaces et palettes ; à l’aube, son intervalle médian est de **66,6 ms** et son **p95 de 233,4 ms**. Cette limite signifie que des saccades restent possibles pendant les premiers chargements ou changements de zoom ; le résultat n’est pas présenté comme une fluidité générale ni 60 images/s.

Le [bilan compact](calvi-illustrated-performance.json) conserve les durées, cadences, p50/p95, compteurs et octets de caches au début et à la fin, ainsi que les empreintes des deux fichiers de mesures brutes. Les profils CPU couvrent chaque séquence entière, préparation et transitions comprises ; ils ne donnent pas une attribution par période et leurs catégories peuvent se recouper. Ces fenêtres courtes et l’instrumentation ne mesurent ni une longue séance, ni Safari, ni un téléphone réel.

## Provenance, historique et limites

**© OpenStreetMap contributors · ODbL 1.0** pour vecteurs et contour ; **© IGN · Licence Ouverte** pour relief, hauteurs et orthophotographies sources. Archives, requêtes et empreintes restent conservées. Les données actuelles ne sont pas une reconstruction de Calvi en 1994. La couverture des observations de véhicules concerne des secteurs inspectés, sans exhaustivité sur toute la commune.

Les rapports [v18](VERIFICATION-CALVI-LA-VIE.md) et [v17](VERIFICATION.md) restent historiques. Leurs tests, captures et mesures de cadence ne sont pas des résultats du rendu v19. Aucun essai physique Mac/Safari, iPhone ou Android, aucune séance humaine et aucun nouveau gain de performance ne sont revendiqués. Les formats mobiles émulés dans Chromium ne remplacent pas un essai sur appareil réel.

Les instructions de démarrage v19 sont enregistrées et relues dans le **brouillon cloud, révision 19**. Le script d’installation, le réseau, les dépôts et les secrets gardent leur configuration précédente. Ce brouillon n’est pas publié et aucune restauration dans une nouvelle tâche n’est revendiquée.

[Lancement](../README.md) · [Conception](CONCEPTION.md) · [Direction artistique](DIRECTION-ARTISTIQUE.md) · [Protocole humain](PLAYTEST.md) · [Cartographie et provenance](CARTOGRAPHIE.md)
