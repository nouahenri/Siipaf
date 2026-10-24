/**
 * Valeurs du site encore écrites dans projets.html, rendues réglables dans la fiche projet (demande du client du 24/10) :
 * chiffres clés du projet (« 59 ha · Superficie », « Rocade Y4 · Accès direct »), badge et points forts de chaque
 * ligne de la grille de prix (« Populaire », texte sous le prix). Reprise des valeurs affichées aujourd'hui pour les
 * fiches écrites du site (même identifiant de projet), seulement là où rien n'est encore saisi.
 */
const FIGURES = {
  yamoussoukro: [{ icon: 'surface', value: 'Plusieurs ha', label: 'Superficie' }, { icon: 'pourcentage', value: '30%', label: 'Apport min.' }],
  ahoutoue: [
    { icon: 'surface', value: '59 ha', label: 'Superficie' }, { icon: 'pourcentage', value: '30%', label: 'Apport min.' },
    { icon: 'acces', value: 'Rocade Y4', label: 'Accès direct' },
  ],
};
// [rang de la ligne dans la grille, badge, points forts]
const OFFERS = {
  bingerville: [[1, 'Populaire', null]],
  cly: [[2, 'Best Seller', null], [3, 'Exclusif', null]],
  riviera: [[0, null, 'Appartement haut standing 5 pièces — Marbre, vue dégagée, prestations exclusives']],
};

exports.up = async function (knex) {
  await knex.schema.alterTable('projects', t => { t.text('key_figures'); });
  await knex.schema.alterTable('project_offers', t => {
    t.string('badge', 40);
    t.text('highlights'); // une ligne par point fort
  });

  for (const [slug, figures] of Object.entries(FIGURES)) {
    await knex('projects').where({ slug }).whereNull('key_figures').update({ key_figures: JSON.stringify(figures) });
  }
  for (const [slug, rows] of Object.entries(OFFERS)) {
    const project = await knex('projects').where({ slug }).first('id');
    if (!project) continue;
    const offers = await knex('project_offers').where({ project_id: project.id }).orderBy('sort');
    for (const [rank, badge, highlights] of rows) {
      const o = offers[rank];
      if (!o) continue;
      await knex('project_offers').where({ id: o.id }).update({ badge, highlights });
    }
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('project_offers', t => { t.dropColumn('badge'); t.dropColumn('highlights'); });
  await knex.schema.alterTable('projects', t => { t.dropColumn('key_figures'); });
};
