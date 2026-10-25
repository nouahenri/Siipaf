/**
 * Paramètres des modules (lib/domain.js : MODULE_SETTINGS), enregistrés dans app_settings : ERP › module › Réglages.
 * Valeur enregistrée, sinon défaut (les règles en place avant le réglage).
 */
const { MODULE_SETTINGS } = require('../lib/domain');

const FIELDS = Object.assign({}, ...Object.values(MODULE_SETTINGS));

async function values(db, module) {
  const fields = MODULE_SETTINGS[module] || {};
  const rows = await db('app_settings').whereIn('key', Object.keys(fields)).select('key', 'value');
  const out = Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.default]));
  for (const r of rows) {
    const n = Number(r.value);
    if (r.value != null && r.value !== '' && Number.isFinite(n)) out[r.key] = Math.min(fields[r.key].max, Math.max(fields[r.key].min, n));
  }
  return out;
}

async function value(db, key) {
  const module = Object.keys(MODULE_SETTINGS).find(m => MODULE_SETTINGS[m][key]);
  if (!module) throw new Error(`Paramètre inconnu : ${key}`);
  return (await values(db, module))[key];
}

async function save(db, module, data) {
  const merged = { ...(await values(db, module)), ...data };
  if (module === 'administration' && merged.admin_alert_second_days >= merged.admin_alert_first_days) {
    throw Object.assign(new Error('Le second rappel doit venir après le premier (moins de jours avant l’échéance).'), { status: 400 });
  }
  await require('./settings').saveSettings(db, data);
  return values(db, module);
}

/** Paliers des rappels d'échéance des contrats et du parc : [premier, second] en jours avant. */
async function alertStages(db) {
  const v = await values(db, 'administration');
  return [v.admin_alert_first_days, v.admin_alert_second_days];
}
async function parcSoon(db) {
  const v = await values(db, 'administration');
  return { days: v.parc_soon_days, km: v.parc_soon_km, h: v.parc_soon_h };
}
/** Délai de traitement d'une réclamation selon sa priorité (heures). */
async function savHours(db) {
  const v = await values(db, 'sav');
  return { urgente: v.sav_hours_urgente, haute: v.sav_hours_haute, normale: v.sav_hours_normale, basse: v.sav_hours_basse };
}

module.exports = { FIELDS, values, value, save, alertStages, parcSoon, savHours };
