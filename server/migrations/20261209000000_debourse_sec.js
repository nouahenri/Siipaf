/**
 * Déboursé sec (ERP › Chantiers, docs/cadrage-debourse-sec.md, choix du client du 02/11/2026) : référentiels réglables
 * (ressources avec prix, ouvrages élémentaires et leur composition, modèles de bâtiment avec ratios) et estimations
 * (paramètres, quantités modifiables, prix figés au calcul). Référentiels de départ : dosages et ratios usuels du gros œuvre,
 * prix indicatifs du marché d'Abidjan À VÉRIFIER par SIIPAF (price_checked = false). Droit chantiers:estimate.
 * Colonnes ajoutées sans clé étrangère vers les tables existantes (règle SQLite des migrations du projet).
 */

// Ressources : code, nature, libellé, unité (liste « Unités » du module), prix unitaire FCFA, perte %
const RESOURCES = [
  ['CIM-42', 'materiau', 'Ciment CPJ 42,5 (sac de 50 kg)', 'sac', 5000, 3],
  ['SAB', 'materiau', 'Sable lagunaire ou de carrière', 'm3', 12000, 10],
  ['GRA', 'materiau', 'Gravier concassé 5/15 – 15/25', 'm3', 25000, 5],
  ['FER', 'materiau', 'Acier HA (fer à béton, toutes sections)', 'kg', 700, 7],
  ['FIL', 'materiau', 'Fil recuit', 'kg', 1500, 5],
  ['AGG-C15', 'materiau', 'Agglo creux de 15 (15 × 20 × 40)', 'u', 400, 5],
  ['AGG-P15', 'materiau', 'Agglo plein de 15', 'u', 450, 5],
  ['HOU-16', 'materiau', 'Hourdis de 16', 'u', 650, 5],
  ['COF', 'materiau', 'Bois de coffrage et d’étaiement (réemploi compris)', 'm2', 2500, 0],
  ['POLY', 'materiau', 'Film polyane', 'm2', 300, 10],
  ['EAU', 'materiau', 'Eau de gâchage', 'm3', 1000, 0],
  ['MOEL', 'materiau', 'Moellons ou tout-venant (hérisson)', 'm3', 15000, 5],
  ['CHARP', 'materiau', 'Charpente bois traitée (fourniture)', 'm2', 7000, 5],
  ['TOLE', 'materiau', 'Couverture bac aluminium', 'm2', 8500, 8],
  ['ETAN', 'materiau', 'Étanchéité bicouche (fourniture)', 'm2', 7500, 10],
  ['MO-MAC', 'main_oeuvre', 'Maçon qualifié', 'h', 1000, 0],
  ['MO-MAN', 'main_oeuvre', 'Manœuvre', 'h', 500, 0],
  ['MO-FER', 'main_oeuvre', 'Ferrailleur', 'h', 875, 0],
  ['MO-COF', 'main_oeuvre', 'Coffreur', 'h', 875, 0],
  ['MO-CHA', 'main_oeuvre', 'Charpentier-couvreur', 'h', 1000, 0],
  ['MO-ETA', 'main_oeuvre', 'Étancheur', 'h', 1000, 0],
  ['MAT-BET', 'materiel', 'Bétonnière (location, carburant compris)', 'j', 15000, 0],
  ['MAT-VIB', 'materiel', 'Vibreur à béton', 'j', 10000, 0],
  ['MAT-COMP', 'materiel', 'Compacteur (dame sauteuse)', 'j', 20000, 0],
];

// Béton armé dosé à 350 kg/m³ : 7 sacs, 0,4 m³ de sable, 0,8 m³ de gravier, 180 l d'eau ; acier, coffrage et temps selon l'élément
const ba = ({ fer, fil, cof, mac, ferr, coff, man, bet, vib }) => [
  ['CIM-42', 7], ['SAB', 0.4], ['GRA', 0.8], ['EAU', 0.18], ['FER', fer], ['FIL', fil], ['COF', cof],
  ['MO-MAC', mac], ['MO-FER', ferr], ['MO-COF', coff], ['MO-MAN', man], ['MAT-BET', bet], ['MAT-VIB', vib],
];
const maconnerie = agglo => [[agglo, 12.5], ['CIM-42', 0.12], ['SAB', 0.02], ['EAU', 0.005], ['MO-MAC', 1], ['MO-MAN', 1]];

// Ouvrages élémentaires : code, lot, libellé, unité, composition par unité d'ouvrage
const WORKS = [
  ['INST', 'installation', 'Installation de chantier et implantation', 'forfait', [['MO-MAC', 24], ['MO-MAN', 48], ['COF', 15]]],
  ['FOUI', 'terrassement', 'Fouilles en rigoles et en puits', 'm3', [['MO-MAN', 4]]],
  ['REMB', 'terrassement', 'Remblai compacté sous dallage', 'm3', [['MO-MAN', 1.5], ['MAT-COMP', 0.05]]],
  ['BPROP', 'fondations', 'Béton de propreté dosé à 150 kg/m³', 'm3', [['CIM-42', 3], ['SAB', 0.4], ['GRA', 0.8], ['EAU', 0.15], ['MO-MAC', 2], ['MO-MAN', 6], ['MAT-BET', 0.1]]],
  ['SEM', 'fondations', 'Béton armé des semelles (350 kg/m³)', 'm3', ba({ fer: 50, fil: 0.5, cof: 2, mac: 6, ferr: 5, coff: 3, man: 10, bet: 0.15, vib: 0.1 })],
  ['LONG', 'fondations', 'Béton armé des longrines et amorces de poteaux (350 kg/m³)', 'm3', ba({ fer: 90, fil: 1, cof: 8, mac: 8, ferr: 8, coff: 8, man: 12, bet: 0.15, vib: 0.1 })],
  ['SOUB', 'soubassement', 'Maçonnerie de soubassement en agglos pleins de 15', 'm2', maconnerie('AGG-P15')],
  ['DALL', 'soubassement', 'Hérisson et dallage en béton armé de 10 cm', 'm2', [['MOEL', 0.15], ['CIM-42', 0.6], ['SAB', 0.04], ['GRA', 0.08], ['EAU', 0.02], ['POLY', 1], ['FER', 3], ['MO-MAC', 1], ['MO-MAN', 2], ['MAT-BET', 0.01]]],
  ['MUR15', 'elevation', 'Maçonnerie d’agglos creux de 15', 'm2', maconnerie('AGG-C15')],
  ['POT', 'elevation', 'Béton armé des poteaux (350 kg/m³)', 'm3', ba({ fer: 120, fil: 1.2, cof: 10, mac: 10, ferr: 12, coff: 14, man: 14, bet: 0.2, vib: 0.15 })],
  ['CHAI', 'elevation', 'Béton armé des chaînages et linteaux (350 kg/m³)', 'm3', ba({ fer: 100, fil: 1, cof: 9, mac: 10, ferr: 10, coff: 12, man: 14, bet: 0.2, vib: 0.15 })],
  ['POUT', 'planchers', 'Béton armé des poutres (350 kg/m³)', 'm3', ba({ fer: 110, fil: 1.1, cof: 10, mac: 10, ferr: 11, coff: 14, man: 14, bet: 0.2, vib: 0.15 })],
  ['PLAN', 'planchers', 'Plancher en corps creux 16 + 4', 'm2', [['HOU-16', 6.7], ['CIM-42', 0.6], ['SAB', 0.035], ['GRA', 0.07], ['EAU', 0.015], ['FER', 8], ['FIL', 0.1], ['COF', 1], ['MO-MAC', 1.2], ['MO-FER', 1], ['MO-COF', 1.2], ['MO-MAN', 2], ['MAT-BET', 0.02], ['MAT-VIB', 0.01]]],
  ['ESC', 'planchers', 'Béton armé des escaliers (350 kg/m³)', 'm3', ba({ fer: 100, fil: 1, cof: 12, mac: 12, ferr: 10, coff: 16, man: 14, bet: 0.2, vib: 0.15 })],
  ['ACRO', 'planchers', 'Acrotère en agglos de 15 et chaînage', 'ml', [['AGG-C15', 7.5], ['CIM-42', 0.25], ['SAB', 0.03], ['GRA', 0.03], ['EAU', 0.01], ['FER', 3], ['COF', 0.5], ['MO-MAC', 1], ['MO-MAN', 1]]],
  ['COUV', 'toiture', 'Charpente bois et couverture bac aluminium', 'm2', [['CHARP', 1], ['TOLE', 1.1], ['MO-CHA', 1]]],
  ['ETAN', 'toiture', 'Étanchéité de toiture-terrasse', 'm2', [['ETAN', 1], ['MO-ETA', 0.4]]],
];

// Modèles de bâtiment : libellé, type de bien (Paramètres du dashboard), paramètres par défaut, toiture comptée, lignes [ouvrage, base, ratio]
const fondations = (fouille, semelles, longrines) => [
  ['INST', 'forfait', 1], ['FOUI', 'lineaire_fondations', fouille], ['REMB', 'emprise', 0.25], ['BPROP', 'lineaire_fondations', 0.03],
  ['SEM', 'lineaire_fondations', semelles], ['LONG', 'lineaire_fondations', longrines], ['SOUB', 'lineaire_fondations', 0.6], ['DALL', 'emprise', 1],
];
const MODELS = [
  ['Villa basse', 'Villa basse', 'Plain-pied, toiture en charpente bois et bac aluminium (cochée par défaut)',
    { surface: 120, emprise: 140, perimetre: 48, murs_interieurs: 36, hauteur: 3, niveaux: 1, ouvertures: 20, logements: 1 }, true,
    [...fondations(0.4, 0.12, 0.05), ['MUR15', 'surface_murs', 1], ['POT', 'surface', 0.012], ['CHAI', 'lineaire_murs', 0.05], ['COUV', 'toit', 1.15]]],
  ['Duplex (R+1)', 'Duplex', 'Deux niveaux, plancher intermédiaire et dalle de toiture en corps creux, étanchéité de la terrasse en option',
    { surface: 180, emprise: 100, perimetre: 42, murs_interieurs: 32, hauteur: 3, niveaux: 2, ouvertures: 20, logements: 1 }, true,
    [...fondations(0.45, 0.15, 0.05), ['MUR15', 'surface_murs', 1], ['POT', 'surface', 0.015], ['CHAI', 'lineaire_murs', 0.05],
      ['POUT', 'planchers_intermediaires', 0.02], ['POUT', 'toit', 0.02], ['PLAN', 'planchers_intermediaires', 1], ['PLAN', 'toit', 1], ['ESC', 'niveaux_sup', 1.8], ['ACRO', 'perimetre_toit', 1], ['ETAN', 'toit', 1]]],
  ['Immeuble d’appartements (R+3)', 'Appartement', 'Bâtiment de 4 niveaux et 12 logements ; le coût par logement divise le total par le nombre de logements',
    { surface: 1200, emprise: 300, perimetre: 80, murs_interieurs: 120, hauteur: 3, niveaux: 4, ouvertures: 25, logements: 12 }, true,
    [['INST', 'forfait', 3], ['FOUI', 'lineaire_fondations', 0.6], ['REMB', 'emprise', 0.25], ['BPROP', 'lineaire_fondations', 0.04],
      ['SEM', 'lineaire_fondations', 0.2], ['LONG', 'lineaire_fondations', 0.06], ['SOUB', 'lineaire_fondations', 0.6], ['DALL', 'emprise', 1],
      ['MUR15', 'surface_murs', 1], ['POT', 'surface', 0.025], ['CHAI', 'lineaire_murs', 0.05], ['POUT', 'planchers_intermediaires', 0.025],
      ['POUT', 'toit', 0.025], ['PLAN', 'planchers_intermediaires', 1],
      ['PLAN', 'toit', 1], ['ESC', 'niveaux_sup', 2], ['ACRO', 'perimetre_toit', 1], ['ETAN', 'toit', 1]]],
];

const insertedId = r => (typeof r === 'object' ? r.id : r);

exports.up = async function (knex) {
  await knex.schema.createTable('debourse_resources', t => {
    t.increments('id');
    t.string('code', 30).notNullable().unique();
    t.string('nature', 12).notNullable(); // materiau, main_oeuvre, materiel
    t.string('label', 160).notNullable();
    t.string('unit', 30).notNullable(); // code de la liste « Unités » du module
    t.bigInteger('unit_price_fcfa').notNullable().defaultTo(0);
    t.decimal('loss_pct', 5, 2).notNullable().defaultTo(0);
    t.integer('article_id').unsigned(); // article du catalogue Achats (dernier prix d'achat proposé)
    t.boolean('price_checked').notNullable().defaultTo(false); // prix vérifié par SIIPAF (sinon « à vérifier »)
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('sort').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });
  await knex.schema.createTable('debourse_works', t => {
    t.increments('id');
    t.string('code', 30).notNullable().unique();
    t.string('lot', 20).notNullable();
    t.string('label', 200).notNullable();
    t.string('unit', 30).notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('sort').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });
  await knex.schema.createTable('debourse_work_items', t => {
    t.increments('id');
    t.integer('work_id').unsigned().notNullable().references('debourse_works.id').onDelete('CASCADE');
    t.integer('resource_id').unsigned().notNullable().references('debourse_resources.id').onDelete('RESTRICT');
    t.decimal('quantity', 14, 4).notNullable();
    t.unique(['work_id', 'resource_id']);
  });
  await knex.schema.createTable('debourse_models', t => {
    t.increments('id');
    t.string('label', 160).notNullable();
    t.integer('property_type_id').unsigned(); // type de bien (ref_items du dashboard)
    t.string('description', 500);
    t.text('params').notNullable(); // paramètres par défaut (JSON)
    t.boolean('with_roof').notNullable().defaultTo(false);
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('sort').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });
  await knex.schema.createTable('debourse_model_lines', t => {
    t.increments('id');
    t.integer('model_id').unsigned().notNullable().references('debourse_models.id').onDelete('CASCADE');
    t.integer('work_id').unsigned().notNullable().references('debourse_works.id').onDelete('RESTRICT');
    t.string('base', 30).notNullable();
    t.decimal('ratio', 14, 4).notNullable();
    t.integer('sort').notNullable().defaultTo(0);
  });
  await knex.schema.createTable('debourse_estimates', t => {
    t.increments('id');
    t.string('reference', 20).notNullable().unique(); // EST-2026-0001
    t.string('label', 200).notNullable();
    t.integer('model_id').unsigned(); // modèle de départ (gardé pour mémoire)
    t.integer('property_type_id').unsigned();
    t.integer('project_id').unsigned();
    t.integer('worksite_id').unsigned();
    t.text('params').notNullable(); // JSON
    t.integer('units').notNullable().defaultTo(1); // bâtiments identiques
    t.boolean('with_roof').notNullable().defaultTo(false);
    t.decimal('site_pct', 5, 2).notNullable().defaultTo(0);
    t.decimal('contingency_pct', 5, 2).notNullable().defaultTo(0);
    t.text('lines').notNullable(); // JSON : ouvrages, quantité calculée et retenue, composition aux prix figés
    t.datetime('priced_at').notNullable();
    t.string('notes', 1000);
    t.integer('budget_worksite_id').unsigned(); // chantier dont le budget a reçu l'estimation
    t.datetime('budget_at');
    t.integer('created_by').unsigned();
    t.integer('updated_by').unsigned();
    t.timestamps(true, true);
  });

  // Unités des ressources : heure et jour s'ajoutent à la liste « Unités » du module
  const lastUnit = await knex('worksite_ref_items').where({ kind: 'unite' }).max({ s: 'sort' }).first();
  let sort = Number(lastUnit?.s || 0);
  for (const [code, label] of [['h', 'Heure'], ['j', 'Jour']]) {
    if (!(await knex('worksite_ref_items').where({ kind: 'unite', code }).first())) await knex('worksite_ref_items').insert({ kind: 'unite', code, label, system: false, sort: ++sort });
  }

  const res = {};
  for (const [i, [code, nature, label, unit, price, loss]] of RESOURCES.entries()) {
    res[code] = insertedId((await knex('debourse_resources').insert({ code, nature, label, unit, unit_price_fcfa: price, loss_pct: loss, sort: i + 1 }))[0]);
  }
  const works = {};
  for (const [i, [code, lot, label, unit, items]] of WORKS.entries()) {
    works[code] = insertedId((await knex('debourse_works').insert({ code, lot, label, unit, sort: i + 1 }))[0]);
    for (const [r, quantity] of items) await knex('debourse_work_items').insert({ work_id: works[code], resource_id: res[r], quantity });
  }
  for (const [i, [label, typeLabel, description, params, withRoof, lines]] of MODELS.entries()) {
    const type = await knex('ref_items').where({ kind: 'type_bien', label: typeLabel }).first('id');
    const id = insertedId((await knex('debourse_models').insert({ label, property_type_id: type?.id || null, description, params: JSON.stringify(params), with_roof: withRoof, sort: i + 1 }))[0]);
    for (const [j, [w, base, ratio]] of lines.entries()) await knex('debourse_model_lines').insert({ model_id: id, work_id: works[w], base, ratio, sort: j + 1 });
  }

  // Droit « Estimer le déboursé sec » : rôles qui gèrent déjà le budget des chantiers
  if (!(await knex.schema.hasTable('role_permissions'))) return;
  for (const { role } of await knex('role_permissions').where({ permission: 'chantiers:budget' }).distinct('role')) {
    if (!(await knex('role_permissions').where({ role, permission: 'chantiers:estimate' }).first())) await knex('role_permissions').insert({ role, permission: 'chantiers:estimate' });
  }
};

exports.down = async function (knex) {
  for (const t of ['debourse_estimates', 'debourse_model_lines', 'debourse_models', 'debourse_work_items', 'debourse_works', 'debourse_resources']) await knex.schema.dropTableIfExists(t);
  await knex('worksite_ref_items').where({ kind: 'unite' }).whereIn('code', ['h', 'j']).del();
  for (const table of ['role_permissions', 'user_permissions']) {
    if (await knex.schema.hasTable(table)) await knex(table).where({ permission: 'chantiers:estimate' }).del();
  }
};
