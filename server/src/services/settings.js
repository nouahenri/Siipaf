/** Réglages généraux (Paramètres › Général), avec repli sur la configuration du serveur. */
const { optionDaysDefault } = require('../config');

const FALLBACK = { option_days_default: optionDaysDefault };

async function getSettings(db) {
  const rows = await db('app_settings').select('key', 'value');
  const out = { ...FALLBACK };
  for (const r of rows) if (r.key in FALLBACK && r.value != null && r.value !== '') out[r.key] = Number(r.value);
  return out;
}

async function getSetting(db, key) {
  return (await getSettings(db))[key];
}

async function saveSettings(db, values) {
  await db.transaction(async trx => {
    for (const [key, value] of Object.entries(values)) {
      const row = { value: value == null ? null : String(value), updated_at: new Date() };
      if (await trx('app_settings').where({ key }).first()) await trx('app_settings').where({ key }).update(row);
      else await trx('app_settings').insert({ key, ...row });
    }
  });
  return getSettings(db);
}

module.exports = { getSettings, getSetting, saveSettings };
