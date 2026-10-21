/**
 * Portefeuille commercial : historique des attributions de prospects et de leurs issues (client, perte,
 * désistement, suppression), daté et rattaché au commercial du moment, pour compter prospects et clients par
 * commercial et par période sans réécrire le passé lors d'un transfert. Listes de prospects importées (un
 * fichier = une liste) avec leur bilan.
 * `lead_id` sans clé étrangère : l'historique d'un prospect supprimé est conservé (il compte en perte).
 */
exports.up = async function (knex) {
  await knex.schema.createTable('lead_imports', t => {
    t.increments('id');
    t.string('name', 160).notNullable();
    t.string('filename', 200);
    t.string('mode', 12).notNullable().defaultTo('prospects'); // prospects, clients
    t.integer('assigned_to').unsigned().references('users.id').onDelete('SET NULL'); // commercial attribué aux nouveaux
    t.integer('rows_total').unsigned().notNullable().defaultTo(0);
    t.integer('created_count').unsigned().notNullable().defaultTo(0);
    t.integer('duplicate_count').unsigned().notNullable().defaultTo(0); // déjà en base : déduits, non comptés comme nouveaux
    t.integer('error_count').unsigned().notNullable().defaultTo(0);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
  });
  await knex.schema.createTable('lead_import_items', t => {
    t.increments('id');
    t.integer('import_id').unsigned().notNullable().references('lead_imports.id').onDelete('CASCADE');
    t.integer('lead_id').unsigned().notNullable();
    t.boolean('duplicate').notNullable().defaultTo(false);
    t.integer('line').unsigned();
    t.unique(['import_id', 'lead_id']);
    t.index(['lead_id']);
  });
  await knex.schema.createTable('lead_portfolio_events', t => {
    t.increments('id');
    t.integer('lead_id').unsigned().notNullable();
    t.string('lead_name', 160);
    t.integer('user_id').unsigned().references('users.id').onDelete('SET NULL'); // commercial concerné (nul : non attribué)
    t.string('kind', 16).notNullable(); // attribution, retrait, client, desistement, perte, reprise, suppression
    t.string('reason', 16); // creation, import, attribution, transfert, retrait, reprise (données existantes)
    t.timestamp('at').notNullable();
    t.integer('import_id').unsigned();
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.index(['user_id', 'at']);
    t.index(['lead_id']);
  });

  // Reprise de l'existant (hypothèse validée par le client) : un prospect déjà attribué compte à sa date de
  // création ; un client à l'ouverture de son premier dossier (sinon à sa création) ; une perte à sa date.
  const ms = v => (v == null ? null : v instanceof Date ? v : new Date(typeof v === 'number' || /^\d+$/.test(String(v)) ? Number(v) : v));
  const leads = await knex('leads').select('id', 'name', 'assigned_to', 'client_code', 'stage', 'lost_at', 'created_at', 'updated_at');
  const sales = await knex('sales').select('lead_id', 'status', 'created_at', 'updated_at');
  const salesBy = {};
  for (const s of sales) (salesBy[s.lead_id] = salesBy[s.lead_id] || []).push(s);
  const rows = [];
  for (const l of leads) {
    const base = { lead_id: l.id, lead_name: l.name, user_id: l.assigned_to || null, reason: 'reprise' };
    const created = ms(l.created_at) || new Date();
    if (l.assigned_to) rows.push({ ...base, kind: 'attribution', at: created });
    const ss = salesBy[l.id] || [];
    if (l.client_code || ss.length) {
      const first = ss.map(s => ms(s.created_at)).filter(Boolean).sort((a, b) => a - b)[0];
      rows.push({ ...base, kind: 'client', at: first || created });
      if (ss.length && ss.every(s => s.status === 'desiste')) {
        const last = ss.map(s => ms(s.updated_at)).filter(Boolean).sort((a, b) => b - a)[0];
        rows.push({ ...base, kind: 'desistement', at: last || ms(l.updated_at) || created });
      }
    }
    if (l.stage === 'perdu') rows.push({ ...base, kind: 'perte', at: ms(l.lost_at) || ms(l.updated_at) || created });
  }
  for (let i = 0; i < rows.length; i += 200) await knex('lead_portfolio_events').insert(rows.slice(i, i + 200));
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('lead_portfolio_events');
  await knex.schema.dropTableIfExists('lead_import_items');
  await knex.schema.dropTableIfExists('lead_imports');
};
