/**
 * Newsletter : campagnes et file d'envoi (un e-mail par abonné, avec son lien de désinscription), envoyées petit à
 * petit selon le débit réglé. Nouveau droit « Envoyer les campagnes », donné aux rôles qui gèrent déjà la newsletter.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('newsletter_campaigns', t => {
    t.increments('id');
    t.string('subject', 160).notNullable();
    t.string('preheader', 200); // aperçu affiché après l'objet dans la boîte de réception
    t.string('heading', 200);
    t.text('body');
    t.integer('image_media_id').unsigned().references('media.id').onDelete('SET NULL');
    t.string('cta_label', 60);
    t.string('cta_url', 500);
    t.string('status', 12).notNullable().defaultTo('brouillon'); // brouillon, en_cours, pause, envoyee, annulee
    t.integer('total').unsigned().notNullable().defaultTo(0);
    t.integer('sent').unsigned().notNullable().defaultTo(0);
    t.integer('failed').unsigned().notNullable().defaultTo(0);
    t.string('last_error', 500);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.integer('launched_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('started_at');
    t.timestamp('finished_at');
    t.timestamps(true, true);
  });
  await knex.schema.createTable('newsletter_sends', t => {
    t.increments('id');
    t.integer('campaign_id').unsigned().notNullable().references('newsletter_campaigns.id').onDelete('CASCADE');
    t.integer('subscriber_id').unsigned().references('newsletter_subscribers.id').onDelete('SET NULL');
    t.string('email', 190).notNullable();
    t.string('status', 12).notNullable().defaultTo('en_attente'); // en_attente, envoi, envoye, echec, ignore
    t.string('error', 300);
    t.timestamp('claimed_at');
    t.timestamp('sent_at');
    t.unique(['campaign_id', 'email']);
    t.index(['status', 'sent_at']);
  });
  if (await knex.schema.hasTable('role_permissions')) {
    for (const role of await knex('role_permissions').where({ permission: 'newsletter:write' }).pluck('role')) {
      if (!(await knex('role_permissions').where({ role, permission: 'newsletter:send' }).first())) await knex('role_permissions').insert({ role, permission: 'newsletter:send' });
    }
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('newsletter_sends');
  await knex.schema.dropTableIfExists('newsletter_campaigns');
  await knex('app_settings').where({ key: 'newsletter' }).del().catch(() => {});
  if (await knex.schema.hasTable('role_permissions')) await knex('role_permissions').where({ permission: 'newsletter:send' }).del();
};
