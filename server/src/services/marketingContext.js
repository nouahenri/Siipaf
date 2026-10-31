/**
 * Faits envoyés à l'IA (et utilisés par les gabarits de démonstration et les contrôles de chiffres) : données publiques et
 * déterministes du catalogue uniquement. JAMAIS de prospects, de clients, de ventes ni de montants encaissés (§16 du document
 * de stratégie : « seules les données nécessaires sont transmises aux fournisseurs »).
 * Sources : projets publiés, offres, lots comptés par statut (plans publiés), points d'avancement visibles par le client et
 * sans lot précis, témoignages publiés (nom abrégé), documents du bien (liste de référence).
 */
const { json } = require('../lib/http');
const { paymentTerms, monthlyFor, siteStageLabel } = require('../lib/domain');
const { getSettings } = require('./settings');

const cut = (s, n) => (s == null ? null : String(s).replace(/\s+/g, ' ').trim().slice(0, n) || null);
/** « Awa Koné » → « Awa K. » : jamais le nom complet d'une personne. */
const shortName = name => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0] || 'Un client';
};

/** { facts, refs } : refs relie p1, o3, t2, u4 aux enregistrements (affichage « faits utilisés »). */
async function buildContext(db, { projectId = null } = {}) {
  const settings = await getSettings(db);
  const q = db('projects').where({ published: true }).whereNull('archived_at').orderBy('sort');
  if (projectId) q.where({ id: projectId });
  const projects = await q;
  const ids = projects.map(p => p.id);
  const refs = {};
  if (!ids.length) return { facts: { entreprise: 'SIIPAF SA, promoteur immobilier en Côte d’Ivoire', programmes: [], temoignages: [] }, refs };

  const [offers, lots, updates, docs, testimonials] = await Promise.all([
    db('project_offers').whereIn('project_id', ids).orderBy(['project_id', 'sort']).select('id', 'project_id', 'label', 'designation', 'surface', 'price_fcfa', 'diaspora_price_fcfa'),
    db('lots as l').join('site_plans as sp', 'sp.id', 'l.plan_id').whereIn('l.project_id', ids).where('sp.published', true).whereNull('sp.archived_at')
      .groupBy('l.project_id', 'l.status').select('l.project_id', 'l.status').count({ n: '*' }),
    db('site_updates').whereIn('project_id', ids).whereNull('lot_id').where({ visible_client: true }).whereNotNull('published_at')
      .orderBy('published_at', 'desc').select('id', 'project_id', 'stage', 'progress_pct', 'title', 'body', 'published_at'),
    db('project_refs as pr').join('ref_items as i', 'i.id', 'pr.ref_id').where('i.kind', 'document').whereIn('pr.project_id', ids)
      .orderBy(['i.sort', 'i.label']).select('pr.project_id', 'i.label', 'pr.state'),
    db('testimonials as t').where('t.status', 'publie').andWhere(b => b.whereIn('t.project_id', ids).orWhereNull('t.project_id'))
      .orderBy([{ column: 't.featured', order: 'desc' }, { column: 't.created_at', order: 'desc' }]).limit(6)
      .select('t.id', 't.name', 't.role_label', 't.project_id', 't.rating', 't.message'),
  ]);

  const programmes = projects.map(p => {
    const terms = paymentTerms(p, settings);
    refs[`p${p.id}`] = { type: 'projet', id: p.id, label: p.name };
    return {
      ref: `p${p.id}`, nom: p.name, ville: p.city, localisation: cut(p.location, 160), accroche: cut(p.tagline, 200), description: cut(p.description, 600),
      categorie: p.category, livraison: p.delivery || null, equipements: json(p.amenities, []).slice(0, 12),
      acompte_fcfa: terms.deposit_fcfa || null, duree_solde_mois: terms.balance_months,
      documents: docs.filter(d => d.project_id === p.id).map(d => `${d.label}${d.state ? ` (${d.state})` : ''}`).slice(0, 8),
      offres: offers.filter(o => o.project_id === p.id).map(o => {
        refs[`o${o.id}`] = { type: 'offre', id: o.id, label: `${p.name} — ${o.label}` };
        const price = o.price_fcfa == null ? null : Number(o.price_fcfa);
        return {
          ref: `o${o.id}`, intitule: o.label, designation: o.designation || null, surface: o.surface || null, price_fcfa: price,
          diaspora_price_fcfa: o.diaspora_price_fcfa == null ? null : Number(o.diaspora_price_fcfa),
          // Calculs déterministes : l'IA les recopie, elle ne les fait pas
          monthly_fcfa: price && terms.balance_months ? monthlyFor(price, terms) : null,
          deposit_pct: price && terms.deposit_fcfa ? Math.round((terms.deposit_fcfa / price) * 100) : null,
        };
      }),
      lots_par_statut: Object.fromEntries(lots.filter(l => l.project_id === p.id).map(l => [l.status, Number(l.n)])),
      avancement: updates.filter(u => u.project_id === p.id).slice(0, 3).map(u => {
        refs[`u${u.id}`] = { type: 'point d’avancement', id: u.id, label: `${p.name} — ${u.title}` };
        return {
          ref: `u${u.id}`, titre: u.title, etape: siteStageLabel(p.category, u.stage), progress_pct: u.progress_pct, texte: cut(u.body, 300),
          publie_le: String(u.published_at instanceof Date ? u.published_at.toISOString() : u.published_at).slice(0, 10),
        };
      }),
    };
  });
  const temoignages = testimonials.map(t => {
    refs[`t${t.id}`] = { type: 'témoignage', id: t.id, label: shortName(t.name) };
    return { ref: `t${t.id}`, auteur: shortName(t.name), qualite: t.role_label || null, note: t.rating || null, texte: cut(t.message, 400) };
  });
  return { facts: { entreprise: 'SIIPAF SA, promoteur immobilier en Côte d’Ivoire', programmes, temoignages }, refs };
}

module.exports = { buildContext, shortName };
