# Vérification CALVI LA VIE — v18

Révision du 5 octobre 2026. Ce rapport concerne les changements de nom, de logo, de textes, d’interface mobile et de parachute. [VERIFICATION.md](VERIFICATION.md) conserve les mesures et contrôles de la version v17 ; ses résultats ne sont pas présentés comme des exécutions nouvelles.

## Changements vérifiés

Le nom affiché, le titre HTML et le manifeste sont **CALVI LA VIE**. Le logo est le PNG original fourni par l’utilisateur, copié sans retouche dans `assets/calvi-la-vie-logo.png` : **1 536 × 1 024 pixels, 2 063 004 octets**, SHA-256 `85a063616229d97c98a85b9729a0e8819c08e7333968965bce595ed902522cb5`. L’accueil présente le logo, deux portraits sans noms et les sélecteurs fonctionnels de mode et d’heure. Les dialogues, messages radio, biographies, noms de personnages et paragraphes de présentation ont été retirés de l’interface.

Le HUD mobile replié mesure **74 pixels** dans les vues 390 × 844 et 844 × 390. Le bouton d’information révèle les détails dans un panneau de **139,94 pixels**. Les boutons principaux restent accessibles, avec des cibles d’au moins **44 × 44 pixels** ; les joysticks et marges de sécurité sont conservés. En parachute, seuls la direction et le bouton de voile restent affichés en bas. Les fenêtres d’aide, de pause et d’options conservent les commandes utiles.

## Moteur et parcours réel

`npm test` : **208 tests exécutés, 208 réussis, zéro échec, zéro annulation et zéro test ignoré**, durée 46,022 secondes. La suite comprend **18 tests de parachute** : saut des deux types d’appareils, ouverture manuelle et inflation progressive, guidage, relief, contact sûr ou chute dangereuse, obstacles et eau, pause et redémarrage. Les règles de véhicules terrestres, de bateaux, de combat et de police restent couvertes.

Un scénario Chromium parcourt réellement les quais et rues de Calvi à pied pour atteindre l’hélicoptère. Il embarque avec E, décolle avec Espace, saute avec E et ouvre le parachute avec le bouton mobile. Il vérifie la voile gonflée, le guidage, la pause avec état et pixels figés, puis l’arrivée au sol. Juste avant le contact, la vitesse verticale vaut **−5,5 m/s**, avec **trois vies** ; l’atterrissage rend les commandes à pied. La police reste active et peut intercepter le joueur après le vol. Aucune position, horloge, vie ni état d’aéronef n’est injecté dans ce parcours.

Les tests unitaires couvrent aussi l’avion ; le parcours navigateur porte sur l’hélicoptère. Une ouverture trop tardive reste dangereuse. La mer, les bâtiments et les zones hors commune ne deviennent pas des points d’atterrissage, et aucune recherche de terre avec téléportation n’est appliquée.

## Navigateur et cache

**34 scénarios navigateur distincts exécutés et validés dans Chromium/Linux**, en passes ciblées, sans test ignoré ni désactivé et sans échec restant. Les reprises ne sont pas ajoutées au total. Les formats vérifiés sont **320 × 568, 375 × 667, 390 × 844, 430 × 932, 844 × 390 et 1 280 × 800**. Les vérifications comprennent accueil/logo, absence de textes de personnages, aide, contrôles tactiles et annulations, conduite et sortie, moto, bateau, arbre et véhicule photographiques, mer, armes et effets, pause et interruptions, paramètres, résultats et redémarrage.

Le chargement hors ligne conserve la ville, ses modules, le **PNG original** et les images de jeu. Les tuiles fines visitées se décodent après rechargement hors ligne, dans les limites de mémoire prévues. Deux chemins de secours du décodage d’images restent exercés dans Chromium ; ils ne constituent pas un essai Safari.

Deux attentes de tests ont été actualisées : le SVG provisoire remplacé à l’accueil n’est plus demandé hors ligne, et l’attente murale de perte d’une vie passe de quatre à six secondes sur ce serveur cloud. La trace conserve la progression réelle de la mèche, de 2,57 à 0,03 secondes en environ 3,2 secondes murales ; les assertions de vies, pause, résultat et jingle restent actives. Les deux cas repris passent avec le **code de sortie 0**, 2/2 en 40,8 secondes. Aucun changement moteur supplémentaire n’a été nécessaire après la passe Node de 208 tests.

## Captures

[Accueil](calvi-la-vie-title.png) · [Téléphone](calvi-la-vie-phone.png) · [Paysage](calvi-la-vie-landscape.png) · [Informations](calvi-la-vie-details.png) · [Parachute, parcours réel](calvi-la-vie-parachute.png).

## Démarrage et limites

Le serveur existant sur 4173 est conservé. Son HTML affiche le nouveau titre ; huit requêtes de modules et de ressources réussissent, dont `parachute.js`, le PNG original (empreinte contrôlée), le manifeste des tuiles et l’aperçu. Les essais Chromium utilisent un serveur distinct sur 4182 et un seul worker. Jouer nécessite Node.js 20 ou supérieur, sans installation de dépendances ; les dépendances Playwright servent uniquement aux tests.

Les données cartographiques, les 698 tuiles de jeu et les originaux IGN ne sont pas réimportés pour cette révision. Les mesures de performances v17 restent historiques. Aucun essai physique récent sur Mac/Safari, iPhone ou Android et aucune séance de joueur humain ne sont revendiqués. La validation Chromium des formats mobiles ne démontre pas les performances de Safari.

Les instructions complètes de démarrage sont enregistrées et relues dans le **brouillon cloud, révision 18** ; scripts d’installation, réseau et dépôts sont préservés. Ce brouillon n’est pas publié et aucune restauration dans une nouvelle tâche n’est revendiquée.
