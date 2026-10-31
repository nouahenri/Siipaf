/**
 * Mode démonstration du Marketing & Communication : sans clé de l'IA, en arrêt d'urgence ou à la demande, des gabarits
 * rédigent les contenus à partir des VRAIS faits du catalogue (prix, livraison, avancement, témoignages publiés). Même schéma
 * de sortie que l'IA (validé par zod), origine « demo », coût nul. Aucun chiffre n'est inventé : seuls ceux des faits sont cités.
 */
const { HttpError } = require('../lib/http');
const { CHANNELS, SEGMENTS, conceptSchema, contentsSchema, withConsentFooter, addDays } = require('../lib/marketing');

const money = n => `${Number(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
const DAY_PATTERN = [1, 3, 5, 2, 4, 6, 0]; // mardi, jeudi, samedi, mercredi, vendredi, dimanche, lundi

function cheapest(p) {
  return p.offres.filter(o => o.price_fcfa).sort((a, b) => a.price_fcfa - b.price_fcfa)[0] || null;
}
const where = p => [p.nom, p.ville].filter(Boolean).join(' à ');

/** Angles éditoriaux : chacun renvoie { title, hook, detail, cta, visual, refs } ou null si les faits manquent. */
const ANGLES = {
  presentation: (p, f, c) => {
    const o = cheapest(p);
    return {
      title: `Présentation de ${p.nom}`,
      hook: `Découvrez ${where(p)}${p.accroche ? ` : ${p.accroche.replace(/[.\s]+$/, '')}.` : '.'}`,
      detail: [p.livraison ? `Livraison prévue : ${p.livraison}.` : null, o ? `À partir de ${money(o.price_fcfa)} (${o.intitule}${o.surface ? `, ${o.surface}` : ''}).` : null].filter(Boolean).join(' '),
      cta: c.cta, visual: `Photo de couverture de ${p.nom} et plan de masse publié`, refs: [p.ref, o?.ref],
    };
  },
  conditions: (p, f, c) => {
    const o = p.offres.find(x => x.monthly_fcfa) || null;
    if (!o && !p.acompte_fcfa) return null;
    return {
      title: `Comment acquérir un bien à ${p.nom}`,
      hook: `Comment acheter à ${p.nom} ? Les conditions sont expliquées simplement.`,
      detail: [p.acompte_fcfa ? `Acompte de ${money(p.acompte_fcfa)} à la réservation.` : null, `Solde échelonné sur ${p.duree_solde_mois} mois.`,
        o ? `Exemple : ${o.intitule}, soit environ ${money(o.monthly_fcfa)} par mois.` : null].filter(Boolean).join(' '),
      cta: c.cta, visual: 'Schéma des étapes d’acquisition (réservation, échéancier, acte)', refs: [p.ref, o?.ref],
    };
  },
  chantier: (p, f, c) => {
    const u = p.avancement[0];
    if (!u) return null;
    return {
      title: `Point chantier ${p.nom}`,
      hook: `Où en est ${p.nom} ? Point d’avancement publié le ${u.publie_le.split('-').reverse().join('/')}.`,
      detail: `${u.titre}${u.etape ? ` — étape : ${u.etape}` : ''}${u.progress_pct != null ? `, avancement ${u.progress_pct} %` : ''}.`,
      cta: c.cta, visual: `Photos du dernier point de chantier publié de ${p.nom}`, refs: [p.ref, u.ref],
    };
  },
  visite: (p, f, c) => ({
    title: `Visite de ${p.nom}`,
    hook: `Venez voir ${p.nom} sur place${p.ville ? `, à ${p.ville}` : ''}.`,
    detail: 'Un conseiller SIIPAF vous accueille, répond à vos questions et vous présente les plans et les documents du bien.',
    cta: c.cta, visual: `Photo du site de ${p.nom} et du plan de masse`, refs: [p.ref],
  }),
  equipements: (p, f, c) => {
    if (!p.equipements.length) return null;
    return {
      title: `Cadre de vie à ${p.nom}`,
      hook: `Le cadre de vie à ${p.nom} en quelques points.`,
      detail: `${p.equipements.slice(0, 6).join(', ')}.`,
      cta: c.cta, visual: `Visuels approuvés du programme ${p.nom}`, refs: [p.ref],
    };
  },
  temoignage: (p, f, c) => {
    const t = f.temoignages[0];
    if (!t || !t.texte) return null;
    return {
      title: `Témoignage ${t.auteur}`,
      hook: `« ${t.texte.replace(/[.\s]+$/, '')}. »`,
      detail: `${t.auteur}${t.qualite ? `, ${t.qualite}` : ''} — témoignage publié sur siipaf.com.`,
      cta: c.cta, visual: 'Citation sur fond aux couleurs de SIIPAF (témoignage autorisé)', refs: [t.ref],
    };
  },
  documents: (p, f, c) => {
    if (!p.documents.length) return null;
    return {
      title: `Documents du bien ${p.nom}`,
      hook: `Acheter en confiance : les documents de ${p.nom}.`,
      detail: `${p.documents.slice(0, 4).join(', ')}. Vous pouvez les consulter avec un conseiller avant de vous engager.`,
      cta: c.cta, visual: 'Infographie des documents du bien et de leur état', refs: [p.ref],
    };
  },
};
const ORDER_BY_SEGMENT = {
  residence_principale: ['presentation', 'conditions', 'chantier', 'visite', 'equipements', 'temoignage', 'documents'],
  diaspora: ['presentation', 'documents', 'chantier', 'conditions', 'temoignage', 'visite', 'equipements'],
  investisseur: ['presentation', 'documents', 'conditions', 'chantier', 'equipements', 'visite', 'temoignage'],
  entreprise: ['presentation', 'visite', 'conditions', 'chantier', 'documents', 'equipements', 'temoignage'],
  parrainage: ['temoignage', 'chantier', 'presentation', 'visite', 'conditions', 'documents', 'equipements'],
};

function compose(channel, kind, a) {
  const tail = [a.detail, a.cta].filter(Boolean);
  switch (kind) {
    case 'story': return `${a.hook}\n${a.cta}`;
    case 'script_video': return `Script vidéo (30 secondes)\nPlan 1 — ${a.hook}\nPlan 2 — ${a.detail || a.title}\nPlan 3 — ${a.cta}`;
    case 'message': return `Bonjour, ici SIIPAF. ${[a.hook, ...tail].join(' ')}`;
    case 'email': return `Bonjour,\n\n${a.hook}\n\n${tail.join('\n\n')}\n\nL’équipe SIIPAF`;
    default: return [a.hook, ...tail].join('\n\n');
  }
}

function requireFacts(facts) {
  if (!facts.programmes?.length) throw new HttpError(409, 'Aucun programme publié au catalogue : publiez au moins un projet pour préparer des contenus.');
}

function demoConcept({ campaign, facts }) {
  requireFacts(facts);
  const p = facts.programmes[0];
  const o = cheapest(p);
  const proofs = [
    p.livraison ? `Livraison prévue : ${p.livraison}.` : null,
    p.avancement[0] ? `Suivi de chantier publié : ${p.avancement[0].titre}.` : null,
    p.documents.length ? `Documents du bien consultables : ${p.documents.slice(0, 3).join(', ')}.` : null,
    o ? `Prix de départ affiché : ${money(o.price_fcfa)}.` : null,
  ].filter(Boolean);
  return conceptSchema.parse({
    angle: `${SEGMENTS[campaign.segment] || 'Acquisition'} : montrer ${p.nom} tel qu’il est, avec des preuves vérifiables.`,
    key_message: `${where(p)} : un programme réel, des conditions explicites et un suivi transparent.`,
    audience: SEGMENTS[campaign.segment] || 'Acquéreurs',
    proof_points: proofs.length ? proofs : [`Programme ${p.nom} publié sur siipaf.com.`],
    cta: campaign.cta_label || 'Prendre rendez-vous',
    hashtags: ['#SIIPAF', '#immobilier', '#CôteDIvoire', p.ville ? `#${p.ville.replace(/\W+/g, '')}` : null].filter(Boolean),
    tone_notes: 'Professionnel, clair, rassurant ; preuves plutôt que superlatifs.',
  });
}

/** Contenus de démonstration : `count` contenus répartis sur les canaux et les programmes, à partir de `from` (un lundi). */
function demoContents({ campaign, facts, channels, from, count, weeks = 1 }) {
  requireFacts(facts);
  const programmes = campaign.project_id ? facts.programmes.filter(p => p.ref === `p${campaign.project_id}`) : facts.programmes;
  const list = programmes.length ? programmes : facts.programmes;
  const order = ORDER_BY_SEGMENT[campaign.segment] || ORDER_BY_SEGMENT.residence_principale;
  const c = { cta: campaign.cta_label ? `${campaign.cta_label} : ${campaign.landing_path}` : 'Prenez rendez-vous avec un conseiller SIIPAF.' };
  const perWeek = Math.max(1, Math.ceil(count / Math.max(1, weeks)));
  const items = [];
  for (let i = 0; i < count; i++) {
    const channel = channels[i % channels.length];
    const kinds = CHANNELS[channel].kinds;
    const kind = kinds[Math.floor(i / channels.length) % kinds.length];
    const p = list[i % list.length];
    // Angle suivant dans l'ordre du segment dont les faits existent
    let a = null;
    for (let k = 0; !a && k < order.length; k++) a = ANGLES[order[(i + k) % order.length]](p, facts, c);
    const body = withConsentFooter(channel, compose(channel, kind, a));
    items.push({
      channel, kind, title: a.title, body, subject: kind === 'email' ? a.title : null,
      hashtags: ['facebook', 'instagram', 'tiktok', 'linkedin'].includes(channel) ? ['#SIIPAF', '#immobilier', p.ville ? `#${p.ville.replace(/\W+/g, '')}` : '#CôteDIvoire'] : [],
      cta: c.cta, visual_idea: a.visual,
      scheduled_for: addDays(from, DAY_PATTERN[i % perWeek % 7] + 7 * Math.floor(i / perWeek)),
      fact_refs: a.refs.filter(Boolean),
    });
  }
  return contentsSchema.parse({ items });
}

/** Variante de démonstration d'un contenu : un autre angle du même programme. */
function demoVariant({ campaign, facts, content }) {
  const channel = content.channel;
  const ref = (content.fact_refs || []).find(r => /^p\d+$/.test(r));
  const p = facts.programmes.find(x => x.ref === ref) || facts.programmes[0];
  requireFacts(facts);
  const c = { cta: campaign.cta_label ? `${campaign.cta_label} : ${campaign.landing_path}` : 'Prenez rendez-vous avec un conseiller SIIPAF.' };
  const names = Object.keys(ANGLES);
  const start = (content.variant_index || 0) + 1;
  let a = null;
  for (let k = 0; !a && k < names.length; k++) a = ANGLES[names[(start + k) % names.length]](p, facts, c);
  return contentsSchema.parse({ items: [{
    channel, kind: content.kind, title: a.title, body: withConsentFooter(channel, compose(channel, content.kind, a)), subject: content.kind === 'email' ? a.title : null,
    hashtags: content.hashtags || [], cta: c.cta, visual_idea: a.visual, fact_refs: a.refs.filter(Boolean),
  }] });
}

module.exports = { demoConcept, demoContents, demoVariant };
