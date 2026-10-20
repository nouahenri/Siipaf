# Audit de la plateforme SIIPAF — 19 octobre 2026

Point de vue : solution de gestion immobilière (promoteur / aménageur), circuit
Prospection → Visite → Décision → Choix du bien → Paiement → Contrat → Notaire → Livraison → SAV.
Périmètre : dashboard admin (admin.siipaf.com), espace client (client.siipaf.com), API, site public.

## 1. Ce qui est solide
- **Lots** : 6 statuts, transitions contrôlées, historique horodaté, option de 7 jours qui expire toute seule.
- **Dossier d'acquisition** : code client unique, prix convenu, versements saisis par le comptable, statut « soldé » automatique, 6 pièces juridiques avec statut et visibilité client, désistement qui clôt le dossier et remet le lot en vente.
- **Échéancier** selon le financement (apport 30 % + 36 mois, Diaspora, comptant, crédit), retards calculés.
- **Espace client** cloisonné (un client ne voit que ses dossiers), connexion par code ou téléphone, messagerie, journal de chantier.
- **Droits** : rôles personnalisables, contrôlés côté serveur (pas seulement masqués dans l'écran). 51 tests automatiques.

## 2. Manques fonctionnels (par menu)
| Menu | Constat | Priorité |
|---|---|---|
| Lots & disponibilités | Pas de création d'un lot à l'unité : seulement l'import en masse ou le dessin sur le plan de masse. Les caractéristiques d'un lot (n°, îlot, surface, prix, type de bien) ne se modifient pas depuis sa fiche. | ✅ Fait le 19/10 : « Nouveau lot », « Modifier », « Supprimer » (refusé s'il y a eu une vente) |
| Fiche lot › Aperçu | Le dossier d'acquisition ne se modifie pas : prix convenu, financement, date de signature, notes. Pourtant le financement pilote l'échéancier. | ✅ Fait le 19/10 : « Modifier le dossier » (et correction des dates) |
| Contenu du site | Diaporama, bandeau, chiffres clés et coordonnées s'enregistrent mais **le site public ne les lit pas** (tout y est écrit en dur). | ✅ Fait le 19/10 : `js/site-content.js` sur les 5 pages ; les 5 diapositives et les 6 messages du bandeau sont repris en base. À mettre en ligne sur siipaf.com. |
| Projets | Pas de suppression d'un projet créé par erreur. Le masquage existe (case « publié »). | P2 |
| Prospects | ~~Pas de suppression d'un prospect~~ — fait le 20/10 (refusée s'il y a un dossier ou une option). | P2 ✔ |
| Messages (formulaire de contact) | Pas de réponse depuis l'admin : traiter ou archiver seulement. | P3 |
| Rendez-vous | Création depuis la fiche prospect uniquement, pas depuis l'agenda. | P3 |

## 3. Règles métier à renforcer
1. **Passage à « Vendu »** : aujourd'hui manuel. Règle proposée : interdit sans dossier d'acquisition actif ; avertissement si le contrat de vente n'est pas « signé ». *(à valider par SIIPAF)*
2. **Désistement** : les sommes versées restent dans le dossier clos ; ni remboursement ni retenue ne sont suivis. → à traiter dans l'ERP (phase 3), avec la compta.
3. **Reçus** : numérotés `REC-AAAA-id` ; une numérotation continue par année sera exigée par la comptabilité (phase 3).
4. **Prix** : seul le prix du lot est suivi ; frais de dossier, frais de notaire et pénalités de retard ne sont pas encore modélisés. *(à valider)*

## 4. Sécurité et exploitation
| Point | Constat | Priorité |
|---|---|---|
| Documents juridiques | Les fichiers joints aux dossiers (contrats, ACD…) sont dans `/uploads`, **lisibles par quiconque connaît leur adresse**. Il faut les servir seulement aux personnes autorisées. | ✅ Fait le 19/10 : réservés à l'équipe ayant accès aux ventes ou aux documents ; le client passe par son espace |
| E-mails | SMTP non configuré : aucun e-mail ne part (mot de passe oublié, notifications). | **P1** (à faire avec le client) |
| Sauvegardes | ~~Pas de sauvegarde planifiée~~ — script `server/scripts/backup.js` fait le 20/10 ; tâche cron à créer sur cPanel. | P2 ✔ |
| Hébergement | `SIIPAF_WEB.zip` public sur siipaf.com ; jeton GitHub en clair dans le dépôt local. | **P1** (actions du client) |
| Git | ~~Rien n'est committé~~ — commits sur `plateforme-admin-espace-client` (20/10). | P2 ✔ |

## 5. Plan d'action
- **P1, maintenant** : création et modification des lots ; modification du dossier d'acquisition ; documents juridiques protégés ; contenu du site branché sur le site public (sa mise en ligne attend l'accord du client).
- **P2** : suppression d'un projet ou d'un prospect sous conditions ; sauvegardes ; commit Git.
- **P3** : réponse aux messages depuis l'admin ; rendez-vous depuis l'agenda.
- **À valider avec SIIPAF** : règles 3.1 et 3.4.
