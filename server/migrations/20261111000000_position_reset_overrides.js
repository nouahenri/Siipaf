/**
 * Changement de poste avec nouveau rôle : retirer ou non les privilèges accordés ou retirés à la personne elle-même
 * (Dashboard › Utilisateurs › privilèges), choix fait dans la fenêtre « Changer de poste » (client, 23/10).
 */
exports.up = knex => knex.schema.alterTable('hr_position_changes', t => {
  t.boolean('reset_overrides').notNullable().defaultTo(false);
});

exports.down = knex => knex.schema.alterTable('hr_position_changes', t => { t.dropColumn('reset_overrides'); });
