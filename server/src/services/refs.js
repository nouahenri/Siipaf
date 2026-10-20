/**
 * Listes de référence (Paramètres) et leur lien avec les projets.
 * Les projets gardent aussi la ville, la localisation et les équipements en texte (colonnes
 * city, location, amenities) : c'est ce que lisent le site et les autres écrans. Ces textes sont
 * recalculés ici à chaque modification d'un projet ou d'une valeur de liste.
 */
const { REF_KINDS, FEATURE_KINDS, VIABILISATION_STATES } = require('../lib/domain');
const { HttpError, json } = require('../lib/http');

// Valeurs proposées au premier lancement (modifiables ensuite dans Paramètres)
const DEFAULT_REFS = {
  equipement: ['Piscine', 'Salle de sport', 'Parking', 'Ascenseur', 'Surveillance CCTV', 'Groupe électrogène', 'Réserve d’eau', 'Climatisation', 'Cuisine équipée', 'Domotique', 'Aires de jeux', 'Espaces verts'],
  commodite: ['École', 'Centre de santé', 'Marché', 'Centre commercial', 'Transport en commun', 'Lieu de culte', 'Banque', 'Pharmacie'],
  viabilisation: ['Voirie', 'Réseau d’eau potable', 'Réseau électrique', 'Éclairage public', 'Assainissement', 'Bornage des lots', 'Caniveaux / drainage'],
  type_bien: ['Terrain nu', 'Villa basse', 'Duplex', 'Appartement', 'Penthouse'],
};

const norm = s => String(s || '').trim().replace(/\s+/g, ' ');
const sameLabel = (a, b) => norm(a).toLocaleLowerCase('fr') === norm(b).toLocaleLowerCase('fr');

async function findOrCreate(knex, kind, label, parentId = null) {
  label = norm(label);
  if (!label) return null;
  const rows = await knex('ref_items').where({ kind }).where(q => (parentId ? q.where({ parent_id: parentId }) : q.whereNull('parent_id')));
  const hit = rows.find(r => sameLabel(r.label, label));
  if (hit) return hit.id;
  const [id] = await knex('ref_items').insert({ kind, label: label.slice(0, 120), parent_id: parentId, sort: rows.length });
  return id;
}

/** Remplit les listes par défaut et rattache les projets existants (ville, localisation, équipements en texte). */
async function backfill(knex) {
  for (const [kind, labels] of Object.entries(DEFAULT_REFS)) {
    if (await knex('ref_items').where({ kind }).first()) continue;
    await knex('ref_items').insert(labels.map((label, sort) => ({ kind, label, sort })));
  }
  const projects = await knex('projects').whereNull('city_id');
  for (const p of projects) {
    const cityId = p.city ? await findOrCreate(knex, 'ville', p.city) : null;
    // « Ahoutoué — Axe Abidjan–Alépé, 20 min… » : localisation + précision d'accès
    const [place, ...rest] = String(p.location || '').split(/\s+—\s+/);
    const locationId = cityId && norm(place) ? await findOrCreate(knex, 'localisation', place, cityId) : null;
    await knex('projects').where({ id: p.id }).update({
      city_id: cityId, location_id: locationId,
      location_detail: p.location_detail || (rest.length ? norm(rest.join(' — ')).slice(0, 255) : null),
    });
    for (const label of json(p.amenities, [])) {
      const refId = await findOrCreate(knex, 'equipement', label);
      if (refId && !(await knex('project_refs').where({ project_id: p.id, ref_id: refId }).first())) {
        await knex('project_refs').insert({ project_id: p.id, ref_id: refId });
      }
    }
  }
}

/** Recalcule les textes d'un projet (ville, localisation, équipements) à partir des listes. */
async function syncProjectText(trx, projectId) {
  const p = await trx('projects').where({ id: projectId }).first();
  if (!p) return;
  const ids = [p.city_id, p.location_id].filter(Boolean);
  const named = ids.length ? await trx('ref_items').whereIn('id', ids) : [];
  const label = id => named.find(r => r.id === id)?.label || null;
  const place = label(p.location_id);
  const location = [place, p.location_detail].filter(Boolean).join(' — ') || null;
  const equipements = await trx('project_refs as pr').join('ref_items as r', 'r.id', 'pr.ref_id')
    .where({ 'pr.project_id': projectId, 'r.kind': 'equipement' }).orderBy(['r.sort', 'r.label']).pluck('r.label');
  await trx('projects').where({ id: projectId }).update({
    city: p.city_id ? label(p.city_id) : p.city,
    location: p.city_id || p.location_id ? location : p.location,
    amenities: JSON.stringify(equipements),
  });
}

/**
 * Applique au projet la ville, la localisation et les cases cochées choisies dans l'admin.
 * Règles : la localisation appartient à la ville choisie ; une valeur archivée n'est acceptée
 * que si le projet l'avait déjà ; l'état d'avancement ne concerne que la viabilisation.
 */
async function applyProjectRefs(trx, projectId, { city_id, location_id, location_detail, refs }) {
  const current = await trx('projects').where({ id: projectId }).first();
  const currentRefs = await trx('project_refs').where({ project_id: projectId }).pluck('ref_id');
  const already = new Set([current.city_id, current.location_id, ...currentRefs].filter(Boolean));
  const check = async (id, kinds) => {
    const item = await trx('ref_items').where({ id }).first();
    if (!item || !kinds.includes(item.kind)) throw new HttpError(400, 'Valeur de liste inconnue.');
    if (item.archived && !already.has(id)) throw new HttpError(400, `« ${item.label} » est archivé : il n’est plus proposé.`);
    return item;
  };
  const update = {};
  if (city_id !== undefined) {
    if (city_id) await check(city_id, ['ville']);
    update.city_id = city_id || null;
  }
  const cityId = city_id !== undefined ? city_id : current.city_id;
  if (location_id !== undefined || city_id !== undefined) {
    const locId = location_id !== undefined ? location_id : current.location_id;
    if (locId) {
      const loc = await check(locId, ['localisation']);
      if (loc.parent_id !== cityId) {
        if (location_id !== undefined) throw new HttpError(400, `La localisation « ${loc.label} » n’appartient pas à la ville choisie.`);
        update.location_id = null; // ville changée : l'ancienne localisation ne vaut plus
      } else update.location_id = locId;
    } else update.location_id = null;
  }
  if (location_detail !== undefined) update.location_detail = location_detail || null;
  if (Object.keys(update).length) await trx('projects').where({ id: projectId }).update(update);

  if (refs !== undefined) {
    const seen = new Set();
    const rows = [];
    for (const r of refs) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const item = await check(r.id, FEATURE_KINDS);
      const states = REF_KINDS[item.kind].states;
      if (r.state && (!states || !VIABILISATION_STATES[r.state])) throw new HttpError(400, 'État d’avancement invalide.');
      rows.push({ project_id: projectId, ref_id: r.id, state: states ? r.state || 'prevu' : null });
    }
    await trx('project_refs').where({ project_id: projectId }).del();
    if (rows.length) await trx('project_refs').insert(rows);
  }
  await syncProjectText(trx, projectId);
}

/** Ville, localisation et cases cochées d'un projet, prêtes pour l'admin ou le site. */
async function projectRefs(db, projectId) {
  const rows = await db('project_refs as pr').join('ref_items as r', 'r.id', 'pr.ref_id')
    .where('pr.project_id', projectId).select('r.id', 'r.kind', 'r.label', 'r.archived', 'pr.state').orderBy(['r.sort', 'r.label']);
  const out = Object.fromEntries(FEATURE_KINDS.map(k => [k, []]));
  for (const r of rows) out[r.kind].push({ id: r.id, label: r.label, archived: !!r.archived, ...(r.kind === 'viabilisation' ? { state: r.state || 'prevu' } : {}) });
  return out;
}

/** Projets qui utilisent une valeur (pour refuser la suppression et recalculer après un renommage). */
async function projectsUsing(db, refId) {
  const direct = await db('projects').where({ city_id: refId }).orWhere({ location_id: refId }).pluck('id');
  const linked = await db('project_refs').where({ ref_id: refId }).pluck('project_id');
  return [...new Set([...direct, ...linked])];
}

module.exports = { DEFAULT_REFS, backfill, syncProjectText, applyProjectRefs, projectRefs, projectsUsing, norm, sameLabel };
