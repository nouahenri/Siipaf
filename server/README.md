# API SIIPAF

Serveur Node.js (Express) du dashboard admin, du plan de masse interactif, des prospects,
rendez-vous, messages de contact et de la newsletter. Base de données MySQL en production
(cPanel LWS), SQLite en local et dans les tests : le même code tourne sur les deux.

## En local

```bash
cd server
npm install
cp .env.example .env      # puis renseigner JWT_SECRET et ADMIN_PASSWORD
npm run setup             # crée la base (data/siipaf.sqlite) et les données de départ
npm run dev               # http://localhost:4000/api/health
npm test                  # tests des règles métier
```

## Dashboard admin (dossier `admin/`)

Application React servie par ce serveur à l'adresse `/admin`.

```bash
cd admin
npm install
npm run dev      # http://localhost:5173/admin (l'API doit tourner sur le port 4000)
npm run build    # produit admin/dist, servi par le serveur à /admin
```

Pour essayer avec des données fictives sans toucher à la vraie base :

```bash
cd server
DB_FILENAME=./data/demo.sqlite node scripts/demo-data.js
DB_FILENAME=./data/demo.sqlite node app.js    # puis http://localhost:4000/admin
```

## Déploiement sur cPanel LWS

1. **Base MySQL** — cPanel › *Bases de données MySQL* : créer une base et un utilisateur, lui donner tous les droits sur la base.
2. **Fichiers** — compiler le dashboard (`cd admin && npm run build`), puis envoyer `server/` et `admin/dist/` hors de `public_html` (ex. `/home/<compte>/siipaf-api/server` et `/home/<compte>/siipaf-api/admin/dist`), sans `node_modules`, `data` ni `.env`.
3. **Application Node** — cPanel › *Setup Node.js App* › *Create application* :
   - Node.js : la version la plus récente proposée (18 minimum) ;
   - Application mode : `Production` ;
   - Application root : `siipaf-api/server` ;
   - Application URL : le sous-domaine de l'API (ex. `api.siipaf.com`) ;
   - Application startup file : `app.js`.
4. **Variables d'environnement** — dans la même page, ajouter celles de `.env.example` avec `NODE_ENV=production`, `DB_CLIENT=mysql`, les accès MySQL, un `JWT_SECRET` de 64 caractères, `CORS_ORIGINS=https://siipaf.com,https://www.siipaf.com` et les accès SMTP.
5. **Installation** — cliquer *Run NPM Install*, puis dans le terminal cPanel (commande « source » affichée en haut de la page de l'application) : `npm run setup`.
6. **Redémarrer** l'application, puis vérifier `https://api.siipaf.com/api/health` et le dashboard sur `https://api.siipaf.com/admin`.

## Organisation

| Dossier | Rôle |
| --- | --- |
| `src/lib/domain.js` | Règles métier : statuts des lots et transitions, étapes du circuit de vente, rôles et droits |
| `src/services/lots.js` | Options (pré-réservations), expiration automatique, changements de statut, dédoublonnage des prospects |
| `src/routes/public.js` | API du site public (`/api/public`) |
| `src/routes/*.js` | API du dashboard (`/api/admin`, connexion requise) |
| `migrations/` | Schéma de la base |
| `seeds/` | Données de départ reprises du site actuel |

## Règles métier

- Statuts d'un lot : disponible, option, réservé, vendu, désistement, non commercialisé.
- Transitions autorisées : voir `LOT_TRANSITIONS` ; vendu → désistement est réservé au super administrateur. Chaque changement est historisé.
- Une option dure la durée du projet (`option_days`, 7 jours par défaut), une seule option active par lot et par prospect ; à expiration le lot reprend son statut précédent.
- Un prospect est retrouvé par e-mail ou téléphone pour éviter les doublons.
