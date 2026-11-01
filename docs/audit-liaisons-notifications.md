# Audit des liaisons entre services et des notifications — 30/10/2026

Réalisé par un agent ECC (lecture seule du code) à la demande du client : partage d'informations et notifications entre modules et services, du prospect au SAV, et liaisons internes décrites dans `docs/analyse-liaisons-inter-services.md`. Rien n'a été modifié par l'audit ; les corrections sont à planifier.

Mécanismes : `notify` (destinataires directs) et `inform` (événement + audiences réglables dans « Circuit d'information ») de `server/src/services/notifications.js` ; catalogue `INFO_EVENTS` / `INFO_AUDIENCES` dans `server/src/lib/domain.js` ; `NOTIF_MODULES` dans `services/notifications.js`.

## A) Parcours client

| N° | Étape | Notification aujourd'hui | État | Écart principal → correction |
|---|---|---|---|---|
| 1a | Prospect venu du site (intérêt, option sur plan, rendez-vous, contact) | E-mail à l'adresse équipe ; cloche du dashboard (`leadAlert`) pour ceux qui le voient | Partiel | Rien dans la cloche ERP des responsables pour un prospect à attribuer → événement `prospect.nouveau` (responsables commerciaux) ; accusé e-mail au prospect (sauf option, déjà fait) ; la cloche du dashboard ignore « Mes notifications » |
| 1b | Prospect importé | Aucune | Manquant | Prévenir le commercial à qui la liste est attribuée |
| 1c | Prospect saisi | Cloche des autres comptes | OK | — |
| 2 | Attribution, répartition, transfert | Seule la décision d'un transfert prévient | Partiel | Prévenir le nouveau commercial à toute attribution (`portfolio.assign`, PATCH, `plannedFor`, import) ; tracer l'attribution dans l'historique partout ; transfert de client : prévenir le demandeur de l'accord du responsable |
| 3 | Activités et rendez-vous | Aucune | Partiel | Prévenir l'assigné quand le responsable confie ; tâche horaire « activités échues / rendez-vous du lendemain » ; e-mail de confirmation du rendez-vous au prospect ; tracer le passage en « visite » |
| 4 | Étapes du pipeline | Aucune (voulu) | OK | Passage automatique en « SAV » sans trace dans l'historique (`sav.js:140`) |
| 5 | Option / réservation d'un lot | Aucune | Manquant | Option expirée ou proche : prévenir le commercial (et le prospect) ; désistement : événement `vente.desistee` (Compta, Juridique, Chantiers, SAV, commercial) ; statut « réservé/vendu » posé sans dossier (`catalog.js:446`) |
| 6 | Ouverture du dossier de vente | `vente.ouverte` → commercial, Direction, Compta, Juridique | OK | Dossier issu d'un import : rien (acceptable) |
| 7a | Échéancier modifié | Aucune | Manquant (basse) | Prévenir commercial et client |
| 7b | Versement déclaré / confirmé / refusé | `versement.a_confirmer`, `vente.versement`, `versement.refuse` | OK | Bruit : les responsables reçoivent tous les versements |
| 7c | Versement enregistré, reçu, écriture | Client jamais prévenu ; écriture seulement après « Synchroniser » | Partiel | Confirmation de versement au client (espace + e-mail) ; « N opérations à synchroniser » pour la Compta ; **bug probable `imports.js:33` (`[^d]` au lieu de `[^\d]`)** |
| 7d | Échéance impayée | `echeance.impayee` une seule fois ; `impaye.transmis` à 90 j | Partiel | Relances périodiques du commercial ; relance du client |
| 8 | Appels de fonds VEFA | Message d'espace client sans e-mail ; commerciaux en direct | Partiel | Un `tellClient` unique avec e-mail « nouveau message » (aussi TMA, PV de réception) |
| 9 | Étape de chantier signalée / déclarée / refusée | `chantier.etape_*` | OK | Point d'avancement publié : ni client ni commercial prévenus |
| 10 | Circuit de l'acte | Seule la signature notifie | Partiel | Prévenir commercial (et client) aux étapes intermédiaires ; honoraires du notaire → Compta absents |
| 11 | TMA | `tma.demandee/acceptee/refusee` | Partiel | **Lien `/chantiers/<id>` inaccessible au commercial** → lien par destinataire ; e-mail au client |
| 12 | Livraison (PV, réserves, garanties) | `lot.livre` | Partiel | **Double porte** : `PATCH /sav/sales/:id/delivery` contourne PV, message et `lot.livre` ; lien inaccessible au commercial |
| 13 | SAV : réclamations | Réclamation du client notifiée ; le reste non | Partiel | Client non prévenu des changements de statut ; commercial non prévenu ; réclamation créée par l'équipe sans `reclamation.ouverte` ; alerte d'échéance SLA |
| 14 | SAV : réserves, interventions, garanties, satisfaction | Aucune | Manquant | `reserve.levee` (client + conducteur), `intervention.cout` (Compta), `satisfaction.recue` (commercial), technicien désigné |
| 15 | Espace client : messages, documents | E-mail équipe seulement | Partiel | Cloche au commercial attribué pour un message du client ; prévenir le client d'un document mis en ligne |
| 16 | Vue Direction | Courrier, contrats, parc, documents, juridique, chantiers | OK | Ajouter SAV en retard, prospects à attribuer, impayés à « À traiter en priorité » |

## B) Liaisons internes

| Liaison | État | Écart → correction |
|---|---|---|
| RH → Compta (paie) | Fait | Pas d'avis à la validation / au paiement de la paie |
| RH → Compta (notes de frais) | Fait | Notifications hors catalogue |
| Recrutement → embauche | Partiel | Événement `employe.embauche` (comptes, services généraux, Compta) ; candidature du site sans cloche RH |
| Départ d'un employé | Fait / partiel | Doublon pour la Compta ; responsable commercial pas toujours prévenu |
| RH ↔ Juridique (échéances CDD / essai) | Partiel | Encart seulement → tâche horaire RH + Juridique |
| RH → Chantiers (pointage → coût) | Fait | — |
| Achats ↔ Chantiers | Fait | — |
| Achats → Compta | Fait | Liens Achats au lieu de Compta ; bruit de 4 audiences par commande |
| Chantiers → Compta | Fait | — |
| Compta → Chantiers (budget) | Partiel | Les commandes confirmées (engagé) ne comptent pas dans l'alerte de budget |
| Parc ↔ Compta | Fait | Hors catalogue |
| Parc ↔ Chantiers | Partiel | Pas de mouvement dépôt ↔ chantier |
| Contrats → Compta | Fait | Hors catalogue |
| Contrats ↔ Juridique | Partiel | Alertes vers un rôle codé en dur (`resp_exploitation`) → calcul par droits ; Juridique non prévenu |
| Courrier → services | Partiel | Encart « Courriers du service » seulement au Juridique ; pas de lien vers la fiche concernée |
| Demandes internes | Fait | — |
| Juridique | Fait (réserves) | Étapes intermédiaires, honoraires du notaire, caution libérée non annoncée à l'acheteur |
| Compta → Commercial (impayés) | Fait (réserves) | Une seule alerte |
| Chantiers → Commercial (avancement → appels de fonds) | Fait | — |
| Chantiers → SAV (livraison) | Fait | Double porte (A-12) |
| SAV → Chantiers (réserves, interventions) | Absent | Prévenir conducteur et entreprise responsable |
| SAV → Juridique (litige) | Partiel | Pas de bouton ni d'avis depuis le SAV |
| SAV → Commercial (satisfaction) | Absent | `satisfaction.recue` |
| Direction ← tous | Fait | Manquent SAV en retard, prospects à attribuer, impayés, seuil de trésorerie |

## C) Cohérence du catalogue

- **Haute** — Audiences sans repli : `audienceUsers` ne retombe pas sur le super admin (contrairement à `usersWith`) ; `exploitation` et `commercial_resp` restent vides sans le rôle correspondant (ex. demande de transfert vue de personne).
- **Haute** — Liens inaccessibles : des destinataires directs (commerciaux) reçoivent `/chantiers/<id>…` sans droit sur les chantiers ; `inform` n'accepte pas de lien par destinataire direct.
- **Moyenne** — Nombreux événements émis par `notify` direct hors `INFO_EVENTS` (non réglables dans le circuit) : congés, frais, courrier, contrats, parc, départs, demandes, `vefa.appel_emis`, `reclamation.confiee`, etc.
- **Moyenne** — Déclenchements trop étroits : `reclamation.ouverte` seulement depuis l'espace client ; `vente.ouverte` seulement depuis la fiche du lot.
- **Moyenne** — « Mes notifications » non respecté par la cloche prospects du dashboard (et le son).
- **Moyenne (à valider)** — Le rôle par défaut `conducteur_travaux` a `juridique:write` et `leads:all` : il reçoit litiges et impayés (noms, montants).
- **Basse** — Doublons (départ, transfert), `usersWithAny`, documents de liaison périmés (§2, §10), clés sans dédoublonnage.

## D) Corrections priorisées

**Haute** : 1) repli des audiences sur le super admin ; 2) liens accessibles pour chaque destinataire ; 3) prospects entrants et attributions notifiés et tracés ; 4) `tellClient` unique avec e-mail (appels de fonds, TMA, PV, versements, statut de réclamation) ; 5) désistement et statut de lot ; 6) SAV branché (réclamations de l'équipe, commercial, conducteur, satisfaction, réserves, interventions, échéances SLA) ; 7) message d'un client → cloche du commercial ; 8) livraison par une seule porte ; 9) `imports.js:33`.

**Moyenne** : 10) options et rendez-vous (prospect et commercial) ; 11) tâche horaire commerciale ; 12) embauche et échéances des contrats de travail ; 13) alertes Contrats/Parc par droits ; 14) étapes de l'acte et honoraires du notaire ; 15) Compta : opérations à synchroniser, engagé dans le budget ; 16) relances d'impayés ; 17) cloche du dashboard et « Mes notifications » ; 18) encart courrier par service ; 19) Vue Direction ; 20) passer les `notify` directs au catalogue ; 21) droits du rôle conducteur de travaux.

**Basse** : 22) mettre à jour le document des liaisons ; 23) doublons et bruit ; 24) échéancier, point d'avancement, document mis en ligne ; 25) traces d'historique (SAV, visite) ; 26) candidatures, témoignages, newsletter dans la cloche.

## E) Suivi des corrections — 31/10/2026

Code livré sans lancer les tests (consigne du client : tests ensemble à la fin du projet) ; test écrit : `server/test/liaisons-notifications.test.js`. Mécanismes : `services/notifications.js` (`inform`, `linkFor`, `usersWithAny`), `services/liaisons.js` (parcours commercial), `services/clients.js` (`tellClient`), `services/sav.js` (`announce*`), catalogue `INFO_EVENTS` (86 nouveaux événements, tous réglables dans le Circuit d'information). Migration : `20261203000000_liaisons_notifications.js` (`liaison_marks`).

**Hautes**
- [x] 1) Repli des audiences sans titulaire sur le super administrateur (`audienceUsers`).
- [x] 2) Liens accessibles à chaque destinataire (`linkFor` : un commercial n'a plus `/chantiers/<id>`, lien par destinataire direct, liens SAV pour les audiences SAV).
- [x] 3) `prospect.nouveau` / `prospect.demande` (site, plan, rendez-vous, contact ; prêt pour l'assistante IA : `announceInbound`), attribution notifiée et tracée partout (`prospect.attribue`, `traceAssignment`), import de liste, accord de transfert au demandeur.
- [x] 4) `tellClient` unique avec e-mail « nouveau message » (appels de fonds VEFA, TMA, PV de réception, versement, statut de réclamation, étapes de l'acte, document, avancement, échéancier, relance).
- [x] 5) `vente.desistee` (Compta, Juridique, Chantiers, SAV, commercial) ; `lot.sans_dossier` remplacé le 31/10 par le blocage (voir Compléments, point 2).
- [x] 6) SAV : `reclamation.ouverte` pour toute création, commercial et conducteur prévenus, `reclamation.resolue`, `satisfaction.recue`, `reserve.levee`, `intervention.confiee`, `intervention.cout`, `reclamation.retard` (tâche horaire). Partiel : l'« entreprise responsable » d'une réserve n'est pas prévenue (le conducteur l'est).
- [x] 7) `message.client` → cloche du commercial attribué.
- [x] 8) `PATCH /sav/sales/:id/delivery` passe par `chantiersLivraison.deliverFromSav` (PV si un chantier couvre le lot, sinon mêmes effets reproduits).
- [x] 9) `imports.js` : `[^\d]` corrigé (le contrôle de droit ne refusait jamais) ; `import.versements` prévient la Compta.

**Moyennes**
- [x] 10) Options (`option.proche`, `option.expiree` : commercial et prospect), confirmation de rendez-vous et accusés des formulaires par e-mail.
- [x] 11) Tâche horaire commerciale (`activite.echue`, `rdv.demain`).
- [x] 12) `employe.embauche` (comptes, services généraux, Compta) et `contrat_travail.echeance` (essai, CDD → responsable, RH, Juridique).
- [x] 13) Alertes Contrats et Parc par droits ; `contrat.echeance_juridique` pour la sous-traitance.
- [x] 14) `acte.etape` (commercial et client) ; honoraires du notaire : montant saisi au Juridique, facture d'achat en brouillon et notification `acte.honoraires` avec le montant (voir Compléments, point 1).
- [x] 15) `compta.a_synchroniser` (tâche horaire, lue après « Synchroniser ») ; engagé compté dans l'alerte de budget et affiché dans la liste des chantiers. Complété le 01/11 : fiche chantier — « + … engagés » sous « Budget consommé », et dans l'onglet Budget lignes « Engagé (commandes confirmées, non reçues) » et « Réel + engagé » (écart et % au même seuil que l'alerte).
- [x] 16) `echeance.relance` (30 et 60 jours : commercial et client).
- [x] 17) Cloche du dashboard : « Mes notifications » respecté (compteur et son).
- [x] 18) Encart « Courriers affectés au service » dans Compta, SAV, RH, Achats (service « administratif »), Chantiers (« chantier » et « technique »), lien vers la fiche du courrier. Complété le 01/11 : Service commercial (tableau de bord) et Vue Direction (section Administration générale, service « direction ») ; le Juridique a son propre encart. Les 9 services du registre ont désormais leur encart.
- [x] 19) Vue Direction : SAV en retard, prospects à attribuer, impayés.
- [x] 20) Tous les `notify` directs passés au catalogue (congés, frais, courrier, contrats, parc, départs, demandes, documents, postes, objectifs, chantiers, besoins, litiges, cautions, `vefa.appel_emis`, `reclamation.confiee`…).
- [ ] 21) Ignoré : décision du client (rôle `conducteur_travaux` inchangé).

**Basses**
- [x] 22) `docs/analyse-liaisons-inter-services.md` mis à jour (§2, §10, « Reste à faire »).
- [x] 23) Doublons de départ (exclusion de ceux déjà prévenus) et de transfert (alertes lues à la décision) ; `usersWithAny` partagé ; bruit réduit (`vente.versement` : plus de responsables commerciaux par défaut ; `commande.confirmee` : sans l'exploitation).
- [x] 24) `echeancier.modifie`, `avancement.publie`, document mis en ligne (client prévenu).
- [x] 25) Traces d'historique : passage en visite, en livraison, en SAV.
- [x] 26) `candidature.recue`, `temoignage.recu`, `newsletter.inscrit`.

## F) Compléments décidés par le client le 31/10/2026

Code livré sans lancer les tests (tests ensemble à la fin du projet) ; cas écrits dans `server/test/liaisons-complements.test.js` (et adaptés dans `lots.test.js` et `liaisons-notifications.test.js`). Migration : `20261206000000_liaisons_complements.js` (`legal_sale_files.notary_fee_fcfa`, `legal_sale_files.notary_invoice_id`, `guarantees.sale_id`).

- [x] 1) Honoraires du notaire : champ « Honoraires du notaire » (FCFA, TTC) dans le circuit de l'acte (droit `juridique:deeds`) ; à la saisie, facture d'achat en BROUILLON au notaire du dossier (fournisseur), compte 632200, rattachée au programme, à valider par la Comptabilité ; `acte.honoraires` avec le montant (lien Comptabilité › Achats). Un seul brouillon par dossier : modifier le montant ou le notaire le met à jour, l'effacer le supprime ; une fois validée, la facture ne se modifie plus au Juridique (409). Les honoraires ne sont pas montrés au commercial.
- [x] 2) « Réservé » et « Vendu » ne se posent plus à la main : `POST /lots/:id/status` répond 409 explicite, la création de lot par import refuse ces statuts (400), le sélecteur de statut grise ces deux choix avec la raison. « Réservé » vient de l'ouverture du dossier de vente (option confirmée comprise), « Vendu » de l'acte signé. `lot.sans_dossier` et `announceLotWithoutSale` sont supprimés (les lots déjà réservés ou vendus sans dossier avant ce changement restent tels quels, sans alerte).
- [x] 3) Courrier des Achats : service « Administratif » conservé (rien à changer).
- [x] 4a) Avis de paie : `paie.validee` (action) et `paie.payee` à la Comptabilité et à la Direction générale, réservés aux comptes qui ont `paie:read`, lien vers la paie du mois.
- [x] 4b) « Ouvrir un litige » depuis une réclamation (Client & SAV) : bouton dans le tiroir de la réclamation, réservé au responsable du SAV (`sav:assign`) ou au juriste (`juridique:litigation`) — ouvrir un contentieux engage l'entreprise : ni tout agent qui traite la réclamation, ni sans le Juridique. Litige d'origine « Réclamation SAV », lié à la réclamation (`sav_ticket_id`), au dossier de vente (donc client, programme et lot) ; service concerné « Client & SAV » ; un seul litige ouvert par réclamation ; `litige.ouvert` prévient le Juridique et la Direction ; trace interne dans le fil de la réclamation et lien vers le litige.
- [x] 4c) Caution libérée : la garantie peut désigner un acheteur (dossier de vente) ; à la libération, l'acheteur reçoit un message dans son espace (`tellClient`, avec l'e-mail « nouveau message »), le fournisseur ou sous-traitant de la caution (ou de son contrat) un e-mail s'il a une adresse, et `caution.liberee` prévient la Comptabilité et le responsable de la caution. Seule la libération est annoncée (pas la mise en jeu ni l'expiration).
- [x] 4d) Seuil de trésorerie : réglage « Seuil d'alerte de trésorerie » dans Comptabilité › Paramètres (`MODULE_SETTINGS.compta`, 5 000 000 FCFA par défaut, 0 = désactivé) ; la tâche horaire de la Comptabilité émet `tresorerie.seuil` (Direction générale, Comptabilité) une seule fois par passage sous le seuil (état gardé dans `app_settings.treasury_alert_state`, réarmé et alerte lue au retour au-dessus) ; sans exercice comptable ouvert, pas d'alerte. Vue Direction : la tuile « Trésorerie » signale le seuil franchi et « À traiter en priorité » reprend la ligne en tête.

Restent à décider : mouvement de dépôt ↔ chantier du parc ; journal des événements.
