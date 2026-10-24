/**
 * Lieux hors programmes (choix du client du 24/10) : siège social, bureaux annexes, dépôts, autres emplacements.
 * Liste réglée dans ERP › Administration générale › Lieux (droit lieux:write). Chaque pièce imputée (achat, dépense
 * du Parc, note de frais, demande interne, pointage, contrat, écriture) porte un programme (et un chantier) ou un
 * lieu ; sans l'un ni l'autre, le siège social. Règles dans lib/domain.js (PLACE_KINDS).
 */
const { HttpError } = require('../lib/http');
const { PLACE_KINDS } = require('../lib/domain');

const insertedId = r => (typeof r === 'object' ? r.id : r);
// Tables qui portent un lieu (reprises pour savoir si un lieu est utilisé)
const USED_IN = ['purchase_invoices', 'asset_costs', 'hr_attendances', 'hr_expenses', 'internal_requests', 'contracts', 'acc_lines', 'suppliers'];

const serialize = p => ({
  id: p.id, kind: p.kind, kind_label: p.kind === 'autre' && p.kind_other ? p.kind_other : PLACE_KINDS[p.kind], kind_other: p.kind_other || null,
  name: p.name, address: p.address || null, city_id: p.city_id || null, city_label: p.city_label || null,
  location_id: p.location_id || null, location_label: p.location_label || null, active: !!p.active, sort: p.sort,
});

async function list(db, { all = false } = {}) {
  // Ville et localité : listes de référence du dashboard (Paramètres › Villes, Localisations)
  const q = db('places as p').leftJoin('ref_items as c', 'c.id', 'p.city_id').leftJoin('ref_items as l', 'l.id', 'p.location_id')
    .orderBy([{ column: 'p.sort' }, { column: 'p.name' }]).select('p.*', 'c.label as city_label', 'l.label as location_label');
  if (!all) q.where('p.active', true);
  return (await q).map(serialize);
}

/** Villes et localités (non archivées) proposées dans le formulaire d'un lieu. */
async function geography(db) {
  const rows = await db('ref_items').whereIn('kind', ['ville', 'localisation']).where({ archived: false }).orderBy(['sort', 'label']).select('id', 'kind', 'label', 'parent_id');
  return { cities: rows.filter(r => r.kind === 'ville').map(({ id, label }) => ({ id, label })), locations: rows.filter(r => r.kind === 'localisation').map(({ id, label, parent_id }) => ({ id, label, city_id: parent_id })) };
}

/** Ville et localité choisies : ville de la liste, localité de cette ville. */
async function checkGeography(db, data, current) {
  const cityId = data.city_id !== undefined ? data.city_id : current?.city_id;
  const locationId = data.location_id !== undefined ? data.location_id : current?.location_id;
  if (cityId && !(await db('ref_items').where({ id: cityId, kind: 'ville' }).first('id'))) throw new HttpError(400, 'Ville inconnue (Paramètres du dashboard › Villes).');
  if (locationId) {
    const l = await db('ref_items').where({ id: locationId, kind: 'localisation' }).first('parent_id');
    if (!l) throw new HttpError(400, 'Localité inconnue (Paramètres du dashboard › Localisations).');
    if (!cityId || Number(l.parent_id) !== Number(cityId)) throw new HttpError(400, 'Cette localité n’appartient pas à la ville choisie.');
  }
}

/** Identifiant du siège social (créé par la migration ; recréé s'il a disparu). */
async function siegeId(db) {
  const s = await db('places').where({ kind: 'siege' }).orderBy('id').first('id');
  if (s) return s.id;
  const [r] = await db('places').insert({ kind: 'siege', name: 'Siège social', sort: 1 });
  return insertedId(r);
}

async function save(db, data, id = null) {
  if (data.kind === 'autre' && !data.kind_other && !(id && (await db('places').where({ id }).first())?.kind_other)) throw new HttpError(400, 'Type « Autre » : précisez son libellé.');
  const current = id ? await db('places').where({ id }).first() : null;
  if (id && !current) throw new HttpError(404, 'Lieu introuvable.');
  const kind = data.kind ?? current?.kind;
  // Un seul siège social, toujours actif : il reçoit ce qui n'est imputé nulle part
  if (kind === 'siege' && await db('places').where({ kind: 'siege' }).whereNot({ id: id || 0 }).first()) throw new HttpError(409, 'Le siège social existe déjà : choisissez un autre type.');
  if (current?.kind === 'siege' && data.kind && data.kind !== 'siege') throw new HttpError(409, 'Le siège social garde son type (il reçoit les pièces sans programme ni lieu).');
  if (current?.kind === 'siege' && data.active === false) throw new HttpError(409, 'Le siège social ne se désactive pas.');
  await checkGeography(db, data, current);
  const name = data.name ?? current?.name;
  // Doublon de nom, accents compris (lower() de SQLite ne connaît pas les lettres accentuées)
  const names = await db('places').whereNot({ id: id || 0 }).select('name');
  if (names.some(p => p.name.toLocaleLowerCase('fr') === String(name).toLocaleLowerCase('fr'))) throw new HttpError(409, 'Un lieu porte déjà ce nom.');
  const row = { ...data, kind_other: kind === 'autre' ? data.kind_other ?? current?.kind_other : null };
  if (id) {
    await db('places').where({ id }).update({ ...row, updated_at: new Date() });
    return id;
  }
  const max = await db('places').max({ m: 'sort' }).first();
  const [r] = await db('places').insert({ ...row, sort: Number(max?.m || 0) + 1 });
  return insertedId(r);
}

/** Un lieu déjà utilisé se désactive (il reste sur les pièces) ; seul un lieu jamais utilisé se supprime. */
async function remove(db, id) {
  const p = await db('places').where({ id }).first();
  if (!p) throw new HttpError(404, 'Lieu introuvable.');
  if (p.kind === 'siege') throw new HttpError(409, 'Le siège social ne se supprime pas.');
  for (const table of USED_IN) {
    if (await db(table).where({ place_id: id }).first()) throw new HttpError(409, 'Ce lieu est déjà utilisé sur des pièces : désactivez-le pour qu’il ne soit plus proposé.');
  }
  await db('places').where({ id }).del();
}

/**
 * Imputation d'une pièce : programme (et chantier) OU lieu. Le chantier fixe le programme ; sans rien, le siège.
 * Renvoie { project_id, worksite_id, place_id } ; refus si programme et lieu sont donnés ensemble.
 */
async function resolvePlace(db, { project_id = null, worksite_id = null, place_id = null } = {}) {
  if ((project_id || worksite_id) && place_id) throw new HttpError(400, 'Choisissez un programme (ou un chantier) ou un lieu, pas les deux.');
  if (project_id || worksite_id) {
    const site = await require('./chantiers').resolveSite(db, { project_id, worksite_id });
    if (!site.worksite_id && !(await db('projects').where({ id: site.project_id }).first('id'))) throw new HttpError(400, 'Programme introuvable.');
    return { ...site, place_id: null };
  }
  if (place_id) {
    if (!(await db('places').where({ id: place_id }).first('id'))) throw new HttpError(400, 'Lieu introuvable.');
    return { project_id: null, worksite_id: null, place_id };
  }
  return { project_id: null, worksite_id: null, place_id: await siegeId(db) };
}

const PLACE_KEYS = ['project_id', 'worksite_id', 'place_id'];
/**
 * Champs d'imputation à enregistrer : à la création (`current` absent) toujours (siège par défaut) ; à la
 * modification, seulement si l'un des trois champs est envoyé.
 */
async function placeFields(db, data, current = null) {
  if (current && !PLACE_KEYS.some(k => data[k] !== undefined)) return {};
  return resolvePlace(db, { project_id: data.project_id ?? null, worksite_id: data.worksite_id ?? null, place_id: data.place_id ?? null });
}

/** Choix « Programme / chantier ou lieu » des formulaires : programmes avec leurs chantiers non clos, lieux actifs. */
async function choices(db) {
  const [programmes, places] = await Promise.all([require('./chantiers').places(db), list(db)]);
  return { programmes, places, siege_id: await siegeId(db) };
}

module.exports = { PLACE_KINDS, PLACE_KEYS, list, geography, siegeId, save, remove, resolvePlace, placeFields, choices, serialize };
