/**
 * ERP · RH › Présences (référence : Odoo Présences) : pointage d'arrivée et de départ (en ligne, sur une borne
 * de chantier avec matricule et code, ou par feuille de présence du conducteur de travaux), corrections tracées,
 * heures supplémentaires du mois arrêtées par le service RH puis reprises dans la paie.
 */
const { HttpError, toDate, isoTime } = require('../lib/http');
const { hashPassword, checkPassword } = require('../auth');
const { computeOvertime, geoCheck, LEAVE_TYPES, GEO_STATUSES } = require('../lib/rh');
const { WORKSITE_OPEN } = require('../lib/domain');
const rh = require('./rh');
const lieux = require('./lieux');

/** Lieu du pointage : programme (et chantier) ou lieu (siège, bureau, dépôt) ; sans rien, le siège. */
const placeOf = (db, d) => lieux.resolvePlace(db, { project_id: d.project_id ?? null, worksite_id: d.worksite_id ?? null, place_id: d.place_id ?? null });

const insertedId = r => (typeof r === 'object' ? r.id : r);
const HOUR = 3600000;
const lastDay = period => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const num = v => (v == null ? null : Number(v));

const serialize = a => {
  const inAt = toDate(a.check_in), outAt = toDate(a.check_out);
  return {
    ...a, check_in: isoTime(a.check_in), check_out: isoTime(a.check_out), latitude: num(a.latitude), longitude: num(a.longitude), out_latitude: num(a.out_latitude), out_longitude: num(a.out_longitude),
    hours: outAt ? Math.round(((outAt - inAt) / HOUR) * 100) / 100 : null, employee_name: a.last_name ? `${a.last_name} ${a.first_name}` : undefined,
  };
};

// ─── Contrôle du lieu de pointage (demande du client du 02/11) ─────────────

/**
 * Position de référence d'un lieu de pointage : celle du chantier, sinon celle de son programme (fiche projet du dashboard),
 * ou celle du lieu (siège, bureau, dépôt). Rayon du chantier ou du lieu, sinon celui des réglages RH. null : lieu non situé.
 */
async function refPosition(db, { project_id = null, worksite_id = null, place_id = null }, s) {
  const radius = r => Number(r) || s.geofence_radius;
  if (worksite_id) {
    const w = await db('worksites').where({ id: worksite_id }).first('latitude', 'longitude', 'radius_m', 'project_id');
    if (w?.latitude != null && w?.longitude != null) return { latitude: Number(w.latitude), longitude: Number(w.longitude), radius: radius(w.radius_m) };
    const p = await db('projects').where({ id: project_id || w?.project_id || 0 }).first('latitude', 'longitude');
    return p?.latitude != null && p?.longitude != null ? { latitude: Number(p.latitude), longitude: Number(p.longitude), radius: radius(w?.radius_m) } : null;
  }
  if (project_id) {
    const p = await db('projects').where({ id: project_id }).first('latitude', 'longitude');
    return p?.latitude != null && p?.longitude != null ? { latitude: Number(p.latitude), longitude: Number(p.longitude), radius: radius(null) } : null;
  }
  if (place_id) {
    const l = await db('places').where({ id: place_id }).first('latitude', 'longitude', 'radius_m');
    return l?.latitude != null && l?.longitude != null ? { latitude: Number(l.latitude), longitude: Number(l.longitude), radius: radius(l.radius_m) } : null;
  }
  return null;
}

/** Libellé du lieu d'un pointage sérialisé (chantier, programme ou lieu). */
const siteLabel = a => (a.worksite_id ? `${a.worksite_reference} — ${a.worksite_name}` : a.project_name || a.place_name || 'Siège social');
const distanceLabel = m => (m == null ? '' : m >= 1000 ? `${String(Math.round(m / 100) / 10).replace('.', ',')} km` : `${m} m`);

/**
 * Pointage hors zone : le service RH (rh:read), le responsable direct de l'employé et le conducteur du chantier sont prévenus,
 * jamais l'employé lui-même. Réglage « Prévenir… » dans RH › Réglages.
 */
async function notifyOutOfZone(db, a, e, moment, s) {
  if (!s.geofence_notify) return;
  const { inform, usersWith, employeeUser } = require('./notifications');
  const status = moment === 'arrivee' ? a.geo_status : a.out_geo_status;
  if (status !== 'hors_zone') return;
  const direct = [...(await usersWith(db, 'rh:read'))];
  const manager = await employeeUser(db, e.manager_id);
  if (manager) direct.push(manager);
  if (a.worksite_id) {
    const w = await db('worksites').where({ id: a.worksite_id }).first('manager_id');
    if (w?.manager_id) direct.push(w.manager_id);
  }
  const at = moment === 'arrivee' ? a.check_in : a.check_out;
  await inform(db, 'pointage.hors_zone', {
    direct, except: e.user_id || null, link: '/rh/presences?onglet=pointages&controle=alerte', key: `pointage:${a.id}:${moment}`,
    title: `Pointage hors zone : ${e.last_name} ${e.first_name}`,
    body: `${moment === 'arrivee' ? 'Arrivée' : 'Départ'} du ${at.slice(0, 10).split('-').reverse().join('/')} à ${at.slice(11, 16)} à ${distanceLabel(moment === 'arrivee' ? a.distance_m : a.out_distance_m)} de « ${siteLabel(a)} »`,
  });
}

const ZONE_TABLES = { lieu: 'places', chantier: 'worksites' };

/** Modifications de positions en attente du super administrateur, par cible (« lieu:3 », « chantier:7 »). */
async function pendingZones(db, kind = null) {
  const q = db('pointage_zone_requests as r').leftJoin('users as u', 'u.id', 'r.requested_by').where('r.status', 'en_attente').select('r.*', 'u.name as requested_by_name');
  if (kind) q.where('r.kind', kind);
  return Object.fromEntries((await q).map(r => [`${r.kind}:${r.target_id}`, {
    id: r.id, latitude: num(r.latitude), longitude: num(r.longitude), radius_m: r.radius_m || null,
    requested_by: r.requested_by, requested_by_name: r.requested_by_name || null, requested_at: isoTime(r.updated_at || r.created_at),
  }]));
}

/** Lieux et chantiers à situer (RH › Réglages) : lieux actifs, programmes et leurs chantiers non clos, rayon par défaut, modifications en attente. */
async function zones(db) {
  const s = await rh.getSettings(db);
  const [places, projects, worksites, pending] = await Promise.all([
    db('places').where({ active: true }).orderBy([{ column: 'sort' }, { column: 'name' }]).select('id', 'kind', 'name', 'latitude', 'longitude', 'radius_m'),
    db('projects').orderBy('name').select('id', 'name', 'latitude', 'longitude'),
    db('worksites').whereIn('status', WORKSITE_OPEN).orderBy('reference').select('id', 'reference', 'name', 'project_id', 'latitude', 'longitude', 'radius_m'),
    pendingZones(db),
  ]);
  const pos = x => ({ latitude: num(x.latitude), longitude: num(x.longitude) });
  return {
    default_radius: s.geofence_radius, geolocation: s.geolocation,
    places: places.map(p => ({ id: p.id, kind: p.kind, name: p.name, ...pos(p), radius_m: p.radius_m || null, pending: pending[`lieu:${p.id}`] || null })),
    programmes: projects.map(p => ({
      id: p.id, name: p.name, ...pos(p),
      worksites: worksites.filter(w => w.project_id === p.id).map(w => ({ id: w.id, reference: w.reference, name: w.name, ...pos(w), radius_m: w.radius_m || null, pending: pending[`chantier:${w.id}`] || null })),
    })),
  };
}

/** Position et rayon d'un lieu ou d'un chantier : latitude et longitude ensemble, ou aucune des deux. */
function checkPosition({ latitude, longitude }) {
  if ((latitude == null) !== (longitude == null)) throw new HttpError(400, 'Position : latitude et longitude vont ensemble.');
}
const r7 = v => (v == null ? null : Math.round(Number(v) * 1e7) / 1e7); // précision des colonnes
const zoneName = async (db, kind, id) => {
  if (kind === 'chantier') { const w = await db('worksites').where({ id }).first('reference', 'name'); return w ? `${w.reference} — ${w.name}` : `chantier n° ${id}`; }
  return (await db('places').where({ id }).first('name'))?.name || `lieu n° ${id}`;
};

/**
 * Position et rayon d'un lieu ou d'un chantier (choix du client du 02/11). Le super administrateur, et toute première saisie d'un
 * lieu sans position, s'appliquent tout de suite. Changer ou effacer une position existante attend la validation du super
 * administrateur ; l'ancienne position sert au contrôle jusqu'à sa décision. Une nouvelle demande remplace celle en attente.
 * Renvoie { applied, request_id }.
 */
async function setZone(db, kind, id, data, user) {
  const next = { latitude: r7(data.latitude), longitude: r7(data.longitude), radius_m: data.radius_m || null };
  checkPosition(next);
  const table = ZONE_TABLES[kind];
  const cur = await db(table).where({ id }).first('latitude', 'longitude', 'radius_m');
  if (!cur) throw new HttpError(404, kind === 'chantier' ? 'Chantier introuvable.' : 'Lieu introuvable.');
  if (r7(cur.latitude) === next.latitude && r7(cur.longitude) === next.longitude && (cur.radius_m || null) === next.radius_m) return { applied: false, request_id: null };
  const { inform, resolve } = require('./notifications');
  const superAdmin = user.role === 'super_admin';
  if (superAdmin || cur.latitude == null) {
    await db(table).where({ id }).update({ ...next, updated_at: new Date() });
    if (superAdmin) { // sa saisie l'emporte sur une demande en attente
      for (const r of await db('pointage_zone_requests').where({ kind, target_id: id, status: 'en_attente' })) {
        await db('pointage_zone_requests').where({ id: r.id }).update({ status: 'annulee', decided_by: user.id, decided_at: new Date(), decision_note: 'Remplacée par une saisie du super administrateur', updated_at: new Date() });
        await resolve(db, `zone:${r.id}:`);
      }
    }
    return { applied: true, request_id: null };
  }
  const row = { ...next, old_latitude: cur.latitude, old_longitude: cur.longitude, old_radius_m: cur.radius_m, requested_by: user.id, updated_at: new Date() };
  const pending = await db('pointage_zone_requests').where({ kind, target_id: id, status: 'en_attente' }).first('id');
  let rid = pending?.id;
  if (rid) { await db('pointage_zone_requests').where({ id: rid }).update(row); await resolve(db, `zone:${rid}:`); }
  else rid = insertedId((await db('pointage_zone_requests').insert({ ...row, kind, target_id: id }))[0]);
  const admins = await db('users').where({ role: 'super_admin', active: true }).select('id');
  const where = await zoneName(db, kind, id);
  await inform(db, 'pointage.position_a_valider', {
    direct: admins, except: user.id, link: '/rh/reglages#positions-pointage', key: `zone:${rid}:sa:${Date.now()}`,
    title: `Position de pointage à valider : ${where}`,
    body: next.latitude == null ? `${user.name} demande d’effacer la position.` : `${user.name} propose ${next.latitude}, ${next.longitude}${next.radius_m ? ` (rayon ${next.radius_m} m)` : ''}.`,
  });
  return { applied: false, request_id: rid };
}

/** Décision sur une modification en attente : le super administrateur valide ou refuse ; le demandeur peut l'annuler. */
async function decideZone(db, rid, { action, note = null }, user) {
  const r = await db('pointage_zone_requests').where({ id: rid }).first();
  if (!r) throw new HttpError(404, 'Demande introuvable.');
  if (r.status !== 'en_attente') throw new HttpError(409, 'Cette demande n’est plus en attente.');
  const superAdmin = user.role === 'super_admin';
  if (action === 'annuler' ? !superAdmin && r.requested_by !== user.id : !superAdmin) throw new HttpError(403, 'Seul le super administrateur valide ou refuse une position de pointage.');
  const { inform, resolve } = require('./notifications');
  const status = { valider: 'validee', refuser: 'refusee', annuler: 'annulee' }[action];
  await db.transaction(async trx => {
    if (action === 'valider' && !(await trx(ZONE_TABLES[r.kind]).where({ id: r.target_id }).update({ latitude: r.latitude, longitude: r.longitude, radius_m: r.radius_m, updated_at: new Date() }))) {
      throw new HttpError(404, r.kind === 'chantier' ? 'Chantier introuvable.' : 'Lieu introuvable.');
    }
    await trx('pointage_zone_requests').where({ id: rid }).update({ status, decided_by: user.id, decided_at: new Date(), decision_note: note, updated_at: new Date() });
  });
  await resolve(db, `zone:${rid}:`);
  if (action !== 'annuler' && r.requested_by) {
    const where = await zoneName(db, r.kind, r.target_id);
    await inform(db, 'pointage.position_decidee', {
      direct: r.requested_by, except: user.id, link: '/rh/reglages#positions-pointage', key: `zone:${rid}:decision`,
      title: `Position de pointage ${action === 'valider' ? 'validée' : 'refusée'} : ${where}`, body: note ? `Motif : ${note}` : null,
    });
  }
  return zones(db);
}
const query = db => db('hr_attendances as a').join('employees as e', 'e.id', 'a.employee_id').leftJoin('projects as p', 'p.id', 'a.project_id').leftJoin('users as u', 'u.id', 'a.created_by')
  .leftJoin('worksites as w', 'w.id', 'a.worksite_id').leftJoin('places as pl', 'pl.id', 'a.place_id')
  .select('a.*', 'e.matricule', 'e.last_name', 'e.first_name', 'e.department', 'e.manager_id', 'p.name as project_name', 'u.name as created_by_name',
    'w.reference as worksite_reference', 'w.name as worksite_name', 'pl.name as place_name');

/** Pointage en cours (arrivée sans départ) d'un employé. */
async function openOf(db, employeeId) {
  const a = await db('hr_attendances').where({ employee_id: employeeId }).whereNull('check_out').orderBy('check_in', 'desc').first();
  return a ? serialize(a) : null;
}

/**
 * Arrivée ou départ selon l'état du pointage ; refus si l'employé est sorti des effectifs. Avec la géolocalisation des réglages RH,
 * la position de l'appareil (téléphone ou tablette de la borne) est comparée au lieu choisi, à l'arrivée comme au départ : le
 * pointage est toujours enregistré, et signalé s'il est hors zone, imprécis ou sans position.
 */
async function toggle(db, e, { project_id = null, worksite_id = null, place_id = null, latitude = null, longitude = null, accuracy = null, source = 'web', userId = null, at = new Date() }) {
  if (!e.active || (e.end_date && e.end_date < at.toISOString().slice(0, 10))) throw new HttpError(400, 'Employé sorti des effectifs.');
  const s = await rh.getSettings(db);
  const pos = latitude != null && longitude != null ? { latitude, longitude, accuracy } : null;
  const control = async site => {
    if (!s.geolocation) return { lat: null, lng: null, accuracy_m: null, distance_m: null, geo_status: null };
    const r = geoCheck(pos, await refPosition(db, site, s));
    return { lat: pos?.latitude ?? null, lng: pos?.longitude ?? null, accuracy_m: pos && accuracy != null ? Math.round(accuracy) : null, ...r };
  };
  const open = await openOf(db, e.id);
  if (open) {
    if (at - toDate(open.check_in) > 16 * HOUR) throw new HttpError(409, 'Pointage d’arrivée de plus de 16 heures : demandez une correction au service RH ou au conducteur de travaux.');
    const g = await control(open);
    await db('hr_attendances').where({ id: open.id }).update({
      check_out: at, out_latitude: g.lat, out_longitude: g.lng, out_accuracy_m: g.accuracy_m, out_distance_m: g.distance_m, out_geo_status: g.geo_status, updated_at: new Date(),
    });
    const a = serialize(await query(db).where('a.id', open.id).first());
    await notifyOutOfZone(db, a, e, 'depart', s);
    return { action: 'depart', attendance: a };
  }
  const site = await placeOf(db, { project_id, worksite_id, place_id });
  const g = await control(site);
  const [id] = await db('hr_attendances').insert({
    employee_id: e.id, check_in: at, source, ...site, latitude: g.lat, longitude: g.lng, accuracy_m: g.accuracy_m, distance_m: g.distance_m, geo_status: g.geo_status, created_by: userId,
  });
  const a = serialize(await query(db).where('a.id', insertedId(id)).first());
  await notifyOutOfZone(db, a, e, 'arrivee', s);
  return { action: 'arrivee', attendance: a };
}

// Verrou de la borne (audit du 30/10) : 5 échecs en 15 minutes bloquent le matricule, même avec le bon code, jusqu'à la fin de
// la fenêtre. En mémoire du processus (une relance le remet à zéro) ; la limite par adresse et par compte complète la route.
const KIOSK_MAX_FAILS = 5, KIOSK_WINDOW = 15 * 60 * 1000;
const kioskFails = new Map(); // matricule -> horodatages des échecs récents
const recentFails = (key, now) => {
  const list = (kioskFails.get(key) || []).filter(t => now - t < KIOSK_WINDOW);
  if (list.length) kioskFails.set(key, list); else kioskFails.delete(key);
  return list;
};
let dummyHash = null; // vérification factice : un matricule inconnu coûte le même temps qu'un code faux
const dummyCheck = async pin => { dummyHash ||= hashPassword('code-factice-borne'); return checkPassword(String(pin), await dummyHash); };
/** Remet à zéro le verrou (tests). */
const resetKioskLocks = () => kioskFails.clear();

/** Borne de pointage : matricule + code personnel, sur une tablette ouverte par un compte autorisé. */
async function kiosk(db, { matricule, pin, project_id, worksite_id, place_id, latitude = null, longitude = null, accuracy = null }, userId, now = Date.now()) {
  const key = String(matricule).trim().toUpperCase();
  const fails = recentFails(key, now);
  if (fails.length >= KIOSK_MAX_FAILS) {
    await dummyCheck(pin);
    throw new HttpError(429, `Trop d’essais pour ce matricule : réessayez dans ${Math.max(1, Math.ceil((fails[0] + KIOSK_WINDOW - now) / 60000))} minute(s) ou demandez au service RH.`);
  }
  const e = rh.normEmployee(await db('employees').where({ matricule: key }).first());
  const ok = e && e.attendance_pin_hash ? await checkPassword(String(pin), e.attendance_pin_hash) : (await dummyCheck(pin), false);
  if (!ok) {
    kioskFails.set(key, [...fails, now]);
    if (kioskFails.size > 5000) for (const k of kioskFails.keys()) recentFails(k, now); // purge des matricules inventés
    throw new HttpError(401, 'Matricule ou code incorrect.');
  }
  kioskFails.delete(key);
  const r = await toggle(db, e, { project_id, worksite_id, place_id, latitude, longitude, accuracy, source: 'borne', userId }); // position de la tablette
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
async function saveSheet(db, { date, project_id = null, worksite_id = null, place_id = null, rows }, userId) {
  const from = new Date(`${date}T00:00:00Z`), to = new Date(from.getTime() + 24 * HOUR);
  const site = await placeOf(db, { project_id, worksite_id, place_id });
  return db.transaction(async trx => {
    let created = 0;
    for (const r of rows) {
      const e = await trx('employees').where({ id: r.employee_id }).first();
      if (!e) throw new HttpError(404, 'Employé introuvable.');
      const del = trx('hr_attendances').where({ employee_id: e.id, source: 'feuille' }).where('check_in', '>=', from).where('check_in', '<', to);
      for (const k of ['project_id', 'worksite_id', 'place_id']) { if (site[k]) del.where(k, site[k]); else del.whereNull(k); }
      await del.del();
      for (const [start, end] of r.periods || []) {
        const a = at(date, start), b = at(date, end);
        if (b <= a) throw new HttpError(400, `${e.last_name} ${e.first_name} : l’heure de fin précède l’heure de début.`);
        const clash = (await trx('hr_attendances').where({ employee_id: e.id })).find(x => toDate(x.check_in) < b && (toDate(x.check_out) || new Date(8.64e15)) > a);
        if (clash) throw new HttpError(409, `${e.last_name} ${e.first_name} a déjà un pointage sur cette plage.`);
        await trx('hr_attendances').insert({ employee_id: e.id, check_in: a, check_out: b, source: 'feuille', ...site, note: r.note || null, created_by: userId });
        created++;
      }
    }
    return created;
  });
}

/** Correction ou saisie manuelle (motif obligatoire) : arrivée avant départ, pas de chevauchement. */
async function upsertManual(db, { id = null, employee_id, check_in, check_out, project_id = null, worksite_id = null, place_id = null, note }, userId) {
  const a = toDate(check_in), b = check_out ? toDate(check_out) : null;
  if (!a || (check_out && !b)) throw new HttpError(400, 'Date et heure invalides.');
  if (b && b <= a) throw new HttpError(400, 'Le départ précède l’arrivée.');
  if (b && b - a > 24 * HOUR) throw new HttpError(400, 'Un pointage ne dépasse pas 24 heures.');
  const others = (await db('hr_attendances').where({ employee_id })).filter(x => x.id !== id);
  if (others.some(x => toDate(x.check_in) < (b || new Date(8.64e15)) && (toDate(x.check_out) || new Date(8.64e15)) > a)) throw new HttpError(409, 'Ce pointage chevauche un autre pointage.');
  const row = { employee_id, check_in: a, check_out: b, ...(await placeOf(db, { project_id, worksite_id, place_id })), note, source: 'manuel', created_by: userId, updated_at: new Date() };
  if (id) {
    // Pointage contrôlé dont on change le lieu : les positions enregistrées sont comparées au nouveau lieu
    const cur = await db('hr_attendances').where({ id }).first();
    if (cur && (cur.geo_status || cur.out_geo_status) && ['project_id', 'worksite_id', 'place_id'].some(k => (cur[k] || null) !== (row[k] || null))) {
      const s = await rh.getSettings(db);
      const ref = await refPosition(db, row, s);
      const at = (lat, lng, acc) => (lat == null ? null : { latitude: Number(lat), longitude: Number(lng), accuracy: acc });
      if (cur.geo_status) Object.assign(row, geoCheck(at(cur.latitude, cur.longitude, cur.accuracy_m), ref));
      if (cur.out_geo_status) { const g = geoCheck(at(cur.out_latitude, cur.out_longitude, cur.out_accuracy_m), ref); Object.assign(row, { out_geo_status: g.geo_status, out_distance_m: g.distance_m }); }
    }
    await db('hr_attendances').where({ id }).update(row);
  }
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
async function today(db, now = new Date(), scope = null) {
  const day = now.toISOString().slice(0, 10);
  const from = new Date(`${day}T00:00:00Z`);
  const rows = (await query(db).where('a.check_in', '>=', from).modify(q => applyScope(q, scope))).map(serialize);
  const team = scope ? await scopedEmployeeIds(db, scope) : null;
  const leaves = (await rh.leaveQuery(db).where('l.status', 'approuvee')).map(rh.serializeLeave).filter(l => l.start_date <= day && l.end_date >= day && (!team || team.includes(l.employee_id)));
  return {
    present: rows.filter(a => !a.check_out), done: rows.filter(a => a.check_out),
    on_leave: leaves.map(l => ({ employee_id: l.employee_id, employee_name: l.employee_name, label: LEAVE_TYPES[l.type]?.label })),
  };
}

/**
 * Périmètre des pointages d'un compte qui pointe sans « Voir le personnel » ni arrêt des heures supplémentaires (point 10 de l'audit
 * du 30/10) : les chantiers qu'il conduit (worksites.manager_id), les pointages d'un programme dont il conduit un chantier quand
 * le pointage n'a pas de chantier, son équipe (employees.manager_id) et ses propres pointages. null = tout le personnel.
 */
async function scopeOf(db, req) {
  if (req.user.role === 'super_admin' || req.can('rh:read') || req.can('rh:overtime')) return null;
  const worksites = await db('worksites').where({ manager_id: req.user.id }).select('id', 'project_id');
  return { me: await rh.employeeOf(db, req.user.id), worksiteIds: worksites.map(w => w.id), projectIds: [...new Set(worksites.map(w => w.project_id).filter(Boolean))] };
}
/** Restreint une requête sur les pointages (alias « a » et « e », voir query) au périmètre. */
function applyScope(q, scope) {
  if (!scope) return q;
  return q.where(w => {
    w.whereIn('a.worksite_id', scope.worksiteIds).orWhere(x => x.whereNull('a.worksite_id').whereIn('a.project_id', scope.projectIds));
    if (scope.me) w.orWhere('e.manager_id', scope.me.id).orWhere('e.id', scope.me.id);
  });
}
/** Employés du périmètre : l'équipe, soi-même et qui a pointé dans ses chantiers (pour les heures supplémentaires et les absences). */
async function scopedEmployeeIds(db, scope) {
  const ids = new Set();
  if (scope.me) {
    ids.add(scope.me.id);
    for (const e of await db('employees').where({ manager_id: scope.me.id }).pluck('id')) ids.add(e);
  }
  const q = db('hr_attendances as a').join('employees as e', 'e.id', 'a.employee_id').distinct('a.employee_id');
  applyScope(q, { ...scope, me: null });
  for (const r of await q) ids.add(r.employee_id);
  return [...ids];
}
/** Le pointage (ou la feuille) visé est-il dans le périmètre ? Chantier / programme conduit, ou employés de l'équipe. */
async function inScope(db, scope, { worksite_id = null, project_id = null }, employeeIds) {
  if (!scope) return true;
  if (worksite_id ? scope.worksiteIds.includes(worksite_id) : !!project_id && scope.projectIds.includes(project_id)) return true;
  const ids = [...new Set([].concat(employeeIds))];
  if (!scope.me || !ids.length) return false;
  return Number((await db('employees').whereIn('id', ids).where({ manager_id: scope.me.id }).count({ n: '*' }).first()).n) === ids.length;
}

module.exports = { GEO_STATUSES, refPosition, zones, pendingZones, setZone, decideZone, checkPosition, scopeOf, applyScope, scopedEmployeeIds, inScope, serialize, query, openOf, toggle, kiosk, resetKioskLocks, setPin, saveSheet, upsertManual, overtimeReport, approveOvertime, today, monthAttendances, lastDay };
