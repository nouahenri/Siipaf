/**
 * Type de la pièce d'identité de l'employé (demande du client du 03/11) : CNI, passeport, permis de conduire, carte consulaire,
 * titre de séjour, attestation d'identité, autre (liste ID_TYPES de lib/paie.js). Les fiches existantes restent sans type.
 */
exports.up = knex => knex.schema.alterTable('employees', t => { t.string('id_type', 20); });
exports.down = knex => knex.schema.alterTable('employees', t => { t.dropColumn('id_type'); });
