/**
 * Privilèges détaillés de l'ERP (demande du client du 29/10, suite du 30/10) : Service commercial et Achats & stocks.
 * Rien ne change pour personne : tout rôle ou compte qui avait l'ancien privilège reçoit toutes ses actions
 * (aussi un privilège individuel retiré : le retrait s'applique aux nouvelles actions).
 * - leads:assign → leads:assign + leads:transfer_decide (valider ou refuser les demandes de transfert) ;
 * - property:write → property:buildings + property:lots ;
 * - vefa:write → vefa:read + vefa:write ;
 * - appro:write → appro:locations + appro:needs + appro:quotes + appro:orders ;
 * - appro:stock → appro:stock + appro:receive + appro:minimum.
 * Copie figée de PERMISSION_SPLITS (lib/domain.js).
 */
const { expand, collapse } = require('../src/lib/splitMigration');

const SPLITS = {
  'leads:assign': ['leads:assign', 'leads:transfer_decide'],
  'property:write': ['property:buildings', 'property:lots'],
  'vefa:write': ['vefa:read', 'vefa:write'],
  'appro:write': ['appro:locations', 'appro:needs', 'appro:quotes', 'appro:orders'],
  'appro:stock': ['appro:stock', 'appro:receive', 'appro:minimum'],
};

exports.up = knex => expand(knex, SPLITS);
exports.down = knex => collapse(knex, SPLITS);
