/**
 * Privilèges détaillés de l'ERP et du dashboard (suite du 30/10) : Administration générale, Juridique, Chantiers, Client & SAV,
 * Paramètres et échéanciers. Rien ne change pour personne : tout rôle ou compte qui avait l'ancien privilège reçoit toutes ses
 * actions (aussi un privilège individuel retiré).
 * - contrats:write → + contrats:close, contrats:documents ; parc:write → + parc:maintenance, parc:costs, parc:reservations ;
 *   demandes:handle → + demandes:view_all, demandes:invoice ;
 * - juridique:write → juridique:deeds + :litigation + :guarantees + :settings ;
 * - chantiers:write → chantiers:create + :plan + :budget + :settings + :tma ; chantiers:direction → chantiers:stages + :situations ;
 * - sav:handle → sav:edit + sav:status + sav:comment ; sav:reserves → sav:delivery + sav:reserves ;
 * - settings:write → settings:refs + settings:general ; schedule:write → schedule:generate + schedule:edit.
 * Copie figée de PERMISSION_SPLITS (lib/domain.js).
 */
const { expand, collapse } = require('../src/lib/splitMigration');

const SPLITS = {
  'contrats:write': ['contrats:write', 'contrats:close', 'contrats:documents'],
  'parc:write': ['parc:write', 'parc:maintenance', 'parc:costs', 'parc:reservations'],
  'demandes:handle': ['demandes:handle', 'demandes:view_all', 'demandes:invoice'],
  'juridique:write': ['juridique:deeds', 'juridique:litigation', 'juridique:guarantees', 'juridique:settings'],
  'chantiers:write': ['chantiers:create', 'chantiers:plan', 'chantiers:budget', 'chantiers:settings', 'chantiers:tma'],
  'chantiers:direction': ['chantiers:stages', 'chantiers:situations'],
  'sav:handle': ['sav:edit', 'sav:status', 'sav:comment'],
  'sav:reserves': ['sav:delivery', 'sav:reserves'],
  'settings:write': ['settings:refs', 'settings:general'],
  'schedule:write': ['schedule:generate', 'schedule:edit'],
};

exports.up = knex => expand(knex, SPLITS);
exports.down = knex => collapse(knex, SPLITS);
