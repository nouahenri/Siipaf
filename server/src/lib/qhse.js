/**
 * ERP · QHSE (Qualité, Hygiène, Sécurité, Environnement) : règles pures du module, sans accès à la base.
 * - Qualité et Hygiène : note Mauvais / Passable / Bon / Très bon (1 à 4), par point de contrôle et note globale.
 * - Sécurité : ouvriers respectant les consignes / ouvriers présents (pourcentage) + points de contrôle de l'état du chantier.
 * - Environnement : points de contrôle conforme / non conforme / sans objet → taux de conformité.
 * Les points de contrôle (grilles) sont réglables dans QHSE › Réglages (table qhse_checkpoints) ; ceux ci-dessous sont les défauts.
 */

const RATINGS = { 1: 'Mauvais', 2: 'Passable', 3: 'Bon', 4: 'Très bon' };
const BAD_RATING = 1;

/** Chaque volet a une échelle : « note » (4 niveaux) ou « conformite » (conforme / non conforme / sans objet). */
const PILLARS = {
  qualite: { label: 'Qualité', scale: 'note', hint: 'Qualité du matériel et technique des ouvrages' },
  hygiene: { label: 'Hygiène', scale: 'note', hint: 'Propreté et rangement' },
  securite: { label: 'Sécurité', scale: 'conformite', hint: 'Ouvriers respectant les consignes et état de sécurité du chantier' },
  environnement: { label: 'Environnement', scale: 'conformite', hint: 'Respect des normes environnementales' },
};
const ANSWERS = { conforme: 'Conforme', non_conforme: 'Non conforme', sans_objet: 'Sans objet' };

const CONTROL_KINDS = { journalier: 'Journalier', hebdomadaire: 'Hebdomadaire' };
// Journalier : saisi (définitif, corrigeable tant que la semaine n'est pas validée) ; hebdomadaire : brouillon → à valider → validé
const CONTROL_STATUSES = { saisi: 'Saisi', brouillon: 'Brouillon', a_valider: 'À valider', valide: 'Validé' };

const AUDIT_KINDS = { planifie: 'Planifié', inopine: 'Inopiné' };
const AUDIT_STATUSES = { planifie: 'Planifié', en_cours: 'En cours', a_valider: 'À valider', valide: 'Validé', annule: 'Annulé' };
const AUDIT_PLACES = { chantier: 'Chantier', siege: 'Siège' };

const GRAVITIES = { mineure: 'Mineure', majeure: 'Majeure', critique: 'Critique' };
const ACTION_STATUSES = { ouverte: 'Ouverte', en_cours: 'En cours', levee: 'Levée', annulee: 'Annulée' };
const ACTION_OPEN = ['ouverte', 'en_cours'];
const ACTION_SOURCES = { controle: 'Contrôle', audit: 'Audit', sav: 'Réclamation SAV', manuelle: 'Saisie directe' };
const FILE_OWNERS = { controle: 'Contrôle', audit: 'Audit', constat: 'Constat', action: 'Action corrective' };

/** Points de contrôle par défaut de chaque volet (modifiables dans QHSE › Réglages). */
const DEFAULT_CHECKPOINTS = {
  qualite: [
    'Qualité des matériaux livrés et stockés (conformité aux commandes, stockage à l’abri)',
    'Conformité des ouvrages aux plans et aux prescriptions',
    'Qualité d’exécution : alignements, aplombs, niveaux',
    'Ferraillage, coffrage et mise en œuvre du béton',
    'Maçonnerie, enduits et finitions',
    'Qualité et état du matériel et des outils',
  ],
  hygiene: [
    'Propreté générale du chantier et des voies de circulation',
    'Rangement des matériaux et des outils',
    'Sanitaires et vestiaires des ouvriers (propreté, eau)',
    'Zone de repas et eau potable',
    'Évacuation régulière des gravats et des emballages',
  ],
  securite: [
    'Balisage et signalisation des zones dangereuses',
    'Clôture du chantier et accès contrôlés',
    'Échafaudages montés, stables et vérifiés',
    'Garde-corps et protections contre les chutes',
    'Extincteurs présents, accessibles et vérifiés',
    'Trousse de premiers secours disponible',
    'Installations électriques provisoires protégées',
    'Engins et machines conformes, conducteurs habilités',
    'Produits dangereux stockés correctement',
  ],
  environnement: [
    'Déchets triés et évacués',
    'Poussière maîtrisée (arrosage, bâchage)',
    'Bruit limité (horaires, matériel)',
    'Eaux usées et eaux de lavage non rejetées dans le milieu',
    'Hydrocarbures et huiles : bacs de rétention, aucune fuite',
    'Produits chimiques stockés et éliminés correctement',
    'Arbres, sols et cours d’eau protégés',
    'Aucun brûlage de déchets',
  ],
};

// ─── Dates (chaînes AAAA-MM-JJ, calculs en UTC pour éviter tout décalage d'heure d'été) ─────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const todayStr = (now = new Date()) => now.toISOString().slice(0, 10);
function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** 1 = lundi … 7 = dimanche. */
const weekday = day => { const w = new Date(`${day}T00:00:00Z`).getUTCDay(); return w === 0 ? 7 : w; };
const mondayOf = day => addDays(day, 1 - weekday(day));
const frDay = d => (d ? d.split('-').reverse().join('/') : '');

/** Jour ouvré : du lundi au vendredi (samedi en plus selon le réglage), hors jours fériés (`holidays` : ensemble de dates). */
function isWorkingDay(day, { saturday = false, holidays = new Set() } = {}) {
  const w = weekday(day);
  if (w === 7 || (w === 6 && !saturday)) return false;
  return !holidays.has(day);
}
/** Jours ouvrés d'un intervalle [from, to] inclus. */
function workingDays(from, to, opts) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkingDay(d, opts)) out.push(d);
  return out;
}

// ─── Notes et taux ─────────────────────────────────────────────────────────────

const round1 = n => Math.round(n * 10) / 10;
const mean = list => {
  const v = list.filter(x => x != null && Number.isFinite(Number(x))).map(Number);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const mean1 = list => { const m = mean(list); return m == null ? null : round1(m); };
/** Note globale proposée : moyenne des notes arrondie au niveau le plus proche (2,5 → Bon), entre 1 et 4. */
function meanRating(ratings) {
  const m = mean(ratings);
  return m == null ? null : Math.min(4, Math.max(1, Math.round(m)));
}
const ratingLabel = r => RATINGS[Math.round(Number(r))] || null;

/** Pourcentage d'ouvriers respectant la sécurité ; null sans ouvriers présents. */
function safetyPct(present, compliant) {
  const p = Number(present), c = Number(compliant);
  if (!Number.isFinite(p) || !Number.isFinite(c) || p <= 0) return null;
  return Math.round((Math.min(c, p) / p) * 100);
}
/** Taux de conformité d'une liste de réponses (sans objet exclu) ; null sans réponse. */
function conformityRate(answers) {
  const real = answers.filter(a => a === 'conforme' || a === 'non_conforme');
  if (!real.length) return null;
  return Math.round((real.filter(a => a === 'conforme').length / real.length) * 100);
}
/** Écart entre deux valeurs (arrondi au dixième) ; null si l'une manque. */
const delta = (cur, prev) => (cur == null || prev == null ? null : round1(cur - prev));
/** Note 1-4 ramenée à un pourcentage (Mauvais 0 %, Très bon 100 %), pour le score d'un audit. */
const ratingPct = avg => (avg == null ? null : Math.round(((avg - 1) / 3) * 100));

/**
 * Synthèse d'une semaine : moyennes des contrôles journaliers (`days`), comparées à la semaine précédente (`previous`).
 * Une ligne : { day, rating_qualite, rating_hygiene, safety_pct, site_safety_pct, env_rate, workers_present, workers_compliant }.
 */
function weekSummary(days, previous = [], { expected = [] } = {}) {
  const agg = rows => ({
    qualite_avg: mean1(rows.map(r => r.rating_qualite)), hygiene_avg: mean1(rows.map(r => r.rating_hygiene)),
    safety_avg: mean1(rows.map(r => r.safety_pct)), site_safety_avg: mean1(rows.map(r => r.site_safety_pct)), env_avg: mean1(rows.map(r => r.env_rate)),
  });
  const cur = agg(days);
  const prev = agg(previous);
  const seen = new Set(days.map(d => d.day));
  const present = days.reduce((t, r) => t + (Number(r.workers_present) || 0), 0);
  const compliant = days.reduce((t, r) => t + (Number(r.workers_compliant) || 0), 0);
  return {
    days: days.length, expected_days: expected.length, missing_days: expected.filter(d => !seen.has(d)),
    ...cur,
    safety_min: days.some(r => r.safety_pct != null) ? Math.min(...days.filter(r => r.safety_pct != null).map(r => r.safety_pct)) : null,
    workers_present: present, workers_compliant: compliant, workers_non_compliant: Math.max(0, present - compliant),
    bad_ratings: days.flatMap(r => ['qualite', 'hygiene'].filter(p => Number(r[`rating_${p}`]) === BAD_RATING).map(p => ({ day: r.day, pillar: p }))),
    previous: prev,
    trend: {
      qualite: delta(cur.qualite_avg, prev.qualite_avg), hygiene: delta(cur.hygiene_avg, prev.hygiene_avg),
      safety: delta(cur.safety_avg, prev.safety_avg), env: delta(cur.env_avg, prev.env_avg),
    },
  };
}

/**
 * Score d'un audit : moyenne des volets renseignés, Qualité et Hygiène ramenées à un pourcentage (Mauvais 0 % … Très bon 100 %),
 * Sécurité et Environnement en taux de conformité. Null sans aucun résultat.
 */
function auditScore({ rating_qualite = null, rating_hygiene = null, safety_rate = null, env_rate = null }) {
  const parts = [ratingPct(rating_qualite), ratingPct(rating_hygiene), safety_rate, env_rate].filter(x => x != null);
  return parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
}

/** Échéance proposée d'une action corrective selon sa gravité (jours réglés dans QHSE › Réglages). */
function actionDueDate(gravity, from, days) {
  const n = { critique: days.critique, majeure: days.majeure, mineure: days.mineure }[gravity] ?? days.mineure;
  return addDays(from, n);
}
const actionLate = (a, today) => ACTION_OPEN.includes(a.status) && !!a.due_on && a.due_on < today;

/** Contrôle d'un point : la bonne forme de réponse selon l'échelle du volet ; renvoie un message de refus ou null. */
function itemRefusal(item) {
  const p = PILLARS[item.pillar];
  if (!p) return 'Volet inconnu.';
  if (p.scale === 'note') {
    if (!RATINGS[item.rating]) return `« ${item.label} » : choisissez une note (Mauvais, Passable, Bon ou Très bon).`;
  } else if (!ANSWERS[item.answer]) return `« ${item.label} » : répondez conforme, non conforme ou sans objet.`;
  return null;
}

module.exports = {
  RATINGS, BAD_RATING, PILLARS, ANSWERS, CONTROL_KINDS, CONTROL_STATUSES, AUDIT_KINDS, AUDIT_STATUSES, AUDIT_PLACES, GRAVITIES,
  ACTION_STATUSES, ACTION_OPEN, ACTION_SOURCES, FILE_OWNERS, DEFAULT_CHECKPOINTS,
  DAY_RE, todayStr, addDays, weekday, mondayOf, frDay, isWorkingDay, workingDays,
  mean, mean1, round1, meanRating, ratingLabel, safetyPct, conformityRate, delta, ratingPct, weekSummary, auditScore, actionDueDate, actionLate, itemRefusal,
};
