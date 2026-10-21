/**
 * ERP · RH › Présences (référence : Odoo Présences) : pointage d'arrivée et de départ (en ligne, sur une borne
 * de chantier avec matricule et code, ou par feuille de présence du conducteur de travaux), corrections tracées,
 * heures supplémentaires du mois arrêtées par le service RH puis reprises dans la paie.
 */
const { HttpError, toDate, isoTime } = require('../lib/http');
const { hashPassword, checkPassword } = require('../auth');
const { computeOvertime, LEAVE_TYPES } = require('../lib/rh');
const rh = require('./rh');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const HOUR = 3600000;
const lastDay = period => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

const serialize = a => {
  const inAt = toDate(a.check_in), outAt = toDate(a.check_out);
  return {
    ...a, check_in: isoTime(a.check_in), check_out: isoTime(a.check_out), latitude: a.latitude == null ? null : Number(a.latitude), longitude: a.longitude == null ? null : Number(a.longitude),
    hours: outAt ? Math.round(((outAt - inAt) / HOUR) * 100) / 100 : null, employee_name: a.last_name ? `${a.last_name} ${a.first_name}` : undefined,
  };
};
const query = db => db('hr_attendances as a').join('employees as e', 'e.id', 'a.employee_id').leftJoin('projects as p', 'p.id', 'a.project_id').leftJoin('users as u', 'u.id', 'a.created_by')
  .select('a.*', 'e.matricule', 'e.last_name', 'e.first_name', 'e.department', 'e.manager_id', 'p.name as project_name', 'u.name as created_by_name');

/** Pointage en cours (arrivée sans départ) d'un employé. */
async function openOf(db, employeeId) {
  const a = await db('hr_attendances').where({ employee_id: employeeId }).whereNull('check_out').orderBy('check_in', 'desc').first();
  return a ? serialize(a) : null;
}

/** Arrivée ou départ selon l'état du pointage ; refus si l'employé est sorti des effectifs. */
async function toggle(db, e, { project_id = null, latitude = null, longitude = null, source = 'web', userId = null, at = new Date() }) {
  if (!e.active || (e.end_date && e.end_date < at.toISOString().slice(0, 10))) throw new HttpError(400, 'Employé sorti des effectifs.');
  const open = await openOf(db, e.id);
  if (open) {
    if (at - toDate(open.check_in) > 16 * HOUR) throw new HttpError(409, 'Pointage d’arrivée de plus de 16 heures : demandez une correction au service RH ou au conducteur de travaux.');
    await db('hr_attendances').where({ id: open.id }).update({ check_out: at, updated_at: new Date() });
    return { action: 'depart', attendance: serialize(await db('hr_attendances').where({ id: open.id }).first()) };
  }
  const [id] = await db('hr_attendances').insert({ employee_id: e.id, check_in: at, source, project_id, latitude, longitude, created_by: userId });
  return { action: 'arrivee', attendance: serialize(await db('hr_attendances').where({ id: insertedId(id) }).first()) };
}

/** Borne de pointage : matricule + code personnel, sur une tablette ouverte par un compte autorisé. */
async function kiosk(db, { matricule, pin, project_id }, userId) {
  const e = rh.normEmployee(await db('employees').where({ matricule: String(matricule).trim().toUpperCase() }).first());
  if (!e || !e.attendance_pin_hash || !(await checkPassword(String(pin), e.attendance_pin_hash))) throw new HttpError(401, 'Matricule ou code incorrect.');
  const r = await toggle(db, e, { project_id, source: 'borne', userId });
  return { ...r, employee: { id: e.id, name: `${e.last_name} ${e.first_name}`, matricule: e.matricule } };
}

async function setPin(db, employeeId, pin) {
  if (!/^\d{4,6}$/.test(String(pin))) throw new HttpError(400, 'Code de 4 à 6 chiffres.');
  await db('employees').where({ id: employeeId }).update({ attendance_pin_hash: await hashPassword(String(pin)), updated_at: new Date() });
}

const at = (date, hm) => {
  if (!/^\d{2}:\d{2}$/.test(hm)) throw new HttpError(400, 'Heure attendue au format HH:MM.');
  return new Date(`${date}T${hm}:00Z`);
};

/**
 * Feuille de présence d'une journée de chantier : pour chaque ouvrier, une ou deux plages (matin, après-midi).
 * Remplace les pointages « feuille » de la même journée et du même chantier.
 */
async function saveSheet(db, { date, project_id = null, rows }, userId) {
  const from = new Date(`${date}T00:00:00Z`), to = new Date(from.getTime() + 24 * HOUR);
  return db.transaction(async trx => {
    let created = 0;
    for (const r of rows) {
      const e = await trx('employees').where({ id: r.employee_id }).first();
      if (!e) throw new HttpError(404, 'Employé introuvable.');
      const del = trx('hr_attendances').where({ employee_id: e.id, source: 'feuille' }).where('check_in', '>=', from).where('check_in', '<', to);
      if (project_id) del.where({ project_id }); else del.whereNull('project_id');
      await del.del();
      for (const [start, end] of r.periods || []) {
        const a = at(date, start), b = at(date, end);
        if (b <= a) throw new HttpError(400, `${e.last_name} ${e.first_name} : l’heure de fin précède l’heure de début.`);
        const clash = (await trx('hr_attendances').where({ employee_id: e.id })).find(x => toDate(x.check_in) < b && (toDate(x.check_out) || new Date(8.64e15)) > a);
        if (clash) throw new HttpError(409, `${e.last_name} ${e.first_name} a déjà un pointage sur cette plage.`);
        await trx('hr_attendances').insert({ employee_id: e.id, check_in: a, check_out: b, source: 'feuille', project_id, note: r.note || null, created_by: userId });
        created++;
      }
    }
    return created;
  });
}

/** Correction ou saisie manuelle (motif obligatoire) : arrivée avant départ, pas de chevauchement. */
async function upsertManual(db, { id = null, employee_id, check_in, check_out, project_id = null, note }, userId) {
  const a = toDate(check_in), b = check_out ? toDate(check_out) : null;
  if (!a || (check_out && !b)) throw new HttpError(400, 'Date et heure invalides.');
  if (b && b <= a) throw new HttpError(400, 'Le départ précède l’arrivée.');
  if (b && b - a > 24 * HOUR) throw new HttpError(400, 'Un pointage ne dépasse pas 24 heures.');
  const others = (await db('hr_attendances').where({ employee_id })).filter(x => x.id !== id);
  if (others.some(x => toDate(x.check_in) < (b || new Date(8.64e15)) && (toDate(x.check_out) || new Date(8.64e15)) > a)) throw new HttpError(409, 'Ce pointage chevauche un autre pointage.');
  const row = { employee_id, check_in: a, check_out: b, project_id, note, source: 'manuel', created_by: userId, updated_at: new Date() };
  if (id) await db('hr_attendances').where({ id }).update(row);
  else id = insertedId((await db('hr_attendances').insert(row))[0]);
  return serialize(await query(db).where('a.id', id).first());
}

/** Pointages d'un mois (et des jours voisins nécessaires aux semaines à cheval). */
async function monthAttendances(db, employeeId, period) {
  const from = new Date(`${period}-01T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 7);
  const to = new Date(`${lastDay(period)}T00:00:00Z`); to.setUTCDate(to.getUTCDate() + 8);
  return (await db('hr_attendances').where({ employee_id: employeeId }).where('check_in', '>=', from).where('check_in', '<', to)).map(serialize);
}

/** Rapport mensuel : heures travaillées et supplémentaires par employé ; montants réservés aux personnes autorisées à voir la paie. */
async function overtimeReport(db, period, { withPay, employeeIds = null }) {
  const s = await rh.getSettings(db);
  const holidays = await rh.holidays(db);
  const q = db('employees').where({ active: true }).orderBy(['last_name', 'first_name']);
  if (employeeIds) q.whereIn('id', employeeIds);
  const approved = await db('hr_overtime').where({ period });
  const rows = [];
  for (const e of await q) {
    const att = await monthAttendances(db, e.id, period);
    if (!att.length) continue;
    // Cadres au forfait (services exclus dans les réglages) : heures suivies, aucune heure supplémentaire payée
    const exempt = (s.overtime_exempt_departments || []).includes(e.department);
    const r = computeOvertime(att, { period, baseSalary: exempt ? 0 : Number(e.base_salary) || 0, holidays, s });
    const done = approved.find(o => o.employee_id === e.id);
    rows.push({
      employee_id: e.id, matricule: e.matricule, name: `${e.last_name} ${e.first_name}`, department: e.department,
      days: new Set(att.filter(a => a.check_in.startsWith(period)).map(a => a.check_in.slice(0, 10))).size,
      open: att.filter(a => !a.check_out).length, ...r, exempt,
      hourly: withPay ? r.hourly : undefined, amount: withPay ? r.amount : undefined, lines: r.lines.map(l => ({ ...l, amount: withPay ? l.amount : undefined })),
      approved: done ? { amount: withPay ? Number(done.amount) : undefined, at: isoTime(done.approved_at) } : null,
    });
  }
  return { period, rows, year_cap: s.overtime_year_cap };
}

/** Arrêté des heures supplémentaires d'un mois : elles passent dans les bulletins (paie en brouillon). */
async function approveOvertime(db, period, employeeIds, userId) {
  const report = await overtimeReport(db, period, { withPay: true, employeeIds });
  const run = await db('payroll_runs').where({ period }).first();
  if (run && run.status !== 'brouillon') throw new HttpError(409, `La paie de ${period} est déjà validée.`);
  await db.transaction(async trx => {
    for (const r of report.rows.filter(x => !x.exempt)) {
      const row = { hours: JSON.stringify(r.lines.map(l => ({ key: l.key, label: l.label, hours: l.hours, rate: l.rate, amount: l.amount }))), amount: r.amount, approved_by: userId, approved_at: new Date(), updated_at: new Date() };
      const existing = await trx('hr_overtime').where({ employee_id: r.employee_id, period }).first();
      if (existing) await trx('hr_overtime').where({ id: existing.id }).update(row);
      else await trx('hr_overtime').insert({ ...row, employee_id: r.employee_id, period });
    }
  });
  if (run) await require('./paie').refreshRun(db, run.id);
  return { approved: report.rows.filter(x => !x.exempt).length, payroll_run_id: run?.id || null };
}

/** Présents et absents du jour (tableau de bord, borne). */
async function today(db, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const from = new Date(`${day}T00:00:00Z`);
  const rows = (await query(db).where('a.check_in', '>=', from)).map(serialize);
  const leaves = (await rh.leaveQuery(db).where('l.status', 'approuvee')).map(rh.serializeLeave).filter(l => l.start_date <= day && l.end_date >= day);
  return {
    present: rows.filter(a => !a.check_out), done: rows.filter(a => a.check_out),
    on_leave: leaves.map(l => ({ employee_id: l.employee_id, employee_name: l.employee_name, label: LEAVE_TYPES[l.type]?.label })),
  };
}

module.exports = { serialize, query, openOf, toggle, kiosk, setPin, saveSheet, upsertManual, overtimeReport, approveOvertime, today, monthAttendances, lastDay };
