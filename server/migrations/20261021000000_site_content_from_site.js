/**
 * Reprend dans la base le diaporama (5 diapositives) et le bandeau (6 messages) affichés sur le site,
 * maintenant que le site public lit « Contenu du site ». Ne touche à rien si l'équipe a déjà modifié ces contenus.
 */
const { SLIDES, TICKER } = require('../src/lib/siteDefaults');

const read = async (knex, key) => {
  const row = await knex('site_content').where({ key }).first();
  if (!row) return null;
  return typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
};

exports.up = async function (knex) {
  const hero = await read(knex, 'hero');
  // Valeur de départ inchangée : une seule diapositive « Votre Réseau » sans image
  if (hero && hero.slides?.length === 1 && hero.slides[0].title === 'Votre Réseau' && !hero.slides[0].media_id) {
    await knex('site_content').where({ key: 'hero' }).update({ value: JSON.stringify({ ...hero, slides: SLIDES }), updated_at: knex.fn.now() });
  }
  const ticker = await read(knex, 'ticker');
  if (ticker && ticker.items?.length === 3 && ticker.items[0].text.startsWith('SIIPAF CITY YAMOUSSOUKRO')) {
    await knex('site_content').where({ key: 'ticker' }).update({ value: JSON.stringify({ items: TICKER }), updated_at: knex.fn.now() });
  }
};

exports.down = async function () {};
