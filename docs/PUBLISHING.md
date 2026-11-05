# Publier BnBridge sur le Chrome Web Store

Ce guide couvre la première publication, puis chaque mise à jour. Les textes
de la fiche sont dans `store/listing.en.md` et `store/listing.fr.md`, les
visuels dans `store/screenshots/`, la politique de confidentialité à la
racine (`PRIVACY.md`).

## Avant la première publication

1. **Compte développeur** : https://chrome.google.com/webstore/devconsole,
   frais uniques de 5 $ au premier dépôt. Un compte Google dédié au projet
   évite de lier la fiche à un compte personnel.
2. **Vérifier les textes** : relire `store/listing.*.md`, et changer l'URL de
   la politique de confidentialité si le dépôt change de nom ou d'adresse.
3. **Visuels** : `npm run screenshots` régénère tout depuis `dev/store.html`
   avec Chrome headless (la variable `CHROME` pointe vers un autre binaire si
   besoin). Vérifier le rendu dans `store/screenshots/fr` et `en`.
4. **Archive** : `npm run zip` produit `dist/bnbridge-<version>.zip` avec le
   manifeste, les textes, les sources et les icônes, rien d'autre.

## Remplir la fiche (console développeur)

Créer un élément, téléverser l'archive, puis onglet par onglet :

**Fiche du Store** (une fois par langue, Français et English)
- Description détaillée : bloc « Description détaillée » de la fiche.
- Catégorie : Productivité › Organisation et planification.
- Langue : Français, et ajouter English avec le bloc anglais.
- Icône du store : `assets/icons/icon-128.png`.
- Captures d'écran : les cinq fichiers `1-read.png` … `5-prefs.png` de la
  langue, dans cet ordre (1280 × 800).
- Petite vignette promotionnelle : `tile-440x280.png`.
- Bandeau promotionnel : `marquee-1400x560.png`.
- Page d'accueil et assistance : l'adresse du dépôt GitHub et sa page issues.

**Confidentialité**
- Objectif unique : bloc « Objectif unique ».
- Justification des permissions : un bloc par permission, tels quels.
- Code distant : Non.
- Usage des données : cocher « Contenu de sites web », cocher les trois
  certifications, coller l'URL de `PRIVACY.md`.

**Distribution**
- Visibilité : Publique. Pour une période de test, « Non répertorié » rend
  la fiche accessible par lien seulement, sans passer par la recherche.
- Régions : toutes, ou France et pays francophones si on préfère commencer
  petit.

Soumettre pour examen. Le premier examen prend en général de un à trois
jours ; une extension qui demande des permissions d'hôte est relue à la
main, et le nom de 55 à 72 caractères peut être jugé long (la limite est à
75, la recommandation à 45). Si la relecture le demande, raccourcir le nom
dans `_locales/*/messages.json` (`ext_name`), pas dans le manifeste.

## Publier une nouvelle version

1. Mettre à jour `version` dans `manifest.json` et `package.json`.
2. Commiter, puis poser le tag et le pousser :

   ```sh
   git tag v0.3.0
   git push origin main v0.3.0
   ```

3. Le workflow `Release` vérifie que le tag correspond au manifeste, lance
   les tests, construit l'archive et la joint à une release GitHub.
4. Si les secrets du Web Store sont définis (voir ci-dessous), il téléverse
   l'archive et la soumet à la publication. Sinon, téléverser à la main
   l'archive de la release dans la console, onglet « Paquet ».

Après examen, Google publie la version ; les utilisateurs la reçoivent dans
les heures qui suivent.

## Publication automatique : les secrets

L'API du Chrome Web Store demande un projet Google Cloud et un client OAuth.
Une seule fois :

1. Dans https://console.cloud.google.com, créer un projet, activer l'API
   « Chrome Web Store API ».
2. Écran de consentement OAuth : type Externe, ajouter le compte développeur
   comme utilisateur test.
3. Identifiants › Créer un ID client OAuth, type « Application de bureau ».
   Noter l'ID client et le secret.
4. Obtenir un jeton de rafraîchissement, avec le compte développeur :

   ```sh
   open "https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=ID_CLIENT&redirect_uri=urn:ietf:wg:oauth:2.0:oob&access_type=offline&prompt=consent"
   curl -X POST https://oauth2.googleapis.com/token -d client_id=ID_CLIENT -d client_secret=SECRET -d code=CODE_AFFICHE -d grant_type=authorization_code -d redirect_uri=urn:ietf:wg:oauth:2.0:oob
   ```

   La réponse contient `refresh_token`.
5. Dans GitHub, Settings › Secrets and variables › Actions, créer :
   `WEBSTORE_CLIENT_ID`, `WEBSTORE_CLIENT_SECRET`, `WEBSTORE_REFRESH_TOKEN`
   et `WEBSTORE_EXTENSION_ID` (l'identifiant de 32 lettres de la fiche, visible
   dans son URL après la première publication manuelle).

Le script `scripts/webstore.sh` fait la même chose en local :
`scripts/webstore.sh dist/bnbridge-0.2.0.zip publish` avec les quatre
variables dans l'environnement.

## Liste de contrôle avant de taguer

- `npm run check && npm test` au vert.
- Version identique dans `manifest.json` et `package.json`.
- Textes des deux langues relus (`_locales/`), surtout `ext_name` et
  `ext_description`.
- Captures régénérées si l'interface a changé.
- `PRIVACY.md` daté du jour si son contenu a bougé.
