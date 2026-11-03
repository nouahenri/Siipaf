const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { toDate } = require('../src/lib/http');
const settingsService = require('../src/services/marketingSettings');

// Rapports des tableaux de bord (Exporter, Imprimer) du Juridique et du Marketing & Communication : droits, structure,
// calculs de la période et exclusion des données hors période
let db, app, admin, juriste, commercial, comptable, ids, project, notary;
const R = '/api/admin/erp/rapports';
const J = '/api/admin/erp/juridique';
const MK = '/api/admin/erp/marketing';
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const insertedId = r => (typeof r === 'object' ? r.id : r);
const PERIOD = `du=${day(-30)}&au=${day(0)}`;
const value = (rep, re) => { const s = rep.summary.find(x => re.test(x.label)); assert.ok(s, `indicateur ${re}`); return s.value; };
const section = (rep, re) => { const s = rep.sections.find(x => re.test(x.title)); assert.ok(s, `section ${re}`); return s; };

/** Structure commune d'un rapport : titre, période, indicateurs, sections avec colonnes et lignes. */
function checkShape(rep, module) {
  assert.equal(rep.module, module);
  assert.ok(rep.title);
  assert.deepEqual(rep.period, { from: day(-30), to: day(0), label: `du ${day(-30).split('-').reverse().join('/')} au ${day(0).split('-').reverse().join('/')}` });
  assert.ok(rep.summary.length > 0 && rep.summary.every(s => s.label && s.format && s.value !== undefined));
  assert.ok(rep.sections.length > 0);
  for (const s of rep.sections) {
    assert.ok(s.title && s.columns.length && Array.isArray(s.rows), s.title);
    assert.ok(s.columns.every(c => c.key && c.label), s.title);
    for (const row of s.rows) assert.ok(Object.keys(row).every(k => s.columns.some(c => c.key === k)), `${s.title} : colonne inconnue`);
  }
  // Montants en francs CFA entiers
  for (const s of rep.summary.filter(x => x.format === 'fcfa')) assert.ok(Number.isInteger(s.value), s.label);
}

/** Dossier de vente sur un nouveau lot du programme (même méthode que test/juridique.test.js). */
async function openSale(code) {
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([...(await db('lots').where({ project_id: project.id }).select('code', 'price_fcfa')).map(l => ({ code: l.code, price_fcfa: Number(l.price_fcfa) })), { code, price_fcfa: 12000000 }]);
  const lot = await db('lots').where({ project_id: project.id, code }).first();
  const res = await admin.post(`/api/admin/lots/${lot.id}/sale`).send({ name: `Client ${code}`, phone: `+225 07 00 00 ${String(lot.id).padStart(2, '0')} 02`, email: `client.${code.toLowerCase()}@test.ci`, financing: 'diaspora' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}
async function steps(saleId, list) {
  for (const [key, date, extra = {}] of list) {
    const res = await juriste.post(`${J}/actes/${saleId}`).send({ key, date, ...extra });
    assert.equal(res.status, 200, `${key} : ${JSON.stringify(res.body)}`);
  }
}

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  juriste = await login(app, await createUser(db, 'conducteur_travaux'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  ids = Object.fromEntries((await db('users').select('id', 'role')).map(u => [u.role, u.id]));
  project = await db('projects').where({ slug: 'ahoutoue' }).first();
  notary = insertedId((await db('suppliers').insert({ name: 'Étude Maître Kouassi', kind: 'notaire' }))[0]);
});
after(() => db.destroy());

test('rapport du Juridique : droits du tableau de bord, actes, litiges et cautions de la période', async () => {
  // Acte signé dans la période (RJ1), acte signé hors période (RJ2), dossier à peine commencé (RJ3)
  const a = await openSale('RJ1');
  await steps(a.id, [['reservation', day(-20)], ['pieces', day(-15)], ['notaire', day(-10), { notary_supplier_id: notary }], ['projet', day(-3)], ['acte', day(-1), { deed_number: 'A-2026-1' }]]);
  const b = await openSale('RJ2');
  await steps(b.id, [['reservation', day(-90)], ['pieces', day(-85)], ['notaire', day(-80), { notary_supplier_id: notary }], ['projet', day(-70)], ['acte', day(-65)], ['remise', day(-60)]]);
  const c = await openSale('RJ3');
  await steps(c.id, [['reservation', day(-5)]]);

  // Litige ouvert dans la période ; litige ancien clos dans la période
  let res = await admin.post(`${J}/litiges`).send({ origin: 'fournisseur', title: 'Retard de livraison du ciment', opponent: 'Ciments du Sud', amount_fcfa: 3000000, opened_on: day(-5), owner_id: ids.conducteur_travaux });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const recent = res.body;
  res = await admin.post(`${J}/litiges`).send({ origin: 'autre', title: 'Bornage contesté', opponent: 'Voisin du programme', amount_fcfa: 1000000, opened_on: day(-100) });
  const old = res.body;
  res = await admin.post(`${J}/litiges/${old.id}/etapes`).send({ stage: 'clos', date: day(-2), outcome: 'transaction', note: 'Accord signé' });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  // Caution qui expire dans la période ; caution qui expire après
  const kinds = (await admin.get(`${J}/refs`)).body.guarantee_kinds;
  const bonne = kinds.find(k => k.label === 'Caution de bonne exécution');
  res = await admin.post(`${J}/cautions`).send({ kind_id: bonne.id, counterparty: 'BTP Ivoire', bank: 'SGBCI', amount_fcfa: 6000000, issued_on: day(-200), expires_on: day(-3) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const dueRef = res.body.reference;
  res = await admin.post(`${J}/cautions`).send({ kind_id: bonne.id, counterparty: 'Réseaux VRD', amount_fcfa: 4000000, issued_on: day(-10), expires_on: day(40) });
  const laterRef = res.body.reference;

  // Droits : ceux du tableau de bord (juriste, Direction) ; ni le commercial ni la Comptabilité
  assert.equal((await commercial.get(`${R}/juridique?${PERIOD}`)).status, 403);
  assert.equal((await comptable.get(`${R}/juridique?${PERIOD}`)).status, 403);
  res = await juriste.get(`${R}/juridique?${PERIOD}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const rep = res.body;
  checkShape(rep, 'juridique');
  assert.equal(rep.title, 'Juridique');

  const signed = section(rep, /^Actes signés/);
  assert.deepEqual(signed.rows.map(r => r.client), ['Client RJ1'], 'acte hors période exclu');
  assert.equal(signed.rows[0].date, day(-1));
  assert.equal(signed.rows[0].notaire, 'Étude Maître Kouassi');
  assert.equal(value(rep, /^Actes signés/), 1);
  assert.equal(value(rep, /^Valeur des ventes/), Number((await db('sales').where({ id: a.id }).first()).price_fcfa));
  assert.equal(value(rep, /^Expéditions/), 0, 'expédition de RJ2 remise hors période');
  const pending = section(rep, /^Ventes en cours jusqu’à l’acte au /);
  assert.match(pending.title, new RegExp(day(0).split('-').reverse().join('/')), 'indicateur à date libellé au jour de fin');
  const rj3 = pending.rows.find(r => r.client === 'Client RJ3');
  assert.equal(rj3.a_faire, 'Pièces du client complètes');
  assert.equal(rj3.faites, 1);
  assert.equal(pending.rows.find(r => r.client === 'Client RJ1').a_faire, 'Expédition remise au client');
  assert.ok(!pending.rows.some(r => r.client === 'Client RJ2'), 'dossier terminé');

  const opened = section(rep, /^Litiges ouverts/);
  assert.deepEqual(opened.rows.map(r => r.reference), [recent.reference], 'litige ouvert hors période exclu');
  assert.equal(opened.rows[0].origine, 'Fournisseur');
  assert.equal(opened.rows[0].statut, 'En cours');
  assert.equal(opened.rows[0].etape, 'Règlement amiable');
  const closed = section(rep, /^Litiges clos/);
  assert.deepEqual(closed.rows.map(r => r.reference), [old.reference]);
  assert.equal(closed.rows[0].issue, 'Transaction / accord');
  assert.equal(value(rep, /^Litiges en cours au /), 1);
  assert.equal(value(rep, /^Montant en jeu/), 3000000);

  const due = section(rep, /^Cautions et retenues arrivant/);
  assert.deepEqual(due.rows.map(r => r.reference), [dueRef], `${laterRef} expire après la période`);
  assert.equal(due.rows[0].sens, 'Reçue d’un tiers');
  assert.equal(due.rows[0].nature, 'Caution reçue : expiration');
  assert.equal(value(rep, /^Montant des cautions/), 6000000);
  assert.ok(rep.sections.some(s => /^Impayés transmis au Juridique au /.test(s.title)));

  // Autre période : l'acte de RJ2 y figure, celui de RJ1 non ; le litige ancien n'était pas encore clos
  const earlier = (await admin.get(`${R}/juridique?du=${day(-120)}&au=${day(-50)}`)).body;
  assert.deepEqual(section(earlier, /^Actes signés/).rows.map(r => r.client), ['Client RJ2']);
  assert.deepEqual(section(earlier, /^Litiges ouverts/).rows.map(r => r.reference), [old.reference]);
  assert.equal(section(earlier, /^Litiges ouverts/).rows[0].statut, 'Clos', 'statut actuel du dossier');
  assert.equal(section(earlier, /^Litiges clos/).rows.length, 0);
  assert.equal(value(earlier, /^Litiges en cours au /), 1, 'en cours à la fin de cette période');
  assert.ok(!section(earlier, /^Ventes en cours/).rows.some(r => r.client === 'Client RJ1'), 'RJ1 réservé après la période');
});

test('rapport du Marketing & Communication : campagnes actives, contenus publiés, dépense de l’IA, prospects des campagnes', async () => {
  const mk = async body => {
    const res = await admin.post(`${MK}/campaigns`).send({ segment: 'diaspora', cta_label: 'Réserver une visite', landing_path: 'contact.html', ...body });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
  };
  const active = await mk({ name: 'Diaspora novembre', starts_on: day(-20), ends_on: day(10) });
  assert.equal((await admin.post(`${MK}/campaigns/${active.id}/validate`)).status, 200);
  const past = await mk({ name: 'Salon de printemps', starts_on: day(-200), ends_on: day(-100) });
  assert.equal((await admin.post(`${MK}/campaigns/${past.id}/validate`)).status, 200);
  const draft = await mk({ name: 'Brouillon de Noël', starts_on: day(-5), ends_on: day(20) });

  // Contenus publiés dans la période et hors période ; un contenu planifié non publié
  await db('marketing_contents').insert([
    { campaign_id: active.id, channel: 'facebook', kind: 'post', title: 'Visite virtuelle du programme', status: 'publie', published_at: new Date(`${day(-2)}T10:00:00Z`), published_url: 'https://facebook.com/siipaf/1' },
    { campaign_id: past.id, channel: 'linkedin', kind: 'article', title: 'Bilan du salon', status: 'publie', published_at: new Date(`${day(-50)}T10:00:00Z`) },
    { campaign_id: active.id, channel: 'whatsapp', kind: 'message', title: 'Rappel des conditions', status: 'planifie', scheduled_for: day(-1) },
  ]);
  // Prospects : deux venus de la campagne active dans la période (dont un devenu client), un ancien, un sans campagne
  await db('leads').insert([
    { name: 'Prospect campagne 1', phone: '0711000001', source: 'site', stage: 'prospection', campaign_id: active.id, utm_medium: 'social', created_at: new Date(`${day(-4)}T09:00:00Z`) },
    { name: 'Prospect campagne 2', phone: '0711000002', source: 'site', stage: 'contrat', campaign_id: active.id, utm_medium: 'social', created_at: new Date(`${day(-3)}T09:00:00Z`) },
    { name: 'Prospect ancien', phone: '0711000003', source: 'site', stage: 'prospection', campaign_id: past.id, utm_medium: 'email', created_at: new Date(`${day(-150)}T09:00:00Z`) },
    { name: 'Prospect direct', phone: '0711000004', source: 'site', stage: 'prospection', created_at: new Date(`${day(-2)}T09:00:00Z`) },
  ]);
  // Dépense de l'IA : un appel facturé dans la période, un hors période, une démonstration gratuite
  const month = day(0).slice(0, 7);
  await db('marketing_generations').insert([
    { campaign_id: active.id, step: 'contenus', mode: 'ia', model: 'claude-sonnet-5-5', status: 'ok', month, cost_micro_usd: 2000000, created_at: new Date(`${day(-3)}T08:00:00Z`) },
    { campaign_id: past.id, step: 'contenus', mode: 'ia', model: 'claude-sonnet-5-5', status: 'ok', month: day(-60).slice(0, 7), cost_micro_usd: 5000000, created_at: new Date(`${day(-60)}T08:00:00Z`) },
    { campaign_id: active.id, step: 'concept', mode: 'demo', status: 'ok', month, cost_micro_usd: 0, created_at: new Date(`${day(-6)}T08:00:00Z`) },
  ]);

  assert.equal((await comptable.get(`${R}/marketing?${PERIOD}`)).status, 403, 'sans marketing:read');
  const res = await admin.get(`${R}/marketing?${PERIOD}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const rep = res.body;
  checkShape(rep, 'marketing');
  assert.equal(rep.title, 'Marketing & Communication');

  const campaigns = section(rep, /^Campagnes de la période/);
  const row = campaigns.rows.find(r => r.campagne === 'Diaspora novembre');
  assert.equal(row.active, 'Oui');
  assert.equal(row.segment, 'Acquéreurs à distance (diaspora)');
  assert.equal(row.statut, 'Validée');
  assert.equal(row.publies, 1);
  assert.equal(row.prospects, 2);
  assert.equal(row.clients, 1);
  const rate = (await settingsService.all(db)).marketing_usd_fcfa;
  assert.equal(row.depense, Math.round(2 * rate));
  assert.ok(!campaigns.rows.some(r => r.campagne === 'Salon de printemps'), 'campagne terminée avant la période, sans activité dans la période');
  assert.ok(!campaigns.rows.some(r => r.campagne === draft.name), 'brouillon non actif');
  assert.equal(value(rep, /^Campagnes actives/), 1);

  assert.deepEqual(section(rep, /^Contenus publiés/).rows.map(r => r.titre), ['Visite virtuelle du programme'], 'publication hors période exclue');
  assert.equal(section(rep, /^Contenus publiés/).rows[0].canal, 'Facebook');
  assert.equal(value(rep, /^Contenus publiés/), 1);
  assert.equal(value(rep, /^Contenus planifiés/), 1);
  assert.equal(value(rep, /^Prospects venus d’une campagne/), 2, 'prospect ancien exclu');
  assert.equal(value(rep, /^Prospects des campagnes devenus clients/), 1);
  const fresh = (await db('leads').select('created_at')).filter(l => { const d = toDate(l.created_at); return d >= new Date(`${day(-30)}T00:00:00Z`) && d < new Date(`${day(1)}T00:00:00Z`); }).length;
  assert.equal(value(rep, /^Part des nouveaux prospects/), Math.round((2 / fresh) * 1000) / 10);
  assert.equal(value(rep, /^Dépense de l’IA/), Math.round(2 * rate), 'appel hors période et démonstration exclus');
  const media = section(rep, /^Prospects des campagnes par canal/).rows;
  assert.deepEqual(media, [{ canal: 'Réseaux sociaux', prospects: 2, clients: 1, part: 100 }]);
  const runs = section(rep, /^Préparations de l’IA/).rows;
  assert.equal(runs.length, 2);
  assert.ok(runs.some(r => r.mode === 'Démonstration' && r.cout === 0));
  assert.ok(runs.some(r => r.mode === 'IA' && r.etat === 'Réussie' && r.cout === Math.round(2 * rate)));

  // Période ancienne : la campagne du salon y est active, avec son prospect et sa dépense
  const old = (await admin.get(`${R}/marketing?du=${day(-210)}&au=${day(-45)}`)).body;
  const salon = section(old, /^Campagnes de la période/).rows.find(r => r.campagne === 'Salon de printemps');
  assert.equal(salon.active, 'Oui');
  assert.equal(salon.prospects, 1);
  assert.equal(salon.depense, Math.round(5 * rate));
  assert.ok(!section(old, /^Campagnes de la période/).rows.some(r => r.campagne === 'Diaspora novembre'), 'créée après la période');
});
