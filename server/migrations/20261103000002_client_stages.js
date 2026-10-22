/**
 * Prospect OU client : une personne arrivée au paiement (ou au-delà) sans code client le reçoit,
 * dans l'ordre de création des fiches, et sa conversion est inscrite au portefeuille de son commercial.
 * Désormais c'est automatique (services/portfolio.js › syncLead) ; cette migration rattrape l'existant.
 * Pas de retour arrière : un code client attribué n'est jamais repris.
 */
const { CLIENT_STAGES } = require('../src/lib/domain');
const { syncLead } = require('../src/services/portfolio');

exports.up = async function (knex) {
  const ids = await knex('leads').whereNull('client_code').whereIn('stage', CLIENT_STAGES).orderBy(['created_at', 'id']).pluck('id');
  for (const id of ids) await syncLead(knex, id);
};

exports.down = async function () {};
