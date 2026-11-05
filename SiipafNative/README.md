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

## Builds Android et iOS (compilation locale, sans EAS)

Projet Expo : `@nouahenris-team/siipaf` (identifiant dans `app.json › extra.eas.projectId`, indispensable aux notifications
push). Les builds se font sur la machine de l'équipe, pas sur les serveurs d'Expo.

### Android (Windows)

Prérequis : Android Studio (SDK Android 37, build-tools 36, NDK 27.1), dont le JDK sert à la compilation.

**Chemins trop longs sous Windows** (erreur `ninja: error: mkdir(CMakeFiles/worklets.dir/C_/Users/…): No such file or
directory` sur `react-native-worklets`) : le projet est dans un dossier au chemin long et CMake le recopie deux fois.
1. Activer les chemins longs de Windows (PowerShell administrateur, puis redémarrer le PC) :
   `New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force`.
2. Installer un CMake récent (Android Studio › SDK Manager › SDK Tools › CMake, 4.1.2 sur le poste actuel) et l'imposer dans
   `android/local.properties` (fichier propre à la machine, hors git), sinon Android Gradle garde CMake 3.22.1 dont le
   `ninja` ignore les chemins longs :
   `cmake.dir=C\:/Users/NOUAMA/AppData/Local/Android/Sdk/cmake/4.1.2` (barres obliques).
3. Supprimer `node_modules/react-native-worklets/android/.cxx` (et celui de `react-native-reanimated` s'il existe), puis
   *File › Sync Project with Gradle Files* et relancer le build.
Après un `npx expo prebuild` (avec ou sans `--clean`, Expo recrée tout `android/`) : remettre la ligne `cmake.dir`.

Architectures compilées : arm64-v8a et armeabi-v7a seulement (vrais téléphones, suffisant pour le Play Store), réglées par
`plugins/withBuildArchs.js`, ce qui divise environ par deux la durée du build. Pour un émulateur x86_64 ponctuel :
`./gradlew assembleDebug -PreactNativeArchitectures=x86_64`. Si CMake 4 refuse un module
ancien (« Compatibility with CMake < 3.5 has been removed »), définir la variable d'environnement
`CMAKE_POLICY_VERSION_MINIMUM=3.5`. En secours : lecteur virtuel court `subst S: C:\Users\NOUAMA\Desktop\SIIPAF_WEB\SiipafNative`
et ouvrir `S:\android` dans Android Studio.

1. `npx expo prebuild --platform android` : génère `android/` depuis `app.json` (dossier ignoré par git, à régénérer après
   chaque changement de `app.json` ou de module natif ; ne pas le modifier à la main).
2. APK d'essai (signé avec la clé de test, à installer directement sur un téléphone) :
   ```bash
   cd android && JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ANDROID_HOME="$LOCALAPPDATA/Android/Sdk" ./gradlew assembleRelease
   ```
   Fichier : `android/app/build/outputs/apk/release/app-release.apk`.
3. Clé d'envoi Google Play, à créer une seule fois et à **conserver précieusement** (sans elle, plus de mise à jour possible) :
   ```bash
   "/c/Program Files/Android/Android Studio/jbr/bin/keytool" -genkeypair -v -keystore siipaf-upload.keystore -alias siipaf-upload -keyalg RSA -keysize 2048 -validity 10000
   ```
   Ranger le fichier **hors du projet**, jamais dans `android/` : `npx expo prebuild` recrée ce dossier en entier et l'efface
   (clé perdue le 05/11). Par exemple `C:/Users/NOUAMA/cles-siipaf/`, avec une copie sur clé USB ou OneDrive. Puis l'indiquer dans `~/.gradle/gradle.properties` (jamais dans le projet) :
   ```
   SIIPAF_UPLOAD_STORE_FILE=C:/chemin/vers/siipaf-upload.keystore
   SIIPAF_UPLOAD_KEY_ALIAS=siipaf-upload
   SIIPAF_UPLOAD_STORE_PASSWORD=…
   SIIPAF_UPLOAD_KEY_PASSWORD=…
   ```
   Le plugin `plugins/withReleaseSigning.js` l'utilise alors pour la version « release ».
4. Fichier pour Google Play : `cd android && ./gradlew bundleRelease` → `android/app/build/outputs/bundle/release/app-release.aab`.
   Le numéro de version se règle dans `app.json` (`version`, `android.versionCode` à augmenter à chaque envoi).

### iOS

Xcode n'existe que sur macOS : `npx expo prebuild --platform ios` puis compilation dans Xcode, sur un Mac, avec un compte
Apple Developer. Sans Mac, `npx eas-cli@latest build --platform ios` reste possible (compilation chez Expo).

Identifiants : `com.siipaf.com` (iOS et Android), celui des fichiers Firebase `google-services.json` (Android) et `GoogleService-Info.plist` (iOS), branchés dans `app.json` (`googleServicesFile`). Expo Go ne reçoit pas les push sur Android : tester avec un build.

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
