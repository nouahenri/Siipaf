/**
 * ERP · RH : congés et absences (contrôles du Code du travail, circuit d'approbation responsable → RH, soldes),
 * jours fériés, dossiers du personnel (documents privés, carrière), objectifs et entretiens, tableau de bord.
 * Les absences non payées approuvées réduisent les jours payés de la paie (services/paie.js).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { HttpError, json, isoDay } = require('../lib/http');
const { uploadsDir } = require('../config');
const {
  DEFAULT_RH, LEAVE_TYPES, PERMISSION_EVENTS, LEAVE_ACTIVE, fixedHolidays, countDays, leaveBalance, annualEntitlement, checkRh, yearsOfService, addDays,
} = require('../lib/rh');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const today = () => new Date().toISOString().slice(0, 10);
const monthsSince = (from, at) => (from ? (new Date(`${at}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000 / (365.25 / 12) : 0);
const overlap = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && bStart <= aEnd;
const fullName = e => `${e.last_name} ${e.first_name}`;

// ─── Réglages et jours fériés ───────────────────────────────
async function getSettings(db) {
  const row = await db('app_settings').where({ key: 'rh' }).first();
  return { ...DEFAULT_RH, ...(json(row?.value, {}) || {}) };
}
async function saveSettings(db, patch) {
  const next = { ...(await getSettings(db)), ...patch };
  const errors = checkRh(next);
  if (errors.length) throw new HttpError(400, errors.join(' '));
  const row = { key: 'rh', value: JSON.stringify(next), updated_at: new Date() };
  if (await db('app_settings').where({ key: 'rh' }).first()) await db('app_settings').where({ key: 'rh' }).update(row);
  else await db('app_settings').insert(row);
  return next;
}

async function holidays(db, from, to) {
  const rows = await db('hr_holidays').orderBy('date').select('date', 'label', 'id');
  return rows.map(h => ({ ...h, date: isoDay(h.date) })).filter(h => (!from || h.date >= from) && (!to || h.date <= to));
}

/** Ajoute les jours fériés fixes et liés à Pâques d'une année (les fêtes musulmanes se saisissent à la main). */
async function seedHolidays(db, year) {
  const existing = new Set((await holidays(db)).map(h => h.date));
  const rows = fixedHolidays(year).filter(h => !existing.has(h.date));
  if (rows.length) await db('hr_holidays').insert(rows);
  return rows.length;
}

// ─── Employés ───────────────────────────────────────────────
const normEmployee = e => e && ({
  ...e, hire_date: isoDay(e.hire_date), end_date: isoDay(e.end_date), birth_date: isoDay(e.birth_date), trial_end_date: isoDay(e.trial_end_date),
  leave_opening_date: isoDay(e.leave_opening_date), leave_opening_days: e.leave_opening_days == null ? null : Number(e.leave_opening_days), active: !!e.active,
});
const employeeOf = async (db, userId) => normEmployee(await db('employees').where({ user_id: userId }).first());
const getEmployee = async (db, id) => {
  const e = normEmployee(await db('employees').where({ id }).first());
  if (!e) throw new HttpError(404, 'Employé introuvable.');
  return e;
};

/** Le compte connecté est-il le responsable direct de cet employé ? */
async function isManagerOf(db, userId, employee) {
  if (!employee.manager_id) return false;
  const m = await db('employees').where({ id: employee.manager_id }).first('user_id');
  return !!m && m.user_id === userId;
}

/** Accès au dossier d'un employé : service RH (droit donné), l'employé lui-même, ou son responsable direct. */
async function accessLevel(db, req, e, perm = 'rh:read') {
  if (req.can(perm)) return 'rh';
  if (e.user_id && e.user_id === req.user.id) return 'self';
  if (await isManagerOf(db, req.user.id, e)) return 'manager';
  throw new HttpError(403, 'Droits insuffisants.');
}

// ─── Soldes ─────────────────────────────────────────────────
const normLeave = l => ({
  ...l, start_date: isoDay(l.start_date), end_date: isoDay(l.end_date), days: Number(l.days), start_half: !!l.start_half, end_half: !!l.end_half,
});

/** Jours calendaires d'une absence compris entre deux dates. */
function calendarOverlap(l, from, to) {
  const s = l.start_date > from ? l.start_date : from;
  const e = l.end_date < to ? l.end_date : to;
  return e < s ? 0 : Math.round((new Date(`${e}T00:00:00Z`) - new Date(`${s}T00:00:00Z`)) / 86400000) + 1;
}

/** Solde de congés annuels d'un employé (acquis, pris, en attente) à une date. */
async function balanceOf(db, e, { at = today(), settings, excludeId = null } = {}) {
  const s = settings || await getSettings(db);
  const leaves = (await db('hr_leaves').where({ employee_id: e.id }).whereIn('status', LEAVE_ACTIVE)).map(normLeave).filter(l => l.id !== excludeId);
  const from = e.leave_opening_date || e.hire_date;
  const unpaidCalendarDays = leaves.filter(l => l.status === 'approuvee' && LEAVE_TYPES[l.type] && !LEAVE_TYPES[l.type].accrues)
    .reduce((t, l) => t + calendarOverlap(l, from, at), 0);
  const annual = leaves.filter(l => l.type === 'conge_annuel' && (!e.leave_opening_date || l.start_date >= e.leave_opening_date));
  const taken = annual.filter(l => l.status === 'approuvee').reduce((t, l) => t + l.days, 0);
  const pending = annual.filter(l => l.status !== 'approuvee').reduce((t, l) => t + l.days, 0);
  const adjustments = (await db('hr_leave_adjustments').where({ employee_id: e.id })).reduce((t, a) => t + Number(a.days), 0);
  return { ...leaveBalance(e, { at, s, unpaidCalendarDays, taken, pending, adjustments }), entitlement: annualEntitlement(e, at, s), seniority_years: yearsOfService(e.hire_date, at) };
}

// ─── Demandes de congé et d'absence ─────────────────────────
/**
 * Contrôle d'une demande et calcul des jours décomptés. `asHr` : saisie par le service RH (types réservés,
 * anticipation tolérée si le réglage l'autorise).
 */
async function checkLeave(db, e, data, { asHr = false, excludeId = null } = {}) {
  const s = await getSettings(db);
  const type = LEAVE_TYPES[data.type];
  if (!type) throw new HttpError(400, 'Type d’absence inconnu.');
  if (type.hr_only && !asHr) throw new HttpError(403, 'Seul le service RH enregistre ce type d’absence.');
  if (data.end_date < data.start_date) throw new HttpError(400, 'La date de fin précède la date de début.');
  if (data.start_date < e.hire_date || (e.end_date && data.end_date > e.end_date)) throw new HttpError(400, 'Absence en dehors du contrat de l’employé.');

  const hols = await holidays(db, data.start_date, data.end_date);
  const days = countDays(data.start_date, data.end_date, {
    count: type.count, holidays: hols, workingDays: s.working_days, startHalf: !!data.start_half, endHalf: !!data.end_half,
  });
  const calendarDays = calendarOverlap({ start_date: data.start_date, end_date: data.end_date }, data.start_date, data.end_date);
  if (!days) throw new HttpError(400, 'Aucun jour décompté : la période ne couvre que des jours de repos ou fériés.');

  const others = (await db('hr_leaves').where({ employee_id: e.id }).whereIn('status', LEAVE_ACTIVE)).map(normLeave).filter(l => l.id !== excludeId);
  const clash = others.find(l => overlap(l.start_date, l.end_date, data.start_date, data.end_date));
  if (clash) throw new HttpError(409, `Une autre absence couvre déjà cette période (${LEAVE_TYPES[clash.type]?.label || clash.type} du ${clash.start_date} au ${clash.end_date}).`);

  const warnings = [];
  if (data.type === 'permission') {
    const ev = PERMISSION_EVENTS[data.event];
    if (!ev) throw new HttpError(400, 'Précisez l’événement familial de la permission.');
    if (days > ev.days) throw new HttpError(400, `${ev.label} : ${ev.days} jour(s) ouvrable(s) au plus.`);
    if (monthsSince(e.hire_date, data.start_date) < s.permission_min_months) throw new HttpError(400, `Permissions exceptionnelles ouvertes après ${s.permission_min_months} mois de présence.`);
    const year = data.start_date.slice(0, 4);
    const used = others.filter(l => l.type === 'permission' && l.start_date.startsWith(year)).reduce((t, l) => t + l.days, 0);
    if (used + days > s.permission_max_days) throw new HttpError(400, `Plafond de ${s.permission_max_days} jours de permission par an atteint (${used} déjà accordé(s)).`);
  }
  if (data.type === 'maternite') {
    if (e.gender === 'M') throw new HttpError(400, 'Congé de maternité : salariée uniquement.');
    if (days > s.maternity_days) throw new HttpError(400, `Congé de maternité : ${s.maternity_days} jours au plus (prolongation pour maladie : type « Maladie »).`);
  }
  if (data.type === 'paternite' && days > s.paternity_days) throw new HttpError(400, `Congé de paternité : ${s.paternity_days} jours au plus.`);
  if (data.type === 'conge_annuel') {
    const b = await balanceOf(db, e, { at: data.start_date, settings: s, excludeId });
    if (!b.eligible) {
      if (!(asHr && s.allow_negative)) throw new HttpError(400, `Premier congé annuel après ${s.min_months_before_leave} mois de service.`);
      warnings.push('Congé pris avant un an de service (anticipation).');
    }
    if (days > b.available) {
      if (!s.allow_negative) throw new HttpError(400, `Solde insuffisant : ${b.available} jour(s) disponible(s) au ${data.start_date}, ${days} demandé(s).`);
      warnings.push(`Solde dépassé : ${b.available} jour(s) disponible(s).`);
    }
    if (days < s.min_continuous_days) warnings.push(`Fraction de moins de ${s.min_continuous_days} jours : l’accord du salarié est requis et une fraction principale d’au moins ${s.min_continuous_days} jours doit être prise dans l’année.`);
  }
  if (type.needs_document && !data.document_id) warnings.push('Justificatif à joindre (certificat médical, attestation).');
  return { days, calendar_days: calendarDays, warnings };
}

async function createLeave(db, e, data, { user, asHr = false, approve = false }) {
  const { days, calendar_days, warnings } = await checkLeave(db, e, data, { asHr });
  const row = {
    employee_id: e.id, type: data.type, event: data.type === 'permission' ? data.event : null, start_date: data.start_date, end_date: data.end_date,
    start_half: !!data.start_half, end_half: !!data.end_half, days, calendar_days, reason: data.reason || null, document_id: data.document_id || null,
    requested_by: user.id, status: 'en_attente',
  };
  const ownLeave = e.user_id === user.id;
  if ((approve && asHr && !ownLeave) || LEAVE_TYPES[data.type].hr_only) Object.assign(row, { status: 'approuvee', decided_by: user.id, decided_at: new Date() });
  const [id] = await db('hr_leaves').insert(row);
  const leave = await leaveDetail(db, insertedId(id));
  if (row.status === 'en_attente') await notifyLeave(db, leave, e, { user });
  return { leave, warnings };
}

/**
 * Circuit des congés dans la cloche : le responsable direct puis le service RH (droit conges:approve) sont prévenus
 * de ce qu'ils ont à approuver ; l'employé, de la décision. Une demande close n'est plus « à traiter » chez personne.
 */
async function notifyLeave(db, l, e, { user }) {
  const { notify, usersWith, employeeUser, resolve } = require('./notifications');
  const who = `${e.last_name} ${e.first_name}`;
  const period = `du ${l.start_date.split('-').reverse().join('/')} au ${l.end_date.split('-').reverse().join('/')} (${l.days} j)`;
  const toRh = async () => notify(db, {
    to: await usersWith(db, 'conges:approve'), except: user.id, module: 'rh', event: 'conge.a_approuver',
    title: `Congé à approuver : ${who}`, body: `${l.label} ${period}`, link: '/rh/conges', priority: 'action', key: `conge:${l.id}:rh`,
  });
  if (l.status === 'en_attente') {
    const manager = await employeeUser(db, e.manager_id);
    if (manager && manager.id !== e.user_id) {
      await notify(db, { to: manager, except: user.id, module: 'rh', event: 'conge.demande', title: `Demande de congé : ${who}`, body: `${l.label} ${period}`, link: '/rh/conges', priority: 'action', key: `conge:${l.id}:manager` });
    } else await toRh();
    return;
  }
  if (l.status === 'approuve_manager') {
    await resolve(db, `conge:${l.id}:manager`);
    await toRh();
    return;
  }
  await resolve(db, `conge:${l.id}:`);
  const labels = { approuvee: 'approuvée', refusee: 'refusée', annulee: 'annulée' };
  if (labels[l.status] && e.user_id) {
    await notify(db, {
      to: e.user_id, except: user.id, module: 'rh', event: `conge.${l.status}`, title: `Votre demande de congé est ${labels[l.status]}`,
      body: [`${l.label} ${period}`, l.status === 'refusee' && l.decision_note ? `Motif : ${l.decision_note}` : null].filter(Boolean).join(' — '),
      link: '/rh/moi', key: `conge:${l.id}:decision:${l.status}`,
    });
  }
}

/**
 * Circuit d'approbation : le responsable direct donne son accord (premier niveau), le service RH approuve
 * définitivement. Personne n'approuve sa propre absence (sauf le super administrateur).
 */
async function decideLeave(db, leaveId, { action, note = null }, { user, can }) {
  const l = normLeave(await db('hr_leaves').where({ id: leaveId }).first() || {});
  if (!l.id) throw new HttpError(404, 'Demande introuvable.');
  const e = await getEmployee(db, l.employee_id);
  const s = await getSettings(db);
  // Droits : « Approuver les congés » (statuer sur toutes les demandes), « Gérer les absences » (annuler une absence commencée)
  const hr = can('conges:approve');
  const manager = await isManagerOf(db, user.id, e);
  const own = e.user_id === user.id;
  const superAdmin = user.role === 'super_admin';
  const patch = { updated_at: new Date() };

  if (action === 'cancel') {
    if (['refusee', 'annulee'].includes(l.status)) throw new HttpError(409, 'Demande déjà close.');
    if (!can('conges:manage') && !(own && (l.status !== 'approuvee' || l.start_date > today()))) throw new HttpError(403, 'Seul le service RH annule une absence déjà commencée.');
    Object.assign(patch, { status: 'annulee', decision_note: note || l.decision_note, decided_by: user.id, decided_at: new Date() });
  } else {
    if (!['en_attente', 'approuve_manager'].includes(l.status)) throw new HttpError(409, 'Cette demande n’est plus à approuver.');
    if (own && !superAdmin) throw new HttpError(403, 'Vous ne pouvez pas statuer sur votre propre demande.');
    if (!hr && !manager) throw new HttpError(403, 'Seuls le responsable direct et le service RH statuent sur cette demande.');
    if (action === 'refuse') {
      if (!note) throw new HttpError(400, 'Indiquez le motif du refus.');
      Object.assign(patch, { status: 'refusee', decision_note: note, decided_by: user.id, decided_at: new Date() });
    } else if (action === 'approve') {
      // Contrôles refaits au moment de l'accord (solde, chevauchements, plafonds)
      await checkLeave(db, e, l, { asHr: hr, excludeId: l.id });
      if (hr || s.approval !== 'manager_then_rh') Object.assign(patch, { status: 'approuvee', decided_by: user.id, decided_at: new Date(), decision_note: note || null });
      else Object.assign(patch, { status: 'approuve_manager', manager_by: user.id, manager_at: new Date(), decision_note: note || null });
      if (manager && !l.manager_by) Object.assign(patch, { manager_by: user.id, manager_at: new Date() });
    } else throw new HttpError(400, 'Action inconnue.');
  }
  await db('hr_leaves').where({ id: l.id }).update(patch);
  const detail = await leaveDetail(db, l.id);
  await notifyLeave(db, detail, e, { user });
  return detail;
}

function leaveQuery(db) {
  return db('hr_leaves as l').join('employees as e', 'e.id', 'l.employee_id')
    .leftJoin('users as rq', 'rq.id', 'l.requested_by').leftJoin('users as mg', 'mg.id', 'l.manager_by').leftJoin('users as dc', 'dc.id', 'l.decided_by')
    .select('l.*', 'e.matricule', 'e.last_name', 'e.first_name', 'e.department', 'e.manager_id', 'e.user_id as employee_user_id',
      'rq.name as requested_by_name', 'mg.name as manager_name', 'dc.name as decided_by_name');
}
const serializeLeave = l => ({
  ...normLeave(l), employee_name: `${l.last_name} ${l.first_name}`, label: LEAVE_TYPES[l.type]?.label || l.type,
  event_label: l.event ? PERMISSION_EVENTS[l.event]?.label || l.event : null, paid: LEAVE_TYPES[l.type]?.paid ?? true,
});
async function leaveDetail(db, id) {
  const l = await leaveQuery(db).where('l.id', id).first();
  return l && serializeLeave(l);
}

/** Demandes que ce compte peut traiter : celles de son équipe (responsable) ou toutes (RH). */
async function toApprove(db, { user, can }) {
  const q = leaveQuery(db).whereIn('l.status', ['en_attente', 'approuve_manager']).orderBy('l.start_date');
  const rows = (await q).map(serializeLeave);
  if (can('conges:approve')) return rows.filter(l => l.employee_user_id !== user.id || user.role === 'super_admin');
  const me = await employeeOf(db, user.id);
  if (!me) return [];
  return rows.filter(l => l.manager_id === me.id && l.status === 'en_attente');
}

// ─── Paie : jours non payés ─────────────────────────────────
/** Jours calendaires d'absence non payée (congé sans solde, absence injustifiée) approuvés dans un mois, sur 30. */
async function unpaidDays(db, employeeId, period) {
  const [y, m] = period.split('-').map(Number);
  const from = `${period}-01`, to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const unpaid = Object.entries(LEAVE_TYPES).filter(([, t]) => !t.paid).map(([k]) => k);
  const rows = (await db('hr_leaves').where({ employee_id: employeeId, status: 'approuvee' }).whereIn('type', unpaid)).map(normLeave);
  return Math.min(30, rows.reduce((t, l) => t + calendarOverlap(l, from, to), 0));
}

// ─── Dossier : documents privés et carrière ─────────────────
// Rangés hors de la partie publique de /uploads (app.js bloque /uploads/private) ; servis après contrôle des droits.
const hrFilesDir = path.join(uploadsDir, 'private', 'rh');
const DOC_MIME = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'application/msword': '.doc' };
function documentUpload() {
  fs.mkdirSync(hrFilesDir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: hrFilesDir,
      filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${DOC_MIME[file.mimetype]}`),
    }),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(DOC_MIME[file.mimetype] ? null : new HttpError(400, 'Envoyez un PDF, une image (JPEG, PNG, WebP) ou un document Word.'), !!DOC_MIME[file.mimetype]),
  }).single('file');
}

// Champs suivis dans l'historique de carrière quand la fiche change
const TRACKED = {
  job_title: ['promotion', 'Poste'], department: ['mutation', 'Service'], project_id: ['mutation', 'Affectation'], contract_type: ['avenant', 'Contrat'],
  category: ['promotion', 'Catégorie'], base_salary: ['augmentation', 'Salaire de base'], end_date: ['fin_contrat', 'Fin de contrat'], trial_end_date: ['fin_essai', 'Fin de la période d’essai'],
};
/** Historique de carrière tenu automatiquement à partir des modifications de la fiche employé. */
async function logChanges(trx, before, after, userId) {
  const changes = Object.entries(TRACKED).filter(([k]) => after[k] !== undefined && String(before[k] ?? '') !== String(after[k] ?? ''));
  if (!changes.length) return 0;
  const kinds = [...new Set(changes.map(([, [kind]]) => kind))];
  const kind = kinds.includes('augmentation') && kinds.length === 1 ? 'augmentation' : kinds.includes('promotion') ? 'promotion' : kinds[0];
  const details = Object.fromEntries(changes.map(([k]) => [k, { from: before[k] ?? null, to: after[k] ?? null }]));
  await trx('hr_career_events').insert({
    employee_id: before.id, date: today(), kind, label: changes.map(([, [, label]]) => label).join(', ') + ' modifié(s)', details: JSON.stringify(details), created_by: userId,
  });
  return 1;
}

/** Historique de carrière ; le salaire n'apparaît qu'aux personnes autorisées à voir la paie. */
async function careerOf(db, employeeId, { withPay }) {
  const rows = await db('hr_career_events as c').leftJoin('users as u', 'u.id', 'c.created_by').where('c.employee_id', employeeId)
    .orderBy([{ column: 'c.date', order: 'desc' }, { column: 'c.id', order: 'desc' }]).select('c.*', 'u.name as created_by_name');
  return rows.map(c => {
    const details = json(c.details, {}) || {};
    if (!withPay) delete details.base_salary;
    return { ...c, date: isoDay(c.date), details };
  }).filter(c => withPay || c.kind !== 'augmentation' || Object.keys(c.details).length);
}

// ─── Objectifs ──────────────────────────────────────────────
/**
 * Objectifs d'un employé : les indicateurs chiffrés (ventes, chantier, SAV, assiduité, formation) sont calculés
 * depuis les données de l'ERP et du dashboard (services/performance.js).
 */
async function objectivesOf(db, e, year) {
  return (await require('./performance').scorecard(db, e, year)).objectives;
}

// ─── Tableau de bord ────────────────────────────────────────
async function dashboard(db, at = today()) {
  const s = await getSettings(db);
  const all = (await db('employees')).map(normEmployee);
  const active = all.filter(e => e.active && e.hire_date <= at && (!e.end_date || e.end_date >= at));
  const count = (list, key) => list.reduce((m, e) => ({ ...m, [e[key] || '—']: (m[e[key] || '—'] || 0) + 1 }), {});
  const leaves = (await leaveQuery(db).whereIn('l.status', LEAVE_ACTIVE)).map(serializeLeave);
  const absentToday = leaves.filter(l => l.status === 'approuvee' && l.start_date <= at && l.end_date >= at);
  const in30 = addDays(at, 30), in60 = addDays(at, 60);

  // 12 derniers mois : entrées, sorties, effectif en fin de mois, jours d'absence par type
  const months = [];
  const [y0, m0] = at.split('-').map(Number);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y0, m0 - 1 - i, 1));
    const key = d.toISOString().slice(0, 7);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const approved = leaves.filter(l => l.status === 'approuvee');
    const byType = {};
    for (const l of approved) {
      const n = calendarOverlap(l, `${key}-01`, end);
      if (n) byType[l.type] = (byType[l.type] || 0) + n;
    }
    months.push({
      month: key,
      entrees: all.filter(e => e.hire_date?.startsWith(key)).length,
      sorties: all.filter(e => e.end_date?.startsWith(key)).length,
      effectif: all.filter(e => e.hire_date <= end && (!e.end_date || e.end_date >= end)).length,
      absences: byType,
    });
  }
  // Absentéisme du mois : jours d'absence hors congés annuels, permissions et maternité / effectif × jours ouvrables
  const cur = months[months.length - 1];
  const workDays = countDays(`${cur.month}-01`, new Date(Date.UTC(y0, m0, 0)).toISOString().slice(0, 10), { holidays: await holidays(db), workingDays: s.working_days });
  const absentDays = ['maladie', 'accident_travail', 'sans_solde', 'absence_injustifiee'].reduce((t, k) => t + (cur.absences[k] || 0), 0);

  const docs = (await db('hr_documents as d').join('employees as e', 'e.id', 'd.employee_id').whereNotNull('d.expires_at').where('e.active', true)
    .select('d.id', 'd.label', 'd.kind', 'd.expires_at', 'd.employee_id', 'e.last_name', 'e.first_name'))
    .map(d => ({ ...d, expires_at: isoDay(d.expires_at), employee_name: `${d.last_name} ${d.first_name}` })).filter(d => d.expires_at <= in60).sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  const birthday = e => {
    if (!e.birth_date) return null;
    let next = `${at.slice(0, 4)}${e.birth_date.slice(4)}`;
    if (next < at) next = `${Number(at.slice(0, 4)) + 1}${e.birth_date.slice(4)}`;
    return next;
  };
  const skills = (await db('hr_employee_skills as es').join('employees as e', 'e.id', 'es.employee_id').join('hr_skills as s', 's.id', 'es.skill_id')
    .whereNotNull('es.expires_at').where('e.active', true).select('es.expires_at', 'es.employee_id', 'e.last_name', 'e.first_name', 's.name'))
    .map(x => ({ ...x, expires_at: isoDay(x.expires_at) })).filter(x => x.expires_at <= in60);
  const alerts = [
    ...skills.map(x => ({ kind: 'habilitation', date: x.expires_at, employee_id: x.employee_id, employee_name: `${x.last_name} ${x.first_name}`, label: `${x.name} : ${x.expires_at < at ? 'à renouveler (expirée)' : 'à renouveler'}` })),
    ...active.filter(e => e.trial_end_date && e.trial_end_date >= at && e.trial_end_date <= in30).map(e => ({ kind: 'essai', date: e.trial_end_date, employee_id: e.id, employee_name: fullName(e), label: 'Fin de la période d’essai' })),
    ...active.filter(e => e.end_date && e.end_date >= at && e.end_date <= in60).map(e => ({ kind: 'contrat', date: e.end_date, employee_id: e.id, employee_name: fullName(e), label: `Fin de ${e.contract_type === 'cdd' ? 'CDD' : 'contrat'}` })),
    ...docs.map(d => ({ kind: 'document', date: d.expires_at, employee_id: d.employee_id, employee_name: d.employee_name, label: `${d.label} : ${d.expires_at < at ? 'expiré' : 'expire'}` })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const dayStart = new Date(`${at}T00:00:00Z`);
  const [present, expenses, jobs, applicants, trainings] = await Promise.all([
    db('hr_attendances').whereNull('check_out').where('check_in', '>=', dayStart).countDistinct({ n: 'employee_id' }).first(),
    db('hr_expenses').where({ status: 'soumise' }).count({ n: '*' }).first(),
    db('hr_jobs').where({ status: 'ouvert' }).count({ n: '*' }).first(),
    db('hr_applicants').where({ stage: 'nouveau' }).whereNull('refuse_reason').count({ n: '*' }).first(),
    db('hr_trainings').where({ status: 'planifiee' }).select('id', 'title', 'start_date'),
  ]);
  return {
    at, headcount: active.length,
    present_now: Number(present?.n || 0), expenses_to_approve: Number(expenses?.n || 0), open_jobs: Number(jobs?.n || 0), new_applicants: Number(applicants?.n || 0),
    trainings_soon: trainings.map(t => ({ ...t, start_date: isoDay(t.start_date) })).filter(t => t.start_date >= at && t.start_date <= in30).sort((a, b) => a.start_date.localeCompare(b.start_date)),
    departments: count(active, 'department'), contracts: count(active, 'contract_type'), genders: count(active, 'gender'),
    avg_seniority: active.length ? Math.round((active.reduce((t, e) => t + monthsSince(e.hire_date, at), 0) / active.length / 12) * 10) / 10 : 0,
    pending: leaves.filter(l => ['en_attente', 'approuve_manager'].includes(l.status)).length,
    absent_today: absentToday, upcoming: leaves.filter(l => l.status === 'approuvee' && l.start_date > at && l.start_date <= in30).sort((a, b) => a.start_date.localeCompare(b.start_date)),
    absenteeism_pct: active.length && workDays ? Math.round((absentDays / (active.length * workDays)) * 1000) / 10 : 0,
    months, alerts,
    birthdays: active.map(e => ({ employee_id: e.id, employee_name: fullName(e), date: birthday(e) })).filter(b => b.date && b.date <= in30).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

module.exports = {
  getSettings, saveSettings, holidays, seedHolidays, employeeOf, getEmployee, isManagerOf, accessLevel, balanceOf, checkLeave, createLeave, decideLeave,
  leaveQuery, serializeLeave, leaveDetail, toApprove, unpaidDays, documentUpload, hrFilesDir, logChanges, careerOf, objectivesOf, dashboard, normEmployee, calendarOverlap,
};
