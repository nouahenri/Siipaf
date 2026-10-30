# Audit des privilèges — dashboard admin et ERP (29/10/2026)

Demande du client du 29/10 : « les privilèges doivent être encore plus détaillés car ambigus et vagues » ; un commercial ne voit et ne traite que ses prospects, clients et rendez-vous ; il voit les projets sans les créer ni les modifier ; un prospect ou un client ne change de commercial qu'avec la validation de la hiérarchie ; « les utilisateurs doivent être aussi revus dans le détail des actions dans tout le projet admin et ERP ».

**Choix du client (29/10)** : prospects non attribués visibles des responsables seulement ; transfert = demande motivée du commercial puis validation du responsable ; versement saisi par un commercial « en attente de confirmation » (ne compte nulle part avant la confirmation de la Comptabilité).

**Règles retenues**
- `leads:all` = **portée « toute l'équipe »** (responsables et services support). Sans elle, un compte ne voit et ne traite que les prospects, clients, rendez-vous, dossiers, versements et messages **qui lui sont attribués** (`services/commercial.js` : `scopeLeads`, `leadInScope`, `saleInScope`).
- `leads:assign` (nouveau) = attribuer, transférer, valider les demandes de transfert.
- Migration `20261129000000_cloisonnement_commercial.js` : les rôles qui consultent des clients sans portefeuille (sans `leads:write`) reçoivent `leads:all` pour garder ce qu'ils voyaient ; `leads:assign` au responsable des exploitations et aux rôles qui avaient `leads:all` + `leads:write`.
- Principe général appliqué partout : **pas d'auto-validation** (on ne valide, n'approuve, ne corrige ni n'ajuste ce qui nous concerne soi-même).

Légende : ☐ à faire · ☑ fait

## Privilèges détaillés (cases à cocher par action)

Précision du client (29/10) : « Gérer les prospects » doit devenir des cases « créer », « modifier », « faire avancer »… Mécanisme : `PERMISSION_SPLITS` (lib/domain.js), 4ᵉ colonne `parent` du catalogue (intitulé commun), migration `20261129200000_privileges_detailles.js` (un rôle qui avait l'ancien privilège reçoit toutes ses actions), grilles Rôles & privilèges, privilèges d'un compte et Accès des modules ERP (ligne d'intitulé « tout cocher », état partiel).

- ☑ **Ventes** : Gérer ses prospects (créer, modifier, faire avancer, activités, importer, demander un transfert) ; Gérer les rendez-vous (planifier, confirmer/déplacer, annuler) ; Statut des lots (option, réserver/vendre, désistement).
- ☑ **Dossiers** : ouvrir, modifier, créer/importer des clients ; Versements (déclarer, enregistrer et confirmer, supprimer) ; Documents juridiques (faire avancer, joindre, rendre visible au client).
- ☑ **Clients et espace client** : fiches clients (voir, créer sans dossier, modifier la fiche, importer, exporter) ; accès (ouvrir, désactiver) ; messagerie (lire et répondre, écrire à plusieurs clients) ; avancement et échéanciers. Migration `20261129300000_privileges_clients.js`.
- ☑ **Catalogue** : projets (créer, modifier la fiche, publier/archiver, grille de prix, supprimer) ; plans de masse et lots (dessiner et importer, créer et modifier les lots, supprimer un lot).
- ☑ **Site web** : contenu (accueil, textes éditoriaux, images des emplacements, coordonnées) ; médiathèque (ajouter, supprimer) ; newsletter (abonnés, campagnes, envoi).
- ☑ **Administration** : comptes (créer, modifier, changer le rôle, mot de passe, désactiver) avec garde contre l'élévation (`notAbove`) ; `circuit:write` (circuit d'information). Migration `20261129400000_privileges_site_comptes.js`.
- ☐ ERP : Service commercial, Achats, Comptabilité, Paie, RH, Administration générale, Juridique, Chantiers, SAV — **découpage action par action** à faire (voir « Réaudit du 30/10 » plus bas). Déjà créés le 30/10 : `sav:all`, `achats:validate`, `rh:documents`, `contacts:handle` (migration `20261130700000_privileges_audit.js`).

## A. Dashboard admin (prospects, clients, ventes, lots, comptes)
- ☑ crm.js — prospects : non attribués réservés à la portée équipe ; fiche, modification, suppression dans le périmètre ; changer de commercial = `leads:assign` (sinon demande de transfert) ; création d'un doublon suivi par un collègue → 409 sans divulguer la fiche.
- ☑ crm.js — rendez-vous : liste, création, modification limités aux prospects du commercial ; pas de RDV confié à un collègue.
- ☑ crm.js — `/stats`, `/stats/timeline` : chiffres et derniers versements limités au périmètre.
- ☑ clientAdmin.js:21 GET /clients — filtrer par périmètre.
- ☑ clientAdmin.js:172 GET /client-messages, :184/:195 GET/POST /leads/:id/messages — périmètre.
- ☑ clientAdmin.js:79/84/90 accès espace client — périmètre.
- ☑ sales.js:263 GET /lots/:id/detail — dossier seulement dans le périmètre ; masquer téléphone/e-mail/nom du prospect sans `sales:read`.
- ☑ sales.js:289-442 écritures sur dossiers, échéanciers, versements, documents — `saleInScope` ; ouverture d'un dossier avec un `lead_id` hors périmètre refusée.
- ☑ catalog.js:451 GET /lots/:id/history — masquer `lead_name` sans `sales:read`.
- ☑ catalog.js:421/432 statut et option d'un lot avec `lead_id` — `leadInScope`.
- ☑ portfolio.js GET /leads/:id/portefeuille — périmètre ; POST /leads/assign → `leads:assign`.
- ☑ users.js:17 GET /roles — exiger un droit (/commerciaux reste ouvert : liste de noms utilisée par les sélecteurs).
- ☑ users.js:57/128 création/modification de compte : rôle cible limité aux privilèges du demandeur (`checkGrant`), pas de changement de mot de passe/e-mail d'un compte plus privilégié.
- ☑ imports.js:29 import de clients : versements → `payments:write`, création de lots → `plans:write`.
- ☑ sales.js:318 PATCH /sales/:id : `signed_at` → `juridique:write` ; champs qui régénèrent l'échéancier → `schedule:write`.
- ☑ Libellés : `lots:status` (désistement), `sales:write`, `payments:write` (suppression), `plans:write` (prix), `projects:write` (suppression), newsletter — tous découpés en actions.
- ☑ Front admin : Layout `/parametres` → `projects:read` ; date de signature masquée sans `juridique:write` ; bouton Importer clients aligné.

## B. ERP — Commercial, Chantiers, Compta, Paie, Juridique
- ☑ services/commercial.js `dashboard` : `team`, `series`, `late_fund_calls` limités au périmètre.
- ☑ erp/commercial.js:376 GET /vefa/calls — `scopeLeads` ; sans `sales:read` masquer client et payé.
- ☑ services/chantiers.js:427 `laborRows` — taux horaire et montant par personne réservés à `paie:read`.
- ☑ Front Payroll.jsx:111/112/252/268/300 — `paie:validate`, `paie:pay`, `paie:settings`.
- ☑ erp/commercial.js:201 GET /property — acquéreur, prix, payé seulement avec `sales:read` et dans le périmètre.
- ☑ compta : écritures de paie nominatives visibles avec `compta:read` — masquer libellés salariés sans `paie:read`.
- ☑ erp/commercial.js:276/288 PATCH /lots — prix, surface et îlot exigent aussi `plans:lots` (30/10).
- ☑ compta.js:316-360 — nouveau `achats:validate` (validation des factures d'achat et des dépenses du Parc) ; pas de séparation créateur / valideur imposée (choix du client du 30/10) (30/10).
- ☑ chantiers.js:169 TMA, juridique.js:113 actes — périmètre si l'accès ne vient que de `sales:read` (30/10).
- ☑ chantiers.js:428 PATCH livraisons — périmètre, réponse filtrée.
- ☑ paie.js:79 PATCH /employees — `user_id` exige `users:edit`, la garde `notAbove`, ni son propre compte ni un super administrateur ; solde de congés repris (POST) → `conges:manage` ; `PUT /users/:id/employee` avec `notAbove` (30/10).
- ☑ chantiers.js:410 réception d'un marché (libère la retenue) — le Juridique est prévenu (`chantier.marche_receptionne`).
- ☑ juridique.js:229/269 litiges visant un collègue — exclus de la vue « service » et de l'intéressé ; le juriste en charge et le Juridique les voient (30/10).
- ☑ chantiers.js:102/124/129 `/refs`, `/programmes/:id` — complets pour `chantiers:read|write|direction`, `direction:read` et les conducteurs, objet minimal pour les autres ; `/lieux` reste ouvert (30/10).
- ☑ juridique.js:129 GET /courrier — Juridique, `courrier:read|write|assign` ou membre du service juridique (30/10).
- ☑ erp/commercial.js:139/184 activités : pas d'activité confiée à un collègue sans `leads:assign`.

## C. ERP — RH, présences, frais, recrutement, demandes, SAV
- ☑ services/rh.js:238 décision de congé en mode « RH seulement » : responsable direct ne peut pas approuver définitivement.
- ☑ erp/rh.js:307/313 ajustement de son propre solde — interdit.
- ☑ erp/rh.js:280 modification de sa propre fiche ; se nommer responsable — interdit ; `leave_opening_days` → `conges:manage`.
- ☑ presences.js:96-104 ses propres pointages — interdit.
- ☑ recrutement.js:101 embauche avec salaire — `paie:employees` ; champ masqué au front.
- ☑ positions.js:176, recrutement.js:32 — salaires masqués sans `paie:read`.
- ☑ erp/rh.js:227 POST /leaves `approve:true` — `conges:approve`.
- ☑ frais.js:80-84 — modifier/soumettre la note d'un autre interdit ; pas d'approbation de sa propre note.
- ☑ requests.js:37 — pas de validation DG de sa propre demande.
- ☑ requests.js:126-150 — facture d'achat créée seulement avec `achats:write` ; pas de traitement de sa propre demande.
- ☑ sav.js:51/159/251 — nouveau `sav:all` « Portée : tout le SAV » ; sans lui, tickets, réserves, interventions, clients, photos et statistiques limités aux clients du compte et à ce qui lui est confié (réclamation attribuée, technicien) (30/10).
- ☐ presences.js:55-75 — conducteur : employés de ses chantiers seulement.
- ☑ presences.js:44 borne : limite par compte et adresse, verrou de 5 échecs en 15 minutes par matricule, vérification factice si le matricule est inconnu (30/10).
- ☐ Libellés : `demandes:dg` (circuit) ☑, `kpi:write` ☑, `sav:reserves` ☑, `self:conges` (renommer « Mon espace RH : congés, justificatifs, auto-évaluation ») ☐.
- ☑ Lectures ouvertes : `/rh/meta` (réglages réservés à `rh:read` / `rh:settings`, règles utiles à Mon espace conservées), chefs de service sans `user_id`, organigramme sans matricule hors `rh:read`, `/onboarding` (30/10).
- ☑ sav.js:304 POST /files — plus de `lead_id` libre (client du périmètre seulement ; rattachement par la pièce jointe) (30/10).
- ☑ Front : EmployeeFile.jsx:210/222 (`conges:manage`), :52 (`formation:write`), Positions.jsx:140, TicketDrawer.jsx:81, NewTicket.jsx:95 (`sav:assign`), Reserves.jsx:59 (`sav:create`), Expenses.jsx:99 (`can_approve`).
- ☑ Front (30/10) : Messages (dashboard) — boutons « Archiver » / « Marquer traité » selon `contacts:handle` ; Purchases.jsx et ParcCompta.jsx — « Valider », « Rejeter » selon `achats:validate` ; EmployeeFile.jsx — pièces du dossier selon `rh:documents` ; EmployeeForm.jsx — compte relié selon `users:edit` ; Parc.jsx — pas de décision sur sa propre demande de véhicule.

## Réaudit du 30/10 (failles nouvelles et nouveaux droits)

Décisions du client (30/10) : **pas de séparation préparateur / valideur** (ni pour la paie, ni pour les écritures, ni pour les factures d'achat : le nouveau droit `achats:validate` suffit) ; `rh:documents` accordé **au service RH seulement** (qui règle les RH, `rh:settings`), pas à tous les titulaires de `rh:read`. Défauts retenus sans question : le chef de service n'est pas obligé d'être membre du service ; l'organigramme montre le nom, le poste et le service mais plus le matricule hors `rh:read`.

Nouveaux droits (catalogue `PERMISSION_CATALOG`, droits par défaut des rôles, migration `20261130700000_privileges_audit.js` pour les rôles et comptes existants) :
- `sav:all` « Portée : tout le SAV » — qui crée, traite, attribue, gère les réserves ou les interventions ; rôles qui ne font que consulter le SAV sans gérer de prospects ; **pas le commercial**.
- `contacts:handle` « Traiter les messages de contact » — qui avait `contacts:read`.
- `achats:validate` « Valider les factures d'achat et les dépenses du Parc » — qui avait `achats:write` ; comptable par défaut.
- `rh:documents` « Voir les pièces du dossier du personnel » — qui règle les RH (`rh:settings`).

- ☑ B1 `sav:all` (voir plus haut).
- ☑ B2 messages de contact cloisonnés (sans `leads:all` : seulement les messages liés à ses fiches) ; marquer traité / archiver = `contacts:handle`.
- ☑ B3 corps JSON limité à 2 Mo avant l'authentification ; l'import Sage lit jusqu'à 25 Mo dans son propre routeur, après l'authentification et le contrôle du droit ; limite de 600 requêtes par minute et par compte sur `/api/admin`.
- ☑ B4 une saisie (nouveau prospect, option sur un lot) ne capture pas une fiche existante sans commercial : 409 « Cette personne est déjà suivie : demandez son attribution au responsable » sans divulguer la fiche ; `plannedFor` n'attribue pas une fiche qui a un code client.
- ☑ B5 demande de reprise d'un non-propriétaire hors portée : réponse `{ id, status }`, titulaire prévenu sans le motif, 5 demandes en attente au plus par demandeur.
- ☑ B6 `create_accounts` / `create_journals` de l'import Sage exigent `compta:settings`.
- ☑ B7 = point 3 (TMA, actes). ☑ B8 = point 4 (compte relié à une fiche). B9 = point 2 (sans séparation, voir décision).
- ☑ B10 pièces du dossier du personnel : `rh:documents` ; l'employé garde l'accès à ses propres pièces.
- ☑ B11 = borne de pointage.
- ☑ B12 `POST /appointments` : le statut est ignoré sans `appointments:edit` ; programme et lot vérifiés.
- ☑ B13 `GET /leads` et `/leads.csv` : les clients seulement avec `clients:read` / `clients:export`.
- ☑ B14 le gestionnaire du parc ne décide pas sa propre demande de véhicule (sauf super administrateur).
- ☐ B15 import : `leads:assign` au lieu de `seesAllLeads` ; ne pas modifier la fiche d'un collègue à l'import.
- ☑ B16 `evaluation:write` ne fixe pas ses propres objectifs ni ne finalise son propre entretien (sauf super administrateur).
- ☑ B17 `assigned_to` vérifié (commercial actif, `cm.assertSeller`) partout où il est saisi : prospects, activités, rendez-vous, attribution en lot, transfert, liste d'import.
- B18 abandonné (décision du client). ☐ B19 `isLegal` inclut `direction:read` (information). ☐ B20 `hasManager()` à mettre en cache (information).
- ☑ Points 1, 2, 3, 4, 6, 7, 8, 9, 11, 13b, 13c, 14 : voir les cases ci-dessus. ☐ Point 10 (pointages des chantiers d'un conducteur).

**Reste à faire — découpage action par action** (migration « expand / collapse » sur le modèle de `20261129400000`, rôles ET comptes) : ☐ Commercial (`leads:assign` + `leads:transfer_decide`, `property:*`, `vefa:*`), ☐ Achats (`appro:*`), ☐ Compta (`suppliers:write`, `compta:sync/import/assets`, `compta:reverse`, `compta:years/lock/opening`, `compta:plan`, `frais:reimburse`), ☐ Paie (`paie:salary`, `paie:inputs`), ☐ RH (`rh:documents_write/career/pin`, `conges:enter/adjust/cancel`, `presence:*`, `recrutement:*`, `formation:*`, `evaluation:*`, `kpi:*`, `rh:rules/positions/heads/holidays`), ☐ Administration (`contrats:close/documents`, `parc:maintenance/costs/reservations`, `demandes:view_all/invoice`), ☐ Juridique (`juridique:deeds/litigation/guarantees/settings`), ☐ Chantiers (`chantiers:create/plan/budget/settings/tma`, `chantiers:stages/situations`), ☐ SAV (`sav:edit/status/comment`, `sav:delivery`), ☐ Dashboard (`settings:refs/general`, `schedule:generate/edit`).

### Compromis assumés (revue de sécurité du 30/10)
- **Verrou de la borne de pointage** : les 5 échecs en 15 minutes par matricule sont comptés en mémoire du processus ; une relance de l'application ou plusieurs processus le remettent à zéro ou le répartissent. Il peut aussi bloquer un matricule à la demande (déni de service) : seul un compte autorisé à pointer atteint la borne, et la limite par compte et adresse ne compte que les échecs.
- **Création d'une fiche par `paie:employees`** : à l'embauche, la Comptabilité peut relier le compte de la nouvelle personne sans `users:edit` ni la garde `notAbove` (cela ne reprend la fiche de personne). Changer le compte d'une fiche existante (relier, détacher, `PUT /users/:id/employee`) exige `users:edit`, la garde contre l'élévation, et jamais son propre compte ni un super administrateur.
- **`rh:files` sans `rh:documents`** : peut joindre et supprimer des pièces du dossier sans les voir ni les télécharger.
- **`sav:all` donné par la migration** à tout rôle personnalisé qui avait `sav:create`, `sav:handle`, `sav:assign`, `sav:reserves` ou `sav:interventions` (et aux rôles qui ne font que consulter le SAV sans gérer de prospects) : le périmètre de ces rôles ne rétrécit pas ; c'est à l'administrateur de le retirer rôle par rôle. La portée du SAV (`sav:all`) est indépendante de celle des prospects (`leads:all`) : liste des dossiers, détail et dépôt de photos suivent la même règle.
- **Messages de contact** : sans `leads:all`, on voit les messages de ses fiches et la boîte commune (messages sans fiche ou dont la fiche n'est pas attribuée), jamais ceux d'une fiche attribuée à un collègue.
