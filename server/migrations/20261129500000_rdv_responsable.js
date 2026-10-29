/**
 * Le responsable commercial planifie aussi des rendez-vous avec les prospects et les clients (demande du client du
 * 29/10) : « Planifier un rendez-vous » est donné aux rôles qui attribuent les prospects (leads:assign).
 */
exports.up = async knex => {
  const roles = await knex('role_permissions').where({ permission: 'leads:assign' }).pluck('role');
  for (const role of roles) {
    if (!(await knex('role_permissions').where({ role, permission: 'appointments:create' }).first())) await knex('role_permissions').insert({ role, permission: 'appointments:create' });
  }
};

// Sans retour arrière automatique : on ne sait plus quels rôles l'avaient déjà
exports.down = async () => {};
