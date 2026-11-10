/**
 * Départ oublié (demande du client du 10/11) : une arrivée restée sans départ au-delà du délai des réglages RH (16 h par
 * défaut) est classée « départ oublié » (`forgotten_at`). Elle ne bloque plus le pointage suivant de l'employé, ses heures
 * ne comptent pas tant que le départ n'est pas saisi, et le service RH, le responsable direct et le conducteur du chantier
 * sont prévenus. La date reste après la correction (historique : « départ oublié, corrigé »).
 */
exports.up = async knex => {
  await knex.schema.alterTable('hr_attendances', t => {
    t.datetime('forgotten_at');
    t.index(['check_out', 'forgotten_at']);
  });
};

exports.down = async knex => {
  await knex.schema.alterTable('hr_attendances', t => {
    t.dropIndex(['check_out', 'forgotten_at']);
    t.dropColumn('forgotten_at');
  });
};
