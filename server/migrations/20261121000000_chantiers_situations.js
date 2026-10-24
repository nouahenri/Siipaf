/**
 * ERP · Chantiers, lot 4 (choix du client du 24/10) : situations de travaux des sous-traitants. Le marché est un
 * contrat de sorte « sous-traitance » rattaché au chantier (table contracts, même liste que l'Administration et le
 * Juridique). Une situation déclare l'avancement cumulé ; vérifiée par le conducteur puis validée par la Direction, elle
 * devient une facture d'achat en brouillon (Comptabilité) et alimente la retenue de garantie du marché (Juridique).
 * Colonnes sans clé étrangère vers les tables récentes (règle SQLite des migrations du projet).
 */
exports.up = async function (knex) {
  await knex.schema.createTable('worksite_situations', t => {
    t.increments('id');
    t.integer('contract_id').unsigned().notNullable().references('contracts.id').onDelete('CASCADE');
    t.integer('worksite_id').unsigned().notNullable().references('worksites.id').onDelete('CASCADE');
    t.integer('number').unsigned().notNullable(); // n° de la situation dans le marché
    t.date('period_end').notNullable(); // travaux arrêtés au
    t.decimal('cumulative_pct', 6, 2); // avancement cumulé déclaré (si le marché a un montant)
    t.bigInteger('cumulative_amount').notNullable(); // travaux cumulés HT
    t.bigInteger('previous_amount').notNullable().defaultTo(0); // cumul HT des situations validées avant celle-ci
    t.bigInteger('amount_ht').notNullable(); // travaux de la période HT
    t.decimal('vat_rate', 5, 2).notNullable().defaultTo(0);
    t.bigInteger('vat_amount').notNullable().defaultTo(0);
    t.bigInteger('amount_ttc').notNullable();
    t.decimal('retention_pct', 5, 2).notNullable().defaultTo(0);
    t.bigInteger('retention_amount').notNullable().defaultTo(0); // retenue de garantie sur le TTC de la période
    t.bigInteger('net_payable').notNullable(); // TTC − retenue
    t.string('status', 10).notNullable().defaultTo('brouillon'); // brouillon, verifiee, validee, refusee
    t.text('note');
    t.string('refusal_reason', 500);
    t.string('file_filename', 120); // situation remise par le sous-traitant
    t.string('file_name', 255);
    t.string('file_mime', 60);
    t.integer('purchase_invoice_id').unsigned();
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.integer('verified_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('verified_at');
    t.integer('validated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('validated_at');
    t.timestamps(true, true);
    t.unique(['contract_id', 'number']);
    t.index(['worksite_id', 'status']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('worksite_situations');
};
