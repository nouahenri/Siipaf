/**
 * Pièce jointe d'une facture d'achat (demande du client du 17/11) : la facture du fournisseur, en PDF ou en image,
 * déposée depuis le formulaire « Nouvelle facture d'achat ». Un seul fichier par facture, rangé hors de la partie
 * publique de /uploads (uploads/private/achats) et servi à ceux qui lisent la comptabilité.
 */
exports.up = async knex => {
  await knex.schema.alterTable('purchase_invoices', t => {
    t.string('document_filename', 120);
    t.string('document_name', 255);
    t.string('document_mime', 100);
    t.integer('document_size').unsigned();
  });
};

exports.down = async knex => {
  await knex.schema.alterTable('purchase_invoices', t => {
    t.dropColumn('document_filename');
    t.dropColumn('document_name');
    t.dropColumn('document_mime');
    t.dropColumn('document_size');
  });
};
