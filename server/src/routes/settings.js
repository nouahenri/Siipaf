/** Paramètres : listes de référence (menus déroulants des projets) et réglages généraux. */
const express = require('express');
const { z } = require('zod');
const { ah, parse, idParam, HttpError, json } = require('../lib/http');
const { requirePermission } = require('../auth');
const { REF_KINDS, FEATURE_KINDS, VIABILISATION_STATES, APP_SETTINGS, monthChoices } = require('../lib/domain');
const { syncProjectText, projectsUsing, norm, sameLabel, PROJECT_REF_COLUMNS } = require('../services/refs');
const { getSettings, saveSettings } = require('../services/settings');

module.exports = function settingsRoutes(db) {
  const r = express.Router();

  const duplicate = async (kind, label, parentId, exceptId) => {
    const rows = await db('ref_items').where({ kind }).where(q => (parentId ? q.where({ parent_id: parentId }) : q.whereNull('parent_id')));
    return rows.find(x => x.id !== exceptId && sameLabel(x.label, label));
  };

  // Lecture : toute personne qui voit les projets (les listes alimentent la fiche projet)
  r.get('/refs', requirePermission('projects:read'), ah(async (req, res) => {
    const [items, direct, linked] = await Promise.all([
      db('ref_items').orderBy(['kind', 'sort', 'label']),
      db('projects').select(PROJECT_REF_COLUMNS),
      db('project_refs').select('ref_id').count({ n: '*' }).groupBy('ref_id'),
    ]);
    const used = {};
    for (const p of direct) for (const c of PROJECT_REF_COLUMNS) if (p[c]) used[p[c]] = (used[p[c]] || 0) + 1;
    for (const l of linked) used[l.ref_id] = (used[l.ref_id] || 0) + Number(l.n);
    res.json({
      kinds: REF_KINDS, states: VIABILISATION_STATES,
      items: items.map(i => ({
        ...i, archived: !!i.archived, used: used[i.id] || 0, children: items.filter(c => c.parent_id === i.id).length,
        project_types: json(i.project_types, null), // type de biens : types de projet concernés (null ou [] = tous)
      })),
    });
  }));

  r.post('/refs', requirePermission('settings:write'), ah(async (req, res) => {
    const data = parse(z.object({
      kind: z.enum(Object.keys(REF_KINDS)),
      label: z.string().trim().min(1, 'Libellé requis').max(120),
      parent_id: z.number().int().positive().nullable().optional(),
    }), req.body);
    const label = norm(data.label);
    const parentKind = REF_KINDS[data.kind].parent;
    let parentId = null;
    if (parentKind) {
      const parent = data.parent_id && await db('ref_items').where({ id: data.parent_id, kind: parentKind }).first();
      if (!parent) throw new HttpError(400, `Choisissez la ${REF_KINDS[parentKind].one} de rattachement.`);
      parentId = parent.id;
    }
    if (await duplicate(data.kind, label, parentId)) throw new HttpError(409, `« ${label} » existe déjà.`);
    const sort = (await db('ref_items').where({ kind: data.kind }).max({ m: 'sort' }).first()).m;
    const [id] = await db('ref_items').insert({ kind: data.kind, label, parent_id: parentId, sort: (sort ?? -1) + 1 });
    res.status(201).json(await db('ref_items').where({ id }).first());
  }));

  r.patch('/refs/:id', requirePermission('settings:write'), ah(async (req, res) => {
    const id = idParam(req);
    const item = await db('ref_items').where({ id }).first();
    if (!item) throw new HttpError(404, 'Valeur introuvable.');
    const data = parse(z.object({
      label: z.string().trim().min(1).max(120).optional(),
      archived: z.boolean().optional(),
      parent_id: z.number().int().positive().optional(),
      // Une case à cocher peut changer de liste (ex. « École » : équipement → commodité)
      kind: z.enum(FEATURE_KINDS).optional(),
      // Type de biens : types de projet auxquels il s'applique
      project_types: z.array(z.number().int().positive()).max(50).optional(),
    }), req.body);
    const update = {};
    if (data.project_types) {
      const scopeKind = REF_KINDS[item.kind].scope;
      if (!scopeKind) throw new HttpError(400, 'Cette liste ne se rattache pas à des types de projet.');
      const ok = await db('ref_items').where({ kind: scopeKind }).whereIn('id', data.project_types).pluck('id');
      if (ok.length !== new Set(data.project_types).size) throw new HttpError(400, 'Type de projet inconnu.');
      update.project_types = JSON.stringify([...new Set(data.project_types)]);
    }
    if (data.kind && data.kind !== item.kind) {
      if (!FEATURE_KINDS.includes(item.kind)) throw new HttpError(400, 'Cette valeur ne peut pas changer de liste.');
      if (item.kind === 'viabilisation' || data.kind === 'viabilisation') {
        await db('project_refs').where({ ref_id: id }).update({ state: data.kind === 'viabilisation' ? 'prevu' : null });
      }
      update.kind = data.kind;
    }
    if (data.parent_id !== undefined) {
      if (!REF_KINDS[item.kind].parent) throw new HttpError(400, 'Cette valeur n’a pas de rattachement.');
      if (await db('projects').where({ location_id: id }).first()) throw new HttpError(409, 'Des projets utilisent cette localisation : elle ne peut pas changer de ville.');
      if (!(await db('ref_items').where({ id: data.parent_id, kind: REF_KINDS[item.kind].parent }).first())) throw new HttpError(400, 'Ville introuvable.');
      update.parent_id = data.parent_id;
    }
    if (data.label) {
      update.label = norm(data.label);
      if (await duplicate(update.kind || item.kind, update.label, update.parent_id ?? item.parent_id, id)) throw new HttpError(409, `« ${update.label} » existe déjà.`);
    }
    if (data.archived !== undefined) update.archived = data.archived;
    if (!Object.keys(update).length) return res.json(item);
    await db.transaction(async trx => {
      await trx('ref_items').where({ id }).update({ ...update, updated_at: new Date() });
      // Les textes des projets (ville, localisation, équipements) suivent le renommage
      if (update.label || update.kind) for (const pid of await projectsUsing(trx, id)) await syncProjectText(trx, pid);
    });
    res.json(await db('ref_items').where({ id }).first());
  }));

  // Ordre d'affichage d'une liste
  r.put('/refs/order', requirePermission('settings:write'), ah(async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.number().int().positive()).max(1000) }), req.body);
    await db.transaction(async trx => {
      for (const [sort, id] of ids.entries()) await trx('ref_items').where({ id }).update({ sort });
    });
    res.json({ ok: true });
  }));

  r.delete('/refs/:id', requirePermission('settings:write'), ah(async (req, res) => {
    const id = idParam(req);
    const item = await db('ref_items').where({ id }).first();
    if (!item) throw new HttpError(404, 'Valeur introuvable.');
    const used = (await projectsUsing(db, id)).length;
    if (used) throw new HttpError(409, `« ${item.label} » est utilisé par ${used} projet${used > 1 ? 's' : ''} : archivez-le plutôt.`);
    const children = await db('ref_items').where({ parent_id: id }).count({ n: '*' }).first();
    if (Number(children.n)) throw new HttpError(409, `Supprimez ou déplacez d’abord les ${children.n} localisation(s) de « ${item.label} ».`);
    await db('ref_items').where({ id }).del();
    res.json({ ok: true });
  }));

  // ─── Réglages généraux ───────────────────────────────────
  r.get('/settings', requirePermission('projects:read'), ah(async (req, res) => {
    res.json({ values: await getSettings(db), fields: APP_SETTINGS });
  }));

  r.put('/settings', requirePermission('settings:write'), ah(async (req, res) => {
    // Réglage en liste : « 6, 12, 24 » (au moins une durée valable) ; les autres sont des entiers bornés
    const listOf = (k, f) => z.string().max(200).refine(t => monthChoices(t).length > 0, `${f.label} : au moins une durée entre ${f.min} et ${f.max} mois.`)
      .transform(t => monthChoices(t).join(', '));
    const shape = Object.fromEntries(Object.entries(APP_SETTINGS).map(([k, f]) => [k, (f.list ? listOf(k, f) : z.number().int().min(f.min).max(f.max)).optional()]));
    const values = parse(z.object(shape), req.body);
    // Le délai par défaut fait partie des délais proposés
    const current = await getSettings(db);
    const months = values.balance_months_default ?? current.balance_months_default;
    const choices = monthChoices(values.balance_months_choices ?? current.balance_months_choices);
    if (!choices.includes(months)) values.balance_months_choices = [...choices, months].sort((a, b) => a - b).join(', ');
    res.json({ values: await saveSettings(db, values), fields: APP_SETTINGS });
  }));

  return r;
};
