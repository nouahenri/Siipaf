/**
 * Fiche employé : un seul formulaire et une seule règle d'enregistrement pour Ressources humaines et Comptabilité
 * (demande du client du 29/10). Chaque groupe de champs reste au droit qui le gouverne :
 * identité, contrat, responsable → « Gérer les dossiers du personnel » (rh:files) ou « Gérer les fiches salariés » (paie:employees) ;
 * salaire, indemnités, paiement, parts fiscales, expatriation → paie:salary ; solde de congés repris → conges:adjust.
 */
const { z } = require('zod');
const { HttpError } = require('../lib/http');
const { ensureNotAbove } = require('./permissions');
const { CONTRACT_TYPES, DEPARTMENTS, MARITAL, PAY_METHODS } = require('../lib/paie');
const rh = require('./rh');
const positions = require('./positions');
const departures = require('./departures');
const kpi = require('./kpi');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const optText = max => z.string().trim().max(max).optional().nullable().transform(v => v || null);
const money = z.number().int().min(0);

const employeeSchema = z.object({
  last_name: z.string().trim().min(1).max(80), first_name: z.string().trim().min(1).max(80), gender: z.enum(['F', 'M']).optional().nullable(),
  birth_date: day.optional().nullable(), birth_place: optText(80), nationality: optText(60), expatriate: z.boolean().optional(), phone: optText(40),
  email: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal('').transform(() => null)), address: optText(255),
  id_number: optText(60), cnps_number: optText(40), emergency_contact: optText(160),
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
  // Sortie : compte, matériel et dossiers à régler sont signalés à ceux qui les reprennent
  if (before.active && data.active === false) await departures.notifyDeparture(db, after, { user });
  // Nouveau poste ou nouveau service : leurs modèles d'objectifs s'appliquent (un objectif déjà présent est gardé)
  if (after.active && (after.position_id !== before.position_id || after.department !== before.department)) await kpi.applyForEmployee(db, id, { user });
  return { before, after };
}

module.exports = { employeeSchema, checkUser, guardUserLink, update, PAY_FIELDS, LEAVE_FIELDS };
