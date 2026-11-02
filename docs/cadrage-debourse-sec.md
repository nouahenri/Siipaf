# Cadrage — Déboursé sec (ERP › Chantiers)

> Demande du client du 02/11/2026 : « évaluer le coût approximatif de construction, en budget et en matériaux, d'une villa,
> d'un appartement par exemple, jusqu'au gros œuvre, avec des paramètres et des référentiels réglables dans le module Chantiers ».
> Plan de capacité établi avec la compétence ECC « product-capability ». **Statut : cadrage validé par le client (§7), construction à suivre.**

## 1. Capacité

Le conducteur de travaux, la Direction et les Achats peuvent, **avant ou pendant un chantier**, chiffrer le **déboursé sec**
d'un bâtiment type (villa basse, duplex, appartement…) **jusqu'au gros œuvre** à partir de quelques paramètres (surface,
niveaux, nombre de logements…). L'ERP calcule les **quantités d'ouvrages**, les **quantités de matériaux** (ciment en sacs,
acier en kg, sable et gravier en m³, agglos…), le **coût par lot** et par nature (matériaux, main-d'œuvre, matériel), le
**coût au m²**, puis peut reporter le résultat dans le **budget prévu du chantier** (postes existants). Les prix, les compositions
d'ouvrages et les ratios des modèles se règlent dans **Chantiers › Réglages**.

## 2. Règles métier (usage BTP)

- **Déboursé sec (DS)** = coût direct de réalisation : Σ (quantité d'ouvrage × coût unitaire sec). Il comprend **matériaux,
  main-d'œuvre d'exécution, matériel**. Il **exclut** frais de chantier, frais généraux, aléas, bénéfice et TVA.
- **Coût unitaire sec d'un ouvrage (sous-détail de prix)** = Σ matériaux (quantité par unité × (1 + perte %) × prix)
  + Σ main-d'œuvre (temps unitaire × taux) + Σ matériel (temps × coût). Exemple : 1 m³ de béton armé dosé à 350 kg/m³ =
  7 sacs de ciment de 50 kg, 0,4 m³ de sable, 0,8 m³ de gravier, acier selon l'élément (ratio kg/m³), coffrage, main-d'œuvre.
- **Coût de revient estimatif** (optionnel, voir question 3) = DS × (1 + frais de chantier % + aléas %) ; le prix de vente
  (coefficient K, frais généraux, marge) relève du Commercial, pas de ce module.
- **Gros œuvre** (périmètre proposé) : installation de chantier, terrassements, fondations (béton de propreté, semelles,
  longrines), soubassement (agglos pleins, hérisson, dallage), élévation (murs en agglos, poteaux, chaînages, linteaux),
  planchers et escaliers (dalle pleine ou corps creux), acrotères. Charpente-couverture et étanchéité : voir question 2.
  Second œuvre et VRD : hors périmètre.
- **Quantités** : par **ratios** rattachés au modèle de bâtiment (ex. 0,18 m³ de béton de fondation par m² d'emprise,
  12,5 agglos par m² de mur, 100 kg d'acier par m³ de béton de poteaux), calculés depuis les paramètres saisis ; chaque
  quantité reste **modifiable** dans l'estimation (métré réel quand on l'a).
- **Prix figés** : une estimation garde les prix du jour de son calcul ; modifier le référentiel ne change pas une estimation
  passée, sauf « Recalculer aux prix actuels » (tracé).
- **Valeurs par défaut** : dosages et ratios usuels ; prix indicatifs du marché d'Abidjan **à vérifier par SIIPAF** avant usage
  (marqués comme tels), comme les barèmes RH « à confirmer ».

## 3. Modèle proposé (une seule source par donnée)

| Référentiel (Chantiers › Réglages › Déboursé sec) | Contenu | Liaisons |
|---|---|---|
| **Ressources** | matériau, main-d'œuvre ou matériel ; unité (liste « Unités » existante) ; prix unitaire FCFA ; perte % | article du catalogue Achats (facultatif) → dernier prix d'achat proposé |
| **Ouvrages élémentaires** | lot (terrassement, fondations…), libellé, unité d'ouvrage, composition (ressource × quantité) | postes du budget (matériaux, main-d'œuvre, engins) |
| **Modèles de bâtiment** | type de bien (Paramètres du dashboard), paramètres attendus, ouvrages × ratio × paramètre | types de bien `ref_items` |
| **Estimations** | modèle, paramètres, quantités (modifiables), prix figés, totaux ; programme et chantier facultatifs | report vers `worksite_budget_lines` ; plus tard besoins en matériaux |

## 4. Écrans

- **Chantiers › Réglages** : section « Déboursé sec » (ressources, ouvrages, modèles), même présentation que les listes réglables.
- **Chantiers › Estimations** (onglet de la liste des chantiers, pas de nouveau menu) : nouvelle estimation (modèle, paramètres,
  nombre de logements identiques), résultat par lot, récapitulatif des matériaux, coût au m², impression.
- **Fiche chantier › Budget** : « Partir d'une estimation » (report des montants par poste, relu avant enregistrement).

## 5. Droits proposés

- `chantiers:estimate` — créer et modifier des estimations (conducteurs, Direction, Achats).
- Référentiels : `chantiers:settings` (existant).

## 6. Hors périmètre

Second œuvre, VRD, prix de vente et marge, planning, appels d'offres sous-traitants, commandes automatiques.

## 7. Choix du client (02/11/2026)

1. **Méthode : les deux** — le modèle calcule les quantités par ratios ; chaque quantité reste modifiable (métré réel).
2. **Toiture en option** — gros œuvre jusqu'aux planchers, escaliers et acrotères ; charpente-couverture et étanchéité en
   lot facultatif, coché selon le modèle ou l'estimation.
3. **Déboursé sec + coût de revient** — coût de revient estimatif = DS × (1 + frais de chantier % + aléas %), taux réglables.
4. **Prix indicatifs préremplis**, marqués « à vérifier » ; le dernier prix d'achat est proposé quand la ressource est reliée
   à un article du catalogue Achats.

## 8. Suite

Après réponse du client : construction en lots (référentiels et calcul + tests, estimations, report au budget), un commit par lot,
vérification à l'écran sur la démo.
