# KPI — référentiels, objectifs de service et indicateurs des services support

État au 27 octobre 2026 : **cadrage validé par le client (voir « Choix du client ») ; rien n'est développé.** À traiter après la recette d'Achats & stocks (un seul chantier à la fois).

## Demande du client (27/10)

1. Pouvoir fixer un objectif **au service lui-même**, pas seulement à ses employés (ex. « la Comptabilité clôture le mois avant le 10 »).
2. Donner des **indicateurs calculés automatiquement** à la Comptabilité, au Juridique et à l'Administratif (aujourd'hui : assiduité et suivi manuel seulement).
3. **Administrer les KPI par référentiels** appliqués aux services ou aux employés, « dans le module Administration générale ou autre ».

## Existant (ne pas recréer)

| Élément | Où | Limite actuelle |
|---|---|---|
| Objectifs annuels par employé | Table `hr_objectives`, ERP › RH › Objectifs | Saisis un par un, employé par employé ; aucun modèle. |
| Liste des indicateurs automatiques | `OBJECTIVE_METRICS` dans `server/src/lib/rh.js` (17 indicateurs) | Liste figée dans le code ; rien pour Compta, Juridique, Administratif. |
| Calcul, score pondéré, courbes | `server/src/services/performance.js` | — |
| KPI par service | `departmentReport` (RH › Performance, Vue Direction) | Simple moyenne des scores des employés. |
| Services | `DEPARTMENTS` dans `server/src/lib/paie.js` (7 services) | — |
| Postes | Table `hr_positions`, RH › Réglages (service rattaché à chaque poste) | — |
| Modèle de référentiel déjà en place | RH › Compétences (types, niveaux, compétences) | Exemple à suivre pour l'écran. |

## Proposition

### A. Référentiel des indicateurs (catalogue)
Une fiche par KPI, gérée à l'écran au lieu d'être figée dans le code :
- nom, famille, unité, sens (« plus haut = mieux » ou « plus bas = mieux ») ;
- source : **automatique** (choisie dans la liste des calculs disponibles) ou **manuelle** ;
- niveau : **individuel**, **service** ou les deux ;
- seuils d'alerte (vert / orange / rouge, en % de la cible) ;
- archivage au lieu de la suppression (les objectifs passés gardent leur indicateur).

Les calculs restent dans le code (on ne crée pas de formule à l'écran) ; le référentiel décide lesquels sont proposés, sous quel nom et avec quels seuils.

### B. Modèles d'objectifs (référentiels appliqués)
Un modèle = une liste de KPI avec cible, poids et période (année, trimestre ou mois). Il s'applique à :
- **un service** → tous ses employés ;
- **un poste** → tous les titulaires du poste (et automatiquement au nouvel arrivant sur ce poste) ;
- **un employé** → ajustement individuel.

Ordre de priorité : employé > poste > service. Appliquer un modèle **génère les objectifs de l'année** dans `hr_objectives` (rien n'est écrasé sans confirmation ; un objectif déjà ajusté à la main est conservé).

### C. Objectifs de service (collectifs)
Un objectif porté par le service lui-même (table dédiée, même calcul d'atteinte), mesuré sur l'ensemble du service. Le score du service combine alors :
- l'atteinte de ses objectifs collectifs ;
- la moyenne des scores de ses employés.

Pondération entre les deux à fixer par le client (proposition : 50 / 50, réglable).

### D. Nouveaux indicateurs automatiques (données déjà en base)

| Service | Indicateur | Niveau | Source |
|---|---|---|---|
| Comptabilité | Clôture mensuelle avant le jour J (date de verrouillage avancée à temps) | Service | `acc_fiscal_years.lock_date` |
| Comptabilité | Écritures validées ; délai moyen brouillon → validée | Individuel | `acc_entries.validated_by`, `validated_at` |
| Comptabilité | Factures fournisseurs réglées à l'échéance (%) ; retard moyen | Service | `purchase_invoices.due_date`, `purchase_payments.date` |
| Comptabilité | Paie validée avant la date de paie | Service | `payroll_runs.validated_at`, `paid_at` |
| Juridique | Délai moyen réservation → remise de l'acte ; actes remis | Service | `legal_sale_files` (dates des étapes) |
| Juridique | Contentieux clos ; contentieux sans prochaine échéance | Individuel | `litigations.owner_id`, `closed_on`, `next_date` |
| Juridique | Garanties échues non traitées | Individuel | `guarantees.owner_id`, `expires_on`, `status` |
| Administratif | Courriers traités dans le délai (%) ; délai moyen | Individuel | `mail_items.assigned_to`, `done_at`, `due_date` |
| Administratif | Demandes internes traitées ; délai moyen de traitement | Individuel | `internal_requests.handled_by`, `handled_at`, `closed_at` |
| Administratif | Actions des documents internes faites à temps | Individuel | `internal_doc_actions.owner_id`, `due_date`, `done_at` |
| Administratif | Entretiens du parc à jour | Service | `asset_maintenance_plans` (échéance à recalculer) |

## Où gérer les référentiels

**Recommandation : dans ERP › RH**, pas dans l'Administration générale, et sans menu en plus :
- un onglet **« Référentiel KPI »** dans RH › Objectifs (catalogue A et modèles B), comme RH › Compétences pour les compétences ;
- les objectifs de service (C) dans RH › Performance, à côté du tableau par service.

Raison : objectifs, entretiens, scores, postes et services sont déjà tous dans RH ; l'Administration générale gère courrier, contrats, parc, documents et demandes. Y placer les KPI couperait le référentiel des objectifs qu'il alimente. La Vue Direction continue d'afficher le résultat.

Droit d'accès proposé : un privilège dédié **`kpi:write`** (gérer le référentiel et les modèles), donné par défaut au service RH et à la Direction ; le responsable d'un service ajuste les cibles de son équipe.

## Choix du client (27/10)

1. **Emplacement : ERP › RH.** Onglet « Référentiel KPI » dans RH › Objectifs ; objectifs de service dans RH › Performance ; aucun menu en plus.
2. **Gestion : le service RH avec la Direction générale.** Privilège `kpi:write` donné par défaut à ces deux rôles ; il n'est pas donné d'office aux responsables de service.
3. **Score d'un service : 50 % objectifs collectifs, 50 % moyenne des employés**, réglable dans RH › Réglages. Sans objectif collectif, le score reste la moyenne des employés (comme aujourd'hui).
4. **Toutes les périodes (mois, trimestre, année), avec filtre** sur les écrans d'objectifs, de performance et la Vue Direction. Règle de cumul (choix technique) : pour un indicateur cumulable (ventes, CA, heures…), la cible et le réalisé d'un trimestre ou d'une année sont la somme des mois ; pour un taux, un délai ou une note, c'est la moyenne sur la période.
5. **Cibles commerciales mensuelles : une seule source (validé par le client le 27/10).** Les cibles saisies dans Commercial › Objectifs deviennent des objectifs mensuels du même système (indicateurs CA signé, ventes, RDV réalisés, encaissements). L'écran Commercial › Objectifs reste tel quel pour le directeur commercial (saisie du mois, réalisé, portefeuille) et lit / écrit ces mêmes objectifs ; le score RH des commerciaux en découle sans double saisie. Les cibles déjà saisies (table `sales_targets`) sont reprises par migration ; le directeur commercial garde le droit de fixer les cibles mensuelles de son équipe (privilège existant `targets:write`) sans avoir `kpi:write`.
6. **Jour limite de la clôture mensuelle : Comptabilité › Réglages** (réglage du module qui porte la règle, comme les autres réglages de la Comptabilité), valeur par défaut le 10.
