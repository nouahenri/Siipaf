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
