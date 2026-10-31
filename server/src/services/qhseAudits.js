/**
 * ERP · QHSE, inspections et audits, constats et plan d'actions correctives.
 * Audit : planifié (date, auditeur) ou inopiné (démarré tout de suite), sur un chantier ou au siège, grille Q/H/S/E, constats avec
 * gravité (mineure, majeure, critique) ; il est soumis puis validé (qhse:validate). Un constat majeur ou critique doit avoir une
 * action corrective avant la soumission. Action corrective : responsable, échéance, statut, preuve de levée (texte ou photo).
 * Le responsable d'une action la fait avancer et la lève sans autre droit que de consulter le QHSE.
 */
const { HttpError, isoDay, isoTime } = require('../lib/http');
const Q = require('../lib/qhse');
const svc = require('./qhse');
const { inform, resolve } = require('./notifications');

const { insertedId, clip } = svc;
const uid = v => Number(v.user.id);
/** Auteurs d'un audit : qui l'a planifié, qui l'a soumis, l'auditeur (compte). Aucun ne le valide, sauf le super administrateur. */
const auditAuthors = a => [a.created_by, a.submitted_by, a.auditor_id];

// ─── Audits ───────────────────────────────────────────────────────────────

const auditQuery = db => db('qhse_audits as a').leftJoin('worksites as w', 'w.id', 'a.worksite_id').leftJoin('projects as p', 'p.id', 'w.project_id')
  .leftJoin('users as u', 'u.id', 'a.auditor_id').leftJoin('users as cu', 'cu.id', 'a.created_by')
  .select('a.*', 'w.reference as worksite_reference', 'w.name as worksite_name', 'w.manager_id', 'p.name as project_name', 'u.name as auditor_user_name', 'cu.name as created_by_name');

const auditVisible = (a, v) => svc.seesAll(v) || Number(a.auditor_id) === uid(v) || (a.worksite_id && Number(a.manager_id) === uid(v));

function serializeAudit(a) {
  return {
    id: a.id, reference: a.reference, kind: a.kind, kind_label: Q.AUDIT_KINDS[a.kind], status: a.status, status_label: Q.AUDIT_STATUSES[a.status] || a.status,
    place_kind: a.place_kind, place_kind_label: Q.AUDIT_PLACES[a.place_kind], worksite_id: a.worksite_id, worksite_reference: a.worksite_reference, worksite_name: a.worksite_name, project_name: a.project_name,
    place_label: a.place_kind === 'siege' ? a.place_label || 'Siège' : [a.worksite_reference, a.worksite_name].filter(Boolean).join(' · '),
    auditor_id: a.auditor_id, auditor_name: a.auditor_user_name || a.auditor_name || null, objective: a.objective, summary: a.summary,
    planned_on: isoDay(a.planned_on), done_on: isoDay(a.done_on),
    rating_qualite: a.rating_qualite, rating_qualite_label: Q.ratingLabel(a.rating_qualite), rating_hygiene: a.rating_hygiene, rating_hygiene_label: Q.ratingLabel(a.rating_hygiene),
    safety_rate: a.safety_rate, env_rate: a.env_rate, score_pct: a.score_pct, reject_reason: a.reject_reason, created_by_name: a.created_by_name,
    submitted_at: isoTime(a.submitted_at), validated_at: isoTime(a.validated_at), created_at: isoTime(a.created_at),
  };
}

async function nextReference(db, prefix, table) {
  const year = Q.todayStr().slice(0, 4);
  const p = `${prefix}-${year}-`;
  const last = await db(table).where('reference', 'like', `${p}%`).orderBy('reference', 'desc').first('reference');
  return `${p}${String(last ? Number(last.reference.slice(p.length)) + 1 : 1).padStart(4, '0')}`;
}

async function listAudits(db, v, { status = null, worksiteId = null, limit = 100 } = {}) {
  const query = auditQuery(db).orderBy([{ column: 'a.planned_on', order: 'desc' }, { column: 'a.id', order: 'desc' }]).limit(Math.min(Number(limit) || 100, 300));
  if (status) query.where('a.status', status);
  if (worksiteId) query.where('a.worksite_id', worksiteId);
  if (!svc.seesAll(v)) query.where(b => b.where('w.manager_id', v.user.id).orWhere('a.auditor_id', v.user.id));
  const rows = await query;
  const counts = rows.length ? await db('qhse_findings').whereIn('audit_id', rows.map(r => r.id)).groupBy('audit_id').select('audit_id').count({ n: '*' }) : [];
  return rows.map(a => ({ ...serializeAudit(a), findings: Number(counts.find(c => c.audit_id === a.id)?.n || 0) }));
}

async function loadAudit(db, id, v) {
  const a = await auditQuery(db).where('a.id', Number(id) || 0).first();
  if (!a || !auditVisible(a, v)) throw new HttpError(404, 'Audit introuvable.');
  return a;
}

async function auditDetail(db, id, v) {
  const a = await loadAudit(db, id, v);
  const [items, findings, files, actions] = await Promise.all([
    svc.itemsOf(db, 'audit', a.id),
    db('qhse_findings as f').leftJoin('users as u', 'u.id', 'f.created_by').where('f.audit_id', a.id).orderBy('f.id').select('f.*', 'u.name as created_by_name'),
    svc.filesOf(db, 'audit', [a.id]),
    db('qhse_actions as x').leftJoin('users as o', 'o.id', 'x.owner_id').where('x.audit_id', a.id).orderBy('x.id').select('x.*', 'o.name as owner_name'),
  ]);
  const findingFiles = await svc.filesOf(db, 'constat', findings.map(f => f.id));
  const today = Q.todayStr();
  const open = ['planifie', 'en_cours'].includes(a.status);
  return {
    ...serializeAudit(a), items, files: files.get(a.id) || [],
    findings: findings.map(f => ({
      id: f.id, pillar: f.pillar, pillar_label: Q.PILLARS[f.pillar]?.label, description: f.description, gravity: f.gravity, gravity_label: Q.GRAVITIES[f.gravity], created_by_name: f.created_by_name,
      files: findingFiles.get(f.id) || [], actions: actions.filter(x => x.finding_id === f.id).map(x => serializeAction(x, today)),
    })),
    actions: actions.map(x => serializeAction(x, today)),
    can_edit: open && v.can('qhse:audit'), can_start: a.status === 'planifie' && v.can('qhse:audit'),
    can_submit: a.status === 'en_cours' && v.can('qhse:audit'), can_decide: a.status === 'a_valider' && v.can('qhse:validate'),
    own: svc.isAuthor(auditAuthors(a), v), // planifié, mené ou soumis par le compte : il peut le refuser mais pas le valider
    can_approve: a.status === 'a_valider' && v.can('qhse:validate') && !svc.isAuthor(auditAuthors(a), v),
    can_cancel: open && v.can('qhse:audit'),
  };
}

async function planAudit(db, data, v) {
  const today = Q.todayStr();
  let w = null;
  if (data.place_kind === 'chantier') {
    if (!data.worksite_id) throw new HttpError(400, 'Choisissez le chantier à inspecter.');
    w = await svc.worksiteFor(db, data.worksite_id, v);
  } else if (!svc.seesAll(v)) throw new HttpError(403, 'Une inspection du siège demande la portée « tous les chantiers ».');
  let auditorId = null;
  if (data.auditor_id) {
    const u = await db('users').where({ id: data.auditor_id, active: true }).first('id');
    if (!u) throw new HttpError(400, 'Auditeur inconnu.');
    auditorId = u.id;
  }
  const auditorName = clip(data.auditor_name, 120);
  if (!auditorId && !auditorName) throw new HttpError(400, 'Indiquez l’auditeur (un compte ou un nom).');
  const inopine = data.kind === 'inopine';
  const plannedOn = inopine ? today : data.planned_on;
  if (!plannedOn) throw new HttpError(400, 'Indiquez la date de l’audit.');
  if (!inopine && plannedOn < today) throw new HttpError(400, 'La date d’un audit planifié ne peut pas être passée (un audit déjà fait est inopiné ou démarré aujourd’hui).');
  const reference = await nextReference(db, 'AUD', 'qhse_audits');
  const id = insertedId((await db('qhse_audits').insert({
    reference, kind: data.kind, status: inopine ? 'en_cours' : 'planifie', place_kind: data.place_kind, worksite_id: w?.id ?? null,
    place_label: data.place_kind === 'siege' ? clip(data.place_label, 160) || 'Siège' : null, auditor_id: auditorId, auditor_name: auditorId ? null : auditorName,
    planned_on: plannedOn, done_on: inopine ? today : null, objective: clip(data.objective, 300), created_by: uid(v),
  }))[0]);
  if (!inopine) {
    await inform(db, 'qhse.audit_planifie', {
      direct: [auditorId, w?.manager_id], except: uid(v), key: `qhse-audit-plan:${id}`, link: `/qhse/audits/${id}`,
      title: `Audit planifié le ${Q.frDay(plannedOn)} : ${w ? `${w.reference} ${w.name}` : data.place_label || 'Siège'}`, body: clip(data.objective, 300),
    });
  }
  return id;
}

const openAudit = a => {
  if (!['planifie', 'en_cours'].includes(a.status)) throw new HttpError(409, 'Cet audit ne se modifie plus.');
};

async function startAudit(db, id, v) {
  const a = await loadAudit(db, id, v);
  if (a.status !== 'planifie') throw new HttpError(409, 'Cet audit est déjà démarré.');
  await db('qhse_audits').where({ id }).update({ status: 'en_cours', done_on: Q.todayStr(), updated_at: new Date() });
  return id;
}

/** Résultats de la grille Q/H/S/E : points renseignés, notes globales (moyenne des points notés par défaut), synthèse. */
async function saveResults(db, id, data, v) {
  const a = await loadAudit(db, id, v);
  openAudit(a);
  const items = await svc.normalizeItems(db, data.items || []);
  const by = p => items.filter(i => i.pillar === p);
  const ratingQ = svc.toInt(data.rating_qualite) ?? Q.meanRating(by('qualite').map(i => i.rating));
  const ratingH = svc.toInt(data.rating_hygiene) ?? Q.meanRating(by('hygiene').map(i => i.rating));
  for (const r of [ratingQ, ratingH]) if (r != null && !Q.RATINGS[r]) throw new HttpError(400, 'Note invalide.');
  const row = {
    rating_qualite: ratingQ, rating_hygiene: ratingH, safety_rate: Q.conformityRate(by('securite').map(i => i.answer)), env_rate: Q.conformityRate(by('environnement').map(i => i.answer)),
    summary: clip(data.summary, 4000), objective: data.objective === undefined ? a.objective : clip(data.objective, 300),
  };
  row.score_pct = Q.auditScore(row);
  await db.transaction(async trx => {
    await trx('qhse_audits').where({ id }).update({ ...row, status: 'en_cours', done_on: a.done_on ? isoDay(a.done_on) : Q.todayStr(), updated_at: new Date() });
    await svc.replaceItems(trx, 'audit', id, items);
  });
  return id;
}

async function submitAudit(db, id, v) {
  const a = await loadAudit(db, id, v);
  if (a.status !== 'en_cours') throw new HttpError(409, 'Seul un audit en cours se soumet.');
  if (!(await db('qhse_items').where({ owner_kind: 'audit', owner_id: id }).first('id'))) throw new HttpError(400, 'Renseignez la grille (au moins un point de contrôle) avant de soumettre l’audit.');
  const bare = await db('qhse_findings as f').where('f.audit_id', id).whereIn('f.gravity', ['majeure', 'critique'])
    .whereNotExists(function () { this.select(db.raw('1')).from('qhse_actions as x').whereRaw('x.finding_id = f.id').whereNot('x.status', 'annulee'); }).select('f.description');
  if (bare.length) throw new HttpError(400, `Ouvrez une action corrective pour chaque constat majeur ou critique avant de soumettre (${bare.length} sans action : « ${bare[0].description.slice(0, 60)} »).`);
  const now = new Date();
  await db('qhse_audits').where({ id }).update({ status: 'a_valider', submitted_at: now, submitted_by: uid(v), reject_reason: null, updated_at: now });
  await inform(db, 'qhse.audit_a_valider', {
    except: uid(v), key: `qhse-audit:${id}:${now.getTime()}`, link: `/qhse/audits/${id}`,
    title: `Audit à valider : ${a.reference}`, body: `${serializeAudit(a).place_label} — score ${a.score_pct == null ? 'non calculé' : `${a.score_pct} %`}`,
  });
  return id;
}

async function decideAudit(db, id, v, { approve, reason = null }) {
  const a = await loadAudit(db, id, v);
  if (a.status !== 'a_valider') throw new HttpError(409, 'Cet audit n’attend pas de décision.');
  if (approve && svc.isAuthor(auditAuthors(a), v)) throw new HttpError(403, 'Vous ne pouvez pas valider un audit que vous avez planifié, mené ou soumis : un autre responsable doit le valider.');
  const now = new Date();
  if (approve) await db('qhse_audits').where({ id }).update({ status: 'valide', validated_by: uid(v), validated_at: now, updated_at: now });
  else await db('qhse_audits').where({ id }).update({ status: 'en_cours', reject_reason: clip(reason, 500), submitted_at: null, submitted_by: null, updated_at: now });
  await resolve(db, `qhse-audit:${id}:`);
  await inform(db, 'qhse.decision', {
    direct: [a.created_by, a.auditor_id], except: uid(v), key: `qhse-audit-decision:${id}:${now.getTime()}`, link: `/qhse/audits/${id}`,
    title: `Audit ${approve ? 'validé' : 'refusé'} : ${a.reference}`, body: approve ? serializeAudit(a).place_label : `Motif : ${reason}`,
  });
  return id;
}

async function cancelAudit(db, id, v) {
  const a = await loadAudit(db, id, v);
  openAudit(a);
  await db('qhse_audits').where({ id }).update({ status: 'annule', updated_at: new Date() });
  return id;
}

// ─── Constats ─────────────────────────────────────────────────────────────

async function addFinding(db, auditId, data, v) {
  const a = await loadAudit(db, auditId, v);
  if (a.status !== 'en_cours') throw new HttpError(409, 'Les constats se saisissent pendant l’audit (démarrez-le d’abord).');
  if (!Q.PILLARS[data.pillar]) throw new HttpError(400, 'Volet inconnu.');
  const description = clip(data.description, 500);
  if (!description || description.length < 3) throw new HttpError(400, 'Décrivez le constat.');
  const id = insertedId((await db('qhse_findings').insert({ audit_id: auditId, pillar: data.pillar, description, gravity: data.gravity, created_by: uid(v) }))[0]);
  if (data.gravity === 'critique') {
    await inform(db, 'qhse.constat_critique', {
      direct: [a.manager_id], except: uid(v), key: `qhse-critique:${id}`, link: `/qhse/audits/${auditId}`,
      title: `Constat critique : ${a.reference}`, body: `${serializeAudit(a).place_label} — ${description}`.slice(0, 500),
    });
  }
  return id;
}

async function loadFinding(db, id, v) {
  const f = await db('qhse_findings').where({ id: Number(id) || 0 }).first();
  if (!f) throw new HttpError(404, 'Constat introuvable.');
  const a = await loadAudit(db, f.audit_id, v);
  return { finding: f, audit: a };
}

async function updateFinding(db, id, data, v) {
  const { finding, audit } = await loadFinding(db, id, v);
  if (audit.status !== 'en_cours') throw new HttpError(409, 'Les constats se modifient pendant l’audit.');
  const patch = {};
  if (data.description != null) {
    const d = clip(data.description, 500);
    if (!d || d.length < 3) throw new HttpError(400, 'Décrivez le constat.');
    patch.description = d;
  }
  if (data.gravity) patch.gravity = data.gravity;
  if (data.pillar) {
    if (!Q.PILLARS[data.pillar]) throw new HttpError(400, 'Volet inconnu.');
    patch.pillar = data.pillar;
  }
  if (Object.keys(patch).length) await db('qhse_findings').where({ id: finding.id }).update({ ...patch, updated_at: new Date() });
  return audit.id;
}

async function removeFinding(db, id, v) {
  const { finding, audit } = await loadFinding(db, id, v);
  if (audit.status !== 'en_cours') throw new HttpError(409, 'Les constats se modifient pendant l’audit.');
  if (await db('qhse_actions').where({ finding_id: finding.id }).whereNot('status', 'annulee').first('id')) throw new HttpError(409, 'Ce constat a des actions correctives : annulez-les d’abord.');
  for (const f of await db('qhse_files').where({ owner_kind: 'constat', owner_id: finding.id })) await svc.removeFile(db, f);
  await db('qhse_findings').where({ id: finding.id }).del();
  return audit.id;
}

// ─── Actions correctives ──────────────────────────────────────────────────

const actionQuery = db => db('qhse_actions as x').leftJoin('users as o', 'o.id', 'x.owner_id').leftJoin('users as cu', 'cu.id', 'x.created_by')
  .leftJoin('worksites as w', 'w.id', 'x.worksite_id').leftJoin('qhse_audits as a', 'a.id', 'x.audit_id').leftJoin('sav_tickets as t', 't.id', 'x.sav_ticket_id')
  .select('x.*', 'o.name as owner_name', 'cu.name as created_by_name', 'w.reference as worksite_reference', 'w.name as worksite_name', 'w.manager_id', 'a.reference as audit_reference', 't.ref as sav_ref', 't.title as sav_title');

function serializeAction(x, today = Q.todayStr()) {
  const due = isoDay(x.due_on);
  const late = Q.actionLate({ status: x.status, due_on: due }, today);
  return {
    id: x.id, reference: x.reference, title: x.title, description: x.description, pillar: x.pillar, pillar_label: Q.PILLARS[x.pillar]?.label || null,
    gravity: x.gravity, gravity_label: Q.GRAVITIES[x.gravity], source_kind: x.source_kind, source_label: Q.ACTION_SOURCES[x.source_kind],
    control_id: x.control_id, audit_id: x.audit_id, audit_reference: x.audit_reference || null, finding_id: x.finding_id,
    worksite_id: x.worksite_id, worksite_reference: x.worksite_reference || null, worksite_name: x.worksite_name || null,
    sav_ticket_id: x.sav_ticket_id, sav_ref: x.sav_ref || null, sav_title: x.sav_title || null,
    owner_id: x.owner_id, owner_name: x.owner_name || null, due_on: due, status: x.status, status_label: Q.ACTION_STATUSES[x.status] || x.status,
    late, days_late: late ? Math.max(1, Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${due}T00:00:00Z`)) / 86400000)) : 0,
    lifted_on: isoDay(x.lifted_on), lifted_note: x.lifted_note, created_by_name: x.created_by_name, created_at: isoTime(x.created_at),
  };
}

const actionVisible = (x, v) => svc.seesAll(v) || Number(x.owner_id) === uid(v) || Number(x.created_by) === uid(v) || (x.worksite_id && Number(x.manager_id) === uid(v));

async function listActions(db, v, { status = 'ouvertes', worksiteId = null, ownerId = null, pillar = null, savTicketId = null, limit = 200 } = {}) {
  const today = Q.todayStr();
  const query = actionQuery(db).orderBy([{ column: 'x.due_on' }, { column: 'x.id', order: 'desc' }]).limit(Math.min(Number(limit) || 200, 500));
  if (status === 'ouvertes') query.whereIn('x.status', Q.ACTION_OPEN);
  else if (status === 'retard') query.whereIn('x.status', Q.ACTION_OPEN).where('x.due_on', '<', today);
  else if (status === 'levees') query.where('x.status', 'levee');
  else if (status && status !== 'toutes') query.where('x.status', status);
  if (worksiteId) query.where('x.worksite_id', worksiteId);
  if (ownerId) query.where('x.owner_id', ownerId);
  if (pillar) query.where('x.pillar', pillar);
  if (savTicketId) query.where('x.sav_ticket_id', savTicketId);
  if (!svc.seesAll(v)) query.where(b => b.where('x.owner_id', v.user.id).orWhere('x.created_by', v.user.id).orWhere('w.manager_id', v.user.id));
  return (await query).map(x => serializeAction(x, today));
}

async function loadAction(db, id, v) {
  const x = await actionQuery(db).where('x.id', Number(id) || 0).first();
  if (!x || !actionVisible(x, v)) throw new HttpError(404, 'Action corrective introuvable.');
  return x;
}

async function actionDetail(db, id, v) {
  const x = await loadAction(db, id, v);
  const files = await svc.filesOf(db, 'action', [x.id]);
  const mine = Number(x.owner_id) === uid(v);
  const open = Q.ACTION_OPEN.includes(x.status);
  return {
    ...serializeAction(x), files: files.get(x.id) || [], can_edit: v.can('qhse:actions'),
    can_progress: open && (mine || v.can('qhse:actions')), can_reopen: ['levee', 'annulee'].includes(x.status) && v.can('qhse:actions'),
  };
}

async function checkOwner(db, ownerId) {
  const u = await db('users').where({ id: ownerId, active: true }).first('id', 'role');
  if (!u) throw new HttpError(400, 'Responsable inconnu.');
  const perms = await require('./permissions').effectivePermissions(db, u);
  if (!perms.includes('*') && !perms.includes('qhse:read')) throw new HttpError(400, 'Cette personne n’a pas accès au QHSE : elle ne verrait pas son action (privilège « Consulter le QHSE »).');
  return u.id;
}

/** Ouvre une action corrective. Rattachement (constat, audit, contrôle, réclamation SAV ou chantier) ; échéance proposée selon la gravité. */
async function createAction(db, data, v) {
  const s = await svc.settings(db);
  let worksiteId = data.worksite_id || null;
  let auditId = data.audit_id || null;
  let controlId = data.control_id || null;
  let pillar = data.pillar || null;
  let gravity = data.gravity || null;
  let source = 'manuelle';
  if (data.finding_id) {
    const { finding, audit } = await loadFinding(db, data.finding_id, v);
    if (['valide', 'annule'].includes(audit.status)) throw new HttpError(409, 'Cet audit est clos.');
    auditId = audit.id; worksiteId = audit.worksite_id || worksiteId; pillar = pillar || finding.pillar; gravity = gravity || finding.gravity; source = 'audit';
  } else if (auditId) {
    const audit = await loadAudit(db, auditId, v);
    worksiteId = audit.worksite_id || worksiteId; source = 'audit';
  } else if (controlId) {
    const c = await svc.loadControl(db, controlId, v);
    worksiteId = c.worksite_id; source = 'controle';
  } else if (data.sav_ticket_id) {
    if (!(await db('sav_tickets').where({ id: data.sav_ticket_id }).first('id'))) throw new HttpError(400, 'Réclamation inconnue.');
    source = 'sav';
  }
  if (worksiteId) await svc.worksiteFor(db, worksiteId, v);
  gravity = gravity || 'mineure';
  const title = clip(data.title, 200);
  if (!title || title.length < 3) throw new HttpError(400, 'Indiquez l’action à mener.');
  if (!data.owner_id) throw new HttpError(400, 'Désignez le responsable de l’action.');
  const ownerId = await checkOwner(db, data.owner_id);
  const today = Q.todayStr();
  const dueOn = data.due_on || Q.actionDueDate(gravity, today, s.due);
  if (dueOn < today) throw new HttpError(400, 'L’échéance ne peut pas être passée.');
  const reference = await nextReference(db, 'QHSE', 'qhse_actions');
  const id = insertedId((await db('qhse_actions').insert({
    reference, title, description: clip(data.description, 4000), pillar, gravity, source_kind: source, control_id: controlId, audit_id: auditId, finding_id: data.finding_id || null,
    worksite_id: worksiteId, sav_ticket_id: data.sav_ticket_id || null, owner_id: ownerId, due_on: dueOn, status: 'ouverte', created_by: uid(v),
  }))[0]);
  await inform(db, 'qhse.action_assignee', {
    direct: [ownerId], except: uid(v), key: `qhse-action:${id}:${ownerId}`, link: `/qhse/actions?fiche=${id}`, priority: gravity === 'critique' ? 'urgent' : 'action',
    title: `Action corrective à mener : ${reference}`, body: `${title} — échéance le ${Q.frDay(dueOn)}`,
  });
  return id;
}

async function updateAction(db, id, data, v) {
  const x = await loadAction(db, id, v);
  if (!v.can('qhse:actions')) throw new HttpError(403, 'Droits insuffisants.');
  if (!Q.ACTION_OPEN.includes(x.status)) throw new HttpError(409, 'Cette action est close : rouvrez-la pour la modifier.');
  const patch = {};
  if (data.title != null) {
    const t = clip(data.title, 200);
    if (!t || t.length < 3) throw new HttpError(400, 'Indiquez l’action à mener.');
    patch.title = t;
  }
  if (data.description !== undefined) patch.description = clip(data.description, 4000);
  if (data.gravity) patch.gravity = data.gravity;
  if (data.pillar !== undefined) {
    if (data.pillar && !Q.PILLARS[data.pillar]) throw new HttpError(400, 'Volet inconnu.');
    patch.pillar = data.pillar || null;
  }
  if (data.due_on) patch.due_on = data.due_on;
  let newOwner = null;
  if (data.owner_id && Number(data.owner_id) !== Number(x.owner_id)) { newOwner = await checkOwner(db, data.owner_id); patch.owner_id = newOwner; }
  if (Object.keys(patch).length) await db('qhse_actions').where({ id }).update({ ...patch, updated_at: new Date() });
  if (newOwner) {
    await inform(db, 'qhse.action_assignee', {
      direct: [newOwner], except: uid(v), key: `qhse-action:${id}:${newOwner}`, link: `/qhse/actions?fiche=${id}`,
      title: `Action corrective à mener : ${x.reference}`, body: `${patch.title || x.title} — échéance le ${Q.frDay(patch.due_on || isoDay(x.due_on))}`,
    });
  }
  return id;
}

/** Fait avancer une action : en cours, levée (avec sa preuve), annulée (motif) ou rouverte. */
async function setActionStatus(db, id, data, v) {
  const x = await loadAction(db, id, v);
  const mine = Number(x.owner_id) === uid(v);
  const manager = v.can('qhse:actions');
  const to = data.status;
  const note = clip(data.note, 1000);
  const open = Q.ACTION_OPEN.includes(x.status);
  const now = new Date();
  if (to === 'en_cours') {
    if (!open) throw new HttpError(409, 'Cette action est close.');
    if (!mine && !manager) throw new HttpError(403, 'Droits insuffisants.');
    await db('qhse_actions').where({ id }).update({ status: 'en_cours', updated_at: now });
  } else if (to === 'levee') {
    if (!open) throw new HttpError(409, 'Cette action est close.');
    if (!mine && !manager) throw new HttpError(403, 'Droits insuffisants.');
    const proofs = await db('qhse_files').where({ owner_kind: 'action', owner_id: id, purpose: 'preuve' }).count({ n: '*' }).first();
    if ((!note || note.length < 3) && !Number(proofs.n)) throw new HttpError(400, 'Joignez la preuve de levée : une photo, ou un texte qui décrit ce qui a été fait.');
    const liftedOn = data.lifted_on || Q.todayStr();
    if (liftedOn > Q.todayStr()) throw new HttpError(400, 'La date de levée ne peut pas être à venir.');
    await db('qhse_actions').where({ id }).update({ status: 'levee', lifted_on: liftedOn, lifted_note: note, lifted_by: uid(v), updated_at: now });
    await resolve(db, `qhse-retard:${id}:`);
    await inform(db, 'qhse.action_levee', {
      direct: [x.created_by, x.manager_id], except: uid(v), key: `qhse-levee:${id}`, link: `/qhse/actions?fiche=${id}`,
      title: `Action corrective levée : ${x.reference}`, body: `${x.title}${note ? ` — ${note}` : ''}`.slice(0, 500),
    });
  } else if (to === 'annulee') {
    if (!open) throw new HttpError(409, 'Cette action est close.');
    if (!manager) throw new HttpError(403, 'Droits insuffisants.');
    if (!note || note.length < 3) throw new HttpError(400, 'Indiquez le motif de l’annulation.');
    await db('qhse_actions').where({ id }).update({ status: 'annulee', lifted_note: note, lifted_by: uid(v), updated_at: now });
    await resolve(db, `qhse-retard:${id}:`);
  } else if (to === 'ouverte') {
    if (open) throw new HttpError(409, 'Cette action est déjà ouverte.');
    if (!manager) throw new HttpError(403, 'Droits insuffisants.');
    await db('qhse_actions').where({ id }).update({ status: 'ouverte', lifted_on: null, lifted_note: null, lifted_by: null, updated_at: now });
  } else throw new HttpError(400, 'Statut inconnu.');
  return id;
}

module.exports = {
  listAudits, loadAudit, auditDetail, planAudit, startAudit, saveResults, submitAudit, decideAudit, cancelAudit, auditVisible, serializeAudit,
  addFinding, updateFinding, removeFinding, loadFinding,
  listActions, loadAction, actionDetail, createAction, updateAction, setActionStatus, serializeAction, actionQuery, actionVisible, nextReference,
};
