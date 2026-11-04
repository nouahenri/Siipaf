# SIIPAF — application mobile (iOS et Android)

Application native Expo (SDK 58, expo-router, onglets natifs) de SIIPAF SA. Même serveur et même base que le site,
le dashboard, l'ERP et l'espace client : rien n'est recopié, tout est lu dans l'API (`https://client.siipaf.com`).

## Ce que fait l'application

- **Vitrine** (onglets Accueil, Programmes, Sita, Contact, Mon espace) : recherche d'un bien, programmes et lotissements
  du dashboard (grille de prix, simulateur de mensualité, documents, viabilisation, itinéraire), plan interactif natif
  (zoom, toucher d'un lot, intérêt ou pré-réservation).
- **Menu latéral « Infos SIIPAF »** : qui sommes-nous, métiers, engagements, financement, avis clients, carrières,
  contacts directs, chiffres clés. Textes réglés dans le dashboard (Contenu du site › Éditorial).
- **Prospects** : formulaire (message, rendez-vous, intérêt, pré-réservation), Sita, WhatsApp. Chaque demande arrive dans
  le dashboard et l'ERP avec l'origine **« Application mobile »** et prévient l'équipe commerciale.
- **Espace client** : accueil du dossier, chantier (photos, vidéos, travaux modificatifs, livraison), paiements
  (échéancier, reçus PDF générés sur le téléphone), documents (ouverture, partage), messages, SAV avec photos, profil.
  Connexion 30 jours, déverrouillage Face ID / empreinte, notifications push par catégorie.

## Lancer en développement

```bash
npm install
```

```bash
npx expo start
```

Pour viser le serveur de démonstration (`client-demo`, port 4001) depuis un téléphone sur le même Wi-Fi :
`EXPO_PUBLIC_API_URL=http://<ip-du-pc>:4001 npx expo start`. L'aperçu web (`npx expo start --web`) sert à la mise au
point ; Face ID, push et appareil photo ne s'y testent pas.

Compte de démonstration : `server/data/demo-acces-mobile.txt` (base `demo.sqlite`, fichier non versionné).

Vérifications : `npm run typecheck` et `npx eslint src`.

## Builds Android et iOS (EAS)

1. `npx eas-cli@latest login` puis `npx eas-cli@latest init` : crée le projet Expo et écrit `extra.eas.projectId`
   dans `app.json` (indispensable aux notifications push).
2. `npx eas-cli@latest build --platform android` (fichier `.aab` pour Google Play, ou profil `preview` pour un `.apk`).
3. `npx eas-cli@latest build --platform ios` (compte Apple Developer requis).
4. `npx eas-cli@latest submit` pour envoyer aux stores.

Identifiants : `com.siipaf.app` (iOS et Android). Expo Go ne reçoit pas les push sur Android : tester avec un build.

À fournir avant publication : logo SIIPAF en haute définition (l'icône actuelle est tirée du logo du site, 121 px),
captures d'écran, textes de fiche store, politique de confidentialité.

## Côté serveur (déjà en place)

- `X-Siipaf-App: mobile` : jeton de 30 jours renvoyé à la connexion, révoqué au changement de mot de passe
  (`client_accounts.token_version`).
- `POST /api/client/push`, `POST /api/client/push/remove`, `GET|PUT /api/client/push/prefs` ; envoi via Expo
  (`services/push.js`, `EXPO_ACCESS_TOKEN` facultatif) à chaque message de l'équipe dans l'espace client.
- Origine `mobile` des prospects (formulaires, plan, Sita : canal « Application mobile » dans l'ERP).
- Migration `20261212000000_application_mobile.js`.

## Contenus du site

`src/content/` contient le catalogue des textes et images du site (copie de `server/src/lib`). Après l'ajout d'une
section au site : `npm run sync-content`. Les textes modifiés dans le dashboard arrivent sans nouvelle version de l'app.
