/**
 * Rapports des tableaux de bord de l'ERP (demande du client du 03/11) : « Exporter » (classeur Excel) et « Imprimer » (page de
 * rapport, enregistrable en PDF) sur le tableau de bord de chaque module et sur la liste des chantiers. Choix du client :
 * indicateurs ET détail, période au choix (mois en cours par défaut).
 *
 * Contrat d'un rapport (un fichier par module dans ce dossier) :
 *   module.exports = {
 *     title: 'Service commercial',
 *     allowed: (viewer, db) => boolean | Promise<boolean>,   // mêmes droits que le tableau de bord du module
 *     build: async (db, period, viewer) => ({
 *       summary: [{ label, value, format }],                      // indicateurs de la période
 *       sections: [{ title, columns: [{ key, label, format }], rows: [{ … }] }],   // détail, une feuille Excel par section
 *     }),
 *   };
 * Formats : 'text' (défaut), 'fcfa', 'number', 'percent', 'date'. Montants en francs CFA entiers ; dates « AAAA-MM-JJ ».
 * `viewer` = { user, can } : chaque rapport applique la même portée que l'écran (ex. prospects du seul commercial).
 * Les dates sont comparées en JavaScript (inPeriod) : SQLite les range tantôt en texte, tantôt en millisecondes.
 */
const { HttpError, toDate, isoDay } = require('../../lib/http');

const MODULES = ['commercial', 'sav', 'compta', 'rh', 'achats', 'juridique', 'marketing', 'qhse', 'administration', 'chantiers'];
const DAY = 86400000;
const fr = d => d.split('-').reverse().join('/');

/** Période du rapport : `du` et `au` (AAAA-MM-JJ, inclus) ; par défaut le mois en cours ; au plus cinq ans. */
function period({ du, au } = {}, now = new Date()) {
  const ok = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
  const first = `${now.toISOString().slice(0, 7)}-01`;
  const fromDay = ok(du) ? du : first;
  const toDay = ok(au) ? au : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  if (toDay < fromDay) throw new HttpError(400, 'La fin de la période précède son début.');
  const from = new Date(`${fromDay}T00:00:00Z`), to = new Date(new Date(`${toDay}T00:00:00Z`).getTime() + DAY);
  if (to - from > 5 * 366 * DAY) throw new HttpError(400, 'Période de cinq ans au plus.');
  return { from, to, fromDay, toDay, label: `du ${fr(fromDay)} au ${fr(toDay)}` };
}

/** La date (texte, millisecondes ou Date) tombe-t-elle dans la période ? */
const inPeriod = (p, value) => { const d = toDate(value); return !!d && d >= p.from && d < p.to; };
const day = value => (value == null ? null : isoDay(value));
const sum = (rows, key) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);

/** Rapport d'un module pour la période, après contrôle des droits du tableau de bord. */
async function report(db, module, query, viewer) {
  if (!MODULES.includes(module)) throw new HttpError(404, 'Rapport inconnu.');
  const def = require(`./${module}`);
  if (!(await def.allowed(viewer, db))) throw new HttpError(403, 'Droits insuffisants pour ce rapport.');
  const p = period(query);
  const out = await def.build(db, p, viewer);
  return {
    module, title: def.title, period: { from: p.fromDay, to: p.toDay, label: p.label }, generated_at: new Date().toISOString(),
    generated_by: viewer.user.name, summary: out.summary || [], sections: (out.sections || []).filter(s => s && s.columns?.length),
  };
}

module.exports = { MODULES, period, inPeriod, day, sum, report };
