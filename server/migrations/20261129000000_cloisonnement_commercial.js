/**
 * Cloisonnement des commerciaux (demande du client du 29/10) : un commercial ne voit et ne traite que ses prospects,
 * clients, rendez-vous, dossiers et messages ; les non attribués ne sont vus que des responsables ; changer le commercial
 * d'un prospect ou d'un client passe par une demande motivée validée par le responsable (table lead_transfer_requests).
 * - « leads:all » devient la portée « toute l'équipe » : donnée aux rôles qui consultent des clients sans en gérer
 *   (comptes non commerciaux), pour qu'ils gardent ce qu'ils voyaient ;
 * - « leads:assign » (nouveau) : attribuer, transférer et valider les demandes de transfert. Donné au responsable des
 *   exploitations et aux rôles qui pouvaient déjà transférer (leads:all + leads:write).
 */
const CLIENT_VIEW = ['client_messages', 'sales:read', 'appointments:read', 'leads:read'];

async function grant(knex, role, permission) {
  if (!(await knex('roles').where({ id: role }).first())) return;
  if (!(await knex('role_permissions').where({ role, permission }).first())) await knex('role_permissions').insert({ role, permission });
}

exports.up = async knex => {
  await knex.schema.createTable('lead_transfer_requests', t => {
    t.increments('id');
    t.integer('lead_id').unsigned().notNullable().references('leads.id').onDelete('CASCADE');
    t.integer('from_user_id').unsigned().references('users.id').onDelete('SET NULL'); // commercial au moment de la demande
    t.integer('to_user_id').unsigned().references('users.id').onDelete('SET NULL'); // vide : rendu au responsable
    t.string('reason', 1000).notNullable();
    t.string('status', 12).notNullable().defaultTo('en_attente'); // en_attente, validee, refusee, annulee
    t.integer('requested_by').unsigned().references('users.id').onDelete('SET NULL');
    t.integer('decided_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('decided_at');
    t.string('decision_note', 1000);
    t.timestamps(true, true);
    t.index(['status']);
    t.index(['lead_id']);
  });

  const perms = await knex('role_permissions').select('role', 'permission');
  const byRole = {};
  for (const p of perms) (byRole[p.role] = byRole[p.role] || new Set()).add(p.permission);
  for (const [role, set] of Object.entries(byRole)) {
    // Comptes qui consultent des clients sans portefeuille (comptabilité, conducteur…) : portée équipe, comme avant
    if (!set.has('leads:write') && !set.has('leads:all') && CLIENT_VIEW.some(p => set.has(p))) await grant(knex, role, 'leads:all');
    if (set.has('leads:all') && set.has('leads:write')) await grant(knex, role, 'leads:assign');
  }
  await grant(knex, 'resp_exploitation', 'leads:assign');
};

exports.down = async knex => {
  await knex('role_permissions').where({ permission: 'leads:assign' }).del();
  if (await knex.schema.hasTable('user_permissions')) await knex('user_permissions').where({ permission: 'leads:assign' }).del();
  await knex.schema.dropTableIfExists('lead_transfer_requests');
};
