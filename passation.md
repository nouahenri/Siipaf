# Passation — Plateforme SIIPAF

> Document de reprise pour continuer le travail dans une nouvelle discussion.
> Dernière mise à jour : 20 octobre 2026.
> Pour reprendre : ouvrir une discussion dans ce dossier et taper `/passation`.

---

## 1. Le projet en bref

SIIPAF SA, promoteur et aménageur immobilier agréé MCLU (Côte d'Ivoire). Trois chantiers, dans cet ordre (choix du client) :

| Phase | Contenu | État |
|---|---|---|
| **1. Site + admin** | Serveur Node, dashboard admin, plan de masse interactif, RDV assistés par IA | **En cours** — étapes 1 à 3 faites |
| **2. Espace client** | Suivi chantier, documents juridiques, cotisations, messagerie | **En cours** — étapes 1 (serveur), 2 (application client) et 3 (gestion dans l'admin) faites ; prochaine : 4 (import CSV des 112 clients, dès réception du fichier) |
| 3. ERP | Admin générale, RH, Compta, Client/SAV, Juridique, KPI commerciaux | À faire |

Circuit métier à respecter partout : **Prospection → Visite → Décision → Choix du bien → Paiement → Contrat → Notaire → Livraison → SAV**.

Existant de référence pour l'espace client : https://suiviclient-siipaf.com/ (112 clients ; on repart de zéro, le client fournira un **export CSV** à importer).

---

## 2. Organisation du dépôt

```
SIIPAF_WEB/
├── *.html, css/, js/, images/   Site public statique (en ligne sur siipaf.com, hébergement LWS)
├── js/testimonials.js           Témoignages dynamiques + formulaire de dépôt (accueil)
├── server/                      API Node.js (Express + Knex) — voir server/README.md
│   ├── src/lib/domain.js        RÈGLES MÉTIER : statuts lots, transitions, rôles, droits, documents
│   ├── src/services/            lots.js (options, expiration, statuts) · sales.js (dossiers d'acquisition)
│   ├── src/routes/              public, auth, users, catalog, sales, crm, content, testimonials
│   ├── migrations/              init · sales · testimonials · client_space · permissions · roles
│   ├── seeds/01_base.js         5 projets + 24 prix + contenu du site + super admin
│   ├── scripts/                 demo-data.js, demo-sales.js (base démo), serve-site.js (aperçu du site)
│   └── test/                    50 tests (node --test) — tous verts
├── admin/                       Dashboard React + Vite, servi par le serveur à /admin
│   └── src/pages, components    Tableau de bord, Prospects, RDV, Lots, Projets, Éditeur de plan,
│                                Contenu, Médiathèque, Messages, Témoignages, Newsletter, Utilisateurs
└── client/                      Espace client React + Vite, servi par le serveur à /espace-client
    ├── src/pages                Login, Password (1re connexion, oubli, réinitialisation), Home, Chantier,
    │                            Paiements, Receipt (reçu imprimable), Documents, Messages, Profile
    ├── src/lib                  api.js (/api/client), session.jsx (session + cache), format.js, domain.js (libellés)
    └── public/                  logo, photo de connexion, projets/<slug>.jpg (repli si le projet n'a pas de photo)
```

**Pile technique (décidée avec le client)** : Node.js sur cPanel LWS (« Setup Node.js App »), MySQL/MariaDB du cPanel en production, SQLite en local et en test (même code via Knex), React + Vite, e-mails via SMTP LWS.

---

## 3. Lancer en local

```bash
cd server && npm install && npm test          # 50 tests
cd admin && npm install && npm run build      # compile le dashboard (servi à /admin)
cd client && npm install && npm run build     # compile l'espace client (servi à /espace-client)
```

- **Base de démonstration** (données fictives, ne touche pas la base locale) :
  `DB_FILENAME=./data/demo.sqlite node scripts/demo-data.js` puis `node scripts/demo-sales.js` (dans `server/`).
  Client de démonstration de l'espace client : `DB_FILENAME=./data/demo.sqlite node scripts/demo-client.js` → Aya Kouamé (diaspora, Lyon), code **SIIPAF-2026-0029**, dossier « apport » à Ahoutoué, 8 versements, une mensualité en retard, 5 points de chantier avec photos, 4 messages. Mot de passe : `DEMO_CLIENT_PASSWORD` dans `server/.env` (créé par le script s'il manque). Le compte SIIPAF-2026-0001 (Kouamé A.) a aussi un accès de test dans la base démo.
- **Aperçus** (fichier `.claude/launch.json`) :
  - `admin-demo` → API + dashboard sur http://localhost:4000/admin (base démo)
  - `client-demo` → même serveur sur le port 4001 : espace client sur http://localhost:4001/espace-client (base démo)
  - `siipaf` → site public sur http://localhost:8765
- Le serveur ne sert `client/dist` que s'il existe **au démarrage** : après le premier `npm run build` de `client/`, redémarrer l'aperçu.
- **Compte admin local** : `admin@siipaf.com`, mot de passe dans `server/.env` (`ADMIN_PASSWORD`). Ne jamais le recopier dans la discussion.
- Après une modification du code serveur, **redémarrer** l'aperçu `admin-demo` (pas de rechargement automatique).
- Les migrations : `npx knex migrate:latest` (local) et `DB_FILENAME=./data/demo.sqlite npx knex migrate:latest` (démo).

---

## 4. Ce qui est fait

### Site public
- Images compressées (58 Mo → 3 Mo), chargement différé, menu mobile refait, responsive corrigé, badges d'offres réparés, filtre rouge retiré.
- Témoignages chargés depuis l'API + formulaire « Laisser un témoignage » (publié après validation). Repli sur les 3 témoignages statiques si l'API est injoignable.
- Adresse de l'API côté site : `http://localhost:4000` en local, sinon `https://api.siipaf.com` (`window.SIIPAF_API` pour surcharger).

### Serveur (API)
- Auth par cookie httpOnly (JWT), 6 rôles : super_admin, commercial, editeur, conducteur_travaux (juridique), comptable, resp_exploitation. Droits dans `src/lib/domain.js`.
- Lots : 6 statuts (disponible, option, réservé, vendu, désistement, non commercialisé), transitions contrôlées, historique. Option = pré-réservation de 7 jours (réglable par projet), expiration automatique.
- **Dossiers d'acquisition** (tables `sales`, `payments`, `sale_documents`) : acquéreur, code client `SIIPAF-AAAA-NNNN` (colonne `leads.client_code`), prix convenu, versements (saisis par le comptable), statut soldé automatique, 6 documents par défaut (contrat de réservation, attestation d'attribution, contrat de vente, ACD, acte notarié, PV de livraison) avec statut et case « visible client ».
- Prospects dédoublonnés par e-mail/téléphone, RDV, messages de contact, newsletter, médiathèque, contenu du site, témoignages modérés.
- Statistiques : `/api/admin/stats` et `/api/admin/stats/timeline` (12 mois, 7 jours, par projet, derniers versements).

### Dashboard admin
- Barre latérale noire, rubrique active rouge, zone logo blanche bord à bord (préférences du client).
- Tableau de bord : KPI pastel avec tendances, courbe lissée des encaissements, anneau par projet, barres groupées 7 jours, barres mises en avant, derniers versements, apparition des cartes au défilement, animations (désactivées si « réduire les animations »).
- Fiche lot en 4 onglets (Aperçu, Paiements, Documents, Historique), pagination 5–100 lignes, tri naturel des numéros.
- Éditeur de plan de masse : image ou PDF (converti par pdf.js), polygones/rectangles, sommets, duplication Ctrl+D, annulation Ctrl+Z, lots à placer.
- Palette des statuts de lots validée daltonisme : disponible `#2E9E5B`, désistement `#0B6BA8`, option `#A16207`, réservé `#6D28D9`, vendu `#9F1239`, non commercialisé gris `#8A8F98`. Séries des graphiques : `#2a78d6`, `#eb6834`, `#1baf7a`, `#eda100`, `#e87ba4`.

---

## 5. Prochaine étape : l'ESPACE CLIENT (phase 2)

Choix déjà validés par le client :
- **Connexion** : code client (`SIIPAF-2026-0001`) **ou numéro de téléphone** (comme l'ancienne plateforme suiviclient-siipaf.com) + mot de passe. Tous les formats sont reconnus (`+225 07…`, `07…`, `00225…`) : on compare les 9 derniers chiffres (`phoneKey` dans `domain.js`). Si plusieurs accès ont le même numéro, la connexion par téléphone est refusée et il faut le code client. Mot de passe oublié : même identifiant. En ligne depuis le 19/10.
- **Contenu** : avancement du chantier (étapes, %, photos et vidéos), documents et dossier juridique (contrat, ACD, actes notariés… avec leur statut), cotisations et paiements (échéancier, versements, reste à payer, retards, reçus), messagerie avec SIIPAF.
- **Paiements** saisis par le comptable dans l'admin (pas de paiement en ligne pour l'instant).
- Interface « très designée, professionnelle », dans **un dossier à part** ; pensée mobile d'abord (clients de la diaspora).

Plan **validé par le client le 19/10/2026**. **Étape 1 (serveur) FAITE** : migration `20261020000000_client_space.js`, règles dans `domain.js` (FINANCING_PLANS, buildSchedule, allocatePayments, SITE_STAGES, droits `client_access:write`, `client_messages`, `site_updates:write`, `schedule:write`), services `schedule.js` / `clients.js`, `auth/client.js` (cookie `siipaf_client`, clé dérivée distincte), routes `client.js` (`/api/client/*`) et `clientAdmin.js`, échéancier dans la fiche lot (`sale.schedule`), routes `POST /sales/:id/schedule/generate` et `PUT /sales/:id/schedule`, `/espace-client` servi depuis `client/dist`. Variable `CLIENT_APP_URL` (à ajouter à `.env.example`). 10 tests dans `test/client.test.js` ; la suite complète compte 42 tests, tous verts.
**Étape 2 (application `client/`) FAITE le 19/10/2026** et vérifiée dans le navigateur (375 px et 1366 px) sur la base démo : connexion, première connexion (changement du mot de passe provisoire → accueil), accueil (photo du bien, anneau d'avancement, déjà versé / reste, alerte de retard ou prochaine échéance, dernier point de chantier, nouveaux messages, accès rapides), chantier (frise des 9 étapes, journal avec galerie et visionneuse plein écran), paiements (échéancier filtrable par statut et groupé par année, versements, reçu imprimable / PDF via le navigateur), documents (statut, étapes, téléchargement), messages (bulles, envoi, rafraîchissement 30 s, lu/non lu), profil (infos, changement de mot de passe, contacts WhatsApp / téléphone / e-mail, déconnexion). Sélecteur de dossier si le client a plusieurs lots. Direction visuelle : papier chaud `#f7f4ef`, encre `#1a1714`, rouge SIIPAF réservé aux actions, or `#a87b12`, titres et montants en Playfair Display, texte en Poppins ; onglets en bas sur mobile, navigation en haut à partir de 900 px ; animations coupées si « réduire les animations ».
**Étape 3 FAITE (19/10)** — `admin/src/components/ClientSpace.jsx` : dans la fiche lot, onglets « Échéancier » (états des échéances, recalcul avec date de départ / nb de mensualités / % d'apport), « Chantier » (points du projet, de l'îlot et du lot ; publier avec photos ou vidéos de la médiathèque, masquer, supprimer), « Messages » et « Accès client » (ouvrir l'accès ; mot de passe provisoire affiché une seule fois, avec boutons Copier et Envoyer par WhatsApp ; suspendre ou réactiver). Rubrique « Messagerie clients » (`admin/src/pages/ClientMessages.jsx`, menu Ventes, pastille des non-lus via `unread_client_messages` de `/api/admin/stats`). Dans la fiche lot, les onglets passent à la ligne au lieu d'être écrasés. Vérifié sur la base démo. **Prochaine étape : 4, l'import CSV des 112 clients.** Pas d'écran « Chantier » sur la page projet : on publie depuis n'importe quel lot avec la portée « Tout le projet ».
À confirmer avec le client : le délai du solde pour le crédit bancaire (2 mois par défaut) ; les fichiers de `/uploads` restent publics si on connaît leur nom (les documents clients passent par `/api/client/documents/:id/fichier`, mais il faudra les déplacer dans un dossier privé).
Une autre discussion, « Optimisation et corrections du site », ajoute les privilèges configurables (`PERMISSION_CATALOG`, `req.can`). Elle modifie `domain.js`, `auth/index.js` et `sales.js`.

Plan détaillé :
1. **Serveur** : tables `client_accounts` (lead_id, mot de passe, changement obligatoire au 1er accès, réinitialisation), `payment_schedule` (échéancier généré selon le financement : apport 30 % + 36 mensualités, Diaspora 36 mensualités, comptant, crédit), `site_updates` (journal de chantier : projet / îlot / lot, étape, %, médias, visible client), `client_messages` (fil client ↔ équipe, non-lus). API `/api/client/*` avec un cookie distinct et un cloisonnement strict sur les dossiers du client. Tests.
2. **Application client** : dossier `client/` (React + Vite), servie à `/espace-client`. Accueil (bien, avancement, situation financière), Chantier (frise d'étapes + galerie), Documents (téléchargement), Paiements (échéancier, reçus imprimables), Messages.
3. **Côté admin** : onglets « Chantier », « Messages », « Accès client » et « Échéancier » dans la fiche lot ; rubrique « Messagerie clients ».
4. **Import CSV** des 112 clients existants dès réception du fichier.

---

## 5 bis. Privilèges configurables (fait le 20/10, session « Optimisation et corrections du site »)

- Tables `role_permissions` et `user_permissions` (migration `20261020010000_permissions.js`), service `server/src/services/permissions.js`, routes `server/src/routes/permissions.js`, catalogue `PERMISSION_CATALOG` dans `domain.js` (droits de l'espace client inclus).
- `requireAuth` calcule `req.user.permissions` (rôle en base + privilèges du compte) et expose `req.can(perm)` : **toujours utiliser `requirePermission()` ou `req.can()`**, jamais `can(req.user.role, …)`.
- Seul le super administrateur modifie les privilèges et crée/modifie un super administrateur. 32 tests serveur verts.
- Admin : page « Rôles & privilèges » (`admin/src/pages/Roles.jsx`, grille rôle × privilège, bouton « Défaut ») et section « Privilèges propres à ce compte » dans la fiche utilisateur (`Users.jsx`). Compilé, **pas encore vérifié visuellement dans le navigateur**.
- Une autre session (« Passation ») construit l'espace client en parallèle : migration `client_space`, `services/schedule.js`, `routes/client*.js`.

## 5 ter. Rôles personnalisés (fait le 20/10, non commité, non mis en ligne)

- **Migration `20261020020000_roles.js`** (à passer en production après les autres, `npm run migrate`) : table `roles` (`id` = clé, `label`, `description`, `system`, `sort`) remplie avec les 6 rôles d'origine (`system = true`, non supprimables) ; `users.role` devient une simple chaîne (MySQL : `MODIFY role VARCHAR(40)` ; SQLite : table `users` reconstruite clés étrangères suspendues, d'où `config.transaction = false`). Vérifiée sur SQLite avec données (privilèges individuels et médias conservés, retour arrière OK). Bases locale et démo déjà migrées (sauvegardes avant migration dans le dossier temporaire de la session, non conservées dans le dépôt).
- **Serveur** : `services/roles.js` (créer, renommer, supprimer — refus si un compte, même désactivé, a encore le rôle), `roleKey()` dans `domain.js` (clé tirée du libellé, suffixe `_2` si déjà prise). Routes (super admin seulement) : `POST /api/admin/permissions/roles`, `PATCH|DELETE /api/admin/permissions/roles/:role`. `GET /admin/permissions` renvoie aussi `system`, `description`, `users_total`. `GET /admin/users/roles` lit la table ; création/modification d'un compte vérifie que le rôle existe. `ROLES`/`ROLE_LABELS`/`PERMISSIONS` du code ne servent plus que de rôles d'origine et de réglage « Défaut » : **ne jamais valider un rôle avec `ROLES`**. Super admin : toujours tous les droits, non renommable ; les autres rôles d'origine sont renommables. Un rôle créé n'a pas de bouton « Défaut ». La liste d'assignation des prospects (`/users/commerciaux`) inclut les rôles créés qui ont « Gérer les prospects ». `req.user.role_label` (et la réponse de connexion) donnent le libellé du rôle.
- **Admin** : `Roles.jsx` — bouton « Nouveau rôle » (nom, description, droits cochés, « Partir des droits de… »), crayon pour renommer, corbeille pour supprimer (rôles créés seulement). `Users.jsx` — sélecteur alimenté par `/admin/users/roles` (rôles créés regroupés à part). En-tête et « Mon compte » affichent `role_label`.
- Tests : `server/test/roles.test.js` (8 tests) ; **50 tests serveur, tous verts**. Admin compilé ; vérifié dans le navigateur sur une copie de la base démo (création d'un rôle, compte affecté, suppression refusée, renommage) ; la grille « Rôles & privilèges » s'affiche correctement.

## 5 quater. Lot du 20/10 (committé sur `plateforme-admin-espace-client`, **pas encore mis en ligne**)

- **Admin** : menu Ventes › **Clients** (`pages/Clients.jsx`, route `GET /api/admin/clients`) ; **import CSV / Excel** des prospects et des clients (`components/ImportModal.jsx`, lecture SheetJS dans le navigateur, `POST /api/admin/import` avec essai à blanc ; en mode clients : code client repris, lots créés au besoin, dossier ouvert, versement « Reprise ancienne plateforme ») ; **suppression d'un prospect** (droit `leads:delete`, refusée s'il a un dossier ou une option) ; **vidéos** dans le suivi de chantier (200 Mo max) ; champ **« Type de projet »** dans la fiche projet (`PROJECT_CATEGORIES`, dont `lotissement`).
- **Conversion d'un plan AutoCAD (DWG/DXF) en carte interactive** : fiche projet › Ajouter un plan › « Convertir un plan AutoCAD ». Le fichier est lu **sur le serveur** (`services/cad.js`, LibreDWG WebAssembly, `POST /api/admin/cad/parse`) ; la détection des parcelles se fait dans l'admin (`admin/src/lib/cadPlan.js`). Sur le DWG d'Ahoutoué : 165 lots numérotés sur 169 (21, 130, 138 restent « à placer ») + 203 parcelles sans numéro proposées en option.
- **Espace client** : échéancier paginé (10 par page) avec fiche détaillée de chaque échéance (versements imputés).
- **Site public** : sous-menu « Projets » (Promotions immobilières / Lotissements) sur les 5 pages ; nouvelles pages `lotissements.html` (projets de type lotissement + autres projets ayant un plan publié) et `plan-interactif.html?projet=<slug>` (zoom, déplacement, recherche d'un lot, filtres par statut, fiche lot, pré-réservation 7 jours, demande de rappel, `&lot=` pour ouvrir un lot) ; bouton « Plan interactif » ajouté dans `projets.html` quand le projet a un plan publié (`has_plan` dans `/api/public/projects`). Fichiers : `css/plans.css`, `js/lotissements.js`, `js/plan-interactif.js`, `js/projets.js`. Vérifié sur la base démo (Bingerville passé en lotissement avec un plan publié, **base démo seulement**).
- **Sauvegarde nocturne** : `server/scripts/backup.js` (base + `uploads` dans `~/sauvegardes`, 14 jours pour la base, 7 archives de fichiers). **La tâche cron n'est pas encore créée sur cPanel** :
  `30 2 * * * /home/c2777901c/nodevenv/siipaf-api/server/22/bin/node /home/c2777901c/siipaf-api/server/scripts/backup.js >> /home/c2777901c/sauvegardes/backup.log 2>&1`
- Tests : **64 tests serveur, tous verts**.

### Mise en ligne de ce lot (à faire, avec l'accord du client et cPanel ouvert dans Chrome)
1. `npm run build` dans `admin/` et `client/`, refaire `deploy/siipaf-api.zip` puis la commande de mise à jour du serveur (section 6) — `npm install --omit=dev` est **obligatoire** cette fois (nouvelle dépendance `@mlightcad/libredwg-web`).
2. Sauvegarder le site, puis `deploy/site-update.zip` : les 5 pages, `lotissements.html`, `plan-interactif.html`, `css/plans.css`, `css/pages.css`, `js/lotissements.js`, `js/plan-interactif.js`, `js/projets.js`, `js/site-content.js`, `js/testimonials.js`.
3. Créer la tâche cron de sauvegarde.
4. En production : passer Ahoutoué en « Lotissement » si c'est voulu, convertir le DWG d'Ahoutoué et publier le plan.

## 6. En attente / points ouverts

- [ ] **Contenu du site non branché** (remarque du client, capture « Contenu du site ») : les onglets Diaporama / Bandeau / Chiffres clés / Coordonnées s'enregistrent en base, mais le site public ne lit pas `/api/public/content` (tout est en dur dans le HTML). À faire : un `js/site-content.js` qui applique diaporama (image d'origine si pas de média), bandeau, chiffres et coordonnées sur toutes les pages, et une migration qui remplit le diaporama avec les 5 diapositives actuelles du site (aujourd'hui 1 seule en base).
- [x] Page « Rôles & privilèges » vérifiée dans le navigateur (20/10, avec les rôles personnalisés). Reste à regarder la section « Privilèges propres à ce compte » d'un utilisateur.
- [x] Rôles personnalisés en ligne (19/10, migration `20261020020000_roles.js` passée sur cPanel).

- [x] (fait le 20/10) **E-mail du site** : remplacer `info@siipaf.ci` par `info@siipaf.com` dans les pages HTML (le client a dit oui ; la commande a été interrompue avant exécution — redemander confirmation puis l'appliquer).
- [x] **Git** : commits sur la branche `plateforme-admin-espace-client` (non poussée : un push déclenche Vercel). Demander avant de pousser.
- [x] (convertisseur fait le 20/10, reste à l'utiliser en production) **Plan de masse d'Ahoutoué reçu le 19/10 : `PLAN DE MASSE AHOUTOUE.dwg`** (à la racine du projet ; à exclure de Git et de Vercel). Prochain chantier possible : le convertir en DXF pour importer les parcelles dans l'éditeur de plan. Contexte précédent : : le client a fourni le périmètre (PDF + DWG AutoCAD 2018, coordonnées UTM ~zone 30N, X≈409 000, Y≈604 000). Il faut le plan des parcelles exporté en DXF pour l'import automatique.
- [x] **Étape 4 de la phase 1** : carte interactive publique (`plan-interactif.html`, 20/10, non mise en ligne).
- [ ] **Étape 5 de la phase 1** : RDV assistés par IA (chat site + WhatsApp + rappels + Google Agenda) — nécessite une clé API Anthropic, un compte WhatsApp Business API, des comptes Google.
- [x] **Serveur en ligne (19/10)** — **dashboard : https://admin.siipaf.com**, **espace client : https://client.siipaf.com** (choix du client, chacun à la racine). Les deux sous-domaines pointent sur le même dossier `public_html/client.siipaf.com`, donc sur la même application Node ; le serveur choisit l'interface selon l'adresse (`ADMIN_HOST=admin.siipaf.com` dans `.env`). Les anciennes adresses `/admin` et `/espace-client` redirigent. En local : admin sur http://admin.localhost:4000, espace client sur http://localhost:4000. cPanel `web40.lws-hosting.com:2083`, compte `c2777901c` : application Node.js 22.22.3 (mode Production, racine `~/siipaf-api/server`, démarrage `app.js`) ; base `c2777901c_siipaf`, utilisateur `c2777901c_siipaf_user` ; 6 migrations passées (jusqu'à `20261020020000_roles`), données de départ et compte `admin@siipaf.com` installés (mot de passe choisi par le client).
  - Secrets dans `~/siipaf-api/server/.env` (droits 600, jamais affichés) : JWT_SECRET et DB_PASSWORD ont été **générés sur le serveur** (`openssl` + `uapi Mysql set_password`), ADMIN_PASSWORD a été saisi par le client. Pour changer un mot de passe MySQL, refaire la même chose, sans saisie à la main : le collage par Ctrl+V dans le terminal cPanel envoie un caractère invisible.
  - **Mettre à jour le serveur** : relancer `deploy/siipaf-api.zip` (serveur sans node_modules/data/.env/uploads/test + `admin/dist` + `client/dist`), l'envoyer dans `/home/c2777901c` avec « Écraser » coché, puis dans le terminal : `cd ~ && unzip -oq siipaf-api.zip && source /home/c2777901c/nodevenv/siipaf-api/server/22/bin/activate && cd ~/siipaf-api/server && npm install --omit=dev && npx knex migrate:latest && cloudlinux-selector restart --json --interpreter nodejs --app-root siipaf-api/server`. Ne jamais faire `npm ci` (il casse le lien node_modules de CloudLinux).
- [ ] **Audit du 19/10 : voir `AUDIT.md`.** P1 fait : lots (création / modification / suppression à l'unité), modification du dossier d'acquisition, documents juridiques protégés, contenu du site branché sur le site public (`js/site-content.js`, migration `20261021000000`). Menu : Lots déplacé dans Catalogue. Rôles : tableau compact, tous les rôles se suppriment sauf super administrateur (`PROTECTED_ROLES`) s'ils n'ont plus de compte. P2 fait le 20/10 (sauf suppression d'un projet) ; reste P3, plus deux règles à faire valider par SIIPAF (passage à « Vendu », frais et pénalités).
- [ ] **E-mails** : SMTP_USER et SMTP_PASSWORD sont vides dans le `.env` du serveur, donc aucun e-mail ne part (mot de passe provisoire, mot de passe oublié, notifications). Il faut une boîte (les 5 comptes de messagerie cPanel sont déjà pris) et que le client saisisse son mot de passe.
- [x] **Site public mis à jour le 20/10** (accord du client) : les 5 pages, `js/site-content.js`, `js/testimonials.js` et `css/pages.css` sont en ligne dans `public_html/siipaf.com`. Sauvegarde de l'ancienne version : `~/sauvegarde-site-avant-20261020.tgz`. Le site lit maintenant « Contenu du site » et les témoignages ; l'adresse e-mail est passée à info@siipaf.com partout. Pour une prochaine mise à jour : refaire `deploy/site-update.zip` et le décompresser dans `public_html/siipaf.com`.
- [x] **`.vercelignore`** exclut aussi `client/` et `deploy/`.

### Sécurité (signalé au client, à suivre)
- `public_html/siipaf.com/SIIPAF_WEB.zip` (142 Mo) est **téléchargeable publiquement** et contient sans doute le dossier `.git`. Le supprimer depuis le gestionnaire de fichiers cPanel (la suppression par l'assistant a été bloquée).
- Le dépôt Git local contient un **jeton GitHub en clair** dans l'URL du remote : le révoquer sur GitHub et faire `git remote set-url origin https://github.com/nouahenri/Siipaf.git`.
- Hébergement : le site public est servi depuis `public_html/siipaf.com` (cache Varnish LWS).

---

## 7. Préférences de travail du client

- Échanges en **français**, explications claires et non techniques.
- Il aime voir le résultat : vérifier visuellement dans le navigateur avant d'annoncer qu'une chose est faite.
- Il envoie souvent des captures annotées et des inspirations (Pinterest, maquettes) : s'en inspirer sans copier.
- Ne pas committer, pousser ou mettre en ligne sans son accord explicite.
