/**
 * ERP · Guide « Bien démarrer » (choix du client du 23/10) : l'ordre de mise en place (paramètres, postes, rôles,
 * comptes, fiches employés, responsables, salaires, droits particuliers), chaque étape cochée d'après la base.
 * Une étape qui ne se mesure pas (vérifier les rôles) se coche à la main ; la coche est gardée dans app_settings.
 */
const express = require('express');
const { z } = require('zod');
const { ah, parse, HttpError, json } = require('../../lib/http');
const { effectivePermissions, hasPermission } = require('../../services/permissions');

const MANUAL_KEY = 'onboarding_manual';
const n = async q => Number((await q.count({ n: '*' }).first()).n || 0);

module.exports = function onboardingRoutes(db) {
  const r = express.Router();
  const allowed = req => req.can('users:read') || req.can('rh:read');

  /** Comptes actifs (hors super administrateur) qui ont un droit donné. */
  async function holders(perm) {
    const users = await db('users').where({ active: true }).whereNot({ role: 'super_admin' }).select('id', 'name', 'role');
    const out = [];
    for (const u of users) if (hasPermission(await effectivePermissions(db, u), perm)) out.push(u.name);
    return out;
  }
  const manual = async () => json((await db('app_settings').where({ key: MANUAL_KEY }).first())?.value, {}) || {};

  r.get('/', ah(async (req, res) => {
    if (!allowed(req)) throw new HttpError(403, 'Droits insuffisants.');
    const year = new Date().getUTCFullYear();
    const m = await manual();
    const [holidays, positions, positionsWithRole, accounts, accountsWithout, employees, withManager, withoutSalary] = await Promise.all([
      n(db('hr_holidays').where('date', '>=', `${year}-01-01`).where('date', '<=', `${year}-12-31`)).catch(() => 0),
      n(db('hr_positions').where({ active: true })), n(db('hr_positions').where({ active: true }).whereNotNull('default_role')),
      n(db('users').where({ active: true }).whereNot({ role: 'super_admin' })),
      n(db('users as u').leftJoin('employees as e', 'e.user_id', 'u.id').where('u.active', true).whereNot('u.role', 'super_admin').whereNull('e.id')),
      n(db('employees').where({ active: true })), n(db('employees').where({ active: true }).whereNotNull('manager_id')),
      n(db('employees').where({ active: true }).where(w => w.whereNull('base_salary').orWhere('base_salary', 0))),
    ]);
    const special = {};
    for (const [perm, label] of [['demandes:dg', 'Direction générale (valider les achats)'], ['courrier:write', 'Secrétariat (enregistrer le courrier)'], ['parc:write', 'Services généraux (parc)'], ['docs:publish', 'Publication des documents internes'], ['demandes:handle', 'Traitement des demandes internes']]) {
      special[perm] = { label, holders: await holders(perm) };
    }
    const missing = Object.values(special).filter(s => !s.holders.length).map(s => s.label);
    const steps = [
      { key: 'parametres', title: 'Régler les paramètres de base', where: 'Dashboard › Paramètres › Général ; ERP › RH › Réglages',
        why: 'Durée des options, plafond d’achat validé par la DG, règles des congés, jours fériés de l’année : tout le reste s’appuie dessus.',
        done: holidays > 0, detail: holidays ? `${holidays} jour(s) férié(s) saisi(s) pour ${year}` : `Aucun jour férié saisi pour ${year}`, link: '/rh/reglages' },
      { key: 'postes', title: 'Créer la liste des postes', where: 'ERP › RH › Réglages › Postes',
        why: 'Chaque poste est rattaché à un service et peut proposer un rôle de compte : on le choisit ensuite dans une liste, sans le retaper.',
        done: positions > 0, detail: `${positions} poste(s), dont ${positionsWithRole} avec un rôle proposé`, link: '/rh/reglages' },
      { key: 'roles', title: 'Vérifier les rôles et leurs privilèges', where: 'Dashboard › Rôles et privilèges (et « Rôles et privilèges » de chaque module de l’ERP)', manual: true,
        why: 'Le rôle décide de ce qu’un compte peut voir et faire. Ajustez les rôles existants ou créez-en (ex. « Secrétaire ») avant de créer les comptes.',
        done: !!m.roles, detail: m.roles ? 'Vérifiés' : 'À vérifier puis cocher', link: null },
      { key: 'comptes', title: 'Créer les comptes utilisateurs', where: 'ERP › Comptes utilisateurs (même compte pour le dashboard et l’ERP)',
        why: 'Un compte par personne qui se connecte : e-mail, rôle, et « Créer la fiche » pour ouvrir sa fiche employé en même temps (poste dans la liste).',
        done: accounts > 0, detail: `${accounts} compte(s) actif(s) hors super administrateur`, link: '/comptes' },
      { key: 'fiches', title: 'Relier chaque compte à une fiche employé et la compléter', where: 'ERP › RH › Personnel (fiche) ; ERP › Comptes utilisateurs (relier)',
        why: 'La fiche porte le poste, le service, le contrat et le responsable direct ; sans fiche, la personne n’a pas de « Mon espace » (congés, frais, demandes, documents à lire).',
        done: accounts > 0 && accountsWithout === 0, detail: accountsWithout ? `${accountsWithout} compte(s) sans fiche employé` : `${employees} fiche(s) active(s), tous les comptes reliés`, link: '/rh/personnel' },
      { key: 'responsables', title: 'Renseigner les responsables directs', where: 'ERP › RH › Personnel › fiche › Modifier (ou « Changer de poste » › équipe)',
        why: 'Le responsable direct approuve les congés, les notes de frais et les demandes internes de son équipe ; un chef de service publie pour son service.',
        done: withManager > 0, detail: `${withManager} employé(s) sur ${employees} ont un responsable direct`, link: '/rh/personnel' },
      { key: 'salaires', title: 'Saisir les salaires', where: 'ERP › Comptabilité › Employés (droit paie)',
        why: 'Le salaire de base, les indemnités et le moyen de paiement servent à la paie ; ils ne sont visibles que des personnes autorisées.',
        done: employees > 0 && withoutSalary === 0, detail: withoutSalary ? `${withoutSalary} fiche(s) sans salaire de base` : 'Toutes les fiches ont un salaire', link: '/compta/employes' },
      { key: 'droits', title: 'Accorder les droits particuliers', where: 'Dashboard › Utilisateurs › compte › privilèges (ou rôle dédié)',
        why: 'Certains droits ne sont donnés à aucun rôle d’office : valider en direction générale, enregistrer le courrier, gérer le parc, publier les documents, traiter les demandes.',
        done: !missing.length, detail: missing.length ? `Personne pour : ${missing.join(' ; ')}` : 'Chaque droit a au moins un titulaire', special, link: null },
    ];
    res.json({ steps, done: steps.filter(s => s.done).length });
  }));

  /** Coche manuelle d'une étape non mesurable. */
  r.post('/:key', ah(async (req, res) => {
    if (!req.can('users:write')) throw new HttpError(403, 'Droits insuffisants.');
    const { done } = parse(z.object({ done: z.boolean() }), req.body);
    if (req.params.key !== 'roles') throw new HttpError(400, 'Cette étape se coche d’après la base.');
    const m = await manual();
    m[req.params.key] = done;
    const row = { value: JSON.stringify(m), updated_at: new Date() };
    if (await db('app_settings').where({ key: MANUAL_KEY }).first()) await db('app_settings').where({ key: MANUAL_KEY }).update(row);
    else await db('app_settings').insert({ key: MANUAL_KEY, ...row });
    res.json({ ok: true });
  }));

  return r;
};
