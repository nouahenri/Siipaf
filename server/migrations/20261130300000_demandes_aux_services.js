/**
 * Demande adressée à un service (demande du client du 29/10) : l'employé choisit le service destinataire (RH,
 * Commercial, SAV, Comptabilité, Juridique, Administration générale) et l'objet ; la demande arrive directement au
 * service, sans accord du responsable, qui la traite dans son propre module (carte « Demandes reçues »). Une demande
 * à l'Administration générale suit les services généraux (Demandes internes › À traiter).
 */
exports.up = async knex => {
  await knex.schema.alterTable('internal_requests', t => { t.string('service', 20); });
};

exports.down = async knex => {
  await knex.schema.alterTable('internal_requests', t => { t.dropColumn('service'); });
};
