/**
 * Son de notification choisi par chaque compte (demande du client du 25/10) : joué par la cloche du dashboard et de
 * l'ERP à l'arrivée d'une notification ; « aucun » pour le silence. Réglé depuis la cloche (Sons de notification).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('users', t => { t.string('notif_sound', 20).notNullable().defaultTo('carillon'); });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('users', t => { t.dropColumn('notif_sound'); });
};
