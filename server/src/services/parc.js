/**
 * ERP · Administration générale › Parc auto et matériel. Les services généraux gèrent (parc:write) : biens,
 * affectations à un employé ou à un chantier, échéances administratives, plans d'entretien, dépenses (carburant,
 * entretien, réparations…) imputées au chantier ; l'employé demande un véhicule depuis Mon espace (self:vehicule).
 * Alertes 30 puis 7 jours avant au responsable du bien et au responsable d'exploitation. Règles dans lib/domain.js.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { HttpError, isoDay, isoTime } = require('../lib/http');
const { uploadsDir, erpUrl } = require('../config');
const {
  ASSET_KINDS, ASSET_STATUSES, ASSET_ASSIGNMENT_KINDS, ASSET_DOC_KINDS, ASSET_COST_KINDS, RESERVATION_STATUSES,
  assetCode, maintenanceDue, fuelConsumption, reservationsOverlap, contractAlertStage, daysBetween, addMonths,
} = require('../lib/domain');
const { notify, usersWith, resolve } = require('./notifications');

const insertedId = r => (typeof r === 'object' ? r.id : r);
const filesDir = path.join(uploadsDir, 'private', 'parc');
const FILE_MIME = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const today = () => new Date().toISOString().slice(0, 10);
const fr = d => (d ? d.split('-').reverse().join('/') : '');
const num = v => (v == null ? null : Number(v));

function fileUpload() {
  fs.mkdirSync(filesDir, { recursive: true });
  return multer({
    storage: multer.diskStorage({ destination: filesDir, filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${FILE_MIME[file.mimetype]}`) }),
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(FILE_MIME[file.mimetype] ? null : new HttpError(400, 'Fichier : PDF ou image (JPEG, PNG, WebP).'), !!FILE_MIME[file.mimetype]),
  }).single('file');
}
const removeFile = name => name && fs.promises.unlink(path.join(filesDir, path.basename(name))).catch(() => {});
const filePath = row => {
  if (!row?.file_filename) throw new HttpError(404, 'Pas de fichier joint.');
  return path.join(filesDir, path.basename(row.file_filename));
};
const fileFields = file => (file ? { file_filename: file.filename, file_name: file.originalname.slice(0, 255), file_mime: file.mimetype } : {});

const employeeName = e => (e.last_name ? `${e.last_name} ${e.first_name || ''}`.trim() : null);

const query = db => db('assets as a')
  .leftJoin('employees as e', 'e.id', 'a.employee_id').leftJoin('projects as p', 'p.id', 'a.project_id')
  .leftJoin('users as u', 'u.id', 'a.manager_id').leftJoin('suppliers as s', 's.id', 'a.supplier_id').leftJoin('worksites as w', 'w.id', 'a.worksite_id')
  .select('a.*', 'e.last_name', 'e.first_name', 'p.name as project_name', 'u.name as manager_name', 's.name as supplier_name', 'w.reference as worksite_reference', 'w.name as worksite_name');

function normalize(a) {
  return {
    ...a, pool: !!a.pool, acquired_on: isoDay(a.acquired_on), meter_at: isoDay(a.meter_at), meter_value: num(a.meter_value),
    purchase_amount: num(a.purchase_amount),
  };
}
const planRow = (p, asset, day, soon) => {
  const due = maintenanceDue({ ...p, last_date: isoDay(p.last_date) }, asset, day, soon);
  return { ...p, active: !!p.active, last_date: isoDay(p.last_date), last_meter: num(p.last_meter), ...due };
};
const docRow = d => ({
  id: d.id, kind: d.kind, kind_label: ASSET_DOC_KINDS[d.kind] || d.kind, label: d.label, reference: d.reference, expires_on: isoDay(d.expires_on),
  amount_estimate: d.amount_estimate == null ? null : Number(d.amount_estimate),
  file_url: d.file_filename ? `/api/admin/erp/parc/documents/${d.id}/fichier` : null, file_name: d.file_name,
});

function serialize(raw) {
  const a = normalize(raw);
  const kind = ASSET_KINDS[a.kind];
  return {
    ...a, last_name: undefined, first_name: undefined, kind_label: a.kind === 'autre' && a.kind_other ? a.kind_other : kind?.label || a.kind,
    status_label: ASSET_STATUSES[a.status], employee_name: employeeName(raw), meter_unit: a.meter === 'km' ? 'km' : a.meter === 'h' ? 'h' : null,
    holder: raw.last_name ? employeeName(raw) : raw.worksite_reference ? `Chantier ${raw.worksite_reference} — ${raw.worksite_name}` : raw.project_name ? `Chantier ${raw.project_name}` : null,
  };
}

async function load(db, id) {
  const a = await query(db).where('a.id', id).first();
  if (!a) throw new HttpError(404, 'Bien introuvable.');
  return a;
}

async function detail(db, id, day = today()) {
  const soon = await require('./moduleSettings').parcSoon(db);
  const raw = await load(db, id);
  const a = normalize(raw);
  const [assignments, docs, plans, costs, reservations] = await Promise.all([
    db('asset_assignments as g').leftJoin('employees as e', 'e.id', 'g.employee_id').leftJoin('projects as p', 'p.id', 'g.project_id').leftJoin('worksites as w', 'w.id', 'g.worksite_id')
      .where('g.asset_id', id).orderBy('g.start_date', 'desc').orderBy('g.id', 'desc').select('g.*', 'e.last_name', 'e.first_name', 'p.name as project_name', 'w.reference as worksite_reference', 'w.name as worksite_name'),
    db('asset_documents').where({ asset_id: id }).orderBy('expires_on'),
    db('asset_maintenance_plans').where({ asset_id: id }).orderBy('id'),
    require('./parcCompta').costQuery(db).where('c.asset_id', id).orderBy('c.date', 'desc').orderBy('c.id', 'desc').limit(300),
    db('asset_reservations as r').join('users as u', 'u.id', 'r.requested_by').where('r.asset_id', id).where('r.status', 'accordee')
      .where('r.end_at', '>=', `${day}T00:00`).orderBy('r.start_at').select('r.*', 'u.name as requested_by_name'),
  ]);
  // Dépenses avec leur état comptable (à valider, validée, rejetée…) ; une dépense rejetée ne compte pas dans les coûts
  const costRows = costs.map(require('./parcCompta').serializeCost);
  const since = addMonths(day, -12);
  const year = costRows.filter(c => c.date > since && c.status !== 'rejetee');
  return {
    ...serialize(raw),
    assignments: assignments.map(g => ({
      ...g, start_date: isoDay(g.start_date), end_date: isoDay(g.end_date), meter_out: num(g.meter_out), meter_in: num(g.meter_in),
      kind_label: ASSET_ASSIGNMENT_KINDS[g.kind], target: g.kind === 'employe' ? employeeName(g) : g.worksite_reference ? `${g.project_name} · ${g.worksite_reference} — ${g.worksite_name}` : g.project_name, last_name: undefined, first_name: undefined,
    })),
    documents: docs.map(docRow),
    plans: plans.map(p => planRow(p, a, day, soon)),
    costs: costRows,
    consumption: fuelConsumption(costRows.filter(c => c.kind === 'carburant'), a.meter),
    costs_12m: { total: year.reduce((t, c) => t + c.amount, 0), by_kind: Object.fromEntries(Object.keys(ASSET_COST_KINDS).map(k => [k, year.filter(c => c.kind === k).reduce((t, c) => t + c.amount, 0)]).filter(([, v]) => v)) },
    reservations: reservations.map(r => ({ id: r.id, start_at: r.start_at, end_at: r.end_at, purpose: r.purpose, requested_by_name: r.requested_by_name })),
  };
}

async function checkRefs(db, data) {
  if (data.supplier_id && !(await db('suppliers').where({ id: data.supplier_id }).first())) throw new HttpError(404, 'Fournisseur introuvable.');
  if (data.manager_id && !(await db('users').where({ id: data.manager_id, active: true }).first())) throw new HttpError(400, 'Responsable introuvable ou inactif.');
  if (data.project_id && !(await db('projects').where({ id: data.project_id }).first())) throw new HttpError(404, 'Programme introuvable.');
}

async function create(db, data, { userId }) {
  const kind = ASSET_KINDS[data.kind];
  if (!kind) throw new HttpError(400, 'Type de bien inconnu.');
  if (data.kind === 'autre' && !data.kind_other) throw new HttpError(400, 'Précisez la nature du matériel.');
  await checkRefs(db, data);
  const row = { ...data, meter: kind.meter, pool: data.kind === 'vehicule' ? !!data.pool : false, created_by: userId };
  if (row.meter_value != null) row.meter_at = today();
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async trx => {
        const prefix = `${kind.prefix}-`;
        const last = await trx('assets').where('code', 'like', `${prefix}%`).orderBy('code', 'desc').first('code');
        const [id] = await trx('assets').insert({ ...row, code: assetCode(data.kind, last ? Number(last.code.slice(prefix.length)) + 1 : 1) });
        return insertedId(id);
      });
    } catch (e) {
      if (attempt >= 4 || !/unique|duplicate/i.test(e.message)) throw e;
    }
  }
}

async function update(db, a, data) {
  if (data.kind && data.kind !== a.kind) throw new HttpError(400, 'Le type d’un bien ne change pas (son code en dépend).');
  if (a.kind === 'autre' && 'kind_other' in data && !data.kind_other) throw new HttpError(400, 'Précisez la nature du matériel.');
  await checkRefs(db, data);
  const patch = { ...data, updated_at: new Date() };
  delete patch.kind;
  if ('pool' in patch) patch.pool = a.kind === 'vehicule' ? !!patch.pool : false;
  if ('meter_value' in patch) {
    if (!a.meter || num(patch.meter_value) === num(a.meter_value)) delete patch.meter_value;
    else patch.meter_at = today();
  }
  await db('assets').where({ id: a.id }).update(patch);
}

/** Relevé du compteur : il ne recule jamais. */
async function raiseMeter(trx, a, value, day) {
  if (value == null || !a.meter) return;
  if (a.meter_value != null && Number(value) < Number(a.meter_value)) return;
  await trx('assets').where({ id: a.id }).update({ meter_value: value, meter_at: day, updated_at: new Date() });
}

/** Remise à un employé ou envoi sur un chantier ; l'affectation en cours est d'abord close à la même date. */
async function assign(db, a, data, { userId }) {
  if (a.status === 'reforme') throw new HttpError(409, 'Bien réformé.');
  if (data.kind === 'employe' && !(await db('employees').where({ id: data.employee_id, active: true }).first())) throw new HttpError(400, 'Employé introuvable ou inactif.');
  if (data.kind === 'chantier' && !data.worksite_id && !(await db('projects').where({ id: data.project_id || 0 }).first())) throw new HttpError(400, 'Choisissez le chantier.');
  // Chantier de l'ERP › Chantiers : il fixe le programme
  const site = data.kind === 'chantier' ? await require('./chantiers').resolveSite(db, data) : { project_id: null, worksite_id: null };
  const open = await db('asset_assignments').where({ asset_id: a.id }).whereNull('end_date').first();
  if (open && data.date < isoDay(open.start_date)) throw new HttpError(400, 'La date précède l’affectation en cours.');
  await db.transaction(async trx => {
    if (open) await trx('asset_assignments').where({ id: open.id }).update({ end_date: data.date, meter_in: data.meter ?? null, updated_at: new Date() });
    await trx('asset_assignments').insert({
      asset_id: a.id, kind: data.kind, employee_id: data.kind === 'employe' ? data.employee_id : null, project_id: site.project_id, worksite_id: site.worksite_id,
      start_date: data.date, condition_out: data.condition || null, meter_out: data.meter ?? null, created_by: userId,
    });
    await trx('assets').where({ id: a.id }).update({
      status: 'affecte', employee_id: data.kind === 'employe' ? data.employee_id : null, project_id: site.project_id, worksite_id: site.worksite_id, updated_at: new Date(),
    });
    await raiseMeter(trx, normalize(a), data.meter, data.date);
  });
}

/** Restitution (employé) ou retour au dépôt (chantier). */
async function release(db, a, data) {
  const open = await db('asset_assignments').where({ asset_id: a.id }).whereNull('end_date').first();
  if (!open) throw new HttpError(409, 'Ce bien n’est pas affecté.');
  if (data.date < isoDay(open.start_date)) throw new HttpError(400, 'La restitution précède la remise.');
  await db.transaction(async trx => {
    await trx('asset_assignments').where({ id: open.id }).update({ end_date: data.date, condition_in: data.condition || null, meter_in: data.meter ?? null, updated_at: new Date() });
    await trx('assets').where({ id: a.id }).update({ status: a.status === 'affecte' ? 'disponible' : a.status, employee_id: null, project_id: null, worksite_id: null, updated_at: new Date() });
    await raiseMeter(trx, normalize(a), data.meter, data.date);
  });
}

/** En panne / en réparation, réformé, ou de nouveau disponible (un bien réformé est d'abord restitué). */
async function setStatus(db, a, status) {
  if (!['disponible', 'maintenance', 'reforme'].includes(status)) throw new HttpError(400, 'Statut inconnu.');
  const open = await db('asset_assignments').where({ asset_id: a.id }).whereNull('end_date').first();
  if (status === 'reforme' && open) throw new HttpError(409, 'Restituez d’abord le bien avant de le réformer.');
  const next = status === 'disponible' && open ? 'affecte' : status;
  await db('assets').where({ id: a.id }).update({ status: next, updated_at: new Date() });
  // Bien immobilisé réformé : le comptable passe sa sortie de l'actif (Comptabilité › Parc › Immobilisations)
  if (status === 'reforme' && a.fixed_value && !a.disposal_entry_id) {
    await notify(db, {
      to: await usersWith(db, 'compta:entries'), module: 'compta', event: 'parc.reforme', title: `Bien réformé à sortir de l’actif : ${a.code} ${a.name}`,
      link: '/compta/parc?onglet=immobilisations', priority: 'action', key: `parc_reforme:${a.id}`,
    });
  }
}

// ─── Échéances administratives et plans d'entretien ─────────
async function addDocument(db, a, data, { file }) {
  if (!ASSET_DOC_KINDS[data.kind]) throw new HttpError(400, 'Type d’échéance inconnu.');
  const [i] = await db('asset_documents').insert({ ...data, asset_id: a.id, ...fileFields(file) });
  return insertedId(i);
}
async function updateDocument(db, d, data, { file }) {
  if (data.kind && !ASSET_DOC_KINDS[data.kind]) throw new HttpError(400, 'Type d’échéance inconnu.');
  const patch = { ...data, updated_at: new Date() };
  if (file) { await removeFile(d.file_filename); Object.assign(patch, fileFields(file)); }
  await db('asset_documents').where({ id: d.id }).update(patch);
}
async function deleteDocument(db, d) {
  await db('asset_documents').where({ id: d.id }).del();
  await removeFile(d.file_filename);
}

function checkPlan(a, data) {
  if (!data.every_km && !data.every_hours && !data.every_months) throw new HttpError(400, 'Indiquez une périodicité : kilomètres, heures ou mois.');
  if (data.every_km && a.meter !== 'km') throw new HttpError(400, 'Ce bien n’a pas de compteur kilométrique.');
  if (data.every_hours && a.meter !== 'h') throw new HttpError(400, 'Ce bien n’a pas de compteur d’heures.');
}
async function addPlan(db, a, data) {
  checkPlan(a, data);
  const [i] = await db('asset_maintenance_plans').insert({ ...data, asset_id: a.id, last_date: data.last_date || today(), last_meter: data.last_meter ?? num(a.meter_value) });
  return insertedId(i);
}
async function updatePlan(db, p, a, data) {
  checkPlan(a, { ...p, ...data });
  await db('asset_maintenance_plans').where({ id: p.id }).update({ ...data, updated_at: new Date() });
}

// ─── Dépenses ───────────────────────────────────────────────
/**
 * Dépense saisie dans le parc : imputée au chantier indiqué, sinon au chantier où travaille le bien ce jour-là.
 * Un plein relève le compteur ; un entretien planifié remet son plan à zéro.
 */
async function addCost(db, a, data, { userId }) {
  if (!ASSET_COST_KINDS[data.kind]) throw new HttpError(400, 'Type de dépense inconnu.');
  if (data.date > today()) throw new HttpError(400, 'La dépense ne peut pas être future.');
  if (data.kind === 'carburant' && !data.liters) throw new HttpError(400, 'Plein : indiquez les litres.');
  if (data.meter_value != null && !a.meter) delete data.meter_value;
  // Imputation : celle indiquée (programme, chantier ou lieu), sinon le chantier où travaille le bien ce jour-là, sinon le siège
  let pick = { project_id: data.project_id ?? null, worksite_id: data.worksite_id ?? null, place_id: data.place_id ?? null };
  if (data.project_id === undefined && data.worksite_id === undefined && data.place_id === undefined) {
    const g = await db('asset_assignments').where({ asset_id: a.id, kind: 'chantier' }).where('start_date', '<=', data.date)
      .where(w => w.whereNull('end_date').orWhere('end_date', '>=', data.date)).orderBy('start_date', 'desc').first('project_id', 'worksite_id');
    pick = { project_id: g?.project_id || null, worksite_id: g?.worksite_id || null, place_id: null };
  }
  const site = await require('./lieux').resolvePlace(db, pick);
  const project = site.project_id;
  let plan = null;
  if (data.plan_id) {
    plan = await db('asset_maintenance_plans').where({ id: data.plan_id, asset_id: a.id }).first();
    if (!plan) throw new HttpError(404, 'Plan d’entretien introuvable.');
  }
  if (data.purchase_invoice_id && !(await db('purchase_invoices').where({ id: data.purchase_invoice_id }).first())) throw new HttpError(404, 'Facture d’achat introuvable.');
  // Lien avec la Comptabilité (choix du client du 23/10) : la dépense part aussitôt en facture ou en écriture à valider
  const pc = require('./parcCompta');
  const row = await pc.checkPayment(db, a, { ...data, ...site });
  const id = await db.transaction(async trx => {
    const [i] = await trx('asset_costs').insert({ ...row, asset_id: a.id, project_id: project, created_by: userId });
    const costId = insertedId(i);
    await pc.bookCost(trx, a, costId, row, userId);
    await raiseMeter(trx, normalize(a), data.meter_value, data.date);
    if (plan) await trx('asset_maintenance_plans').where({ id: plan.id }).update({ last_date: data.date, last_meter: data.meter_value ?? num(a.meter_value), updated_at: new Date() });
    return costId;
  });
  await pc.announceCost(db, id, userId);
  return id;
}

// ─── Vues transverses ───────────────────────────────────────
/** Échéances administratives et entretiens (dus, à prévoir, ou dans `days` jours) de tous les biens en service. */
async function deadlines(db, { days = 60, day = today() } = {}) {
  const soon = await require('./moduleSettings').parcSoon(db);
  const assets = (await query(db).whereNot('a.status', 'reforme')).map(normalize);
  const ids = assets.map(a => a.id);
  const by = id => assets.find(a => a.id === id);
  const out = [];
  if (!ids.length) return out;
  for (const d of await db('asset_documents').whereIn('asset_id', ids).whereNotNull('expires_on')) {
    const date = isoDay(d.expires_on);
    const left = daysBetween(day, date);
    if (left <= days) out.push({ key: `doc:${d.id}`, kind: 'document', asset_id: d.asset_id, date, days_left: left, label: `${d.label} — échéance`, state: left < 0 ? 'du' : left <= 7 ? 'bientot' : 'ok' });
  }
  for (const p of await db('asset_maintenance_plans').whereIn('asset_id', ids).where({ active: true })) {
    const a = by(p.asset_id);
    const r = planRow(p, a, day, soon);
    const left = r.next_date ? daysBetween(day, r.next_date) : null;
    if (r.state !== 'ok' || (left != null && left <= days)) {
      out.push({ key: `plan:${p.id}`, kind: 'entretien', asset_id: p.asset_id, date: r.next_date, days_left: left, next_meter: r.next_meter, meter_value: a.meter_value, meter_unit: a.meter, label: p.label, state: r.state });
    }
  }
  return out.map(x => ({ ...x, code: by(x.asset_id).code, name: by(x.asset_id).name, plate: by(x.asset_id).plate }))
    .sort((x, y) => ({ du: 0, bientot: 1, ok: 2 }[x.state] - { du: 0, bientot: 1, ok: 2 }[y.state]) || String(x.date || '9').localeCompare(String(y.date || '9')));
}

/** Coûts de la période par chantier, par bien et par nature (frais généraux = sans chantier). */
async function costsReport(db, { from, to }) {
  const rows = await db('asset_costs as c').join('assets as a', 'a.id', 'c.asset_id').leftJoin('projects as p', 'p.id', 'c.project_id')
    .leftJoin('places as pl', 'pl.id', 'c.place_id')
    .whereBetween('c.date', [from, to]).whereNull('c.rejected_at').select('c.kind', 'c.amount', 'c.liters', 'c.project_id', 'p.name as project_name', 'c.place_id', 'pl.name as place_name', 'a.id as asset_id', 'a.code', 'a.name');
  const group = (keyOf, labelOf) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      const g = m.get(k) || { key: k, label: labelOf(r), total: 0, by_kind: {}, liters: 0 };
      g.total += Number(r.amount);
      g.by_kind[r.kind] = (g.by_kind[r.kind] || 0) + Number(r.amount);
      g.liters += Number(r.liters || 0);
      m.set(k, g);
    }
    return [...m.values()].sort((x, y) => y.total - x.total);
  };
  return {
    from, to, total: rows.reduce((t, r) => t + Number(r.amount), 0),
    by_project: group(r => r.project_id || `lieu-${r.place_id || 0}`, r => r.project_name || r.place_name || 'Frais généraux (sans chantier)'),
    by_asset: group(r => r.asset_id, r => `${r.code} · ${r.name}`),
    by_kind: Object.fromEntries(Object.keys(ASSET_COST_KINDS).map(k => [k, rows.filter(r => r.kind === k).reduce((t, r) => t + Number(r.amount), 0)]).filter(([, v]) => v)),
  };
}

// ─── Réservations de véhicules ──────────────────────────────
const resaQuery = db => db('asset_reservations as r').join('users as u', 'u.id', 'r.requested_by').leftJoin('assets as a', 'a.id', 'r.asset_id')
  .leftJoin('users as d', 'd.id', 'r.decided_by')
  .select('r.*', 'u.name as requested_by_name', 'a.code as asset_code', 'a.name as asset_name', 'a.plate as asset_plate', 'd.name as decided_by_name');
const resaRow = r => ({ ...r, status_label: RESERVATION_STATUSES[r.status], decided_at: isoTime(r.decided_at), created_at: isoTime(r.created_at) });

async function request(db, data, { user }) {
  if (data.end_at <= data.start_at) throw new HttpError(400, 'La fin doit suivre le début.');
  if (data.start_at.slice(0, 10) < today()) throw new HttpError(400, 'La réservation ne peut pas commencer dans le passé.');
  const [i] = await db('asset_reservations').insert({ ...data, requested_by: user.id });
  const id = insertedId(i);
  // Lien RH (Mon espace) → services généraux
  await notify(db, {
    to: await usersWith(db, 'parc:write'), except: user.id, module: 'administration', event: 'vehicule.demande',
    title: `Demande de véhicule de ${user.name}`, body: `Du ${fr(data.start_at.slice(0, 10))} ${data.start_at.slice(11)} au ${fr(data.end_at.slice(0, 10))} ${data.end_at.slice(11)} — ${data.purpose}`,
    link: '/administration/parc?onglet=reservations', priority: 'action', key: `vehicule:${id}:demande`,
  });
  return id;
}

/**
 * Véhicules libres sur le créneau : en état de rouler, non remis à un employé (véhicule de fonction) et sans
 * réservation accordée qui chevauche. Les véhicules de service (pool) d'abord.
 */
async function freeVehicles(db, { start_at, end_at, except = null }) {
  const vehicles = await db('assets').where({ kind: 'vehicule' }).whereNotIn('status', ['maintenance', 'reforme']).whereNull('employee_id')
    .orderBy('pool', 'desc').orderBy('code');
  const taken = await db('asset_reservations').where({ status: 'accordee' }).whereNotNull('asset_id').modify(q => { if (except) q.whereNot('id', except); });
  return vehicles.filter(v => !taken.some(t => t.asset_id === v.id && reservationsOverlap(t, { start_at, end_at })))
    .map(v => ({ id: v.id, code: v.code, name: v.name, plate: v.plate, pool: !!v.pool, status: v.status }));
}

async function decide(db, r, { status, asset_id, note }, { user }) {
  if (r.status !== 'demandee' && !(r.status === 'accordee' && status === 'accordee')) throw new HttpError(409, 'Demande déjà traitée.');
  if (status === 'refusee' && !note) throw new HttpError(400, 'Indiquez le motif du refus.');
  if (status === 'accordee') {
    if (!asset_id) throw new HttpError(400, 'Choisissez le véhicule.');
    const free = await freeVehicles(db, { start_at: r.start_at, end_at: r.end_at, except: r.id });
    if (!free.some(v => v.id === asset_id)) throw new HttpError(409, 'Ce véhicule n’est pas libre sur ce créneau.');
  }
  await db('asset_reservations').where({ id: r.id }).update({
    status, asset_id: status === 'accordee' ? asset_id : null, decided_by: user.id, decided_at: new Date(), decision_note: note || null, updated_at: new Date(),
  });
  const row = await resaQuery(db).where('r.id', r.id).first();
  const when = `du ${fr(r.start_at.slice(0, 10))} ${r.start_at.slice(11)} au ${fr(r.end_at.slice(0, 10))} ${r.end_at.slice(11)}`;
  const title = `Véhicule ${status === 'accordee' ? 'accordé' : 'refusé'} ${when}`;
  await resolve(db, `vehicule:${r.id}:demande`);
  await notify(db, {
    to: r.requested_by, except: user.id, module: 'rh', event: status === 'accordee' ? 'vehicule.accorde' : 'vehicule.refuse',
    title, body: status === 'accordee' ? `${row.asset_name}${row.asset_plate ? ` (${row.asset_plate})` : ''} — ${r.purpose}` : `Motif : ${note}`,
    link: '/rh/moi', key: `vehicule:${r.id}:${status}:${row.asset_id || ''}`,
    email: {
      subject: `[SIIPAF] ${title}`,
      text: u => (status === 'accordee'
        ? `Bonjour ${u.name},\n\nVotre demande de véhicule ${when} (${r.purpose}) est accordée : ${row.asset_name}${row.asset_plate ? ` (${row.asset_plate})` : ''}.${note ? `\n${note}` : ''}`
        : `Bonjour ${u.name},\n\nVotre demande de véhicule ${when} (${r.purpose}) est refusée.\nMotif : ${note}`),
    },
  });
  return resaRow(row);
}

// ─── Alertes ────────────────────────────────────────────────
async function alertRecipients(db, a) {
  return db('users').where({ active: true }).where(w => { w.where('role', 'resp_exploitation'); if (a.manager_id) w.orWhere('id', a.manager_id); }).select('id', 'name', 'email');
}

/**
 * Tâche horaire, sans doublon : échéances administratives et entretiens par date (30 puis 7 jours avant),
 * entretien atteint au compteur (une fois). Rien pour une échéance dépassée depuis plus de 30 jours.
 */
async function tick(db, day = today()) {
  // Rappels d'échéance et entretien « bientôt » : Administration générale › Réglages
  const [stages, soon] = [await require('./moduleSettings').alertStages(db), await require('./moduleSettings').parcSoon(db)];
  let alerts = 0;
  const assets = new Map((await db('assets').whereNot('status', 'reforme')).map(a => [a.id, normalize(a)]));
  const items = [];
  for (const d of await db('asset_documents').whereNotNull('expires_on')) {
    if (assets.has(d.asset_id)) items.push({ asset: assets.get(d.asset_id), key: `doc:${d.id}`, date: isoDay(d.expires_on), label: d.label });
  }
  for (const p of await db('asset_maintenance_plans').where({ active: true })) {
    const a = assets.get(p.asset_id);
    if (!a) continue;
    const r = planRow(p, a, day, soon);
    if (r.next_date) items.push({ asset: a, key: `plan:${p.id}`, date: r.next_date, label: p.label });
    if (r.next_meter != null && a.meter_value != null && a.meter_value >= r.next_meter) items.push({ asset: a, key: `plan:${p.id}:compteur`, due: String(r.next_meter), stage: 0, label: `${p.label} (compteur atteint : ${r.next_meter} ${a.meter})` });
  }
  for (const it of items) {
    let stage = it.stage;
    const due = it.due || it.date;
    if (stage == null) {
      stage = contractAlertStage(it.date, day, stages);
      if (!stage || daysBetween(it.date, day) > 30) continue;
    }
    const done = (await db('asset_alerts').where({ asset_id: it.asset.id, deadline_key: it.key, due }).pluck('stage')).map(Number);
    if (done.some(s => s <= stage)) continue;
    await db('asset_alerts').insert({ asset_id: it.asset.id, deadline_key: it.key, due, stage });
    const left = it.date ? daysBetween(day, it.date) : null;
    const when = left == null ? 'à faire maintenant' : left < 0 ? `dépassée depuis ${-left} jour(s)` : left === 0 ? 'aujourd’hui' : `dans ${left} jour(s)`;
    const title = `Parc ${it.asset.code}${it.asset.plate ? ` (${it.asset.plate})` : ''} : ${it.label}`;
    await notify(db, {
      to: await alertRecipients(db, it.asset), module: 'administration', event: 'parc.echeance',
      title, body: `${it.asset.name} — ${when}${it.date ? ` (${fr(it.date)})` : ''}`, link: `/administration/parc?fiche=${it.asset.id}`,
      priority: left != null && left > 7 ? 'action' : 'urgent', key: `parc:${it.asset.id}:${it.key}:${due}:${stage}`,
      email: {
        subject: `[SIIPAF] ${title}`,
        text: u => `Bonjour ${u.name},\n\n${it.label} — ${when}${it.date ? ` (${fr(it.date)})` : ''}\nBien : ${it.asset.code} · ${it.asset.name}\n\nOuvrir dans l’ERP : ${erpUrl}/administration/parc?fiche=${it.asset.id}`,
      },
    });
    alerts++;
  }
  return { alerts };
}

async function badges(db, { can, userId }) {
  const manage = can('parc:read') || can('parc:write');
  const items = manage ? await deadlines(db, { days: 30 }) : [];
  const requests = can('parc:write') ? Number((await db('asset_reservations').where({ status: 'demandee' }).count({ n: '*' }).first()).n || 0) : 0;
  const mine = Number((await db('asset_reservations').where({ requested_by: userId }).whereIn('status', ['demandee', 'accordee']).count({ n: '*' }).first()).n || 0);
  // Dépenses à valider par la Comptabilité (pastille de l'onglet « À valider »)
  const costs = can('achats:write') || can('compta:read') ? (await require('./parcCompta').pendingCosts(db)).length : 0;
  return { due: items.length, late: items.filter(x => x.state === 'du').length, requests, my_reservations: mine, costs_to_validate: costs };
}

module.exports = {
  fileUpload, filePath, query, load, detail, serialize, create, update, assign, release, setStatus,
  addDocument, updateDocument, deleteDocument, addPlan, updatePlan, addCost, deadlines, costsReport,
  resaQuery, resaRow, request, freeVehicles, decide, tick, badges,
};
