/**
 * Données de démonstration du module ERP · Commercial (base de démo locale uniquement).
 *   DB_FILENAME=./data/demo.sqlite node scripts/demo-commercial.js
 * Deux commerciaux, prospects attribués avec montants et priorités, activités (dont en retard), motifs de perte,
 * types de lots, une résidence en immeubles (bâtiments, étages, appartements) vendue en VEFA avec appels de fonds,
 * objectifs du mois.
 */
const crypto = require('crypto');
const { createDb } = require('../src/db');
const { hashPassword } = require('../src/auth');
const { openSale } = require('../src/services/sales');
const vefa = require('../src/services/vefa');
const { LOST_REASONS } = require('../src/lib/domain');

const DAY = 864e5;
const at = (days, hour = 10) => { const d = new Date(Date.now() + days * DAY); d.setHours(hour, 0, 0, 0); return d; };
const pick = (arr, i) => arr[i % arr.length];

(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Script réservé à la base de démo.');
  const db = createDb();
  if (await db('buildings').first()) { console.log('Données Commercial déjà présentes.'); return db.destroy(); }
  const admin = await db('users').orderBy('id').first();

  // Commerciaux de démonstration (mot de passe aléatoire : comptes non utilisables)
  const sellers = [];
  for (const [name, email] of [['Awa Diabaté', 'awa.commerciale@exemple.com'], ['Serge Kouadio', 'serge.commercial@exemple.com']]) {
    let u = await db('users').where({ email }).first();
    if (!u) {
      const [id] = await db('users').insert({ email, name, role: 'commercial', password_hash: await hashPassword(crypto.randomBytes(18).toString('hex')) });
      u = await db('users').where({ id: typeof id === 'object' ? id.id : id }).first();
    }
    sellers.push(u);
  }
  const team = [...sellers, admin];

  // Prospects : commercial, montant attendu, priorité, type ; motifs pour les perdus
  const leads = await db('leads as ld').leftJoin('lots as l', 'l.id', 'ld.lot_id').select('ld.*', 'l.price_fcfa as lot_price').orderBy('ld.id');
  const reasons = Object.keys(LOST_REASONS);
  for (const [i, ld] of leads.entries()) {
    const patch = {
      assigned_to: pick(team, i).id,
      expected_revenue_fcfa: ld.lot_price || pick([18e6, 25e6, 32e6, 45e6, 60e6], i),
      priority: pick([0, 1, 2, 3, 1, 0], i),
      kind: pick(['acquereur', 'acquereur', 'investisseur', 'acquereur', 'entreprise'], i),
    };
    if (ld.stage === 'perdu') Object.assign(patch, { lost_reason: pick(reasons, i), lost_at: at(-(i % 60)) });
    await db('leads').where({ id: ld.id }).update(patch);
  }

  // Activités : à faire (en retard, aujourd'hui, à venir) et déjà faites (historique)
  const open = leads.filter(l => ['prospection', 'visite', 'decision', 'choix_bien'].includes(l.stage));
  const plans = [
    ['appel', 'Rappeler après la visite', -3], ['whatsapp', 'Envoyer la grille de prix', 0], ['visite', 'Visite du site avec la famille', 2],
    ['relance', 'Relance : décision de financement', -1], ['document', 'Récupérer la lettre d’accord bancaire', 5], ['reunion', 'Rendez-vous au bureau pour la réservation', 7],
  ];
  for (const [i, ld] of open.entries()) {
    const [kind, summary, d] = pick(plans, i);
    const owner = pick(team, i).id;
    await db('lead_activities').insert({ lead_id: ld.id, kind, summary, due_at: at(d, 9 + (i % 8)), assigned_to: owner, created_by: owner });
    await db('lead_activities').insert({
      lead_id: ld.id, kind: 'appel', summary: 'Premier appel', outcome: pick(['Intéressé par une villa 4 pièces, budget à confirmer.', 'Souhaite visiter un samedi.', 'Compare avec un autre programme à Bingerville.'], i),
      due_at: at(-10 - (i % 10)), done_at: at(-10 - (i % 10)), assigned_to: owner, created_by: owner,
    });
  }

  // Types de lots
  const projects = await db('projects').select('id', 'name');
  const byName = n => projects.find(p => p.name.includes(n));
  const bing = byName('BINGERVILLE'), yam = byName('YAMOUSSOUKRO'), aho = byName('AHOUTOUE'), angre = byName('ANGRÉ') || byName('ANGRE');
  if (bing) await db('lots').where({ project_id: bing.id }).update({ lot_type: 'parcelle' });
  for (const p of [yam, aho].filter(Boolean)) await db('lots').where({ project_id: p.id }).update({ lot_type: 'villa', rooms: 4 });

  // Résidence d'appartements en immeubles, vendue en VEFA
  if (angre) {
    const blocks = [{ code: 'Bât. A', name: 'Résidence Les Flamboyants', floors: 4 }, { code: 'Bât. B', name: 'Résidence Les Flamboyants', floors: 3 }];
    const lotIds = [];
    for (const b of blocks) {
      const [bid] = await db('buildings').insert({ project_id: angre.id, code: b.code, name: b.name, kind: 'immeuble', floors: b.floors });
      const buildingId = typeof bid === 'object' ? bid.id : bid;
      for (let f = 0; f <= b.floors; f++) {
        for (let u = 1; u <= 2; u++) {
          const rooms = u === 1 ? 3 : 4;
          const [lid] = await db('lots').insert({
            project_id: angre.id, code: `${b.code.slice(-1)}-${f}0${u}`, lot_type: f === 0 && u === 1 ? 'commerce' : 'appartement', building_id: buildingId, floor: f, rooms,
            surface_m2: rooms === 3 ? 92 : 118, price_fcfa: (rooms === 3 ? 58e6 : 74e6) + f * 2e6, tantiemes: rooms === 3 ? 45 : 58, status: 'disponible',
          });
          lotIds.push(typeof lid === 'object' ? lid.id : lid);
        }
      }
    }
    await vefa.savePlan(db, angre.id, { milestones: require('../src/lib/domain').DEFAULT_VEFA_PLAN, due_days: 15 }, admin.id);
    const buyers = leads.filter(l => ['decision', 'choix_bien'].includes(l.stage)).slice(0, 4);
    const sales = [];
    for (const [i, ld] of buyers.entries()) {
      const s = await openSale(db, { lotId: lotIds[2 + i * 2], leadId: ld.id, vefa: true, reserved_at: at(-150 + i * 10), signed_at: at(-140 + i * 10).toISOString().slice(0, 10), user: { id: pick(sellers, i).id } });
      sales.push(s);
    }
    // Avancement du chantier : les fondations sont achevées (le gros œuvre a démarré)
    for (const [stage, days, title] of [['terrassement', -120, 'Terrassement terminé'], ['fondations', -90, 'Coulage des semelles'], ['gros_oeuvre', -40, 'Élévation des murs du bâtiment A']]) {
      const [id] = await db('site_updates').insert({ project_id: angre.id, stage, progress_pct: { terrassement: 10, fondations: 20, gros_oeuvre: 35 }[stage], title, published_at: at(days), created_by: admin.id });
      await vefa.onSiteUpdate(db, await db('site_updates').where({ id: typeof id === 'object' ? id.id : id }).first(), admin.id);
    }
    // Versements : signature payée par tous, fondations payées par deux acquéreurs (les autres sont en retard)
    for (const [i, s] of sales.entries()) {
      const calls = await db('fund_calls').where({ sale_id: s.id, status: 'appele' }).orderBy('seq');
      const toPay = calls.slice(0, i < 2 ? 2 : 1);
      for (const c of toPay) await db('payments').insert({ sale_id: s.id, amount_fcfa: c.amount_fcfa, paid_at: c.due_date, method: 'virement', reference: `VEFA-${s.id}-${c.seq}`, recorded_by: admin.id });
    }
  }

  // Objectifs du mois
  const month = new Date().toISOString().slice(0, 7);
  for (const [i, u] of team.entries()) {
    await db('sales_targets').insert({ user_id: u.id, month, ca_fcfa: [150e6, 120e6, 80e6][i], ventes: [4, 3, 2][i], rdv: [12, 10, 6][i], encaissements_fcfa: [60e6, 50e6, 40e6][i], set_by: admin.id });
  }
  console.log(`Commercial de démonstration : ${leads.length} prospects attribués, ${open.length * 2} activités, résidence en VEFA${angre ? '' : ' (projet Angré absent)'}.`);
  await db.destroy();
})().catch(e => { console.error(e); process.exit(1); });
