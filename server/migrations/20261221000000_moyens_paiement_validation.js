/**
 * Moyens de paiement de l'application et de l'espace client (Paramètres › Général, champs pay_*) : demande du client du
 * 20/11. Seul le super administrateur propose un changement ; il ne s'applique aux clients qu'après validation de la
 * direction générale (ERP › Vue Direction). Une proposition garde les valeurs d'avant et proposées, l'auteur, la décision.
 */
exports.up = async knex => {
  await knex.schema.createTable('payment_setting_changes', t => {
    t.increments('id');
    t.text('previous').notNullable(); // JSON { pay_*: valeur } au moment de la proposition
    t.text('proposed').notNullable(); // JSON { pay_*: valeur } proposé (champs modifiés seulement)
    t.string('status', 20).notNullable().defaultTo('a_valider'); // a_valider | validee | refusee | annulee | remplacee
    t.integer('requested_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.integer('decided_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.datetime('decided_at');
    t.string('reason', 500);
    t.timestamps(true, true);
    t.index(['status']);
  });
};

exports.down = async knex => {
  await knex.schema.dropTableIfExists('payment_setting_changes');
};
