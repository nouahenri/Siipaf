/**
 * Moyens de paiement (Paramètres › Général, champs pay_*) : le super administrateur propose, la direction générale
 * (droit « paiements:dg ») valide dans l'ERP › Vue Direction. Les clients gardent les moyens en vigueur jusqu'à la
 * validation. Une nouvelle proposition remplace celle qui attendait encore. Le validateur peut être l'auteur
 * (super administrateur qui est aussi DG : choix du client du 20/11).
 */
const { APP_SETTINGS, PAY_SETTING_KEYS } = require('../lib/domain');
const { HttpError } = require('../lib/http');
const { getSettings, saveSettings } = require('./settings');

const parseJson = text => { try { return JSON.parse(text) || {}; } catch { return {}; } };

/** Proposition présentée : champ par champ, valeur en vigueur et valeur proposée. */
async function serialize(db, row) {
  if (!row) return null;
  const previous = parseJson(row.previous);
  const proposed = parseJson(row.proposed);
  const users = await db('users').whereIn('id', [row.requested_by, row.decided_by].filter(Boolean)).select('id', 'name');
  const nameOf = id => users.find(u => u.id === id)?.name || null;
  return {
    id: row.id, status: row.status, reason: row.reason || null, created_at: row.created_at, decided_at: row.decided_at || null,
    requested_by: row.requested_by, requested_by_name: nameOf(row.requested_by), decided_by_name: nameOf(row.decided_by),
    changes: Object.keys(proposed).map(key => ({ key, label: APP_SETTINGS[key]?.label || key, before: previous[key] ?? '', after: proposed[key] ?? '' })),
  };
}

async function pending(db) {
  return serialize(db, await db('payment_setting_changes').where({ status: 'a_valider' }).orderBy('id', 'desc').first());
}

/** Champs pay_* réellement modifiés par rapport aux valeurs en vigueur (les autres sont ignorés). */
async function diff(db, values) {
  const current = await getSettings(db);
  const changed = {};
  for (const k of PAY_SETTING_KEYS) if (k in values && String(values[k] ?? '').trim() !== String(current[k] ?? '')) changed[k] = String(values[k] ?? '').trim();
  return { current, changed };
}

/** Proposition du super administrateur : enregistrée « à valider », la direction générale est prévenue. */
async function propose(db, user, values) {
  const { current, changed } = await diff(db, values);
  if (!Object.keys(changed).length) return null; // rien de changé : les autres réglages s'enregistrent normalement
  if (user.role !== 'super_admin') throw new HttpError(403, 'Seul le super administrateur peut modifier les moyens de paiement.');
  const previous = Object.fromEntries(Object.keys(changed).map(k => [k, current[k] ?? '']));
  const id = await db.transaction(async trx => {
    await trx('payment_setting_changes').where({ status: 'a_valider' }).update({ status: 'remplacee', updated_at: new Date() });
    const [inserted] = await trx('payment_setting_changes').insert({ previous: JSON.stringify(previous), proposed: JSON.stringify(changed), status: 'a_valider', requested_by: user.id });
    return typeof inserted === 'object' ? inserted.id : inserted;
  });
  const labels = Object.keys(changed).map(k => APP_SETTINGS[k].label.split(' :')[0]);
  await require('./notifications').inform(db, 'moyens_paiement.a_valider', {
    key: `moyens_paiement:${id}`, title: 'Moyens de paiement à valider',
    body: `${user.name} propose de modifier : ${[...new Set(labels)].join(', ')}. Les clients gardent les moyens actuels jusqu’à votre validation.`,
    link: '/administration',
  }).catch(() => {});
  return pending(db);
}

async function decide(db, id, user, { approve, reason }) {
  const row = await db('payment_setting_changes').where({ id }).first();
  if (!row) throw new HttpError(404, 'Proposition introuvable.');
  if (row.status !== 'a_valider') throw new HttpError(409, 'Cette proposition a déjà été traitée.');
  if (!approve && !String(reason || '').trim()) throw new HttpError(400, 'Indiquez le motif du refus.');
  await db.transaction(async trx => {
    if (approve) await saveSettings(trx, parseJson(row.proposed));
    await trx('payment_setting_changes').where({ id }).update({ status: approve ? 'validee' : 'refusee', decided_by: user.id, decided_at: new Date(), reason: approve ? null : String(reason).trim().slice(0, 500), updated_at: new Date() });
  });
  if (row.requested_by && row.requested_by !== user.id) {
    await require('./notifications').inform(db, 'moyens_paiement.decision', {
      direct: [row.requested_by], key: `moyens_paiement:decision:${id}`,
      title: approve ? 'Moyens de paiement validés' : 'Moyens de paiement refusés',
      body: approve ? `${user.name} a validé votre modification : elle s’applique maintenant dans l’application et l’espace client.` : `${user.name} a refusé votre modification : ${String(reason).trim()}`,
      link: '/parametres?section=general',
    }).catch(() => {});
  }
  return serialize(db, await db('payment_setting_changes').where({ id }).first());
}

async function cancel(db, id, user) {
  const row = await db('payment_setting_changes').where({ id }).first();
  if (!row || row.status !== 'a_valider') throw new HttpError(409, 'Aucune proposition en attente à annuler.');
  if (user.role !== 'super_admin') throw new HttpError(403, 'Seul le super administrateur peut annuler cette proposition.');
  await db('payment_setting_changes').where({ id }).update({ status: 'annulee', decided_by: user.id, decided_at: new Date(), updated_at: new Date() });
}

module.exports = { pending, propose, decide, cancel };
