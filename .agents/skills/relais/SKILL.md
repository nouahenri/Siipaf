---
name: relais
description: Alias de /passation. Relais entre discussions sur le projet SIIPAF. Reprend le travail à partir de passation.md (état du projet, décisions, prochaine étape, points en attente) ou met ce fichier à jour avant de changer de discussion. À utiliser quand l'utilisateur dit « passation », « relais », « reprends où on en était », « on continue », ou demande de préparer une nouvelle discussion.
---

# Relais SIIPAF (identique à /passation)

Le fichier `passation.md`, à la racine du projet, est la mémoire de travail partagée entre les discussions. Deux usages :

## A. Reprendre le travail (début de discussion)

1. Lire `passation.md` en entier, puis `server/README.md` si la tâche touche au serveur.
2. Vérifier que l'état décrit est toujours vrai, sans rien modifier :
   - `git status --short` et `git log --oneline -3` (ce qui est committé ou non) ;
   - `cd server && npm test` (les tests doivent être verts ; signaler sinon) ;
   - la présence des dossiers `server/`, `admin/` et du fichier `server/.env` (ne jamais afficher son contenu).
3. Résumer à l'utilisateur, en français et en quelques lignes : où on en est, la prochaine étape prévue, les points en attente qui demandent sa réponse.
4. Demander confirmation avant d'attaquer la prochaine étape si un choix reste ouvert ; sinon, continuer.

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
