# Une piste pour Blue Night : enquête dans Calvi

Ce mode est une proposition de conception, **pas une fonctionnalité présente
dans le jeu livré**.

Le joueur explore des panoramas Street View de Calvi, repère un détail dans
la rue et découvre une conversation, un objet ou une nouvelle piste. Ninu et
Antò commentent les détours à la radio. Une mission pourrait demander de
retrouver une cassette disparue entre le port, les carrughji et la citadelle.
Les commerces et dialogues seraient inventés, sans attribuer ces événements
aux habitants réels.

Le déplacement suit les panoramas disponibles : regarder autour de soi,
avancer au point suivant et choisir une rue. Une petite carte montre les
lieux visités. Les indices et personnages peuvent être affichés dans une
interface autour du panorama. Les scènes de conduite et de destruction
continuent dans la carte modélisée de Blue Night.

Une image panoramique ne fournit pas un monde 3D dans lequel marcher
librement, entrer dans les maisons ou modifier les bâtiments. La couverture
et les dates de prise de vue varient selon les rues ; les vues disponibles
ne garantissent pas une reconstitution de Calvi en 1994.

L’intégration officielle demande l’API Google Maps adaptée, une clé
configurée pour le site et la vérification des conditions et tarifs en
vigueur. Il faut conserver l’affichage et l’attribution imposés par Google,
et respecter ses règles de stockage des images. Le prototype actuel n’a
aucune clé Google, aucun téléchargement Street View et fonctionne hors ligne
avec ses données locales.

[Documentation officielle du panorama Street View](https://developers.google.com/maps/documentation/javascript/streetview).
