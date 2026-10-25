# Cadrage — ERP › Chantiers

> Choix du client du 24/10/2026 (questions de cadrage), complétés par les choix techniques délégués.

## 1. Choix du client

| Sujet | Choix |
|---|---|
| Périmètre de la v1 | Planning et phases · Budget et coûts réels · Sous-traitants et situations · Journal et réception · **toute autre fonction utile selon les règles métier** |
| Découpage | **Plusieurs chantiers par programme** (ex. tranche 1 / tranche 2, VRD séparé des villas), chacun avec son budget et son conducteur |
| Étape qui déclenche l'appel de fonds VEFA | **Direction seule** (question 3 du §9 de l'analyse, tranchée) |
| Points d'avancement vus par les clients | **Les deux endroits** : onglet Chantier du dashboard (inchangé) et ERP › Chantiers, sur la même table `site_updates` |
| Validation d'une situation de sous-traitant | **Conducteur de travaux puis Direction** ; la facture d'achat part alors en brouillon chez le comptable |
| Retenue de garantie | **5 % par défaut, réglable par marché** |
| Coût de main-d'œuvre | **Les deux** : taux saisi s'il existe (journaliers, intérim), sinon calculé depuis le salaire de la fiche employé |
| En plus dans la v1 | Travaux modificatifs acquéreurs (TMA) · Besoins en matériaux · Retards et dates promises · Tableau de bord Direction |

### Lieux hors programmes (demande du client du 24/10, en cours du lot 2)

| Sujet | Choix |
|---|---|
| Liste des lieux | Administrable dans **ERP › Administration générale › Lieux** |
| Types | Siège social · Bureau annexe / agence · Dépôt / magasin · Autre (libellé libre) |
| Qui modifie | Super administrateur, Comptabilité, Administration générale (droit `lieux:write`, par défaut comptable et responsable des exploitations) |
| Où choisir « programme / chantier OU lieu » | Achats et fournisseurs (lieu par défaut de la fiche) · Parc et dépenses · Notes de frais et demandes internes · Pointages et contrats |
| Comptabilité | **Axe analytique** : chaque écriture porte un programme (et un chantier) ou un lieu ; états par lieu |
| Sans programme ni lieu | **Siège social par défaut** ; l'existant sans programme est repris sur le siège |

## 2. Modèle (une seule source par donnée)

- **Chantier** (`worksites`, réf. `CH-AAAA-NNN`) : programme (`projects`), nom, zone (îlots, bâtiments ou lots couverts), conducteur de travaux (compte), statut (préparation, en cours, suspendu, réceptionné, clos), dates prévues et réelles.
  La comptabilité garde son axe analytique **programme** (`project_id`) ; le chantier s'ajoute à côté (`worksite_id`) sur les pièces qui le portent, et le programme se déduit du chantier.
- **Phases** (`worksite_phases`) : étapes du journal de chantier (`SITE_STAGES`) ou phase libre, dates prévues / réelles, avancement, phase précédente → **Gantt**.
- **Tâches** (`worksite_tasks`) : rattachées à une phase, responsable (employé ou sous-traitant), jalon ou non, statut → **Kanban**.
- **Budget** (`worksite_budget_lines`) : postes matériaux, main-d'œuvre, sous-traitance, engins et matériel, frais divers, autre.
- **Coûts réels** (aucune ressaisie) : factures d'achat portant le chantier, dépenses du Parc (bien affecté au chantier ce jour-là), pointages RH × coût horaire, situations validées des sous-traitants.
- **Journal quotidien** (`worksite_journal`) : météo, effectif, travaux réalisés, incidents, photos (interne).
- **Points d'avancement** : `site_updates` (inchangé, visible des clients), publiables du dashboard ou de l'ERP.
- **Étapes atteintes** (`worksite_stage_declarations`) : le conducteur signale (photos, date), **la Direction déclare** ; seule la déclaration émet les appels de fonds VEFA des lots concernés.
- **Marchés de sous-traitance** = contrats de sorte « sous-traitance » (`contracts`, même liste que l'Administration et le Juridique) rattachés au chantier ; retenue 5 % pré-remplie.
- **Situations de travaux** (`worksite_situations`) : cumul déclaré, montant de la période, retenue, statut (brouillon → vérifiée par le conducteur → validée par la Direction / refusée) ; validée → facture d'achat en brouillon (Compta) et retenue cumulée dans les Cautions (Juridique).
- **TMA** (`worksite_changes`) : demande de l'acquéreur, devis, accord du client, réalisation, facturation.
- **Besoins en matériaux** (`worksite_needs`) : articles, quantités, date souhaitée ; repris par le futur module Achats & stocks.
- **Date promise** (`sales.promised_delivery_on`) : un retard prévu prévient le commercial du client, le SAV et la Direction.
- **Réception** : la date de livraison du lot reste `sales.delivered_at` (ouvre réserves et garanties du SAV).

## 3. Droits

- `chantiers:read` — consulter les chantiers ; `chantiers:write` — gérer ses chantiers (conducteur de travaux) ;
- `chantiers:direction` — **valider en direction** : déclarer une étape atteinte (appels de fonds), valider les situations. Donné à aucun rôle par défaut (comme `demandes:dg`) : à accorder au compte du DG ; le super administrateur l'a toujours.
- Un conducteur nommé sur un chantier le gère sans autre droit que `chantiers:read`. Prix de vente non visibles du module (le lot vendu, pas son prix).

## 4. Ordre de construction (un commit par lot)

1. Chantiers, phases (Gantt), tâches (Kanban), budget par poste, droits, module ouvert dans le lanceur.
2. Coûts réels et budget consommé (achats, Parc, main-d'œuvre), alertes de dépassement.
3. Journal quotidien, points d'avancement depuis l'ERP, étapes déclarées par la Direction → appels de fonds, dates promises et retards.
4. Sous-traitants : marchés, situations, retenues → Juridique, factures → Comptabilité.
5. TMA, besoins en matériaux, réception des lots (PV → SAV).
6. Tableau de bord du module et section Chantiers de la Vue Direction ; script de démo ; recette.

## 5. Choix du client pour le lot 5 (25/10/2026)

| Sujet | Choix |
|---|---|
| TMA | **Circuit complet** : demande par le commercial ou par l'acquéreur (espace client) → devis chiffré par le conducteur → **accord de l'acquéreur dans son espace client** → montant ajouté à l'échéancier de la vente (Comptabilité prévenue) → réalisation suivie sur le chantier |
| Réception d'un lot | **PV de livraison et réserves** (date de livraison du dossier, réserves ouvertes au SAV, garanties qui démarrent) · **dernier appel de fonds** : la Direction est invitée à déclarer l'étape « Livraison » du lot · **espace client** : PV, réserves et levées visibles · **Juridique** prévenu (expédition de l'acte, fin du circuit de vente) |
| Besoins en matériaux | **Liste suivie** : saisie par le conducteur, validée par la Direction ou l'acheteur, statut demandé → validé → commandé → livré ; reprise par Achats & stocks |
| Retenues de garantie | **Réception du marché** : date de réception des travaux du sous-traitant saisie par le conducteur ; libération proposée à cette date + délai de garantie (Juridique › Réglages) ; Juridique et Comptabilité prévenus à l'échéance |
