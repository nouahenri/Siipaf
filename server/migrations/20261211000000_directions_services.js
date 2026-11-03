/**
 * Directions et services administrables (demande du client du 03/11) : la liste des services n'est plus codée en dur
 * (lib/paie DEPARTMENTS) mais tenue dans RH › Réglages et Administration générale › Réglages. Deux niveaux : une direction
 * regroupe des services ; un employé appartient à un service. La clé d'un service reste celle rangée partout ailleurs
 * (employees.department, hr_positions.department, courrier, demandes, objectifs…) : les 9 services existants gardent la leur.
 * Chaque service peut être rattaché à un module de l'ERP (« Demandes du service » dans son menu).
 * Regroupement de départ proposé, à valider par le client (choix du 03/11).
 * Privilège « Directions et services » (org:structure) : responsable des exploitations et rôles qui désignent les chefs de
 * service (rh:heads), comme les droits par défaut du code.
 */
const DIRECTIONS = [
  ['dir-generale', 'Direction générale'],
  ['dir-admin-fin', 'Direction administrative et financière'],
  ['dir-commerciale', 'Direction commerciale'],
  ['dir-technique', 'Direction technique'],
];
// [clé, libellé, direction, module de l'ERP]
const SERVICES = [
  ['direction', 'Direction', 'dir-generale', null],
  ['juridique', 'Juridique', 'dir-generale', 'juridique'],
  ['comptabilite', 'Comptabilité', 'dir-admin-fin', 'compta'],
  ['rh', 'Ressources humaines', 'dir-admin-fin', 'rh'],
  ['administratif', 'Administratif', 'dir-admin-fin', 'administration'],
  ['commercial', 'Commercial', 'dir-commerciale', 'commercial'],
  ['sav', 'Client & SAV', 'dir-commerciale', 'sav'],
  ['technique', 'Technique / bureau d’études', 'dir-technique', null],
  ['chantier', 'Chantier', 'dir-technique', null],
];

exports.up = async function (knex) {
  await knex.schema.createTable('org_units', t => {
    t.increments('id');
    t.string('key', 20).notNullable().unique(); // rangée dans les autres tables (department) : ne change jamais
    t.string('label', 80).notNullable();
    t.string('kind', 10).notNullable(); // direction | service
    t.integer('parent_id').unsigned().references('id').inTable('org_units').onDelete('SET NULL'); // direction d'un service
    t.string('module', 30); // module de l'ERP du service (Demandes du service)
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('sort').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });
  const ids = {};
  for (const [i, [key, label]] of DIRECTIONS.entries()) {
    const [id] = await knex('org_units').insert({ key, label, kind: 'direction', sort: i + 1 }).returning('id');
    ids[key] = typeof id === 'object' ? id.id : id;
  }
  for (const [i, [key, label, direction, module]] of SERVICES.entries()) {
    await knex('org_units').insert({ key, label, kind: 'service', parent_id: ids[direction], module, sort: i + 1 });
  }
  // Services déjà rangés hors des 9 clés (données anciennes) : repris tels quels, sans direction
  const known = new Set(SERVICES.map(s => s[0]));
  const extra = new Set();
  for (const table of ['employees', 'hr_positions', 'hr_jobs']) {
    if (await knex.schema.hasTable(table)) for (const k of await knex(table).distinct('department').pluck('department')) if (k && !known.has(k)) extra.add(k);
  }
  for (const key of extra) await knex('org_units').insert({ key: String(key).slice(0, 20), label: String(key), kind: 'service', sort: 100 });

  if (!(await knex.schema.hasTable('role_permissions'))) return;
  const roles = await knex('role_permissions').where({ permission: 'rh:heads' }).distinct('role').pluck('role');
  for (const role of new Set([...roles, 'resp_exploitation'])) {
    if (!(await knex('role_permissions').where({ role }).first())) continue; // rôle encore sur ses droits par défaut
    if (!(await knex('role_permissions').where({ role, permission: 'org:structure' }).first())) await knex('role_permissions').insert({ role, permission: 'org:structure' });
  }
};

exports.down = async function (knex) {
  for (const table of ['role_permissions', 'user_permissions']) {
    if (await knex.schema.hasTable(table)) await knex(table).where({ permission: 'org:structure' }).del();
  }
  await knex.schema.dropTableIfExists('org_units');
};
