/**
 * ERP · Administration générale › Courrier arrivée / départ (choix du client du 22/10) : n° d'ordre par sens et par an,
 * scan joint, affectation par la direction (destinataire, suite à donner, délai), relances la veille de l'échéance et
 * le jour du dépassement, confidentialité. Droits courrier:* donnés au responsable d'exploitation.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('mail_items', t => {
    t.increments('id');
    t.string('direction', 10).notNullable(); // arrivee | depart
    t.integer('year').notNullable();
    t.integer('seq').notNullable();
    t.string('number', 20).notNullable().unique(); // A-2026-0001
    t.date('date').notNullable(); // date d'arrivée ou d'envoi
    t.date('letter_date'); // date portée sur le courrier
    t.string('letter_ref', 100); // référence de l'expéditeur
    t.string('correspondent', 200).notNullable(); // expéditeur (arrivée) ou destinataire externe (départ)
    t.string('subject', 300).notNullable();
    t.string('nature', 20).notNullable().defaultTo('lettre');
    t.string('channel', 20).notNullable().defaultTo('poste');
    t.boolean('confidential').notNullable().defaultTo(false);
    t.boolean('urgent').notNullable().defaultTo(false);
    t.text('notes');
    t.string('scan_filename', 120);
    t.string('scan_name', 255);
    t.string('scan_mime', 60);
    t.string('status', 12).notNullable().defaultTo('enregistre');
    // Affectation (direction)
    t.integer('assigned_to').unsigned().references('users.id').onDelete('SET NULL');
    t.string('assigned_department', 20);
    t.string('suite', 12);
    t.date('due_date');
    t.text('instructions');
    t.integer('assigned_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('assigned_at');
    // Suite donnée
    t.text('done_note');
    t.integer('done_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('done_at');
    t.integer('reply_to_id').unsigned().references('mail_items.id').onDelete('SET NULL'); // départ en réponse à une arrivée
    t.timestamp('reminded_eve_at');
    t.timestamp('reminded_late_at');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.unique(['direction', 'year', 'seq']);
    t.index(['status', 'due_date']);
    t.index(['assigned_to', 'status']);
  });

  if (!(await knex.schema.hasTable('role_permissions'))) return;
  if (await knex('role_permissions').where({ role: 'resp_exploitation' }).first()) {
    for (const permission of ['courrier:read', 'courrier:write', 'courrier:assign']) {
      if (!(await knex('role_permissions').where({ role: 'resp_exploitation', permission }).first())) {
        await knex('role_permissions').insert({ role: 'resp_exploitation', permission });
      }
    }
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('mail_items');
  for (const table of ['role_permissions', 'user_permissions']) {
    if (await knex.schema.hasTable(table)) await knex(table).whereIn('permission', ['courrier:read', 'courrier:write', 'courrier:assign']).del();
  }
};
