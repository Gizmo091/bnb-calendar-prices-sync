# BnB Calendar Prices Sync

Extension Chrome (Manifest V3) pour gérer les prix du calendrier d'une location
saisonnière sur Airbnb et Abritel / Vrbo, sans API ni abonnement : elle agit
dans votre propre session, à vitesse humaine, comme vous le feriez à la main.

## Fonctionnalités

- **Exporter** les prix d'une année, nuit par nuit, dans un fichier de prix
  (`.bnbprices`, du JSON lisible).
- **Importer** un fichier de prix et l'appliquer au calendrier d'un site.
- **Reporter une année sur la suivante** en suivant les vacances scolaires :
  les prix de l'année N sont traduits en règles par période (Noël, hiver zone A,
  hiver zones A+B, été, hors vacances…), puis réappliqués sur les dates
  correspondantes de l'année N+1, qui ne tombent jamais aux mêmes dates.
- **Ne jamais écraser un prix déjà personnalisé** : seules les nuits encore au
  prix de base sont modifiées. Le prix de base est détecté automatiquement sur
  les nuits lointaines du calendrier et doit être confirmé par vous.
- **Simulation obligatoire** avant application : la liste exacte des plages et
  des prix est affichée, avec les nuits ignorées et la raison.
- **Transfert entre plateformes** : « Appliquer tels quels » reprend un fichier
  exporté d'un site sur l'autre, pour la même année, avec un coefficient et un
  arrondi optionnels pour ajuster le prix.

Les vacances scolaires viennent de l'open data de l'Éducation nationale
(`fr-en-calendrier-scolaire`), les jours fériés de `calendrier.api.gouv.fr`.

## Installation (mode développeur)

1. `chrome://extensions`, activer le mode développeur.
2. « Charger l'extension non empaquetée » et choisir ce dossier.
3. Ouvrir le calendrier hôte du site, puis cliquer sur l'icône de l'extension :
   le panneau s'ouvre dans le panneau latéral de Chrome, à côté de la page, et
   suit l'onglet actif tant qu'aucune application n'est en cours. Sur un onglet
   non pris en charge, il le dit. Les prix chargés sont conservés d'une
   ouverture à l'autre, par annonce.

Chrome 114 ou plus récent (API `sidePanel`).

## Format du fichier de prix

Le fichier `prix-<site>-<année>.bnbprices` contient du JSON :

```json
{
  "version": 1,
  "site": "airbnb",
  "listingId": "123456",
  "currency": "EUR",
  "exportedAt": "2026-11-04T10:00:00.000Z",
  "basePrice": 150,
  "days": {
    "2027-02-06": { "price": 220, "custom": true, "available": true }
  }
}
```

## Structure

```
manifest.json
src/
  core/        logique métier, indépendante du navigateur (testée en Node)
  adapters/    lecture et écriture du calendrier de chaque site
  content/     script de contenu : charge l'adaptateur et répond aux messages du panneau
  ui/          panneau latéral : page, gabarit, styles, grille de l'année
  background.js  ouvre le panneau au clic, relaie les API publiques avec cache
dev/preview.html  aperçu du panneau hors extension (servir le dépôt en HTTP, `?dark`, `?state=…`)
test/
```

Le panneau garde un chrome neutre ; la seule couleur sert au bouton « Appliquer » et à la
grille de l'année, qui montre les prix chargés puis l'état de chaque nuit du plan. La mise en
forme suit la méthode [unslop](https://github.com/heydamir/unslop) de Damir Sokolovsky (CC BY 4.0).

## État

Le cœur métier est testé (`npm test`).

- **Airbnb** : adaptateur calibré sur le calendrier hôte (`/multicalendar/<id>`)
  en novembre 2026. Lecture par défilement de la liste virtualisée, écriture par
  sélection de plage (clic puis maj+clic) et formulaire « Prix par nuit ».
  Chaque étape vérifie l'état de la page et s'interrompt sans enregistrer en
  cas de doute.
- **Abritel / Vrbo** : adaptateur calibré sur le calendrier propriétaire
  (`/p/calendar/<id>`) en novembre 2026. Lecture depuis la vue « Année »
  (toutes les nuits ont un prix, même passées ou réservées), écriture par
  sélection de plage et formulaire « Tarifs et réductions ».

Limites connues sur Airbnb :

- la lecture passe par la requête interne du calendrier, qui donne le prix de
  toutes les nuits, passées et réservées comprises. Si cette requête change,
  l'adaptateur se replie sur le calendrier affiché, où ces nuits n'ont pas de
  prix. Les nuits réservées sont lues mais jamais modifiées ;
- le prix lu est le prix nominal fixé par l'hôte. Sur une nuit couverte par une
  promotion Airbnb, le calendrier affiche le prix remisé ; l'export garde le
  prix nominal et signale la promotion (`promotion`). Le repli sur le
  calendrier affiché, lui, lirait le prix remisé ;
- Airbnb n'indique pas si un prix est personnalisé : une nuit est considérée
  comme personnalisée quand son prix diffère du prix de base.

## Avertissement

L'automatisation d'un site, même depuis son propre navigateur, n'est pas
prévue par les conditions d'utilisation des plateformes. Utilisez l'extension
avec parcimonie, en vérifiant chaque simulation, et uniquement sur vos propres
annonces.
