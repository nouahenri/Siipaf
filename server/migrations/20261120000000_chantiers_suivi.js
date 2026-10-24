/**
 * ERP · Chantiers, lot 3 : journal quotidien (météo, effectif, travaux, incidents, photos), étapes de chantier
 * signalées par le conducteur et déclarées par la Direction seule (choix du client du 24/10 : seule la déclaration
 * émet les appels de fonds VEFA), date de livraison promise à l'acquéreur (retards prévus signalés).
 * Colonnes ajoutées sans clé étrangère (règle SQLite des migrations du projet).
 */
const { isoDay } = require('../src/lib/http');

// Étapes du journal de chantier, figées à la date de la migration
const SITE_STAGES = ['etudes', 'terrassement', 'vrd', 'fondations', 'gros_oeuvre', 'toiture', 'second_oeuvre', 'finitions', 'livraison'];
const file = t => { t.string('file_filename', 120); t.string('file_name', 255); t.string('file_mime', 60); };

/**
 * Reprise : avant ce lot, un point d'avancement publié valait constat (une étape était achevée quand le chantier
 * était passé à la suivante). Pour chaque portée (programme, îlot, lot), l'étape qui précède la plus avancée publiée
 * est enregistrée comme déclarée : les nouveaux dossiers VEFA reçoivent les mêmes appels qu'avant.
 */
async function reprise(knex) {
  const updates = await knex('site_updates').select('project_id', 'ilot', 'lot_id', 'stage', 'published_at');
  const scopes = new Map();
  for (const u of updates) {
    const k = `${u.project_id}|${u.ilot || ''}|${u.lot_id || ''}`;
    const cur = scopes.get(k);
    if (!cur || SITE_STAGES.indexOf(u.stage) > SITE_STAGES.indexOf(cur.stage)) scopes.set(k, u);
  }
  let n = 0;
  for (const u of scopes.values()) {
    const i = SITE_STAGES.indexOf(u.stage);
    if (i < 1) continue;
    await knex('stage_declarations').insert({
      project_id: u.project_id, ilot: u.lot_id ? null : u.ilot || null, lot_id: u.lot_id || null, stage: SITE_STAGES[i - 1],
      reached_on: isoDay(u.published_at) || isoDay(new Date()), status: 'declaree',
      note: 'Reprise des points d’avancement publiés avant la déclaration par la Direction',
    });
    n++;
  }
  return n;
}

exports.up = async function (knex) {
  await knex.schema.createTable('worksite_journal', t => {
    t.increments('id');
    t.integer('worksite_id').unsigned().notNullable().references('worksites.id').onDelete('CASCADE');
    t.date('day').notNullable();
    t.string('weather', 12); // soleil, nuageux, pluie, orage
    t.integer('headcount').unsigned(); // effectif présent (ouvriers, sous-traitants compris)
    t.text('work_done');
    t.text('incidents');
    t.text('notes');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.unique(['worksite_id', 'day']);
  });
  await knex.schema.createTable('worksite_journal_files', t => {
    t.increments('id');
    t.integer('journal_id').unsigned().notNullable().references('worksite_journal.id').onDelete('CASCADE');
    file(t);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Étape atteinte : signalée par le conducteur, déclarée (ou refusée) par la Direction
  await knex.schema.createTable('stage_declarations', t => {
    t.increments('id');
    t.integer('project_id').unsigned().notNullable().references('projects.id').onDelete('CASCADE');
    t.integer('worksite_id').unsigned().references('worksites.id').onDelete('SET NULL'); // zone du chantier
    t.string('ilot', 40); // ou un îlot, un bâtiment, un lot du programme (sans chantier)
    t.integer('building_id').unsigned();
    t.integer('lot_id').unsigned();
    t.string('stage', 20).notNullable();
    t.date('reached_on').notNullable();
    t.string('status', 10).notNullable(); // signalee, declaree, refusee
    t.text('note');
    file(t); // attestation, PV ou photo
    t.integer('reported_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('reported_at');
    t.integer('declared_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('declared_at');
    t.string('refusal_reason', 500);
    t.integer('calls_count').unsigned().notNullable().defaultTo(0);
    t.bigInteger('calls_amount').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.index(['project_id', 'status']);
  });

  await knex.schema.alterTable('sales', t => { t.date('promised_delivery_on'); });
  await reprise(knex);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('sales', t => { t.dropColumn('promised_delivery_on'); });
  for (const table of ['stage_declarations', 'worksite_journal_files', 'worksite_journal']) await knex.schema.dropTableIfExists(table);
};

exports.reprise = reprise;
