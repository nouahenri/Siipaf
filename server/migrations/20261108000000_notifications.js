/**
 * Centre de notifications commun de l'ERP (docs/analyse-liaisons-inter-services.md §6.1) : une ligne par destinataire,
 * affichée dans la cloche de la barre du haut et sur les cartes des modules. La clé `dedupe_key` évite d'envoyer
 * deux fois la même alerte (palier 30 / 7 jours, relance de la veille…).
 */
exports.up = async function (knex) {
  await knex.schema.createTable('notifications', t => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.string('module', 20).notNullable(); // commercial | sav | compta | rh | administration…
    t.string('event', 40).notNullable(); // courrier.affecte, contrat.echeance, conge.demande…
    t.string('title', 255).notNullable();
    t.string('body', 500);
    t.string('link', 255); // chemin dans l'ERP : /administration/courrier?fiche=12
    t.string('priority', 10).notNullable().defaultTo('info'); // info | action | urgent
    t.string('dedupe_key', 120);
    t.timestamp('read_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['user_id', 'dedupe_key']);
    t.index(['user_id', 'read_at']);
    t.index(['user_id', 'created_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('notifications');
};
