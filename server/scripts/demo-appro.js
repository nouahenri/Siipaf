/** Données propres à Achats & stocks ; refuse toute base autre qu'une base de démonstration SQLite. */
const path = require('path');
const filename = path.resolve(__dirname, '..', process.env.DB_FILENAME || '');
if (process.env.DB_CLIENT !== 'sqlite' || path.dirname(filename).toLowerCase() !== path.resolve(__dirname, '..', 'data').toLowerCase() || !/^demo[\w-]*\.sqlite$/i.test(path.basename(filename))) {
  console.error('Réservé à DB_CLIENT=sqlite et DB_FILENAME=./data/demo*.sqlite.'); process.exit(1);
}
process.env.SMTP_HOST = ''; process.env.SMTP_USER = '';
const { getDb } = require('../src/db');
const appro = require('../src/services/appro');
const { effectivePermissions, hasPermission } = require('../src/services/permissions');
(async () => {
  const db = getDb();
  try {
    await db.migrate.latest();
    if (await db('appro_articles').where({ code: 'CIM-DEMO' }).first()) { console.log('Données Achats & stocks déjà présentes ; aucune donnée remplacée.'); return; }
    await db.transaction(async trx => {
      const admin = await trx('users').where({ role: 'super_admin', active: true }).first();
      const buyer = await trx('users').whereIn('role', ['comptable', 'conducteur_travaux']).where({ active: true }).first() || admin;
      const permissions = await effectivePermissions(trx, buyer), actor = { userId: buyer.id, can: p => hasPermission(permissions, p) };
      const supplier = await trx('suppliers').where({ active: true, kind: 'fournisseur' }).first();
      const place = await trx('places').where({ active: true }).orderBy('id').first();
      const worksite = await trx('worksites').whereNot({ status: 'clos' }).first();
      const units = await trx('worksite_ref_items').where({ kind: 'unite', active: true });
      if (!admin || !supplier || !place || !units.length) throw new Error('Compte admin, fournisseur, lieu et unités existants requis ; aucun n’est créé dans les anciens modules.');
      const choose = pattern => (units.find(u => pattern.test(u.code + ' ' + u.label)) || units[0]).code;
      const a = await appro.saveArticle(trx, { code: 'CIM-DEMO', label: 'Ciment CPJ — démonstration', unit: choose(/sac/i), min_quantity: 10, active: true }, null, admin.id);
      const b = await appro.saveArticle(trx, { code: 'ACI-DEMO', label: 'Acier de construction — démonstration', unit: choose(/tonne/i), min_quantity: 5, active: true }, null, admin.id);
      let loc = (await appro.locations(trx)).find(l => l.place_id === place.id);
      if (!loc) loc = await appro.createLocation(trx, { place_id: place.id }, admin.id);
      if (worksite && !(await appro.locations(trx)).some(l => l.worksite_id === worksite.id)) await appro.createLocation(trx, { worksite_id: worksite.id }, admin.id);
      const date = new Date().toISOString().slice(0, 10);
      const initial = await appro.saveMovement(trx, { kind: 'entree', to_location_id: loc.id, date, note: 'Démonstration Achats & stocks — stock initial', lines: [{ article_id: a.id, quantity: 30 }, { article_id: b.id, quantity: 2 }] }, null, admin.id);
      await appro.postMovement(trx, initial.id, admin.id);
      const quote = await appro.saveDocument(trx, 'quote', { supplier_id: supplier.id, location_id: loc.id, date, vat_rate: 18, supplier_ref: 'DEV-DEMO-ACHATS', note: 'Démonstration Achats & stocks — devis fournisseur', lines: [{ article_id: a.id, quantity: 100, unit_price_fcfa: 5000 }] }, null, admin.id);
      await appro.receiveQuote(trx, quote.id, admin.id);
      const order = await appro.quoteToOrder(trx, quote.id, admin.id);
      await appro.approveOrder(trx, order.id, { userId: admin.id, can: () => true });
      await appro.receiveOrder(trx, order.id, { date, supplier_ref: 'BL-DEMO-ACHATS', note: 'Livraison partielle de démonstration', lines: [{ order_line_id: order.lines[0].id, quantity: 40 }] }, { userId: admin.id, can: () => true });
      const pending = await appro.saveDocument(trx, 'order', { supplier_id: supplier.id, location_id: loc.id, date, vat_rate: 18, note: 'Démonstration Achats & stocks — validation', lines: [{ article_id: b.id, quantity: 100, unit_price_fcfa: 25000 }] }, null, buyer.id);
      await appro.approveOrder(trx, pending.id, actor);
      console.log(`Démo Achats & stocks prête : ${order.reference}, ${pending.reference}, 2 articles, stock initial, livraison partielle. Aucune facture créée.`);
    });
  } finally { await db.destroy(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });

