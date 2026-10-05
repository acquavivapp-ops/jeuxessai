# Calvi — aperçu hybride du port

Ce prototype fixe compare **le même port, avec la même caméra**, en dessin seul ou avec des détails photographiques ajoutés au sol. Il permet d’examiner le mélange satellite/dessin. Le jeu principal reste la v20 illustrée et ne charge aucune photographie par défaut.

## Ouvrir et comparer

Depuis le dossier du projet, lancer `npm start`, puis ouvrir **`/docs/calvi-hybrid-preview.html`** sur l’adresse affichée dans le terminal, normalement [http://127.0.0.1:4173/docs/calvi-hybrid-preview.html](http://127.0.0.1:4173/docs/calvi-hybrid-preview.html). L’aperçu utilise les fichiers locaux du projet ; une ouverture directe par `file://` ne convient pas.

- **Avant / après** déplace la séparation entre dessin et hybride.
- **Détail photo** règle l’intensité du mélange.
- **Lumière** compare jour et nuit, sans déplacer la caméra.

Il s’agit d’une vue graphique isolée, sans déplacement ni partie jouable.

## Ce qui reste réel et ce qui est dessiné

Les photographies IGN BD ORTHO archivées ont été demandées à **0,25 m/pixel**. Ce pas d’export ne certifie ni résolution native ni précision locale. Leurs emprises sont raccordées aux coordonnées du monde et à sa caméra ; elles ne remplacent pas sa géométrie.

La photo ajoute uniquement du **détail au sol terrestre**. Mer, routes, bâtiments et relief bâti, végétation, personnages et véhicules restent dessinés. Des masques retirent de la couche photo les silhouettes bâties, végétales et de véhicules connues, avec les observations exclues disponibles. Ils révèlent le sol dessiné dessous ; ils n’inventent pas une photographie nettoyée. Les zones non couvertes gardent le dessin. Les originaux restent intacts.

La source photo retient **au plus quatre crops et 16 Mio de pixels décodés**, avec un **tampon réutilisé de 256 Kio** distinct. Les caches du renderer restent séparés ; ces plafonds ne représentent pas la mémoire totale du navigateur et ne prouvent pas une cadence de jeu.

## Vérifications et limites

**Vérification courte réussie, code 0, Chromium fermé** : quatre cas jour/nuit × bureau/mobile. Caméras, contours et 251 états de véhicules source sont identiques ; le retour au dessin seul retrouve ses pixels et les compteurs chauds restent stables. Quatre photos occupent 16 Mio décodés, avec le tampon distinct de 256 Kio. Dans le jeu normal, aucun JPEG ni module hybride n’est demandé. La [preuve compacte](calvi-hybrid-preview-validation.json) conserve commande, sources, empreintes et limites. Il ne s’agit ni d’un benchmark ni d’une nouvelle passe des 35 scénarios v20. Les [preuves v20](VERIFICATION-CALVI-FLUIDITE.md) restent celles du jeu entièrement illustré.

Comparaisons contrôlées : [bureau, jour](calvi-hybrid-preview-day.png) · [bureau, nuit](calvi-hybrid-preview-night.png) · [format mobile, jour](calvi-hybrid-preview-phone.png). Gauche : dessin ; droite : hybride, au même endroit.

Le prototype couvre seulement le **port**, avec une caméra fixe. Il ne valide pas une partie hybride sur toute la commune, le confort de déplacement ou Mac/Safari. Ombres photographiques, objets non annotés et décalages entre millésimes peuvent subsister. Les dates locales IGN restent inconnues ; il ne s’agit pas d’une reconstruction de 1994.

© IGN · Licence Ouverte / Open Licence — © OpenStreetMap contributors · ODbL 1.0. [Cartographie et provenance](CARTOGRAPHIE.md) · [Lancement du jeu](../README.md)
