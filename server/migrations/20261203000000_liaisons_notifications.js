/**
 * Liaisons entre services et notifications (audit du 30/10/2026, docs/audit-liaisons-notifications.md) :
 * - `liaison_marks` : registre des messages automatiques déjà envoyés à un client ou à un prospect (rappel d'option, relance
 *   d'impayé, accusé de rendez-vous…), pour n'en envoyer qu'un par étape même si la tâche horaire repasse ;
 * - aucun droit à ajouter : les nouveaux événements s'appuient sur les droits existants et se règlent dans le circuit d'information.
 */
exports.up = async knex => {
  if (!(await knex.schema.hasTable('liaison_marks'))) {
    await knex.schema.createTable('liaison_marks', t => {
      t.increments('id');
      t.string('mark_key', 190).notNullable().unique();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
};

exports.down = async knex => {
  await knex.schema.dropTableIfExists('liaison_marks');
};
