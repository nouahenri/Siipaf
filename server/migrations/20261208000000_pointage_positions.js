/**
 * Contrôle du lieu de pointage (demande du client du 02/11) : position GPS et rayon de chaque lieu (siège, bureaux,
 * dépôts) et de chaque chantier, réglables dans RH › Réglages et Administration générale › Lieux. Chaque pointage en
 * ligne ou à la borne garde la précision annoncée par l'appareil, la distance au lieu choisi et le résultat du
 * contrôle, à l'arrivée comme au départ. Le pointage n'est jamais refusé : il est signalé.
 * Privilège « Positions de pointage » (presence:zones) : responsable RH, responsable des exploitations, super administrateur
 * (choix du client du 02/11). Le rôle « Responsable RH » n'est pas un rôle d'origine : il le reçoit s'il existe déjà.
 */
const isHrHead = label => /responsable.*(\brh\b|ressources humaines)/i.test(String(label || '').normalize('NFD').replace(/[̀-ͯ]/g, ''));

exports.up = async function (knex) {
  for (const table of ['places', 'worksites']) {
    await knex.schema.alterTable(table, t => {
      t.decimal('latitude', 10, 7);
      t.decimal('longitude', 10, 7);
      t.integer('radius_m').unsigned(); // vide : rayon par défaut des réglages RH
    });
  }
  await knex.schema.alterTable('hr_attendances', t => {
    t.integer('accuracy_m').unsigned();
    t.integer('distance_m').unsigned();
    t.string('geo_status', 12); // sur_place, imprecise, hors_zone, sans_position, non_situe ; vide : pas de contrôle
    t.decimal('out_latitude', 9, 6);
    t.decimal('out_longitude', 9, 6);
    t.integer('out_accuracy_m').unsigned();
    t.integer('out_distance_m').unsigned();
    t.string('out_geo_status', 12);
  });

  // Modification d'une position déjà saisie par un autre que le super administrateur : en attente de sa validation
  // (choix du client du 02/11 ; la première saisie s'applique tout de suite). L'ancienne position sert jusqu'à la décision.
  await knex.schema.createTable('pointage_zone_requests', t => {
    t.increments('id');
    t.string('kind', 10).notNullable(); // lieu, chantier
    t.integer('target_id').unsigned().notNullable();
    t.decimal('latitude', 10, 7); t.decimal('longitude', 10, 7); t.integer('radius_m').unsigned(); // proposé (vide : effacer)
    t.decimal('old_latitude', 10, 7); t.decimal('old_longitude', 10, 7); t.integer('old_radius_m').unsigned();
    t.string('status', 12).notNullable().defaultTo('en_attente'); // en_attente, validee, refusee, annulee
    t.integer('requested_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.integer('decided_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.datetime('decided_at');
    t.string('decision_note', 255);
    t.timestamps(true, true);
    t.index(['kind', 'target_id', 'status']);
  });

  if (!(await knex.schema.hasTable('role_permissions'))) return;
  const roles = (await knex('roles').select('id', 'label')).filter(r => r.id === 'resp_exploitation' || isHrHead(r.label) || isHrHead(r.id.replace(/_/g, ' ')));
  for (const { id: role } of roles) {
    if (!(await knex('role_permissions').where({ role }).first())) continue; // rôle encore sur ses droits par défaut
    if (!(await knex('role_permissions').where({ role, permission: 'presence:zones' }).first())) await knex('role_permissions').insert({ role, permission: 'presence:zones' });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('pointage_zone_requests');
  for (const table of ['role_permissions', 'user_permissions']) {
    if (await knex.schema.hasTable(table)) await knex(table).where({ permission: 'presence:zones' }).del();
  }
  await knex.schema.alterTable('hr_attendances', t => {
    for (const c of ['accuracy_m', 'distance_m', 'geo_status', 'out_latitude', 'out_longitude', 'out_accuracy_m', 'out_distance_m', 'out_geo_status']) t.dropColumn(c);
  });
  for (const table of ['places', 'worksites']) {
    await knex.schema.alterTable(table, t => { t.dropColumn('latitude'); t.dropColumn('longitude'); t.dropColumn('radius_m'); });
  }
};
