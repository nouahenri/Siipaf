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
- ☑ **Espace client** : accès (ouvrir, désactiver) ; messagerie (lire et répondre, écrire à plusieurs clients).
- ☐ Catalogue (projets : créer, modifier, grilles de prix, supprimer ; plans), Site web (médiathèque, newsletter), Administration (comptes : créer, modifier, mot de passe, désactiver).
- ☐ ERP : Service commercial, Achats, Comptabilité (dont `achats:validate`), Paie, RH, Administration générale, Juridique, Chantiers, SAV (dont `sav:all`).

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
- ☐ users.js:17/36 GET /roles, /commerciaux — exiger un droit.
- ☐ users.js:57/128 création/modification de compte : rôle cible limité aux privilèges du demandeur (`checkGrant`), pas de changement de mot de passe/e-mail d'un compte plus privilégié.
- ☑ imports.js:29 import de clients : versements → `payments:write`, création de lots → `plans:write`.
- ☑ sales.js:318 PATCH /sales/:id : `signed_at` → `juridique:write` ; champs qui régénèrent l'échéancier → `schedule:write`.
- ☐ Libellés : `lots:status` (désistement), `sales:write`, `payments:write` (suppression), `plans:write` (prix), `projects:write` (suppression), newsletter.
- ☑ Front admin : Layout `/parametres` → `projects:read` ; date de signature masquée sans `juridique:write` ; bouton Importer clients aligné.

## B. ERP — Commercial, Chantiers, Compta, Paie, Juridique
- ☑ services/commercial.js `dashboard` : `team`, `series`, `late_fund_calls` limités au périmètre.
- ☑ erp/commercial.js:376 GET /vefa/calls — `scopeLeads` ; sans `sales:read` masquer client et payé.
- ☐ services/chantiers.js:427 `laborRows` — taux horaire et montant par personne réservés à `paie:read`.
- ☐ Front Payroll.jsx:111/112/252/268/300 — `paie:validate`, `paie:pay`, `paie:settings`.
- ☑ erp/commercial.js:201 GET /property — acquéreur, prix, payé seulement avec `sales:read` et dans le périmètre.
- ☐ compta : écritures de paie nominatives visibles avec `compta:read` — masquer libellés salariés sans `paie:read`.
- ☐ erp/commercial.js:276/288 PATCH /lots — `price_fcfa` exige `projects:write`.
- ☐ compta.js:316-360 — nouveau `achats:validate` (validation des factures d'achat et des dépenses du Parc).
- ☐ chantiers.js:169 TMA, juridique.js:113 actes — périmètre si l'accès ne vient que de `sales:read`.
- ☑ chantiers.js:428 PATCH livraisons — périmètre, réponse filtrée.
- ☐ paie.js:79 PATCH /employees — `user_id` → `users:write`, `manager_id`/`active` → `rh:files`.
- ☐ chantiers.js:410 réception d'un marché (libère la retenue) — prévenir le Juridique.
- ☐ juridique.js:229/269 litiges visant un collègue — exclure de la vue « service ».
- ☐ chantiers.js:102/124/129 `/refs`, `/lieux`, `/programmes/:id` — limiter aux comptes concernés.
- ☐ juridique.js:129 GET /courrier — exiger un droit.
- ☑ erp/commercial.js:139/184 activités : pas d'activité confiée à un collègue sans `leads:assign`.

## C. ERP — RH, présences, frais, recrutement, demandes, SAV
- ☐ services/rh.js:238 décision de congé en mode « RH seulement » : responsable direct ne peut pas approuver définitivement.
- ☐ erp/rh.js:307/313 ajustement de son propre solde — interdit.
- ☐ erp/rh.js:280 modification de sa propre fiche ; se nommer responsable — interdit ; `leave_opening_days` → `conges:manage`.
- ☐ presences.js:96-104 ses propres pointages — interdit.
- ☐ recrutement.js:101 embauche avec salaire — `paie:employees` ; champ masqué au front.
- ☐ positions.js:176, recrutement.js:32 — salaires masqués sans `paie:read`.
- ☐ erp/rh.js:227 POST /leaves `approve:true` — `conges:approve`.
- ☐ frais.js:80-84 — modifier/soumettre la note d'un autre interdit ; pas d'approbation de sa propre note.
- ☐ requests.js:37 — pas de validation DG de sa propre demande.
- ☐ requests.js:126-150 — facture d'achat créée seulement avec `achats:write` ; pas de traitement de sa propre demande.
- ☐ sav.js:51/159/251 — nouveau `sav:all` ; sans lui, tickets et interventions qui lui sont confiés.
- ☐ presences.js:55-75 — conducteur : employés de ses chantiers seulement.
- ☐ presences.js:44 borne : limiter les essais de code.
- ☐ Libellés : `demandes:dg` (circuit), `kpi:write` (objectifs individuels), `sav:reserves`, `self:conges`.
- ☐ Lectures ouvertes : organigramme, `/rh/meta`, `/onboarding`.
- ☐ sav.js:304 POST /files — `lead_id` lié au ticket.
- ☐ Front : EmployeeFile.jsx:210/222 (`conges:manage`), :52 (`formation:write`), Positions.jsx:140, TicketDrawer.jsx:81, NewTicket.jsx:95 (`sav:assign`), Reserves.jsx:59 (`sav:create`), Expenses.jsx:99 (`can_approve`).
