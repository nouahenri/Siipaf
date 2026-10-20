---
name: passation
description: Relais entre discussions sur le projet SIIPAF. Reprend le travail à partir de passation.md (état du projet, décisions, prochaine étape, points en attente) ou met ce fichier à jour avant de changer de discussion. À utiliser quand l'utilisateur dit « passation », « relais », « reprends où on en était », « on continue », ou demande de préparer une nouvelle discussion.
---

# Passation SIIPAF

Le fichier `passation.md`, à la racine du projet, est la mémoire de travail partagée entre les discussions. Deux usages :

## A. Reprendre le travail (début de discussion)

1. Lire `passation.md`, et rien d'autre à ce stade : pas de relecture du code ni du README.
2. Une seule commande de contrôle : `git status --short`. Ne lancer `npm test` que si la passation signale un travail non vérifié.
3. Résumer à l'utilisateur en 5 lignes maximum : où on en est, la prochaine étape, ce qui attend sa réponse.
4. Attaquer la prochaine étape (ou demander si un choix reste ouvert), en ne lisant que les fichiers dont cette étape a besoin.

## Mode opératoire (économie de jetons)
- **Un seul chantier à la fois.** Une nouvelle demande en cours de route est notée dans « En attente » de `passation.md`, puis on demande à l'utilisateur s'il veut changer de chantier. Pas de nouvelle session ni de sous-agent sans demande explicite de sa part.
- Lire des extraits ciblés (grep, plages de lignes), pas des fichiers entiers déjà décrits dans la passation.
- Pendant le développement, lancer seulement le fichier de test concerné ; la suite complète une seule fois en fin d'étape.
- Dans le navigateur, préférer la lecture du texte aux captures d'écran, et regrouper les actions.
- Mettre `passation.md` à jour à la fin de chaque étape (et avant tout changement de chantier), de façon concise.

Règles qui s'appliquent dès la reprise :
- Les règles métier sont dans `server/src/lib/domain.js` : s'y conformer et les y faire évoluer, pas ailleurs.
- Tout nouveau comportement serveur s'accompagne de tests dans `server/test/`.
- Vérifier visuellement dans le navigateur (aperçus `admin-demo` et `siipaf` de `.Codex/launch.json`) avant d'annoncer qu'une interface est terminée. Redémarrer `admin-demo` après un changement côté serveur.
- Ne jamais recopier de mot de passe ou de jeton dans la discussion ; renvoyer vers `server/.env`.
- Ne pas committer, pousser, mettre en ligne ni supprimer de fichiers sur l'hébergement sans l'accord explicite de l'utilisateur.

## B. Mettre à jour la passation (fin de discussion, ou sur demande)

Réécrire `passation.md` pour qu'une nouvelle discussion puisse repartir sans rien d'autre :
- mettre à jour la date, le tableau des phases et la section « Ce qui est fait » ;
- décrire précisément la **prochaine étape** et les choix déjà validés par l'utilisateur ;
- tenir à jour la liste « En attente / points ouverts » (cocher ce qui est réglé, ajouter le nouveau) ;
- garder la section sécurité et les préférences du client ;
- ne mettre aucun secret dans le fichier.

Puis indiquer à l'utilisateur comment reprendre : ouvrir une nouvelle discussion dans ce dossier et taper `/passation`.
