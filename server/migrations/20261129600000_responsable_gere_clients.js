/**
 * Le responsable commercial voit et gère tous les clients (précision du client du 29/10) : « Modifier la fiche d'un
 * client » est donné aux rôles qui attribuent les prospects (leads:assign), qui ont déjà la portée « toute l'équipe ».
 */
exports.up = async knex => {
  for (const role of await knex('role_permissions').where({ permission: 'leads:assign' }).pluck('role')) {
    if (!(await knex('role_permissions').where({ role, permission: 'clients:edit' }).first())) await knex('role_permissions').insert({ role, permission: 'clients:edit' });
  }
};

// Sans retour arrière automatique : on ne sait plus quels rôles l'avaient déjà
exports.down = async () => {};
