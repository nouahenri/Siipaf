/**
 * Privilèges détaillés de l'ERP (suite du 30/10) : Ressources humaines. Rien ne change pour personne : tout rôle ou compte qui
 * avait l'ancien privilège reçoit toutes ses actions (aussi un privilège individuel retiré).
 * - rh:files → rh:files + rh:documents_write + rh:career + rh:pin ;
 * - conges:manage → conges:enter + conges:adjust + conges:cancel ;
 * - presence:write → presence:sheets + presence:kiosk + presence:correct ;
 * - recrutement:write → recrutement:jobs + :applicants + :hire + :delete ;
 * - formation:write → formation:skills + :plan + :complete ; evaluation:write → evaluation:objectives + :reviews ;
 * - kpi:write → kpi:indicators + :templates + :department ; rh:settings → rh:rules + :positions + :heads + :holidays.
 * Copie figée de PERMISSION_SPLITS (lib/domain.js).
 */
const { expand, collapse } = require('../src/lib/splitMigration');

const SPLITS = {
  'rh:files': ['rh:files', 'rh:documents_write', 'rh:career', 'rh:pin'],
  'conges:manage': ['conges:enter', 'conges:adjust', 'conges:cancel'],
  'presence:write': ['presence:sheets', 'presence:kiosk', 'presence:correct'],
  'recrutement:write': ['recrutement:jobs', 'recrutement:applicants', 'recrutement:hire', 'recrutement:delete'],
  'formation:write': ['formation:skills', 'formation:plan', 'formation:complete'],
  'evaluation:write': ['evaluation:objectives', 'evaluation:reviews'],
  'kpi:write': ['kpi:indicators', 'kpi:templates', 'kpi:department'],
  'rh:settings': ['rh:rules', 'rh:positions', 'rh:heads', 'rh:holidays'],
};

exports.up = knex => expand(knex, SPLITS);
exports.down = knex => collapse(knex, SPLITS);
