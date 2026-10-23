/**
 * ERP · RH — règles des congés et absences (Côte d'Ivoire). Tout est réglable dans « RH › Réglages » et doit être
 * confirmé par SIIPAF (convention collective, règlement intérieur) avant usage réel.
 * Sources (oct. 2026) : Code du travail, loi 2015-532 modifiée par l'ordonnance 2021-902 — art. 25.1 (2,2 jours
 * ouvrables par mois de service effectif), 25.2 (majorations d'ancienneté et pour enfants à charge), 25.3 (absences
 * assimilées), 25.4 (droit ouvert après 12 mois), 25.6 (fractionnement : au moins 14 jours consécutifs), 25.12
 * (permissions exceptionnelles : 6 mois de présence, 10 jours par an, sans retenue) ; décret 2001-22 (jours fériés).
 */

const DEFAULT_RH = {
  accrual_per_month: 2.2, // jours ouvrables par mois de service effectif
  // Majoration d'ancienneté : [années de service, jours ouvrables en plus par an]
  seniority_bonus: [[5, 1], [10, 2], [15, 3], [20, 5], [25, 7], [30, 8]],
  child_bonus_days: 2, // par enfant à charge (salarié de moins de 21 ans, ou à partir du 4e enfant au-delà)
  child_bonus_young_age: 21, child_bonus_from_child: 4,
  round_up: true, // droits annuels arrondis à l'entier supérieur
  min_months_before_leave: 12, // premier congé après un an de service
  allow_negative: false, // congé pris par anticipation (au-delà du solde)
  min_continuous_days: 14, // fraction principale du congé
  working_days: [1, 2, 3, 4, 5, 6], // jours ouvrables : du lundi au samedi (dimanche = repos)
  permission_min_months: 6, permission_max_days: 10,
  maternity_days: 98, paternity_days: 10, // 14 semaines ; paternité : à confirmer
  approval: 'manager_then_rh', // 'rh' : seul le service RH approuve
  // Présences et heures supplémentaires (durée légale 40 h ; majorations usuelles, à confirmer par le comptable)
  weekly_hours: 40, hourly_divisor: 173.33, // 40 h × 52 / 12 : taux horaire = salaire de base / diviseur
  overtime_tiers: [[6, 15], [null, 50]], // 6 premières heures au-delà de 40 h : +15 %, puis +50 %
  night_rate: 75, sunday_rate: 75, sunday_night_rate: 100, night_start: 22, night_end: 5,
  overtime_year_cap: 220, geolocation: true,
  // Pause déjeuner retirée d'un pointage continu de plus de 6 h (placée à 12 h si le pointage couvre midi)
  break_minutes: 60, break_after_hours: 6,
  overtime_exempt_departments: ['direction'], // cadres au forfait : heures suivies, pas d'heures supplémentaires payées
  // Notes de frais : catégorie → compte de charge (plan SYSCOHADA)
  expense_categories: {
    deplacement: { label: 'Déplacement, transport', account: '6181' }, carburant: { label: 'Carburant', account: '6053' },
    mission: { label: 'Mission, per diem, hébergement', account: '6384' }, reception: { label: 'Repas d’affaires, réception', account: '6383' },
    fournitures: { label: 'Fournitures de bureau', account: '6055' }, petit_materiel: { label: 'Petit matériel de chantier', account: '6056' },
    telecom: { label: 'Téléphone, internet', account: '628' }, autre: { label: 'Autre dépense', account: '638' },
  },
  expense_payable_account: '422100',
};

const EXPENSE_STATUSES = {
  brouillon: { label: 'Brouillon', tone: '' }, soumise: { label: 'À approuver', tone: 'warn' }, approuvee: { label: 'À comptabiliser', tone: 'brand' },
  comptabilisee: { label: 'À rembourser', tone: 'brand' }, remboursee: { label: 'Remboursée', tone: 'ok' }, refusee: { label: 'Refusée', tone: 'danger' },
};
const ATTENDANCE_SOURCES = { web: 'Pointage en ligne', borne: 'Borne de pointage', feuille: 'Feuille de présence', manuel: 'Correction manuelle' };

// Recrutement (pipeline inspiré d'Odoo Recrutement)
const RECRUIT_STAGES = {
  nouveau: 'Nouvelle candidature', qualification: 'Présélection', entretien_1: 'Premier entretien', entretien_2: 'Second entretien',
  proposition: 'Proposition d’embauche', embauche: 'Embauché(e)',
};
const RECRUIT_SOURCES = {
  site_web: 'Site SIIPAF', linkedin: 'LinkedIn', emploi_ci: 'Sites d’emploi', cooptation: 'Cooptation', bouche_a_oreille: 'Bouche-à-oreille',
  cabinet: 'Cabinet de recrutement', agepe: 'AGEPE', spontanee: 'Candidature spontanée', autre: 'Autre',
};
const REFUSE_REASONS = {
  profil: 'Profil inadapté', experience: 'Expérience insuffisante', salaire: 'Prétentions salariales', desistement: 'Désistement du candidat',
  injoignable: 'Candidat injoignable', autre_candidat: 'Autre candidat retenu', poste_ferme: 'Poste fermé',
};
const JOB_STATUSES = { ouvert: 'Ouvert', pourvu: 'Pourvu', ferme: 'Fermé' };
const RESUME_KINDS = { experience: 'Expérience', formation: 'Diplôme, formation', certification: 'Certification', interne: 'Formation interne SIIPAF' };
const TRAINING_STATUSES = { planifiee: 'Planifiée', realisee: 'Réalisée', annulee: 'Annulée' };

/**
 * Types d'absence. paid : maintenu en paie ; deducts : décompté du solde de congés ; count : jours ouvrables ou
 * calendaires ; accrues : compte comme service effectif pour l'acquisition des congés (art. 25.3).
 */
const LEAVE_TYPES = {
  conge_annuel: { label: 'Congé annuel', paid: true, deducts: true, count: 'ouvrables', accrues: true, color: '#1baf7a' },
  permission: { label: 'Permission exceptionnelle', paid: true, deducts: false, count: 'ouvrables', accrues: true, color: '#2a78d6', needs_event: true },
  maladie: { label: 'Maladie', paid: true, deducts: false, count: 'calendaires', accrues: true, color: '#eda100', needs_document: true },
  accident_travail: { label: 'Accident du travail', paid: true, deducts: false, count: 'calendaires', accrues: true, color: '#eb6834', needs_document: true },
  maternite: { label: 'Congé de maternité', paid: true, deducts: false, count: 'calendaires', accrues: true, color: '#e87ba4', needs_document: true },
  paternite: { label: 'Congé de paternité', paid: true, deducts: false, count: 'ouvrables', accrues: true, color: '#6d28d9' },
  formation: { label: 'Formation', paid: true, deducts: false, count: 'ouvrables', accrues: true, color: '#0f8fa3' },
  recuperation: { label: 'Récupération', paid: true, deducts: false, count: 'ouvrables', accrues: true, color: '#5b6170' },
  sans_solde: { label: 'Congé sans solde', paid: false, deducts: false, count: 'calendaires', accrues: false, color: '#8a8f99' },
  absence_injustifiee: { label: 'Absence injustifiée', paid: false, deducts: false, count: 'calendaires', accrues: false, color: '#d2101e', hr_only: true },
};

// Permissions exceptionnelles (art. 25.12) : jours ouvrables accordés par événement familial justifié
const PERMISSION_EVENTS = {
  mariage: { label: 'Mariage du salarié', days: 4 },
  mariage_enfant: { label: 'Mariage d’un enfant', days: 2 },
  mariage_frere_soeur: { label: 'Mariage d’un frère ou d’une sœur', days: 2 },
  deces_conjoint: { label: 'Décès du conjoint', days: 5 },
  deces_enfant_parent: { label: 'Décès d’un enfant, du père ou de la mère', days: 5 },
  deces_frere_soeur: { label: 'Décès d’un frère ou d’une sœur', days: 2 },
  deces_beaux_parents: { label: 'Décès d’un beau-père ou d’une belle-mère', days: 2 },
  naissance: { label: 'Naissance d’un enfant', days: 2 },
  bapteme: { label: 'Baptême d’un enfant', days: 1 },
  communion: { label: 'Première communion', days: 1 },
  demenagement: { label: 'Déménagement', days: 1 },
};

const LEAVE_STATUSES = {
  en_attente: { label: 'À approuver', tone: 'warn' },
  approuve_manager: { label: 'Accord du responsable', tone: 'brand' },
  approuvee: { label: 'Approuvée', tone: 'ok' },
  refusee: { label: 'Refusée', tone: 'danger' },
  annulee: { label: 'Annulée', tone: '' },
};
const LEAVE_ACTIVE = ['en_attente', 'approuve_manager', 'approuvee'];

const DOCUMENT_KINDS = {
  contrat: 'Contrat de travail', avenant: 'Avenant', cni: 'Pièce d’identité', titre_sejour: 'Titre de séjour / permis de travail',
  diplome: 'Diplôme, certificat', cv: 'CV', certificat_medical: 'Certificat médical', attestation: 'Attestation', sanction: 'Courrier disciplinaire', autre: 'Autre',
};
const CAREER_EVENTS = {
  embauche: 'Embauche', fin_essai: 'Confirmation après essai', avenant: 'Avenant au contrat', promotion: 'Promotion', augmentation: 'Révision du salaire',
  mutation: 'Changement de service / affectation', formation: 'Formation suivie', avertissement: 'Avertissement', fin_contrat: 'Fin de contrat', autre: 'Autre',
};
/**
 * Changement de poste (choix du client du 23/10) : motif et type d'événement de carrière correspondant. La date d'effet
 * peut être future : le changement s'applique alors ce jour-là (poste, service, catégorie, salaire, responsable, rôle).
 */
const POSITION_CHANGE_REASONS = {
  promotion: { label: 'Promotion', career: 'promotion' }, mutation: { label: 'Mutation / changement de service', career: 'mutation' },
  reclassement: { label: 'Reclassement', career: 'avenant' }, autre: { label: 'Autre', career: 'autre' },
};
const OBJECTIVE_STATUSES = { en_cours: 'En cours', atteint: 'Atteint', partiel: 'Partiellement atteint', non_atteint: 'Non atteint', abandonne: 'Abandonné' };
/**
 * Indicateurs d'objectifs calculés depuis les données de l'ERP et du dashboard (services/performance.js).
 * unit : nombre, fcfa, pct, heures, jours, note ; lower : plus c'est bas, mieux c'est ; needs : la fiche doit être reliée
 * à un compte du dashboard (user) ou affectée à un programme (project) ; group : famille affichée dans les écrans ;
 * cumul : la valeur s'additionne sur la période (sa cible annuelle est proratisée sur une semaine, un mois…), sinon c'est un taux.
 * Les clés commerciales sont celles de commercial.achieved.
 */
const OBJECTIVE_METRICS = {
  manuel: { label: 'Suivi manuel', group: 'Tous services', unit: null },
  ventes: { label: 'Ventes (dossiers ouverts)', group: 'Commercial', unit: 'nombre', needs: 'user', cumul: true },
  ca_fcfa: { label: 'Chiffre d’affaires signé', group: 'Commercial', unit: 'fcfa', needs: 'user', cumul: true },
  encaissements_fcfa: { label: 'Encaissements', group: 'Commercial', unit: 'fcfa', needs: 'user', cumul: true },
  rdv: { label: 'Rendez-vous réalisés', group: 'Commercial', unit: 'nombre', needs: 'user', cumul: true },
  // Portefeuille (lib/domain.js, portfolioCounts) : attribués − transférés − perdus ; clients gagnés − désistés
  prospects_nets: { label: 'Prospects attribués (nets des pertes et transferts)', group: 'Commercial', unit: 'nombre', needs: 'user', cumul: true },
  clients_nets: { label: 'Nouveaux clients (nets des désistements)', group: 'Commercial', unit: 'nombre', needs: 'user', cumul: true },
  chantier_avancement: { label: 'Avancement du chantier d’affectation', group: 'Chantier et technique', unit: 'pct', needs: 'project' },
  chantier_publications: { label: 'Points d’avancement publiés aux clients', group: 'Chantier et technique', unit: 'nombre', needs: 'user', cumul: true },
  reserves_levees: { label: 'Réserves de livraison levées', group: 'Chantier et technique', unit: 'nombre', needs: 'user', cumul: true },
  interventions_realisees: { label: 'Interventions SAV réalisées', group: 'Chantier et technique', unit: 'nombre', needs: 'user', cumul: true },
  sav_resolus: { label: 'Réclamations résolues', group: 'SAV et qualité', unit: 'nombre', needs: 'user', cumul: true },
  sav_dans_delai: { label: 'Réclamations résolues dans le délai', group: 'SAV et qualité', unit: 'pct', needs: 'user' },
  sav_delai_moyen: { label: 'Délai moyen de résolution', group: 'SAV et qualité', unit: 'heures', needs: 'user', lower: true },
  sav_satisfaction: { label: 'Satisfaction client (sur 5)', group: 'SAV et qualité', unit: 'note', needs: 'user' },
  presence: { label: 'Taux de présence', group: 'Assiduité et formation', unit: 'pct' },
  absences: { label: 'Jours d’absence non planifiée', group: 'Assiduité et formation', unit: 'jours', lower: true, cumul: true },
  formation_heures: { label: 'Heures de formation suivies', group: 'Assiduité et formation', unit: 'heures', cumul: true },
};

/** Atteinte d'un objectif chiffré (0 à 100 %), selon le sens de l'indicateur. */
function attainment(metric, actual, target) {
  const m = OBJECTIVE_METRICS[metric];
  if (actual == null || target == null) return 0;
  if (m?.lower) return actual <= target ? 100 : target > 0 ? Math.max(0, Math.round((target / actual) * 100)) : 0;
  return target > 0 ? Math.min(100, Math.max(0, Math.round((actual / target) * 100))) : 100;
}
const REVIEW_RATINGS = { 1: 'Insuffisant', 2: 'À améliorer', 3: 'Conforme aux attentes', 4: 'Au-delà des attentes', 5: 'Exceptionnel' };

// ─── Calendrier ──────────────────────────────────────────────
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseDay = s => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => { const d = parseDay(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

/** Dimanche de Pâques (algorithme de Meeus / Butcher). */
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Jours fériés à date fixe ou liés à Pâques (décret 2001-22). Les fêtes musulmanes (Aïd el-Fitr, Tabaski, Maouloud,
 * lendemains) dépendent de la lune : elles sont saisies chaque année dans les réglages.
 */
function fixedHolidays(year) {
  const e = easter(year);
  return [
    [`${year}-01-01`, 'Jour de l’an'], [addDays(e, 1), 'Lundi de Pâques'], [`${year}-05-01`, 'Fête du travail'],
    [addDays(e, 39), 'Ascension'], [addDays(e, 50), 'Lundi de Pentecôte'], [`${year}-08-07`, 'Fête de l’indépendance'],
    [`${year}-08-15`, 'Assomption'], [`${year}-11-01`, 'Toussaint'], [`${year}-11-15`, 'Journée nationale de la paix'], [`${year}-12-25`, 'Noël'],
  ].map(([date, label]) => ({ date, label })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Nombre de jours d'une absence : ouvrables (hors jours de repos et fériés) ou calendaires. */
function countDays(start, end, { count = 'ouvrables', holidays = [], workingDays = DEFAULT_RH.working_days, startHalf = false, endHalf = false } = {}) {
  if (!start || !end || end < start) return 0;
  const off = new Set(holidays.map(h => (typeof h === 'string' ? h : h.date)));
  let n = 0;
  const counted = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (count === 'calendaires' || (workingDays.includes(parseDay(d).getUTCDay()) && !off.has(d))) { n++; counted.push(d); }
  }
  if (startHalf && counted[0] === start) n -= 0.5;
  if (endHalf && counted[counted.length - 1] === end && (start !== end || !startHalf)) n -= 0.5;
  return Math.max(0, n);
}

/** Années de service révolues à une date. */
function yearsOfService(hireDate, at) {
  if (!hireDate) return 0;
  const h = parseDay(hireDate), a = parseDay(at);
  let y = a.getUTCFullYear() - h.getUTCFullYear();
  if (a.getUTCMonth() < h.getUTCMonth() || (a.getUTCMonth() === h.getUTCMonth() && a.getUTCDate() < h.getUTCDate())) y--;
  return Math.max(0, y);
}
/** Mois de service entre deux dates (fin exclue) : mois civils entiers, puis jours restants sur 30. */
function monthsBetween(from, to) {
  if (to <= from) return 0;
  const f = parseDay(from), t = parseDay(to);
  let months = (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + t.getUTCMonth() - f.getUTCMonth();
  if (t.getUTCDate() < f.getUTCDate()) months--;
  const anchor = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + months, f.getUTCDate()));
  return Math.max(0, months + (t - anchor) / 86400000 / 30);
}

/** Jours supplémentaires d'une année de référence : ancienneté + enfants à charge (art. 25.2). */
function annualBonus(e, at, s = DEFAULT_RH) {
  const years = yearsOfService(e.hire_date, at);
  const seniority = [...s.seniority_bonus].sort((a, b) => a[0] - b[0]).reduce((t, [y, d]) => (years >= y ? d : t), 0);
  const kids = Number(e.children) || 0;
  let childDays = 0;
  if (kids && s.child_bonus_days) {
    const age = e.birth_date ? yearsOfService(e.birth_date, at) : null;
    if (age != null && age < s.child_bonus_young_age) childDays = kids * s.child_bonus_days;
    else childDays = Math.max(0, kids - s.child_bonus_from_child + 1) * s.child_bonus_days;
  }
  return { seniority, children: childDays, total: seniority + childDays };
}

/**
 * Solde de congés annuels à une date : reprise (solde d'ouverture) + acquisition mensuelle sur le service effectif
 * (absences non assimilées retirées) + majorations à chaque anniversaire d'embauche + ajustements − congés pris.
 * `absences` : [{ type, days_calendar }] des absences approuvées non assimilées ; `taken` : jours de congé annuel
 * approuvés ; `adjustments` : total des corrections manuelles (+/−).
 */
function leaveBalance(e, { at, s = DEFAULT_RH, unpaidCalendarDays = 0, taken = 0, pending = 0, adjustments = 0 }) {
  const from = e.leave_opening_date || e.hire_date;
  const end = e.end_date && e.end_date < at ? e.end_date : at;
  const opening = Number(e.leave_opening_days) || 0;
  if (!from || end < from) return { opening, accrued: 0, bonus: 0, adjustments, taken, pending, balance: opening + adjustments - taken, available: opening + adjustments - taken - pending, months: 0, eligible: false };
  const months = Math.max(0, monthsBetween(from, addDays(end, 1)) - unpaidCalendarDays / 30);
  const accrued = Math.round(months * s.accrual_per_month * 100) / 100;
  let bonus = 0;
  // Majorations acquises à chaque anniversaire d'embauche passé depuis la reprise
  const hire = parseDay(e.hire_date);
  for (let y = hire.getUTCFullYear() + 1; y <= parseDay(end).getUTCFullYear(); y++) {
    const anniversary = `${y}-${pad(hire.getUTCMonth() + 1)}-${pad(hire.getUTCDate())}`;
    if (anniversary > from && anniversary <= end) bonus += annualBonus(e, anniversary, s).total;
  }
  const balance = Math.round((opening + accrued + bonus + adjustments - taken) * 100) / 100;
  const eligible = monthsBetween(e.hire_date, at) >= s.min_months_before_leave || !!e.leave_opening_date;
  return { opening, accrued, bonus, adjustments, taken, pending, balance, available: Math.round((balance - pending) * 100) / 100, months: Math.round(months * 10) / 10, eligible };
}

/** Droit annuel théorique à une date (pour l'affichage) : 12 × acquisition mensuelle + majorations, arrondi. */
function annualEntitlement(e, at, s = DEFAULT_RH) {
  const base = 12 * s.accrual_per_month;
  const bonus = annualBonus(e, at, s);
  const total = base + bonus.total;
  return { base: s.round_up ? Math.ceil(base) : base, ...bonus, total: s.round_up ? Math.ceil(total) : total };
}

// ─── Heures supplémentaires ─────────────────────────────────
const HOUR = 3600000;
const isoMonday = d => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };

/**
 * Découpe un pointage en tranches homogènes (jour ou nuit, jour ordinaire ou dimanche / férié). Les heures sont celles
 * d'Abidjan, qui vit à l'heure UTC toute l'année.
 */
function chunks(from, to, { holidays = new Set(), s = DEFAULT_RH } = {}) {
  const out = [];
  let t = from.getTime();
  const end = to.getTime();
  while (t < end) {
    const d = new Date(t);
    const h = d.getUTCHours();
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const cuts = [dayStart + 24 * HOUR, dayStart + s.night_end * HOUR, dayStart + s.night_start * HOUR].filter(c => c > t);
    const next = Math.min(end, ...cuts);
    const night = h >= s.night_start || h < s.night_end;
    const special = d.getUTCDay() === 0 || holidays.has(ymd(d));
    out.push({ start: t, hours: (next - t) / HOUR, night, special });
    t = next;
  }
  return out;
}

/**
 * Pause déjeuner : un pointage continu de plus de `break_after_hours` perd `break_minutes`, prises à 12 h quand
 * le pointage couvre midi (sinon en fin de journée). Les feuilles de chantier, saisies en deux plages, n'y sont pas soumises.
 */
function withoutBreak(from, to, s = DEFAULT_RH) {
  const ms = (s.break_minutes || 0) * 60000;
  if (!ms || to - from <= (s.break_after_hours || 0) * HOUR) return [[from, to]];
  const noon = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12);
  if (noon > from.getTime() && noon + ms < to.getTime()) return [[from, new Date(noon)], [new Date(noon + ms), to]];
  return [[from, new Date(to.getTime() - ms)]];
}

/**
 * Heures supplémentaires d'un mois à partir des pointages : semaine par semaine (lundi → dimanche, rattachée au mois
 * de son jeudi), les heures au-delà de la durée légale sont majorées selon leur rang (41e à 46e heure, puis au-delà)
 * ou leur moment (nuit, dimanche et jour férié). Montant = heures × taux horaire × (1 + majoration).
 */
function computeOvertime(attendances, { period, baseSalary = 0, holidays = [], s = DEFAULT_RH }) {
  const hol = new Set(holidays.map(h => (typeof h === 'string' ? h : h.date)));
  const weeks = {};
  for (const a of attendances) {
    if (!a.check_in || !a.check_out) continue;
    for (const [from, to] of withoutBreak(new Date(a.check_in), new Date(a.check_out), s))
    for (const c of chunks(from, to, { holidays: hol, s })) {
      const monday = isoMonday(new Date(c.start));
      const thursday = new Date(monday.getTime() + 3 * 24 * HOUR);
      if (ymd(thursday).slice(0, 7) !== period) continue;
      (weeks[ymd(monday)] ||= []).push(c);
    }
  }
  const buckets = { tier: s.overtime_tiers.map(() => 0), night: 0, sunday: 0, sunday_night: 0 };
  let worked = 0, normal = 0;
  const weekRows = [];
  for (const [monday, list] of Object.entries(weeks).sort()) {
    list.sort((a, b) => a.start - b.start);
    let total = 0, extra = 0;
    for (const c of list) {
      let h = c.hours;
      const room = Math.max(0, s.weekly_hours - total);
      const reg = Math.min(h, room);
      normal += reg; total += reg; h -= reg;
      while (h > 1e-9) {
        if (c.special || c.night) {
          buckets[c.special && c.night ? 'sunday_night' : c.special ? 'sunday' : 'night'] += h;
          extra += h; total += h; h = 0;
        } else {
          // Rang de l'heure supplémentaire dans la semaine → tranche
          let start = 0, i = 0;
          for (; i < s.overtime_tiers.length; i++) {
            const size = s.overtime_tiers[i][0];
            if (size == null || extra < start + size) break;
            start += size;
          }
          const size = s.overtime_tiers[i]?.[0];
          const take = size == null ? h : Math.min(h, start + size - extra);
          buckets.tier[i] += take; extra += take; total += take; h -= take;
        }
      }
    }
    worked += total;
    weekRows.push({ monday, hours: round2(total), overtime: round2(extra) });
  }
  const hourly = baseSalary / s.hourly_divisor;
  const lines = [
    ...s.overtime_tiers.map(([size, rate], i) => ({ key: `tier${i}`, label: size == null ? `Heures supplémentaires au-delà (+${rate} %)` : `Heures supplémentaires ${i === 0 ? `${s.weekly_hours + 1}e à ${s.weekly_hours + size}e heure` : 'tranche suivante'} (+${rate} %)`, hours: buckets.tier[i], rate })),
    { key: 'night', label: `Heures de nuit (+${s.night_rate} %)`, hours: buckets.night, rate: s.night_rate },
    { key: 'sunday', label: `Dimanche et jours fériés (+${s.sunday_rate} %)`, hours: buckets.sunday, rate: s.sunday_rate },
    { key: 'sunday_night', label: `Nuit du dimanche et des jours fériés (+${s.sunday_night_rate} %)`, hours: buckets.sunday_night, rate: s.sunday_night_rate },
  ].map(l => ({ ...l, hours: round2(l.hours), amount: Math.round(l.hours * hourly * (1 + l.rate / 100)) })).filter(l => l.hours > 0);
  const overtime = lines.reduce((t, l) => t + l.hours, 0);
  return { period, worked: round2(worked), normal: round2(normal), overtime: round2(overtime), hourly: Math.round(hourly), lines, amount: lines.reduce((t, l) => t + l.amount, 0), weeks: weekRows };
}
const round2 = n => Math.round(n * 100) / 100;

/** Contrôle des réglages saisis. */
function checkRh(s) {
  const errors = [];
  if (!(s.accrual_per_month > 0 && s.accrual_per_month <= 5)) errors.push('Acquisition mensuelle entre 0 et 5 jours.');
  if (!Array.isArray(s.working_days) || !s.working_days.length || s.working_days.some(d => d < 0 || d > 6)) errors.push('Choisissez au moins un jour ouvrable.');
  let prev = -1;
  for (const [y, d] of s.seniority_bonus) {
    if (y <= prev) errors.push('Paliers d’ancienneté croissants.');
    if (d < 0) errors.push('Majoration d’ancienneté positive.');
    prev = y;
  }
  if (!(s.weekly_hours > 0 && s.weekly_hours <= 60)) errors.push('Durée hebdomadaire entre 1 et 60 heures.');
  if (!(s.hourly_divisor > 0)) errors.push('Diviseur du taux horaire positif.');
  if (!s.overtime_tiers.length || s.overtime_tiers[s.overtime_tiers.length - 1][0] != null) errors.push('La dernière tranche d’heures supplémentaires est sans limite.');
  for (const [, c] of Object.entries(s.expense_categories || {})) if (!c.label || !/^\d{2,12}$/.test(c.account || '')) errors.push('Chaque catégorie de frais a un libellé et un compte.');
  return [...new Set(errors)];
}

module.exports = {
  DEFAULT_RH, LEAVE_TYPES, PERMISSION_EVENTS, LEAVE_STATUSES, LEAVE_ACTIVE, DOCUMENT_KINDS, CAREER_EVENTS, POSITION_CHANGE_REASONS, OBJECTIVE_STATUSES, OBJECTIVE_METRICS, REVIEW_RATINGS,
  EXPENSE_STATUSES, ATTENDANCE_SOURCES, RECRUIT_STAGES, RECRUIT_SOURCES, REFUSE_REASONS, JOB_STATUSES, RESUME_KINDS, TRAINING_STATUSES,
  easter, fixedHolidays, countDays, yearsOfService, annualBonus, leaveBalance, annualEntitlement, checkRh, addDays, chunks, withoutBreak, computeOvertime, attainment,
};
