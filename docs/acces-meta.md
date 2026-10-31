# Acquisition Meta — accès à fournir pour brancher

Le module Marketing est prêt en mode « non connecté » : rien n'est envoyé à Meta tant que ces informations ne sont pas saisies. Elles se saisissent dans **ERP › Marketing & Communication › Réglages › Connecteurs Meta** (droit « Réglages du Marketing »). Les secrets y sont chiffrés et ne s'affichent plus jamais en clair (seuls les 4 derniers caractères).

## À fournir par SIIPAF

1. **Application Meta** (developers.facebook.com), de type « Entreprise », avec les produits Webhooks, Messenger, Instagram et API Marketing :
   - identifiant de l'application ;
   - secret de l'application.
2. **Page Facebook** (https://web.facebook.com/Siipaf.sa) :
   - identifiant numérique de la page ;
   - jeton d'accès de la page, longue durée (idéalement sans expiration, via un utilisateur système du Business Manager) ;
   - accès au Business Manager pour rattacher l'application à la page.
3. **Compte Instagram professionnel** lié à la page : son identifiant.
4. **Compte publicitaire** :
   - identifiant (avec ou sans `act_`) ;
   - jeton avec le droit `ads_management` (de préférence celui d'un utilisateur système ; facultatif si le jeton de page suffit) ;
   - moyen de paiement actif.
5. **Pixel Meta** : identifiant du pixel du compte publicitaire.
6. **Jeton de vérification des webhooks** : librement choisi (bouton « Générer » dans l'ERP), à saisir à l'identique dans l'ERP et dans la console Meta.

## À faire dans la console Meta (SIIPAF ou un administrateur)

- Déclarer l'adresse de rappel `https://<adresse publique du serveur>/api/public/meta/webhook` (affichée et copiable dans l'ERP) avec le jeton de vérification :
  - pour la page : `leadgen`, `feed`, `messages`, `messaging_postbacks` ;
  - pour Instagram : `messages`, `comments`.
- Demander la revue Meta des autorisations : `leads_retrieval`, `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_manage_engagement`, `instagram_manage_messages`, `instagram_manage_comments` ; puis passer l'application en mode « Live ».
- Formulaires de publicité : les créer sur la page et mettre le **code de la campagne** (visible sur la fiche campagne de l'ERP) dans le nom de l'annonce ou de la campagne Meta, pour rattacher les prospects.
- Fournir l'**adresse de la politique de confidentialité** du site (exigée par Meta), avec la mention de la loi 2013-450 / ARTCI pour les listes d'audience.

## Côté SIIPAF dans les outils

- Activer **Sita** (Dashboard › Contenu du site › Assistante du site) : elle répond aussi sur Messenger et Instagram.
- Fixer le plafond mensuel en FCFA de Sita et celui du Marketing.
- Facultatif, avant de saisir les secrets : définir `META_SECRETS_KEY` dans `server/.env` (sinon la clé de chiffrement est dérivée de `JWT_SECRET` ; la changer rendrait les secrets enregistrés illisibles).

## Plus tard

- **WhatsApp Business** : numéro vérifié et accès à l'API Cloud (non encore branché).
