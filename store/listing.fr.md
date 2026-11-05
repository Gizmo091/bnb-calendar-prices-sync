# Fiche du Chrome Web Store — français

À coller dans les champs de la console développeur, langue « Français ». Le
nom et le résumé viennent du manifeste et ne se modifient pas dans la console.

## Nom (manifeste, 72 caractères)

BnBridge – Vos tarifs, d'une plateforme à l'autre, d'une année à l'autre

## Résumé (description du manifeste, 132 caractères max)

Exportez, importez et reportez les prix de vos calendriers Airbnb et Abritel, d'une plateforme à l'autre et d'une année sur l'autre.

## Catégorie

Productivité › Organisation et planification

## Description détaillée

BnBridge est un panneau latéral pour les hôtes qui fixent eux-mêmes leurs tarifs à la nuit sur Airbnb et Abritel / Vrbo. Il lit votre calendrier, garde vos prix dans un fichier qui vous appartient, et les réécrit où vous voulez : sur l'autre plateforme, ou sur le calendrier de l'année suivante, avec les vacances scolaires déplacées à leurs nouvelles dates.

Sans API, sans abonnement, sans compte. L'extension travaille dans votre propre session, sur la page du calendrier déjà ouverte, à vitesse humaine, exactement comme vous le feriez à la main, les cinq cents clics en moins.

CE QU'ELLE FAIT

• Lire une année entière de prix, nuit par nuit, dans une grille lisible d'un coup d'œil.
• Exporter les prix dans un fichier .bnbprices (du JSON lisible), et importer un tel fichier sur une autre annonce ou une autre plateforme.
• Reporter une année sur la suivante : les prix de l'année N deviennent des règles par période (Noël, hiver zone A, été, hors vacances…) appliquées aux dates correspondantes de l'année N+1, qui ne tombent jamais les mêmes jours. Le samedi, ou les jours de votre choix, garde son propre tarif.
• Ne jamais écraser un prix que vous avez personnalisé à la main, sauf si vous le demandez : seules les nuits encore au prix de base sont modifiées.
• Prévisualiser avant d'écrire quoi que ce soit : chaque nuit apparaît dans la couleur du tarif qui l'attend, les nuits déjà au bon prix et celles conservées se distinguent, et les règles déduites de l'année source sont listées en détail.
• Tout appliquer, ou seulement une sélection : un clic ou un glisser sur la grille choisit des nuits. Le reste s'applique plus tard, sans nouvelle prévisualisation.
• Mettre en pause ou arrêter à tout moment. Chaque opération est vérifiée sur le calendrier avant la suivante, et le journal garde la trace de tout.
• Interface en français et en anglais, selon la langue de Chrome ou votre choix.

SITES PRIS EN CHARGE

• Airbnb, le multicalendrier hôte (airbnb.fr et airbnb.com).
• Abritel / Vrbo, le calendrier propriétaire (abritel.fr et vrbo.com).

Les vacances scolaires et les jours fériés viennent de l'open data français (Éducation nationale et calendrier.api.gouv.fr) : le report d'une année sur l'autre est pensé pour les annonces situées en France.

CONFIDENTIALITÉ

BnBridge ne parle qu'à la page du calendrier ouverte dans votre navigateur et aux deux API publiques des vacances. Vos prix restent dans le stockage local de votre navigateur et dans les fichiers que vous exportez. Rien n'est envoyé, ni à nous ni à personne, il n'y a ni compte ni suivi. Politique complète : https://github.com/Gizmo091/bnb-calendar-prices-sync/blob/main/PRIVACY.md

BnBridge est un projet indépendant, sans lien avec Airbnb, Abritel, Vrbo ou Expedia Group. Les interfaces des sites changent ; si une étape échoue, l'extension s'arrête sans rien écrire et dit dans le journal ce qu'elle a vu.

## Objectif unique (onglet confidentialité)

Lire, exporter, importer et appliquer les prix à la nuit d'un calendrier de location saisonnière sur Airbnb et Abritel / Vrbo, y compris reporter les prix d'une année sur la suivante.

## Justification des permissions (onglet confidentialité)

storage — Conserve dans le navigateur les prix lus pour une annonce, le prix de base et les réglages (coefficient, arrondi, jours à tarif propre, langue, affichage du journal), pour reprendre là où on s'était arrêté.

sidePanel — Toute l'interface vit dans le panneau latéral de Chrome, à côté du calendrier sur lequel elle agit.

Hôtes airbnb.fr, airbnb.com, abritel.fr, vrbo.com — Le script de contenu lit le calendrier affiché sur ces sites et remplit le formulaire de prix à la place de l'utilisateur. Aucun autre site n'est touché.

Scripts de contenu — Chargés uniquement sur les sites ci-dessus ; ils répondent aux demandes du panneau (lire le calendrier, appliquer un prix) et ne font rien d'eux-mêmes.

Code distant — Aucun. Tout le code est dans le paquet.

## Usage des données (onglet confidentialité)

Données collectées : contenu de sites web (les prix et l'état de réservation affichés sur le calendrier de l'utilisateur). Elles sont stockées localement dans le navigateur et dans les fichiers exportés par l'utilisateur. Elles ne sont jamais transmises au développeur ni à des tiers.

Certifications : non vendues à des tiers, non utilisées à des fins étrangères à l'objectif unique, non utilisées pour évaluer la solvabilité ou à des fins de prêt.

URL de la politique de confidentialité : https://github.com/Gizmo091/bnb-calendar-prices-sync/blob/main/PRIVACY.md
