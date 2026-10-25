/**
 * Achats & stocks · catalogue des articles (choix du client du 25/10) : le chantier choisit l'article de son besoin
 * dans le catalogue (ou le signale hors catalogue) ; le catalogue est géré par le responsable des achats, la
 * Comptabilité et le responsable des exploitations (privilège « appro:articles »), rempli au fil des besoins ou par import CSV.
 */
const MANAGERS = ['comptable', 'resp_exploitation'];
const BUYER_PERMISSIONS = ['appro:read', 'appro:write', 'appro:validate', 'appro:stock', 'appro:settings', 'appro:articles', 'contrats:read', 'chantiers:read'];

exports.up = async knex => {
  await knex.schema.alterTable('worksite_needs', t => { t.integer('article_id').unsigned(); });
  for (const role of MANAGERS) {
    if ((await knex('roles').where({ id: role }).first()) && !(await knex('role_permissions').where({ role, permission: 'appro:articles' }).first())) {
      await knex('role_permissions').insert({ role, permission: 'appro:articles' });
    }
  }
  // Rôle créé pour le client, réglable et supprimable ensuite dans Rôles et privilèges
  if (!(await knex('roles').where({ id: 'resp_achats' }).first())) {
    const last = await knex('roles').max({ s: 'sort' }).first();
    await knex('roles').insert({ id: 'resp_achats', label: 'Responsable des achats', description: 'Catalogue des articles, demandes de prix, bons de commande, réceptions et stocks', system: false, sort: Number(last?.s || 0) + 1 });
    await knex('role_permissions').insert(BUYER_PERMISSIONS.map(permission => ({ role: 'resp_achats', permission })));
  }
};

exports.down = async knex => {
  await knex('role_permissions').where({ permission: 'appro:articles' }).del();
  if (await knex.schema.hasTable('user_permissions')) await knex('user_permissions').where({ permission: 'appro:articles' }).del();
  if (!(await knex('users').where({ role: 'resp_achats' }).first())) {
    await knex('role_permissions').where({ role: 'resp_achats' }).del();
    await knex('roles').where({ id: 'resp_achats' }).del();
  }
  await knex.schema.alterTable('worksite_needs', t => { t.dropColumn('article_id'); });
};
