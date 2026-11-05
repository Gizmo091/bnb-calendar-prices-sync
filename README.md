<img src="assets/logo.svg" alt="" width="64" height="64" align="left">

# BnBridge

**Bridge your rates across platforms and years.**

<br clear="left">

[![CI](https://github.com/Gizmo091/bnb-calendar-prices-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/Gizmo091/bnb-calendar-prices-sync/actions/workflows/ci.yml)

<a href="https://www.buymeacoffee.com/mathieuvedie"><img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="Buy Me A Coffee" height="32" /></a>

Extension Chrome (Manifest V3) pour gérer les prix du calendrier d'une location
saisonnière sur Airbnb et Abritel / Vrbo, sans API ni abonnement : elle agit
dans votre propre session, à vitesse humaine, comme vous le feriez à la main.

## Fonctionnalités

- **Exporter** les prix d'une année, nuit par nuit, dans un fichier de prix
  (`.bnbprices`, du JSON lisible).
- **Importer** un fichier de prix et l'appliquer au calendrier d'un site.
- **Reporter une année sur la suivante** en suivant les vacances scolaires du
  ou des pays choisis :
  les prix de l'année N sont traduits en règles par période (Noël, hiver zone A,
  hiver zones A+B, été, hors vacances…), puis réappliqués sur les dates
  correspondantes de l'année N+1, qui ne tombent jamais aux mêmes dates. Les
  jours qui ont leur propre tarif dans chaque période (le samedi par défaut,
  réglable : vendredi et samedi, samedi et dimanche…) ont chacun leur règle.
- **Ne jamais écraser un prix déjà personnalisé** : seules les nuits encore au
  prix de base sont modifiées. Le prix de base est détecté automatiquement sur
  les nuits lointaines du calendrier et doit être confirmé par vous.
- **Simulation obligatoire** avant application : la projection et la
  comparaison au calendrier cible se font d'un seul geste. Une grille de
  l'année apparaît aussitôt et se remplit mois par mois au fil de la lecture
  du site, puis montre chaque nuit déjà au bon prix, ou dans la couleur du
  tarif qui va lui être appliqué, avec les nuits réservées et passées marquées
  par-dessus, et se met à jour pendant l'application ; les nuits ignorées et
  les règles déduites de l'année source restent consultables en détail.
- **Appliquer tout, ou seulement une sélection** : un clic ou un glisser sur
  la grille choisit des nuits (contour clair), et un second bouton n'enregistre
  que celles-là ; le reste peut être appliqué ensuite sans nouvelle simulation.
- **Interface en anglais et en français**, selon la langue de Chrome ou celle
  choisie dans les préférences ; les textes vivent dans `_locales/`.
- **Journal** en bas du panneau, à afficher ou masquer depuis les préférences,
  l'engrenage de l'en-tête, où se choisit aussi la langue.
- **Pause et arrêt à tout moment** pendant l'enregistrement : l'opération en
  cours se termine, puis l'extension attend ou s'arrête ; une nouvelle
  simulation reprend là où elle en était.
- **Transfert entre plateformes** : « Appliquer tels quels » reprend un fichier
  exporté d'un site sur l'autre, pour la même année, avec un coefficient et un
  arrondi optionnels pour ajuster le prix.

Les vacances à suivre se choisissent dans les réglages, un ou plusieurs pays :
celles des voyageurs, pas celles du lieu de l'annonce. Pour la France, les
vacances scolaires viennent de l'open data de l'Éducation nationale
(`fr-en-calendrier-scolaire`, zones A, B, C, publié jusqu'à trois ans
d'avance) et les jours fériés de `calendrier.api.gouv.fr`. Pour les autres
pays, l'[OpenHolidays API](https://www.openholidaysapi.org) fournit vacances
et fériés d'une trentaine de pays européens, région par région. Ces API
acceptent les requêtes de toute origine, l'extension ne demande aucune
permission sur elles.

## Installation (mode développeur)

1. `chrome://extensions`, activer le mode développeur.
2. « Charger l'extension non empaquetée » et choisir ce dossier.
3. Ouvrir le calendrier hôte du site, puis cliquer sur l'icône de l'extension :
   le panneau s'ouvre dans le panneau latéral de Chrome, à côté de la page, et
   suit l'onglet actif tant qu'aucune application n'est en cours. Sur un onglet
   non pris en charge, il le dit. Les prix chargés sont conservés d'une
   ouverture à l'autre, et ne reviennent que sur l'annonce où ils ont été
   chargés ; les étapes suivantes restent inaccessibles tant qu'aucun prix
   n'est chargé. Un fichier importé venant d'une autre annonce est signalé.

Chrome 114 ou plus récent (API `sidePanel`).

## Format du fichier de prix

Le fichier `prix-<site>-<annonce>-<année>.bnbprices`, où l'annonce est son nom
simplifié ou à défaut son identifiant, contient du JSON :

```json
{
  "version": 1,
  "site": "airbnb",
  "listingId": "123456",
  "listingName": "Chalet avec vue",
  "currency": "EUR",
  "exportedAt": "2026-11-04T10:00:00.000Z",
  "basePrice": 150,
  "days": {
    "2027-02-06": { "price": 220, "custom": true, "available": true }
  }
}
```

## Identité visuelle

Le logo est un pont blanc au-dessus de la ligne des tarifs, du jaune au rouge,
les couleurs mêmes de la grille des prix. Il vit dans `assets/logo.svg`, avec
un mot-symbole (`assets/wordmark.svg`) et les icônes de l'extension
(`assets/icons/`, générées par `rsvg-convert` depuis le logo).

| Rôle | Clair | Sombre |
| --- | --- | --- |
| Bleu du pont, marque (boutons, numéros d'étape, progression) | `#2f5fcf`, encre `#1e3f93` | `#7f9ff6`, encre `#a9bdff` |
| Vert, nuit au bon prix (grilles seulement) | `#2f6f4e` | `#4cb07e` |
| Échelle des prix, du moins cher au plus cher | `#f4e4a6` → `#cf3f33` | `#766d3e` → `#d1403a` |
| Graphite, texte et surfaces | `#171717` sur `#ffffff` | `#ededed` sur `#19191b` |

Le chrome du panneau reste neutre ; la marque n'apparaît que sur ce qui agit
(bouton principal, numéros d'étape, préférences), jamais dans les grilles.

## Structure

```
manifest.json
_locales/     textes de l'interface, anglais (défaut) et français
assets/       logo, mot-symbole et icônes
src/
  core/        logique métier, indépendante du navigateur (testée en Node)
  adapters/    lecture et écriture du calendrier de chaque site
  content/     script de contenu : charge l'adaptateur et répond aux messages du panneau
  ui/          panneau latéral : page, gabarit, styles, grille de l'année
  background.js  ouvre le panneau au clic, relaie les API publiques avec cache
dev/preview.html  aperçu du panneau hors extension (servir le dépôt en HTTP, `?dark`, `?lang=en`, `?state=…`)
dev/store.html    compositions des visuels du store, capturées par scripts/screenshots.sh
store/            fiche du store (en, fr) et visuels générés
scripts/          empaquetage, captures, téléversement sur le Web Store
docs/PUBLISHING.md  marche à suivre pour publier
test/
```

Le panneau garde un chrome neutre ; la couleur de marque sert aux actions, et la
grille de l'année montre les prix chargés puis l'état de chaque nuit du plan. La mise en
forme suit la méthode [unslop](https://github.com/heydamir/unslop) de Damir Sokolovsky (CC BY 4.0).

## État

Le cœur métier, le manifeste et la grille sont testés (`npm test`, sans
dépendance, avec le lanceur de Node), et `npm run check` vérifie la syntaxe
de toutes les sources. GitHub Actions lance les deux sur Node 20 et 22 à
chaque poussée et chaque pull request, puis construit l'archive de
l'extension, téléchargeable depuis l'exécution.

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

## Proposer une amélioration ou signaler un problème

Pas besoin de compte : un formulaire de deux minutes, [en français](https://tally.so/r/VpjJNa)
ou [en anglais](https://tally.so/r/7Xbx59), accessible aussi depuis le bas du panneau.
Les développeurs peuvent préférer les [issues GitHub](https://github.com/Gizmo091/bnb-calendar-prices-sync/issues).

## Publication

Les textes de la fiche du Chrome Web Store sont dans `store/`, les visuels se
régénèrent avec `npm run screenshots`, l'archive avec `npm run zip`, et un tag
`vX.Y.Z` déclenche la release (voir `docs/PUBLISHING.md`). La politique de
confidentialité est dans `PRIVACY.md`.

## Avertissement

L'automatisation d'un site, même depuis son propre navigateur, n'est pas
prévue par les conditions d'utilisation des plateformes. Utilisez l'extension
avec parcimonie, en vérifiant chaque simulation, et uniquement sur vos propres
annonces.
