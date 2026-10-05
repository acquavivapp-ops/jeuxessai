# CALVI LA VIE — Calvi, 1994

CALVI LA VIE est un jeu d’action en vue aérienne, à pied, en voiture, à moto, en bateau, en hélicoptère et en avion, inspiré des premières années de GTA. Calvi est son unique carte : les rues, bâtiments, littoral et limite de la commune proviennent d’OpenStreetMap. Relief, photographie aérienne et hauteurs disponibles viennent d’IGN. Ces données actuelles sont habillées d’un univers corse fictif de 1994.

## Territoire et déplacements

Le périmètre suit la commune de Calvi, identifiée par le code INSEE **2B050** et la relation OSM **1151255**. Le personnage part du port. La Revellata, la plage, la Pinède et le secteur de l’aéroport appartiennent à la même carte continue. La frontière importée limite la marche et le roulage ; le bateau navigue dans la mer réelle au-delà du rivage administratif, et le vol reste dans le cadre cartographique. Le rectangle qui contient la commune n’est pas présenté comme sa superficie administrative. La projection garde le nord en haut et une échelle de quatre pixels logiques par mètre.

La caméra suit le personnage avec un zoom rapproché d’environ **1,95**, puis recule progressivement à **1,65** en voiture pour montrer davantage de route. Elle ne modifie ni distances ni collisions. Le terrain soulève visuellement le sol et les bâtiments, et module légèrement la vitesse sur les pentes. Les contrôles gardent accélération, freinage, marche arrière, sortie de voiture et vol d’un véhicule accessible.

Les arbres et le maquis matérialisés suivent les observations végétales de la photographie. Les houppiers reprennent les pixels source découpés selon les silhouettes observées, puis portés par un volume et une hauteur artistiques. **Vingt-huit couronnes sombres** près de la place du port complètent le détecteur de verts. Les petits troncs, d’implantation estimée, font obstacle aux déplacements et aux tirs ; la couronne entière reste distincte de ce corps physique. Le maquis bas ralentit le passage et masque les jambes, tandis que les grands buissons peuvent faire obstacle. Les feuilles occultent localement la silhouette réellement derrière leurs contours ; aucune transparence spéciale du feuillage n’est appliquée au personnage. Ombre et pied du tronc restent au sol, tandis que la couronne élevée passe devant les acteurs concernés. Le clapotis apporte un mouvement discret à la mer photographiée, sans passer sur les quais ou les bateaux ; son animation suit le temps actif.

Les **251 observations admissibles de véhicules** sont converties en acteurs jouables à leur position source : **96 voitures, 153 bateaux et deux avions**, pour **291 véhicules au départ** avec les 40 placements fictifs et véhicules de trafic. Leurs anciennes images sont masquées par **251 petites retouches persistantes** de matière voisine lorsqu’ils se déplacent ou sont détruits. La voiture du départ, observation `photo-car-port-04`, appartient déjà au joueur ; celle issue de `photo-car-port-05` reste distincte et volable. Les vingt observations exclues restent archivées, et les véhicules non recensés conservent leur image fixe. La couverture concerne des secteurs du port, des parkings et de l’aéroport, sans exhaustivité sur toute la commune.

## Transports pilotables

Une moto attend près du départ au port ; le bateau **La Face B** est amarré côté eau, avec un point d’embarquement sur la terre. L’hélicoptère **Maquis FM** repose dans un parking dégagé à l’ouest du port. Le petit avion **Le Dernier Départ** se trouve dans l’aire de stationnement réelle de l’aéroport Calvi–Sainte-Catherine. D’autres bateaux et **deux avions photographiés à Calvi** rejoignent la flotte après vérification de leur observation et de leur accès. Quatre observations d’avions au sud de l’aéroport restent archivées hors jeu, car elles sont hors des polygones communaux importés.

Six vrais axes de pontons OSM permettent la circulation à pied dans le port. La largeur de jeu de **10 pixels, soit 2,5 m**, est une estimation photographique ; les axes et leurs identifiants source sont archivés. Ces passages ne sont pas des routes carrossables. Passants et agents à pied peuvent se déplacer sur un sol libre au-delà des seules routes, avec le même contour et les mêmes obstacles physiques que le joueur.

| Transport | Commandes et comportement |
|---|---|
| Moto | Direction pour accélérer et tourner, direction opposée pour reculer, Espace pour freiner. Son corps plus étroit facilite les passages terrestres. |
| Bateau | Direction pour naviguer et tourner, direction opposée pour reculer, Espace pour ralentir. La coque reste sur l’eau ; il faut accoster près d’une terre libre pour descendre. |
| Hélicoptère | Espace ou DÉCOLLER pour prendre de la hauteur, direction pour voler. ATTERRIR demande un sol libre et peu pentu ; relâcher le déplacement pour achever la descente. |
| Avion | Direction pour rouler, Espace ou DÉCOLLER pour armer le départ, puis accélérer droit devant. En vol, ATTERRIR demande une approche terrestre dégagée, une pente faible et une vitesse réduite. |

**E/Entrée ou MONTER** permet de prendre un véhicule accessible ; **E/Entrée ou SORTIR** permet d’en descendre après ralentissement. La proximité seule ne suffit pas : le passage jusqu’à l’interaction doit éviter murs et troncs, et une sortie au sol demande une place réellement praticable. En avion ou en hélicoptère, **E/Entrée ou SAUTER** permet aussi de quitter l’appareil en vol ; **Espace ou PARACHUTE** ouvre le parachute pendant la chute. Sur téléphone, le stick gauche pilote et les boutons contextuels suivent l’état réel : FREIN, DÉCOLLER, ATTERRIR, ANNULER, SAUTER ou PARACHUTE. Le vol et la chute sont des mécaniques d’arcade avec une altitude de jeu et des collisions selon la hauteur des obstacles.

Les premiers transports ont des placements fictifs sur des surfaces vérifiées ; les véhicules ajoutés depuis la photographie gardent une position observée et un comportement de jeu. Cet ensemble n’est pas un inventaire exhaustif de véhicules réels. Les parkings et le rivage restent ceux de la carte source. L’aire aéroportuaire OSM **200335795** et la piste **8113537** proviennent de l’archive existante ; les placements ne créent ni nouvelle piste ni héliport réel. La coque entière du bateau est vérifiée sur l’eau, son embarquement à pied sur un accès libre, et les véhicules au sol gardent une sortie praticable. Les avions photographiques gardent des règles de décollage et d’atterrissage d’arcade, sans certification des accès aéronautiques.

Les bateaux photographiques gardent un corps de collision inscrit dans leur vraie silhouette de coque, distinct des dimensions de dessin et du masque persistant. Le passage d’embarquement se contrôle depuis un bord de coque réel ; un transfert entre bateaux demande faible vitesse, coques proches et passage sans autre obstacle. Les pontons ne servent ni au roulage ni à l’atterrissage.

## Heure et lumière

Une journée complète dure **douze minutes de jeu actif**. Le menu permet de partir à 06:00, 12:00, 18:30 ou 00:00. L’heure affichée avance de deux minutes par seconde active, avec aube et crépuscule progressifs. Le jour éclaire pierre, mer et végétation ; la nuit met en valeur fenêtres, enseignes, phares et éclairages publics. Tutoriel, pause et interruption figent la simulation et son éclairage.

## Armes et destruction

| Arme | Usage arcade |
|---|---|
| Pistolet | Tir régulier équilibré. |
| Rafale | Cadence rapide, impacts individuels plus faibles. |
| Lance-BOUM | Projectile explosif ; le souffle affecte aussi le joueur proche. |
| Fusil à pompe | Sept projectiles dispersés, courte portée. |
| Fusil de précision | Tir sans dispersion, longue portée. |
| Carabine | Tir automatique avec faible dispersion. |

R, Tab ou le bouton d’arme parcourent les six armes. Les tirs rencontrent d’abord le premier mur, tronc, véhicule ou acteur sur leur segment. Les munitions et paramètres sont des règles d’arcade. Une voiture détruite par tirs prend feu puis explose ; les explosifs peuvent déclencher immédiatement une chaîne. La méthode de destruction change les foyers, la poussière et les débris des bâtiments. Les morts laissent des traces de sang temporaires. Ces effets suivent le temps du jeu ; une chaîne dense conserve en priorité les explosions visibles proches du joueur sans modifier les dégâts.

## Recherche policière

La gravité des faits alimente une recherche de **zéro à six étoiles**. Tirer, voler, endommager un bien, blesser, tuer et provoquer une explosion ont des poids différents ; une rafale ou un équipage touché ne compte pas artificiellement plusieurs fois le même incident.

| Niveau | Réponse |
|---|---|
| 1 | Patrouilles locales. |
| 2 | Poursuite renforcée. |
| 3 | Barrages sur les rues réelles, avec véhicules destructibles et préavis. |
| 4 | Hélicoptère de recherche qui suit les derniers signalements. |
| 5 | Véhicules et unités lourdes. |
| 6 | Renforts militaires. |

Les renforts arrivent après une annonce et un délai. Les tirs policiers sont annoncés, rencontrent les murs et restent esquivables. La recherche diminue lorsque le joueur cesse les actes et échappe aux observations. Les unités, barrages et projectiles sont bornés pour limiter la charge et maintenir des possibilités de fuite. Le système représente une fiction de jeu, pas une procédure réelle.

## Modes et univers

L’exploration libre est proposée par défaut, sans limite de durée. Trois dépôts fictifs restent facultatifs. Le mode missions demande de les détruire puis de revenir au port en 180 secondes. Les deux modes commencent avec trois vies. Les empreintes source ne décrivent ni les occupants réels ni la fragilité réelle des constructions.

Les personnages portent des tenues olive et des cagoules noires, avec des silhouettes humoristiques. L’interface affiche les objectifs, états et commandes ; les noms des personnages, répliques, biographies et textes de présentation ont été retirés. La musique et les bruitages restent originaux. Graphismes, portraits, logos et musique n’utilisent aucune ressource de GTA ou Nintendo.

[Lancement](../README.md) · [Cartographie](CARTOGRAPHIE.md) · [Direction artistique](DIRECTION-ARTISTIQUE.md) · [Vérifications v18](VERIFICATION-CALVI-LA-VIE.md) · [Essais humains](PLAYTEST.md)
