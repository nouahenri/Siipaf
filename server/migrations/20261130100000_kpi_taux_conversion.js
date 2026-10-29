/**
 * Indicateur « Taux de conversion (prospects devenus clients) » au référentiel KPI (demande du client du 29/10 : objectif
 * principal du Service commercial), placé en tête des indicateurs Commercial. Définition : lib/domain.js (conversionRate).
 */
exports.up = async knex => {
  if (await knex('hr_kpis').where({ metric: 'taux_conversion' }).first()) return;
  const first = await knex('hr_kpis').where({ family: 'Commercial' }).min({ s: 'sort' }).first();
  await knex('hr_kpis').insert({
    name: 'Taux de conversion (prospects devenus clients)', family: 'Commercial', metric: 'taux_conversion', level: 'tous', sort: (Number(first?.s) || 10) - 5,
    description: 'Nouveaux clients nets ÷ prospects reçus sur la période (attribués − transférés), en %. Objectif principal du Service commercial.',
  });
};

exports.down = async knex => {
  await knex('hr_kpis').where({ metric: 'taux_conversion' }).del();
};
