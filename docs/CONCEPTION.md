# CALVI LA VIE — v19, Calvi illustrée

CALVI LA VIE est un jeu d’action en vue aérienne, à pied et dans cinq types de transports, inspiré de l’arcade des années 90 et des premiers GTA. La v19 applique un décor dessiné en **2,5D** à toute la carte réelle de Calvi. La géographie importée reste la même : coordonnées, voies, littoral, empreintes bâties, relief et observations ne sont pas déplacés pour composer une nouvelle ville.

## Territoire et rendu

L’unique carte suit la commune **INSEE 2B050**, relation OpenStreetMap **1151255**, avec cinq polygones, îlots compris. Port, citadelle, gare, plage, Pinède, Revellata et aéroport appartiennent au même monde. Le nord reste en haut et la projection conserve quatre pixels logiques par mètre. La frontière limite marche et roulage ; bateau et vol utilisent le cadre cartographique, avec accès terrestre praticable pour revenir à pied.

Les **1 552 tronçons routiers et 3 893 empreintes bâties** gardent leurs géométries source. Les routes sont dessinées sur leurs tracés, avec leurs largeurs de jeu ; les bâtiments portent toits et façades illustrés sur leurs volumes existants. Le **MNT IGN LiDAR HD**, à environ 20 m avec extrait urbain à 5 m, continue de donner le relief. Les **1 355 hauteurs IGN BD TOPO raccordées** restent utilisées ; les 2 538 autres empreintes gardent une estimation artistique ou une indication OSM exploitable. Ces estimations ne deviennent pas des mesures parce que le rendu est plus détaillé.

Sol, pierre, asphalte, sable, mer, toitures et végétation reprennent les matières dessinées de `assets/calvi-illustrated-materials.png`. La photographie IGN demeure une référence archivée pour les observations et la provenance ; elle n’est plus le fond, un toit ou un houppier affiché. La couleur et le détail sont interprétés pour le jeu, avec ombres et lumière jour/nuit.

La caméra suit le personnage avec un zoom rapproché d’environ **1,95**, puis recule progressivement à **1,65** en véhicule. Elle garde les mêmes distances physiques. Le terrain module légèrement la vitesse sur les pentes ; le nouvel habillage ne redessine pas les collisions.

## Végétation et observations

Les **12 000 groupes végétaux**, dont 8 475 couronnes ou groupes boisés et 3 525 groupes bas, gardent leurs positions et silhouettes observées. Les 32 observations manuelles conservent 28 arbres sombres et quatre palmiers. Les couronnes sont illustrées et ombrées ; les petits troncs d’implantation estimée bloquent déplacements et tirs. Le maquis bas ralentit le passage et masque les jambes ; les grands buissons peuvent faire obstacle. La couronne visuelle ne devient pas un mur entier. Le relief, les troncs et l’ordre des éléments au premier plan doivent rendre compréhensible le passage sous les feuilles.

Les **251 observations admissibles de véhicules** restent des acteurs jouables à leurs positions source : **96 voitures, 153 bateaux et deux avions**. Avec les 40 placements fictifs et véhicules de trafic, il y a **291 véhicules au départ**. La voiture `photo-car-port-04` appartient au joueur ; `photo-car-port-05` reste distincte et volable. Les vingt observations exclues restent archivées. La couverture concerne des secteurs du port, des parkings et de l’aéroport, sans exhaustivité communale. Le sol dessiné ne contient plus les silhouettes fixes de véhicules de la photographie.

## Transports, saut et parachute

| Transport | Comportement |
|---|---|
| Voiture | Accélération, virages, marche arrière, freinage, sortie à l’arrêt et vol d’un véhicule accessible. |
| Moto | Même logique terrestre, avec un corps plus étroit. |
| Bateau | Navigation sur l’eau, marche arrière et freinage ; sortie depuis un accès terrestre libre ou transfert vers une coque proche et lente. |
| Hélicoptère | Décollage, direction libre, descente sur un sol dégagé ou saut en vol. |
| Avion | Rouler, armer le décollage, accélérer, voler ; demander une approche terrestre libre à vitesse réduite ou sauter. |

Les premiers véhicules sont placés fictivement sur des surfaces vérifiées. Les observations ajoutées gardent une position photographique, sans certifier une propriété ni une installation aéronautique. L’aire aéroportuaire OSM 200335795 et la piste 8113537 restent celles de l’archive ; quatre avions observés hors commune restent exclus.

Les **six axes de pontons OSM** sont praticables à pied ; leur largeur de jeu de **10 pixels, soit 2,5 m**, reste estimée. Ils ne servent pas au roulage ni à l’atterrissage. Les bateaux photographiques gardent un corps physique inscrit dans leur silhouette observée. Sept s’abordent depuis la côte, 110 depuis les pontons et 36 par approche maritime ou transfert. Le passage doit éviter murs, troncs, terre et autres coques.

**E/Entrée ou MONTER** prend un véhicule accessible ; **E/Entrée ou SORTIR** en descend au sol après ralentissement. En avion ou en hélicoptère, **E/Entrée ou SAUTER** quitte aussi l’appareil en vol. **Espace ou PARACHUTE** ouvre la voile pendant la chute ; touches de déplacement ou stick gauche dirigent la descente. Il faut ouvrir assez tôt et viser un sol libre. Espace sert également à poser une bouteille à pied, freiner sur terre ou en bateau, et décoller/demander l’atterrissage selon l’état du véhicule.

## Temps, missions et interface

L’exploration libre, proposée par défaut, n’a pas de limite de durée. Le mode missions demande de détruire trois dépôts fictifs puis de revenir au port en **180 secondes**. Les deux modes commencent avec trois vies. Les titres d’objectifs sont conservés, mais les récits, biographies et répliques ont été retirés.

Le logo original fourni est conservé. Le menu permet de choisir mode et heure ; le HUD compact montre les informations nécessaires, et **ⓘ** déplie les détails. Les noms des personnages et textes de présentation ne réapparaissent pas dans le décor illustré.

Une journée dure **douze minutes actives**. Départs à 06:00, 12:00, 18:30 ou 00:00 ; ombres, éclairage, phares et lampes suivent l’horloge. Pause, tutoriel et interruption figent simulation et effets, y compris la chute et le parachute.

## Armes, destruction et recherche

Les six armes restent **Pistolet, Rafale, Lance-BOUM, Fusil à pompe, Fusil de précision et Carabine**, sélectionnées avec R, Tab ou le bouton d’arme. Les tirs rencontrent le premier obstacle physique sur leur segment. Le Lance-BOUM peut atteindre le sol depuis un appareil en vol ; les autres armes ne tirent pas sur des cibles terrestres depuis le vol.

Les morts laissent du sang temporaire. Une voiture détruite par tirs brûle puis explose après **1,4 seconde active** ; les explosifs peuvent déclencher immédiatement une chaîne. Les bâtiments ont une résistance finie. Feu, souffle, débris et fumée sont dessinés, avec effets réduits disponibles. Le budget d’effets privilégie les explosions proches du joueur sans changer leurs dégâts.

La gravité des incidents alimente une recherche de **zéro à six étoiles** : patrouilles, renforts, barrages dès 3, hélicoptère de recherche dès 4, unités lourdes dès 5 et armée à 6. Les avertissements précèdent les renforts, les barrages sont destructibles et les agents à pied respectent le sol praticable et ses obstacles. La recherche diminue après fuite hors de vue sans nouveau fait.

## Provenance et vérification

**© OpenStreetMap contributors · ODbL 1.0** et **© IGN · Licence Ouverte** restent les attributions des données utilisées. Requêtes, archives, empreintes et estimations restent documentées. L’illustration n’est ni un relevé cadastral ni une reconstruction historique de 1994 ; façades, détails, personnages, enseignes et missions sont des créations de jeu.

Les rapports v17 et v18 restent des preuves de leurs versions respectives. Ils ne valident pas le nouveau rendu v19, sa cadence ni son confort sur Mac/Safari ou téléphone. Le protocole humain est une séance à réaliser, pas une observation obtenue.

[Lancement](../README.md) · [Cartographie](CARTOGRAPHIE.md) · [Direction artistique](DIRECTION-ARTISTIQUE.md) · [Vérification v19](VERIFICATION-CALVI-ILLUSTREE.md) · [Historique v18](VERIFICATION-CALVI-LA-VIE.md) · [Historique v17](VERIFICATION.md) · [Essais humains](PLAYTEST.md)
