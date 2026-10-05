# Vérification CALVI LA VIE — v20, lisibilité et cadence

Révision du 5 octobre 2026. **212 tests Node et 35 scénarios Chromium distincts réussis**, avec comparaison géographique, mesure de cadence isolée et preuves du rendu v20. Les preuves v19 restent dans leur [rapport historique](VERIFICATION-CALVI-ILLUSTREE.md) et ne sont pas comptées comme des essais de cette version.

## Changement et provenance

La v20 réduit le contraste et la répétition des matières, ajoute un grain fin, des couronnes irrégulières et une mer nuancée, puis différencie les typologies bâties. Les nuances statiques du relief sont lissées ; les carrosseries et palettes réutilisées visent à limiter le travail répété. Le logo original, le HUD compact, les textes de personnages retirés, les armes, poursuites, cinq transports et parachute sont conservés. Les photographies IGN restent des sources archivées, pas des pixels du décor.

La comparaison géographique v20 a le **code de sortie 0** : **41 fichiers source et 251 placements observés inchangés**, avec les mêmes 1 552 axes routiers, 3 893 empreintes, 12 000 groupes végétaux et six pontons que v18/v19. Le rectangle reste de **35 766,74 × 30 930,25 pixels logiques**. La [preuve compacte](calvi-v20-geometry-validation.json) conserve les empreintes par section et le SHA-256 géométrique `bde3e54d6455fc8507077bf0e5772abfd02bca271450bca33b21e28e837db891`. **De nouveaux repères visuels sont ajoutés**, sans les confondre avec cette géométrie conservée :

- Murailles : **67 nœuds OSM**, largeur **3 m** et hauteur **10 m estimées** ; tracé décoratif, collisions de base conservées.
- Aéroport : **30 axes ou surfaces, 376 points source** ; **45 m** est le tag de largeur de la piste principale, tandis que les dimensions absentes et raccords restent artistiques.
- Toitures : **3 219 couleurs retenues**, issues de **83 200 échantillons dans 193 JPEG IGN aux SHA-256 vérifiés**. Une couleur ne prouve ni forme ni matériau ; les profils peu fiables sont écartés.

Sources : [architecture](../data/calvi-architecture.js), [couleurs](../data/calvi-roof-observations.js), [cartographie et limites](CARTOGRAPHIE.md). © OpenStreetMap contributors · ODbL 1.0 ; © IGN · Licence Ouverte. Aucun relevé cadastral certifié ni reconstruction de 1994 n’est revendiqué.

## Diagnostic et comparaison finale

Le diagnostic v19 a isolé du travail répété dans le rendu dynamique et les carrosseries. Les parts issues du profileur sont des estimations inclusives qui se recoupent ; elles ne sont pas des pourcentages CPU additifs. Une première mesure v20 a révélé une régression à l’aube due à l’éviction répétée de carrosseries visibles ; elle reste un diagnostic exclu du résultat livré. Le correctif réserve les trois palettes avant admission, garde le rendu direct quand le cache est plein et étale les mélanges. La confirmation est refaite séparément après gel, avec le **code de sortie 0** et Chromium fermé avant la suite suivante.

Le protocole a comparé **quatre configurations** : 1 280 × 800 et 390 × 844, à 12:00 et 06:00, avec les mêmes contrôles, zoom et densité. Chacune comprend cinq secondes immobile, huit secondes de commande de conduite, puis cinq secondes après changement d’orientation : **12 fenêtres** par version. Les positions initiales sont contrôlées ; les trajectoires peuvent varier avec la progression de la simulation. Une voiture bloquée ne constitue pas une preuve de conduite fluide et un trajet complémentaire non apparié reste identifié séparément.

Les mesures conservent cadence des callbacks `requestAnimationFrame`, intervalles médians/p95, périodes longues, durée murale et temps actif, compteurs et octets des caches. Le profileur CDP échantillonne à 1 ms ; ses catégories sont inclusives et les profils couvrent les transitions.

La [preuve de performance compacte](calvi-v20-performance.json) conserve protocole, empreintes des sources et fichiers bruts, métriques des **12 fenêtres par version**, déplacements et compteurs de cache au début et à la fin. Les gros profils restent hors livraison. Les valeurs ci-dessous sont les callbacks/s observés : **immobile / commande de déplacement / après orientation**.

| Configuration | Baseline v19 | v20 finale |
|---|---:|---:|
| 1 280 × 800, midi | 34,51 / 32,45 / 32,07 | **39,09 / 40,97 / 39,54** |
| 1 280 × 800, aube | 33,19 / 28,44 / 29,62 | **41,33 / 39,40 / 33,12** |
| 390 × 844, midi | 59,11 / 53,32 / 58,23 | **60,22 / 58,24 / 59,14** |
| 390 × 844, aube | 58,05 / 49,00 / 39,77 | **59,69 / 54,55 / 57,33** |

Le p95 final des intervalles est de **33,4 ms au format bureau** et **16,7 à 16,8 ms au format mobile**. Les quatre configurations immobiles ont **zéro nouvelle peinture, miss ou éviction visible** dans les caches sol, toits, feuillage et carrosseries ; les plafonds sont respectés : **sol 32 Mio, toits et carrosseries réunis 16 Mio, feuillage 4 Mio**. Les carrosseries occupent **au plus 4 Mio à l’intérieur des 16 Mio**, sans budget supplémentaire. Ces plafonds ne représentent pas la mémoire totale du navigateur.

**La commande heurte un obstacle après environ 201 pixels du monde** : cette phase ne prouve pas une conduite continue. Le gain observé concerne ces courtes fenêtres appariées, sans promesse générale de 60 images/s.

Un **trajet public complémentaire**, code 0, rejoint six points du quai avec E puis le joystick réel, sans injection d’état : **544,43 pixels du monde parcourus, 507,61 de déplacement net, 12,42 s et trois vies conservées**. Il vérifie une conduite effectivement mobile ; c’est une preuve fonctionnelle séparée, sans comparaison de FPS ni ajout au total des 35 scénarios.

## Vérifications finales

| Contrôle | État v20 |
|---|---|
| Tests Node complets | Code 0 ; 212/212, zéro échec, annulation ou cas ignoré ; 53,8 s. |
| Scénarios Chromium distincts | Deux passes code 0 : 12/12 en 186,152 s, puis 23/23 en 393,360 s ; zéro skipped, flaky ou échec inattendu. |
| Comparaison géométrie / observations | Code 0 ; 41 sources et 251 placements identiques à v18/v19. |
| Cadence et caches face au baseline v19 | Code 0, comparaison isolée et quatre validations de cache réussies. |
| Captures | Six PNG finaux contrôlés ; zéro erreur JS/console/HTTP et zéro JPEG aérien demandé. |

Les [contrôles de démarrage](calvi-v20-readiness.json), code 0, vérifient **46 ressources précachées et sw.js : 47 réponses HTTP 200 identiques aux fichiers du projet**, sans photographie précachée. Les dix empreintes runtime contrôlées par la racine sont identiques pendant les mesures et tests. Après vérification, deux espaces sur une ligne vide de illustrated-buildings.js ont été retirés ; le code exécuté est identique. La preuve navigateur conserve les SHA-256 testé et livré. Les 35 cas sont distincts ; reprises, trajet complémentaire et contrôles DPR 2 ne sont pas ajoutés à ce total. La suite couvre bateau et hélicoptère/parachute par les commandes publiques ; elle comprend aussi le rendu sectoriel isolé, distinct d’un trajet jusqu’à ces lieux.

Le [bilan navigateur compact](calvi-v20-browser-validation.json) conserve les commandes exactes des deux passes, les codes de sortie, le trajet du quai, les contrôles DPR 2 et les preuves des captures. Tous les Chromium sont fermés. Les vérifications DPR 2 portent sur trois formats émulés et un segment de marche public de 75,79 à 76,09 pixels, avec commandes accessibles, pause et géométrie conservées ; elles ne prouvent pas une performance sur téléphone physique.

Trois captures publiques finales du port : [jour](calvi-v20-day.png), [nuit](calvi-v20-night.png), en 1 280 × 800, et [format téléphone](calvi-v20-phone.png), en 390 × 844. Elles utilisent le jeu normal après démarrage. Logo original de 1 536 × 1 024 intact, 251 positions source conservées et aucune photographie JPEG demandée pour le décor.

Trois captures v20 contrôlées montrent le rendu sectoriel isolé : [citadelle](calvi-v20-citadel-fixture.png), [plage et Pinède](calvi-v20-beach-fixture.png), [aéroport](calvi-v20-airport-fixture.png), en 1 280 × 800. Ces **fixtures de rendu** montrent les sources dans le jeu ; elles ne prouvent pas un trajet du joueur vers ces lieux.

## Portée

Les mesures utilisent **Chromium/Linux instrumenté dans l’environnement cloud**. WebKit est absent ; Mac/Safari et les téléphones physiques ne sont pas mesurés. Des formats mobiles émulés ne remplacent pas ces appareils. Les courtes observations ne valident pas une longue séance, le confort tactile ou la reconnaissance des lieux par un joueur humain.

[Lancement](../README.md) · [Direction artistique](DIRECTION-ARTISTIQUE.md) · [Protocole humain](PLAYTEST.md)
