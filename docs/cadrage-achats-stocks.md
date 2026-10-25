# Achats & stocks — périmètre documenté

État au 25 octobre 2026 : implémentation locale terminée et vérifiée sur la démonstration. Choix du client et traitements métier retenus par délégation consignés ci-dessous. Aucun commit, push ni déploiement effectué pour ce chantier.

## Demande du client

Implémenter le module « Achats & stocks » déjà prévu dans l'ERP, sans modifier le fonctionnement des modules existants, sans nouvelle orientation et sans extrapolation.

## Périmètre déjà inscrit dans la passation

Source : `passation.md`, §5 quinquies, « Vision fonctionnelle demandée par le client (20/10) ».

- Demandes de prix et bons de commande de matériaux.
- Contrats-cadres et suivi des sous-traitants : conserver les contrats et le suivi existants en Administration générale, Chantiers et Juridique.
- Stocks de matériaux par dépôt et par chantier, y compris les emplacements temporaires de chantier.
- Mouvements dépôt ↔ chantiers et alertes de rupture.
- Reprise des besoins en matériaux déjà saisis dans les chantiers.

Les biens immobiliers restent des lots du parc immobilier ; ce ne sont pas des articles de stock.

## Éléments existants à reprendre sans changer leurs règles

| Élément | Source existante | Raccordement identifié |
|---|---|---|
| Fournisseurs | Table `suppliers`, routes `/api/admin/erp/compta/suppliers` | Utiliser les mêmes identifiants et fiches ; aucun second fichier fournisseurs. |
| Factures et paiements fournisseur | Tables `purchase_invoices`, `purchase_payments`, `services/compta.js` | Réception physique distincte de la facture. Préparation explicite d'un brouillon pour les réceptions non facturées ; validation, règlements et écritures restent dans la Comptabilité. |
| Besoins chantier | Table `worksite_needs`, `services/chantiersLivraison.js` | Réutiliser les besoins et leurs identifiants, sans recréer leur circuit. |
| Validation des besoins | `docs/cadrage-chantiers.md`, §5 ; routes Chantiers | Demandé → validé par la Direction ou l'acheteur → commandé → livré ; livraison confirmée par le conducteur. Les refus et annulations conservent les règles existantes. |
| Quantités et unités des besoins | `worksite_needs.quantity`, liste `worksite_ref_items` de sorte `unite` | Conserver les quantités et les unités réglables déjà saisies. |
| Affectations | Tables `places`, `projects`, `worksites`, `services/lieux.js`, `components/PlacePicker.jsx` | Réutiliser les lieux, programmes et chantiers existants. |
| Sous-traitants et contrats-cadres | Table `contracts`, services Contrats et `chantiersSousTraitance.js` | Aucun nouveau circuit de contrat, de situation ou de retenue de garantie. |
| Comptes et privilèges | Comptes `users`, catalogue de `server/src/lib/domain.js` | Même session et mêmes comptes. Nouveaux droits `appro:*` propres au module, sans donner les droits comptables aux conducteurs. |
| Présentation | Tuile « Achats & stocks » existante dans `ERP-SIIPAF/src/pages/Launcher.jsx` | Ouvrir la tuile existante ; reprendre les composants et la présentation actuels. |

Les ajouts de raccordement nécessaires au lanceur, à la navigation, aux routes et au catalogue des droits concerneront uniquement le nouveau module. Ils ne doivent pas réécrire les traitements des modules en place.

## Choix du client et traitements métier retenus (25/10)

1. **Accès et réglages — choix explicite du client** : super administrateur, directeur des exploitations, conducteur de chantier, Comptabilité. Reprise des rôles existants `super_admin`, `resp_exploitation`, `conducteur_travaux`, `comptable`, sans les renommer. Les quatre peuvent régler le plafond ; les trois rôles opérationnels reçoivent les seuls nouveaux droits `appro:read/write/validate/stock/settings`. `appro:direction` est donné au rôle existant des exploitations, le super administrateur conservant ses droits globaux. Les rôles restent administrables dans le catalogue commun.
2. **Plafond — choix explicite du client** : administrable dans Réglages du module. Valeur initiale reprise du plafond SIIPAF existant des demandes internes, sans modifier celui-ci. À partir du plafond TTC inclus, transmission à la Direction ; le plafond est figé sur la commande transmise. Un changement ultérieur du réglage ne contourne pas une validation déjà requise.
3. **Stock insuffisant — recherche demandée et décision déléguée** : bloquer toute sortie/transfert qui rendrait négatif le stock courant ou historique. Opérations atomiques ; un brouillon n'agit pas sur le stock, et un mouvement validé ne se rejoue ni ne se modifie. Stock initial et corrections se justifient par un nouveau mouvement daté, avec motif.
4. **Réception et facture — décision déléguée aux règles métier** : la réception, partielle ou complète, enregistre les quantités effectivement reçues et le stock, sans dette ni écriture. Après réception de la facture du fournisseur, un compte possédant déjà `achats:write` et `compta:read` peut préparer un brouillon sur les réceptions non facturées. Une réception ne se facture qu'une fois. La validation comptable et le paiement restent inchangés. Les arrondis cumulés HT/TVA/TTC des réceptions partielles restent égaux au bon de commande.
5. **Besoins existants** : mêmes identifiants et circuit. Une commande reprend la quantité et l'unité du besoin validé, pour le chantier destinataire ; pas de double commande active. La réception complète met le besoin à jour uniquement quand l'acteur possède les droits du circuit Chantiers existant. Les transferts de stock généraux restent disponibles sans recréer un besoin.
6. **Demandes de prix** : saisie des prix reçus, passage « Devis reçu », conversion unique en commande. Aucun envoi de message au fournisseur ajouté. Documents imprimables via le navigateur.

### Sources de la recherche

- [ERPNext — Purchase Receipt](https://docs.frappe.io/erpnext/purchase-receipt) : séparation commande / réception physique / facture et réceptions partielles.
- [ERPNext — stock négatif et valorisations anormales](https://docs.frappe.io/erpnext/why-is-my-valuation-rate-or-stock-value-negative-or-abnormally-high) : prévention du stock négatif et contrôle des opérations antidatées.

Ces pratiques guident les nouveaux traitements. Aucune méthode de valorisation comptable ni aucun circuit des modules existants n'est remplacé.

## Implémentation et état de vérification

- Migration additive `20261125000000_achats_stocks.js` : tables `appro_*` et seuls droits propres au module. Aucun schéma de table métier existante modifié.
- Règles dans `server/src/lib/domain.js`, service `server/src/services/appro.js`, routes `/api/admin/erp/achats`.
- Écrans dans `ERP-SIIPAF/src/pages/achats/`, helpers `src/lib/appro.js`, ouverture de la tuile existante et enregistrement des routes/menu du nouveau module.
- Notifications dans le centre existant ; préférences personnelles du nouveau module. Contrats existants consultés selon leurs droits habituels.
- Ajout demandé après recette : **Administration générale › Vue Direction** reprend les quatre indicateurs et la ligne de synthèse du module, entre Chantiers et Finance. Composant commun `ApproSummary.jsx`, calculs issus directement de `appro.dashboard`, sans nouveau calcul métier ni changement des droits de la Vue Direction.
- **16 tests dédiés verts ; suite serveur complète : 260 tests réussis, aucun échec**. Builds ERP, dashboard et espace client réussis. `git diff --check` sans erreur.
- Après l'ajout Direction : **19 tests ciblés Direction + Achats & stocks réussis**, dont un nouveau test de cohérence des deux tableaux de bord au cours du cycle commande/réception/réapprovisionnement ; nouveau build ERP réussi.
- Script `server/scripts/demo-appro.js`, réservé explicitement à une base `server/data/demo*.sqlite`. Réutilise les fournisseurs/lieux/chantiers ; crée seulement les données propres au nouveau module. SMTP coupé ; aucun remplissage des bases réelles.

## Vérifications effectuées

- Tests des droits des quatre rôles retenus, du plafond figé, des refus et des notifications, y compris des identifiants proches (1 et 10).
- Réceptions partielles, arrondis cumulés HT/TVA/TTC, sur-réception refusée, interdiction de double facture, libération des réceptions après suppression du brouillon dans la Comptabilité, référence fournisseur déjà utilisée refusée.
- Stock atomique et non négatif, transferts, échec d'une opération multiligne sans modification partielle, concurrence, antidatage et dates futures contrôlés.
- Besoins de chantier repris par leurs identifiants, quantité et unité conservées, pas de seconde commande active pour le même besoin ; conversion unique d'un devis reçu.
- Navigateur : création d'une commande, confirmation, réception partielle puis stock ; transfert refusé pour quantité excessive, corrigé puis validé ; seuil d'article décimal enregistré/relu puis rétabli ; plafond passé à 600 000, relu après rechargement puis rétabli à 500 000 FCFA ; demandes de prix, historique, document imprimable, fournisseurs/contrats existants et matrice des droits consultés.
- Vérification à 1 440 px et 390 px : page sans débordement horizontal, tableaux défilant dans leur cadre, formulaire mobile contenu dans l'écran. Aucun message d'erreur dans la console du module.
- Dashboard admin de démonstration ouvert après connexion normale, sans erreur console ; page Carrières du site public et formulaire existant toujours présents. Formulaire de préparation de facture du module ouvert puis fermé sans soumission.
- Comparaison de la démonstration avec sa sauvegarde : **112 tables métier préexistantes identiques** (hors comptes, droits et notifications). Aucune facture ajoutée pendant la recette visuelle ; la préparation du brouillon comptable est vérifiée par les tests isolés.

## Démonstration et reprise

- Aperçu : `http://erp.localhost:4003/achats`, base `server/data/demo.sqlite`, SMTP désactivé. Exemples : DP-2026-0001, BC-2026-0001 partiellement reçu, BC-2026-0002 en attente Direction et BC-2026-0003 issu de la recette visuelle.
- Sauvegarde avant migration : `C:/Users/NOUAMA/.codex/visualizations/2026/10/25/01a17244-3f7a-7940-8810-9a408ee28bee/demo-before-achats-stocks.sqlite`.
- **Seule la base de démonstration a reçu la nouvelle migration et les exemples.** La base locale principale et la production n'ont pas été migrées par ce chantier.
- Le raccordement des besoins dépend du lot Chantiers déjà présent localement (`chantiersLivraison`, `worksite_needs`, migration `20261124000000_chantiers_livraison.js`) : préserver cet ensemble lors d'une éventuelle livraison ultérieure.
- Tous les travaux préexistants restent conservés. Prochaine étape : retour du client sur la démonstration. Aucun commit, push ni déploiement sans accord explicite.
