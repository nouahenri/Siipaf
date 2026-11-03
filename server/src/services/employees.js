/**
 * Fiche employé : un seul formulaire et une seule règle d'enregistrement pour Ressources humaines et Comptabilité
 * (demande du client du 29/10). Chaque groupe de champs reste au droit qui le gouverne :
 * identité, contrat, responsable → « Gérer les dossiers du personnel » (rh:files) ou « Gérer les fiches salariés » (paie:employees) ;
 * salaire, indemnités, paiement, parts fiscales, expatriation → paie:salary ; solde de congés repris → conges:adjust.
 */
const { z } = require('../lib/zod');
const { HttpError } = require('../lib/http');
const { ensureNotAbove } = require('./permissions');
const { CONTRACT_TYPES, DEPARTMENTS, MARITAL, PAY_METHODS, ID_TYPES } = require('../lib/paie');
const rh = require('./rh');
const positions = require('./positions');
const departures = require('./departures');
const kpi = require('./kpi');
const { inform } = require('./notifications');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const optText = max => z.string().trim().max(max).optional().nullable().transform(v => v || null);
const money = z.number().int().min(0);

/**
 * Matricule attribué par le service RH (demande du client du 03/11 : saisi, jamais numéroté automatiquement). Il sert
 * d'identifiant à la borne de pointage et de code de tiers en Comptabilité : unique, 3 à 20 caractères (lettres, chiffres,
 * tirets), rangé en majuscules comme le cherche la borne.
 */
const matricule = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,19}$/, 'Matricule : 3 à 20 caractères (lettres, chiffres, tirets).');
async function assertMatriculeFree(db, value, selfId = null) {
  const taken = await db('employees').where({ matricule: value }).whereNot('id', selfId || 0).first('first_name', 'last_name');
  if (taken) throw new HttpError(409, `Le matricule ${value} est déjà attribué à ${taken.last_name} ${taken.first_name}.`);
}

const employeeSchema = z.object({
  matricule: matricule.optional(),
  last_name: z.string().trim().min(1).max(80), first_name: z.string().trim().min(1).max(80), gender: z.enum(['F', 'M']).optional().nullable(),
  birth_date: day.optional().nullable(), birth_place: optText(80), nationality: optText(60), expatriate: z.boolean().optional(), phone: optText(40),
  email: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal('').transform(() => null)), address: optText(255),
  id_type: z.enum(Object.keys(ID_TYPES)).optional().nullable(), id_number: optText(60), cnps_number: optText(40), emergency_contact: optText(160),
  marital_status: z.enum(Object.keys(MARITAL)).optional(), children: z.number().int().min(0).max(20).optional(),
  tax_parts: z.number().min(1).max(5).multipleOf(0.5).optional().nullable(), job_title: z.string().trim().min(2).max(120),
  position_id: z.number().int().positive().optional().nullable(),
  department: z.enum(Object.keys(DEPARTMENTS)).optional(), category: optText(40), contract_type: z.enum(Object.keys(CONTRACT_TYPES)).optional(),
  hire_date: day, end_date: day.optional().nullable(), trial_end_date: day.optional().nullable(),
  manager_id: z.number().int().positive().optional().nullable(), project_id: z.number().int().positive().optional().nullable(),
  user_id: z.number().int().positive().optional().nullable(), active: z.boolean().optional(), notes: optText(500),
  base_salary: money, housing_allowance: money.optional(), transport_allowance: money.optional(), other_allowance: money.optional(),
  site_hourly_rate: z.number().int().min(0).max(1000000).optional().nullable(), accident_rate: z.number().min(0).max(10).optional().nullable(),
  pay_method: z.enum(Object.keys(PAY_METHODS)).optional(), bank_account: optText(80),
  leave_opening_days: z.number().min(-60).max(200).optional().nullable(), leave_opening_date: day.optional().nullable(),
});

/** Champs de la paie : réservés au droit « Salaire et paiement » (paie:salary). */
const PAY_FIELDS = ['base_salary', 'housing_allowance', 'transport_allowance', 'other_allowance', 'site_hourly_rate', 'accident_rate', 'pay_method', 'bank_account', 'tax_parts', 'expatriate'];
const LEAVE_FIELDS = ['leave_opening_days', 'leave_opening_date'];

async function checkUser(db, userId, selfId = null) {
  if (!userId) return;
  if (!(await db('users').where({ id: userId }).first())) throw new HttpError(404, 'Compte du dashboard introuvable.');
  const taken = await db('employees').where({ user_id: userId }).whereNot('id', selfId || 0).first();
  if (taken) throw new HttpError(409, `Ce compte est déjà relié à ${taken.first_name} ${taken.last_name}.`);
}

/**
 * Relier une fiche à un compte (ou l'en détacher) touche à ce compte : droit « Modifier un compte », jamais le compte d'un
 * super administrateur ni plus privilégié que soi, ni son propre compte (audit du 30/10). Le super administrateur n'est pas limité.
 * Ne s'applique qu'à une fiche EXISTANTE : à la création (embauche), la Comptabilité relie librement le compte de la nouvelle
 * personne, ce qui ne reprend la fiche de personne.
 */
async function guardUserLink(db, userId, { user, can }) {
  if (!userId) return;
  if (!can('users:edit')) throw new HttpError(403, 'Relier une fiche à un compte demande le droit « Modifier un compte ».');
  if (user.role === 'super_admin') return;
  const target = await db('users').where({ id: userId }).first();
  if (!target) return; // checkUser répond « introuvable »
  if (target.id === user.id) throw new HttpError(403, 'Vous ne pouvez pas relier votre propre compte à une fiche : demandez au service RH.');
  if (target.role === 'super_admin') throw new HttpError(403, 'Seul un super administrateur peut modifier un super administrateur.');
  await ensureNotAbove(db, user, { user: target });
}

/** Enregistre la fiche (RH ou Comptabilité, même règle) ; renvoie la fiche avant et après. */
async function update(db, id, data, { user, can }) {
  const superAdmin = user.role === 'super_admin';
  if (!can('rh:files') && !can('paie:employees')) throw new HttpError(403, 'Droits insuffisants.');
  if (PAY_FIELDS.some(k => k in data) && !can('paie:salary')) throw new HttpError(403, 'Salaire, indemnités et paiement se règlent avec le droit « Salaire et paiement » (Comptabilité).');
  if (LEAVE_FIELDS.some(k => k in data) && !can('conges:adjust')) throw new HttpError(403, 'Le solde d’ouverture des congés se règle avec le droit « Ajuster les soldes ».');
  const before = await db('employees').where({ id }).first();
  if (!before) throw new HttpError(404, 'Employé introuvable.');
  if (before.user_id === user.id && !superAdmin) throw new HttpError(403, 'Votre propre fiche se modifie par le service RH ou la Comptabilité (vos coordonnées : Mon espace).');
  if (data.user_id !== undefined && (data.user_id || null) !== (before.user_id || null)) {
    await guardUserLink(db, data.user_id, { user, can });
    await guardUserLink(db, before.user_id, { user, can }); // détacher le compte actuel
    await checkUser(db, data.user_id, id);
  }
  // Se nommer responsable de quelqu'un donne ses droits de responsable : jamais pour soi-même
  if (data.manager_id && !superAdmin && (await db('employees').where({ id: data.manager_id }).first('user_id'))?.user_id === user.id) {
    throw new HttpError(403, 'Vous ne pouvez pas vous nommer responsable d’un employé : demandez au service RH.');
  }
  // Le matricule s'attribue et se corrige au service RH ; l'employé est prévenu (son identifiant à la borne change)
  const newMatricule = data.matricule !== undefined && data.matricule !== before.matricule;
  if (newMatricule) {
    if (!can('rh:files')) throw new HttpError(403, 'Le matricule est attribué par le service RH (droit « Gérer les dossiers du personnel »).');
    await assertMatriculeFree(db, data.matricule, id);
  }
  if (data.manager_id === id) throw new HttpError(400, 'Un employé ne peut pas être son propre responsable.');
  if (data.manager_id && !(await db('employees').where({ id: data.manager_id }).first())) throw new HttpError(404, 'Responsable introuvable.');
  // Pas de boucle dans la hiérarchie (A responsable de B, B responsable de A)
  for (let m = data.manager_id, guard = 0; m && guard < 50; guard++) {
    if (m === id) throw new HttpError(400, 'Cette hiérarchie formerait une boucle.');
    m = (await db('employees').where({ id: m }).first('manager_id'))?.manager_id;
  }
  await db.transaction(async trx => {
    // Un intitulé saisi ici reste dans la liste des postes (RH › Réglages)
    if (data.position_id || (data.job_title && data.job_title !== before.job_title)) {
      Object.assign(data, await positions.resolve(trx, { position_id: data.position_id, job_title: data.job_title, department: data.department || before.department }));
    }
    await trx('employees').where({ id }).update({ ...data, updated_at: new Date() });
    await rh.logChanges(trx, rh.normEmployee(before), data, user.id);
  });
  const after = await db('employees').where({ id }).first();
  if (newMatricule && after.user_id) {
    await inform(db, 'rh.matricule', {
      direct: after.user_id, except: user.id, module: 'rh', link: '/rh/moi', key: `matricule:${id}:${after.matricule}`,
      title: `Votre matricule devient ${after.matricule}`,
      body: `Le service RH a remplacé ${before.matricule} par ${after.matricule}. Utilisez ce nouveau matricule pour pointer à la borne.`,
    });
  }
  // Sortie : compte, matériel et dossiers à régler sont signalés à ceux qui les reprennent
  if (before.active && data.active === false) await departures.notifyDeparture(db, after, { user });
  // Nouveau poste ou nouveau service : leurs modèles d'objectifs s'appliquent (un objectif déjà présent est gardé)
  if (after.active && (after.position_id !== before.position_id || after.department !== before.department)) await kpi.applyForEmployee(db, id, { user });
  return { before, after };
}

const insertedId = r => (typeof r === 'object' ? r.id : r);

/**
 * Nouvelle fiche (demande du client du 02/11 : la création est du ressort du service RH, transmise à la Comptabilité) : matricule,
 * événement de carrière « Embauche », modèles d'objectifs, puis la Comptabilité (salaire à fixer), les comptes et les services
 * généraux sont prévenus (announceHire). Salaire : paie:salary ; solde de congés repris : conges:adjust. Renvoie l'identifiant.
 */
async function create(db, data, { user, can }) {
  // Sans le droit « Salaire et paiement », la fiche est créée à 0 et la Comptabilité fixe le salaire
  if (PAY_FIELDS.some(k => data[k] != null && data[k] !== 0 && data[k] !== false) && !can('paie:salary')) {
    throw new HttpError(403, 'Salaire, indemnités et paiement se règlent avec le droit « Salaire et paiement ».');
  }
  // Solde de congés repris : « Ajuster les soldes » (le compte relié à une nouvelle fiche reste libre : l'embauche ne reprend la
  // fiche de personne ; changer le compte d'une fiche existante demande « Modifier un compte », voir guardUserLink)
  if (LEAVE_FIELDS.some(k => data[k] != null) && !can('conges:adjust')) throw new HttpError(403, 'Le solde d’ouverture des congés se règle avec le droit « Ajuster les soldes ».');
  if (!data.matricule) throw new HttpError(400, 'Saisissez le matricule attribué par le service RH.');
  await assertMatriculeFree(db, data.matricule);
  await checkUser(db, data.user_id);
  if (data.manager_id && !(await db('employees').where({ id: data.manager_id }).first('id'))) throw new HttpError(404, 'Responsable introuvable.');
  const row = { base_salary: 0, ...data };
  const id = await db.transaction(async trx => {
    Object.assign(row, await positions.resolve(trx, row));
    const newId = insertedId((await trx('employees').insert(row))[0]);
    await trx('hr_career_events').insert({ employee_id: newId, date: row.hire_date, kind: 'embauche', label: `Embauche : ${row.job_title}`, details: JSON.stringify({ contract_type: row.contract_type || 'cdi' }), created_by: user.id });
    return newId;
  });
  // Modèles d'objectifs du service et du poste appliqués pour l'année en cours (RH › Référentiel KPI)
  await kpi.applyForEmployee(db, id, { user });
  await rh.announceHire(db, id, user.id);
  return id;
}

/** Fiches créées depuis des comptes du dashboard (reprise du personnel déjà présent) : nom, e-mail, poste et service tirés du compte. */
const ROLE_JOBS = { super_admin: 'Direction', commercial: 'Commercial(e)', editeur: 'Chargé(e) de communication', conducteur_travaux: 'Conducteur de travaux', comptable: 'Comptable', resp_exploitation: 'Responsable des exploitations' };
const ROLE_DEPTS = { super_admin: 'direction', commercial: 'commercial', editeur: 'administratif', conducteur_travaux: 'technique', comptable: 'comptabilite', resp_exploitation: 'direction' };
async function createFromUsers(db, people, hireDate, { user }) {
  // Un matricule saisi par le service RH pour chaque compte choisi : ni deux fois le même, ni un matricule déjà pris
  // (un compte qui a déjà sa fiche est ignoré, son matricule saisi aussi)
  const linked = new Set(await db('employees').whereIn('user_id', people.map(p => p.user_id)).pluck('user_id'));
  people = people.filter(p => !linked.has(p.user_id));
  const seen = new Set();
  for (const p of people) {
    if (seen.has(p.matricule)) throw new HttpError(400, `Le matricule ${p.matricule} est saisi deux fois.`);
    seen.add(p.matricule);
    await assertMatriculeFree(db, p.matricule);
  }
  const ids = [];
  await db.transaction(async trx => {
    for (const { user_id: uid, matricule: code } of people) {
      const u = await trx('users').where({ id: uid }).first();
      if (!u || await trx('employees').where({ user_id: uid }).first()) continue;
      const [first, ...rest] = u.name.trim().split(/\s+/);
      const [id] = await trx('employees').insert({
        matricule: code, user_id: u.id, first_name: first, last_name: rest.join(' ') || first, email: u.email, phone: u.phone || null,
        ...(await positions.resolve(trx, { job_title: ROLE_JOBS[u.role] || 'Employé(e)', department: ROLE_DEPTS[u.role] || 'administratif' })), hire_date: hireDate, base_salary: 0,
      });
      ids.push(insertedId(id));
    }
  });
  for (const id of ids) await kpi.applyForEmployee(db, id, { user });
  return ids.length;
}

module.exports = { employeeSchema, matricule, assertMatriculeFree, checkUser, guardUserLink, create, createFromUsers, update, PAY_FIELDS, LEAVE_FIELDS };
