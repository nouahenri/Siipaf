/**
 * ERP · Chantiers, lot 5 (choix du client du 25/10) : travaux modificatifs des acquéreurs (TMA), besoins en
 * matériaux, réception des lots (PV, réserves au SAV) et réception des travaux des marchés de sous-traitance
 * (point de départ de la libération des retenues). Colonnes sans clé étrangère vers les tables récentes (règle SQLite
 * des migrations du projet).
 */
const UNITES = [['u', 'Unité'], ['m2', 'm²'], ['m3', 'm³'], ['ml', 'Mètre linéaire'], ['kg', 'Kilogramme'], ['t', 'Tonne'], ['sac', 'Sac'], ['l', 'Litre'], ['forfait', 'Forfait']];

exports.up = async function (knex) {
  // TMA : demande (équipe ou acquéreur) → devis du conducteur → réponse de l'acquéreur dans son espace → réalisation
  await knex.schema.createTable('worksite_changes', t => {
    t.increments('id');
    t.string('reference', 20).notNullable().unique(); // TMA-2026-0001
    t.integer('sale_id').unsigned().notNullable();
    t.integer('lot_id').unsigned();
    t.integer('worksite_id').unsigned();
    t.string('title', 200).notNullable();
    t.text('description');
    t.string('source', 10).notNullable().defaultTo('equipe'); // equipe, client
    t.string('status', 12).notNullable().defaultTo('demandee'); // demandee, chiffree, acceptee, refusee, annulee, realisee
    t.bigInteger('amount_fcfa'); // devis TTC à la charge de l'acquéreur
    t.integer('delay_days').unsigned(); // délai de réalisation annoncé
    t.text('quote_note');
    t.integer('quoted_by').unsigned();
    t.timestamp('quoted_at');
    t.timestamp('answered_at');
    t.string('client_note', 500); // motif d'un refus de l'acquéreur
    t.date('due_date'); // échéance de paiement, fixée à l'acceptation
    t.date('done_on');
    t.string('file_filename', 120); // devis
    t.string('file_name', 255);
    t.string('file_mime', 60);
    t.integer('created_by').unsigned();
    t.timestamps(true, true);
    t.index(['sale_id', 'status']);
    t.index(['worksite_id', 'status']);
  });

  // Besoins en matériaux : demandé → validé → commandé → livré (repris par le futur module Achats & stocks)
  await knex.schema.createTable('worksite_needs', t => {
    t.increments('id');
    t.integer('worksite_id').unsigned().notNullable();
    t.integer('phase_id').unsigned();
    t.string('label', 200).notNullable();
    t.decimal('quantity', 14, 2).notNullable();
    t.string('unit', 30).notNullable(); // code de la liste réglable « unite »
    t.date('needed_on');
    t.string('status', 10).notNullable().defaultTo('demande'); // demande, valide, refuse, commande, livre, annule
    t.integer('supplier_id').unsigned();
    t.bigInteger('estimate_fcfa');
    t.string('note', 1000);
    t.string('refusal_reason', 255);
    t.integer('requested_by').unsigned();
    t.integer('validated_by').unsigned();
    t.timestamp('validated_at');
    t.date('ordered_on');
    t.date('delivered_on');
    t.timestamps(true, true);
    t.index(['worksite_id', 'status']);
  });

  // Réception d'un lot (remise des clés) : un PV par dossier de vente ; les réserves vont dans sav_reserves
  await knex.schema.createTable('lot_handovers', t => {
    t.increments('id');
    t.integer('sale_id').unsigned().notNullable().unique();
    t.integer('worksite_id').unsigned();
    t.date('handed_on').notNullable();
    t.boolean('client_signed').notNullable().defaultTo(true);
    t.string('attendees', 255);
    t.text('note');
    t.string('file_filename', 120); // PV signé
    t.string('file_name', 255);
    t.string('file_mime', 60);
    t.integer('created_by').unsigned();
    t.timestamps(true, true);
  });

  // Appel de fonds émis par une déclaration d'étape (fiche détaillée de la déclaration)
  if (!(await knex.schema.hasColumn('fund_calls', 'declaration_id'))) {
    await knex.schema.alterTable('fund_calls', t => { t.integer('declaration_id').unsigned(); });
  }

  // Réception des travaux d'un marché de sous-traitance : départ du délai de garantie de la retenue
  if (!(await knex.schema.hasColumn('contracts', 'works_received_on'))) {
    await knex.schema.alterTable('contracts', t => { t.date('works_received_on'); });
  }

  const sort = Number((await knex('worksite_ref_items').where({ kind: 'unite' }).count({ n: '*' }).first()).n || 0);
  if (!sort) {
    await knex('worksite_ref_items').insert(UNITES.map(([code, label], i) => ({ kind: 'unite', code, label, system: false, active: true, sort: i })));
  }
};

exports.down = async function (knex) {
  await knex('worksite_ref_items').where({ kind: 'unite' }).del();
  if (await knex.schema.hasColumn('fund_calls', 'declaration_id')) await knex.schema.alterTable('fund_calls', t => { t.dropColumn('declaration_id'); });
  if (await knex.schema.hasColumn('contracts', 'works_received_on')) await knex.schema.alterTable('contracts', t => { t.dropColumn('works_received_on'); });
  await knex.schema.dropTableIfExists('lot_handovers');
  await knex.schema.dropTableIfExists('worksite_needs');
  await knex.schema.dropTableIfExists('worksite_changes');
};
