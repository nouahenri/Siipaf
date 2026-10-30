/**
 * Privilèges détaillés de l'ERP (suite du 30/10) : Comptabilité et Paie. Rien ne change pour personne : tout rôle ou compte
 * qui avait l'ancien privilège reçoit toutes ses actions (aussi un privilège individuel retiré).
 * - compta:entries → + compta:sync, compta:import, compta:assets ; compta:validate → + compta:reverse ;
 * - achats:write → suppliers:write + achats:write + achats:validate ; achats:pay → + achats:advance ; frais:post → + frais:reimburse ;
 * - compta:close → compta:years + compta:lock + compta:opening + compta:close ; compta:settings → compta:plan + compta:settings ;
 * - paie:employees → + paie:salary ; paie:prepare → + paie:inputs.
 * Copie figée de PERMISSION_SPLITS (lib/domain.js).
 */
const { expand, collapse } = require('../src/lib/splitMigration');

const SPLITS = {
  'compta:entries': ['compta:entries', 'compta:sync', 'compta:import', 'compta:assets'],
  'compta:validate': ['compta:validate', 'compta:reverse'],
  'achats:write': ['suppliers:write', 'achats:write', 'achats:validate'],
  'achats:pay': ['achats:pay', 'achats:advance'],
  'frais:post': ['frais:post', 'frais:reimburse'],
  'compta:close': ['compta:years', 'compta:lock', 'compta:opening', 'compta:close'],
  'compta:settings': ['compta:plan', 'compta:settings'],
  'paie:employees': ['paie:employees', 'paie:salary'],
  'paie:prepare': ['paie:prepare', 'paie:inputs'],
};

exports.up = knex => expand(knex, SPLITS);
// achats:validate existait avant ce découpage (20261130700000) : il ne se replie pas dans achats:write au retour arrière
exports.down = knex => collapse(knex, { ...SPLITS, 'achats:write': ['suppliers:write', 'achats:write'] });
