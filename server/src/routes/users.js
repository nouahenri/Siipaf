const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError } = require('../lib/http');
const { hashPassword, requirePermission, publicUser } = require('../auth');
const { listRoles, requireRole } = require('../services/roles');

const insertedId = r => (typeof r === 'object' ? r.id : r);
// Mot de passe provisoire lisible (sans 0/O, 1/l/I), montré une seule fois à la personne qui crée le compte
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const temporaryPassword = () => Array.from(crypto.randomBytes(12), b => ALPHABET[b % ALPHABET.length]).join('');

module.exports = function userRoutes(db) {
  const r = express.Router();

  // Rôles proposés dans les sélecteurs : ceux d'origine et ceux créés dans « Rôles & privilèges »
  r.get('/roles', ah(async (req, res) => {
    res.json((await listRoles(db)).map(role => ({ id: role.id, label: role.label, system: !!role.system })));
  }));

  r.get('/', requirePermission('users:read'), ah(async (req, res) => {
    const users = await db('users').orderBy('name');
    // Fiche employé reliée (ERP), quand la table existe
    const employees = await db.schema.hasTable('employees').then(has => (has ? db('employees').whereNotNull('user_id').select('id', 'user_id', 'matricule', 'job_title') : []));
    res.json(users.map(u => ({ ...publicUser(u), employee: employees.find(e => e.user_id === u.id) || null })));
  }));

  // Fiches employés sans compte, que l'on peut relier à un compte (ERP › Comptes utilisateurs)
  r.get('/unlinked-employees', requirePermission('users:write'), ah(async (req, res) => {
    if (!(await db.schema.hasTable('employees'))) return res.json([]);
    res.json(await db('employees').whereNull('user_id').where({ active: true }).orderBy(['last_name', 'first_name']).select('id', 'matricule', 'last_name', 'first_name', 'job_title', 'email'));
  }));

  // Liste courte pour les sélecteurs (assigner un prospect à un commercial…)
  // (plus les rôles créés dans le dashboard qui ont le droit « Gérer les prospects »)
  r.get('/commerciaux', ah(async (req, res) => {
    const sellers = db('role_permissions').where({ permission: 'leads:write' }).select('role');
    const users = await db('users').where({ active: true })
      .where(q => q.whereIn('role', ['commercial', 'resp_exploitation', 'super_admin']).orWhereIn('role', sellers))
      .orderBy('name');
    res.json(users.map(u => ({ id: u.id, name: u.name, role: u.role })));
  }));

  const base = {
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().max(40).optional().nullable(),
    role: z.string().trim().min(1).max(40), // existence vérifiée dans la table roles
    active: z.boolean().optional(),
  };

  /**
   * Nouveau compte (dashboard et ERP). Sans mot de passe saisi, un mot de passe provisoire est généré et renvoyé
   * une seule fois ; la personne devra en choisir un à sa première connexion. Le compte peut être relié à une fiche
   * employé existante (employee_id) ou en créer une (employee), ce qui demande un droit sur les fiches du personnel.
   */
  r.post('/', requirePermission('users:write'), ah(async (req, res) => {
    const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
    const data = parse(z.object({
      ...base, password: z.string().min(10, 'Mot de passe : 10 caractères minimum.').optional(),
      employee_id: z.number().int().positive().optional().nullable(),
      employee: z.object({
        job_title: z.string().trim().min(2).max(120), position_id: z.number().int().positive().optional().nullable(),
        department: z.string().trim().min(2).max(20), hire_date: day, contract_type: z.string().trim().max(12).optional(),
      }).optional().nullable(),
    }), req.body);
    await requireRole(db, data.role);
    if (await db('users').where({ email: data.email }).first()) throw new HttpError(409, 'Un compte existe déjà avec cet e-mail.');
    if (data.role === 'super_admin' && req.user.role !== 'super_admin') throw new HttpError(403, 'Seul un super administrateur peut créer un super administrateur.');
    if ((data.employee_id || data.employee) && !(req.can('rh:files') || req.can('paie:employees'))) throw new HttpError(403, 'Relier ou créer une fiche employé demande un droit sur les fiches du personnel.');
    const { password, employee_id, employee, ...rest } = data;
    const temporary = password ? null : temporaryPassword();
    const id = await db.transaction(async trx => {
      const userId = insertedId((await trx('users').insert({ ...rest, password_hash: await hashPassword(password || temporary), must_change_password: true }))[0]);
      if (employee_id) {
        const e = await trx('employees').where({ id: employee_id }).first();
        if (!e) throw new HttpError(404, 'Fiche employé introuvable.');
        if (e.user_id) throw new HttpError(409, 'Cette fiche est déjà reliée à un compte.');
        await trx('employees').where({ id: e.id }).update({ user_id: userId, updated_at: new Date() });
      } else if (employee) {
        const { DEPARTMENTS, CONTRACT_TYPES } = require('../lib/paie');
        if (!DEPARTMENTS[employee.department]) throw new HttpError(400, 'Service inconnu.');
        const contract = CONTRACT_TYPES[employee.contract_type] ? employee.contract_type : 'cdi';
        const [first, ...others] = rest.name.trim().split(/\s+/);
        // Poste de la liste (RH › Réglages), ou ajouté à la liste s'il n'y figure pas
        const post = await require('../services/positions').resolve(trx, employee);
        const eid = insertedId((await trx('employees').insert({
          matricule: await require('../services/paie').nextMatricule(trx), user_id: userId, first_name: first, last_name: others.join(' ') || first,
          email: rest.email, phone: rest.phone || null, job_title: post.job_title, position_id: post.position_id, department: employee.department, contract_type: contract,
          hire_date: employee.hire_date, base_salary: 0,
        }))[0]);
        await trx('hr_career_events').insert({ employee_id: eid, date: employee.hire_date, kind: 'embauche', label: `Embauche : ${post.job_title}`, details: JSON.stringify({ contract_type: contract }), created_by: req.user.id }).catch(() => {});
      }
      return userId;
    });
    res.status(201).json({ ...publicUser(await db('users').where({ id }).first()), temporary_password: temporary });
  }));

  // Nouveau mot de passe provisoire (oubli) : renvoyé une seule fois, à changer à la connexion suivante
  r.post('/:id/reset-password', requirePermission('users:write'), ah(async (req, res) => {
    const target = await db('users').where({ id: idParam(req) }).first();
    if (!target) throw new HttpError(404, 'Utilisateur introuvable.');
    if (target.id === req.user.id) throw new HttpError(400, 'Changez votre propre mot de passe depuis votre compte.');
    if (target.role === 'super_admin' && req.user.role !== 'super_admin') throw new HttpError(403, 'Seul un super administrateur peut modifier un super administrateur.');
    const temporary = temporaryPassword();
    await db('users').where({ id: target.id }).update({ password_hash: await hashPassword(temporary), must_change_password: true, updated_at: new Date() });
    res.json({ temporary_password: temporary });
  }));

  // Relier un compte à une fiche employé (ou le détacher)
  r.put('/:id/employee', requirePermission('users:write'), ah(async (req, res) => {
    if (!(req.can('rh:files') || req.can('paie:employees'))) throw new HttpError(403, 'Relier une fiche employé demande un droit sur les fiches du personnel.');
    const userId = idParam(req);
    const { employee_id } = parse(z.object({ employee_id: z.number().int().positive().nullable() }), req.body);
    if (!(await db('users').where({ id: userId }).first())) throw new HttpError(404, 'Utilisateur introuvable.');
    await db.transaction(async trx => {
      if (employee_id) {
        const e = await trx('employees').where({ id: employee_id }).first();
        if (!e) throw new HttpError(404, 'Fiche employé introuvable.');
        if (e.user_id && e.user_id !== userId) throw new HttpError(409, 'Cette fiche est déjà reliée à un autre compte.');
      }
      await trx('employees').where({ user_id: userId }).update({ user_id: null, updated_at: new Date() });
      if (employee_id) await trx('employees').where({ id: employee_id }).update({ user_id: userId, updated_at: new Date() });
    });
    res.json({ ok: true });
  }));

  r.patch('/:id', requirePermission('users:write'), ah(async (req, res) => {
    const id = idParam(req);
    const data = parse(z.object({ ...base, password: z.string().min(10).optional() }).partial(), req.body);
    if (data.role) await requireRole(db, data.role);
    if (id === req.user.id && (data.active === false || (data.role && data.role !== req.user.role))) {
      throw new HttpError(400, 'Vous ne pouvez pas désactiver votre propre compte ni changer votre rôle.');
    }
    const target = await db('users').where({ id }).first();
    if (target && req.user.role !== 'super_admin' && (target.role === 'super_admin' || data.role === 'super_admin')) {
      throw new HttpError(403, 'Seul un super administrateur peut modifier un super administrateur.');
    }
    const { password, ...rest } = data;
    const patch = { ...rest, updated_at: new Date() };
    if (password) {
      patch.password_hash = await hashPassword(password);
      // Mot de passe fixé par quelqu'un d'autre : provisoire
      if (id !== req.user.id) patch.must_change_password = true;
    }
    const n = await db('users').where({ id }).update(patch);
    if (!n) throw new HttpError(404, 'Utilisateur introuvable.');
    res.json(publicUser(await db('users').where({ id }).first()));
  }));

  return r;
};
