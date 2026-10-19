/**
 * Témoignages clients : déposés depuis le site (en attente de validation) ou saisis
 * dans le dashboard ; seuls les témoignages publiés apparaissent sur le site.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('testimonials', t => {
    t.increments('id');
    t.string('name', 120).notNullable();
    t.string('role_label', 120); // ex. « Diaspora France », « Cadre supérieur »
    t.string('email', 190); // jamais affiché publiquement
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL');
    t.tinyint('rating').unsigned().notNullable().defaultTo(5);
    t.text('message').notNullable();
    t.integer('photo_media_id').unsigned().references('media.id').onDelete('SET NULL');
    t.enu('status', ['en_attente', 'publie', 'refuse']).notNullable().defaultTo('en_attente');
    t.boolean('featured').notNullable().defaultTo(false);
    t.string('source', 20).notNullable().defaultTo('site');
    t.integer('moderated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('moderated_at');
    t.timestamps(true, true);
    t.index(['status']);
  });

  // Témoignages déjà affichés sur le site, repris tels quels
  const project = async slug => (await knex('projects').where({ slug }).first())?.id || null;
  await knex('testimonials').insert([
    {
      name: 'Kouamé A.', role_label: 'Diaspora France', project_id: await project('yamoussoukro'), rating: 5, status: 'publie', featured: false, source: 'admin',
      message: "Grâce à SIIPAF, j'ai pu acquérir mon appartement à Yamoussoukro sans apport initial. L'option Diaspora m'a permis de payer depuis la France sur 36 mois. Un accompagnement sérieux et transparent du début à la fin.",
    },
    {
      name: 'Bamba S.', role_label: 'Cadre supérieur', project_id: await project('bingerville'), rating: 5, status: 'publie', featured: true, source: 'admin',
      message: "J'ai investi dans un duplex à Bingerville. La livraison en 180 jours a été tenue comme promis dans le contrat. L'équipe SIIPAF est très professionnelle et disponible à chaque étape. Je recommande vivement !",
    },
    {
      name: 'N’Goran E.', role_label: "Chef d'entreprise", project_id: await project('cly'), rating: 5, status: 'publie', featured: false, source: 'admin',
      message: "Mon appartement F4 à Cocody Angré est exactement comme présenté dans la brochure. Les finitions sont impeccables et le standing est au rendez-vous. SIIPAF SA mérite sa réputation de promoteur sérieux.",
    },
  ]);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('testimonials');
};
