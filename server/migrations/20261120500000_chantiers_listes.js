/**
 * ERP · Chantiers : listes réglables dans Chantiers › Réglages (demande du client du 24/10) — météo du journal et
 * postes du budget. Les codes déjà enregistrés sur les pièces restent les mêmes ; les postes utilisés par les calculs
 * des coûts réels (matériaux, main-d'œuvre, sous-traitance, engins, frais) sont « système » : renommables, jamais
 * supprimés ni désactivés.
 */
const POSTES = [
  ['materiaux', 'Matériaux', true], ['main_oeuvre', 'Main-d’œuvre', true], ['sous_traitance', 'Sous-traitance', true],
  ['engins', 'Engins et matériel', true], ['frais', 'Frais de chantier', true], ['autre', 'Autre', false],
];
const METEO = [['soleil', 'Ensoleillé'], ['nuageux', 'Nuageux'], ['pluie', 'Pluie'], ['orage', 'Orage / intempéries']];

exports.up = async function (knex) {
  await knex.schema.createTable('worksite_ref_items', t => {
    t.increments('id');
    t.string('kind', 10).notNullable(); // poste, meteo
    t.string('code', 30).notNullable(); // valeur enregistrée sur les pièces
    t.string('label', 120).notNullable();
    t.boolean('system').notNullable().defaultTo(false);
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('sort').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.unique(['kind', 'code']);
  });
  await knex('worksite_ref_items').insert([
    ...POSTES.map(([code, label, system], sort) => ({ kind: 'poste', code, label, system, sort })),
    ...METEO.map(([code, label], sort) => ({ kind: 'meteo', code, label, system: false, sort })),
  ]);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('worksite_ref_items');
};
