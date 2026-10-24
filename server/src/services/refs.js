/**
 * Listes de référence (Paramètres) et leur lien avec les projets.
 * Les projets gardent aussi la ville, la localisation et les équipements en texte (colonnes
 * city, location, amenities) : c'est ce que lisent le site et les autres écrans. Ces textes sont
 * recalculés ici à chaque modification d'un projet ou d'une valeur de liste.
 */
const { REF_KINDS, FEATURE_KINDS, VIABILISATION_STATES, categoryForProjectType } = require('../lib/domain');
const { HttpError, json } = require('../lib/http');

// Valeurs proposées au premier lancement (modifiables ensuite dans Paramètres)
const DEFAULT_REFS = {
  equipement: ['Piscine', 'Salle de sport', 'Parking', 'Ascenseur', 'Surveillance CCTV', 'Groupe électrogène', 'Réserve d’eau', 'Climatisation', 'Cuisine équipée', 'Domotique', 'Aires de jeux', 'Espaces verts'],
  commodite: ['École', 'Centre de santé', 'Marché', 'Centre commercial', 'Transport en commun', 'Lieu de culte', 'Banque', 'Pharmacie'],
  viabilisation: ['Voirie', 'Réseau d’eau potable', 'Réseau électrique', 'Éclairage public', 'Assainissement', 'Bornage des lots', 'Caniveaux / drainage'],
  document: ['Titre foncier', 'ACD (Arrêté de Concession Définitive)', 'Attestation villageoise', 'Lettre d’attribution', 'Certificat de propriété coutumière', 'Permis de construire'],
  type_projet: ['Logement social & haut standing', 'Logement social', 'Haut standing', 'Lotissement'],
  type_bien: ['Terrain nu', 'Villa basse', 'Duplex', 'Appartement', 'Penthouse'],
};
// Colonnes de « projects » qui pointent vers une valeur de liste (menus déroulants de la fiche projet)
const PROJECT_REF_COLUMNS = ['city_id', 'location_id', ...Object.values(REF_KINDS).map(k => k.project).filter(Boolean)];

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

/** Listes encore vides : valeurs par défaut. */
async function seedDefaultLists(knex) {
  for (const [kind, labels] of Object.entries(DEFAULT_REFS)) {
    if (await knex('ref_items').where({ kind }).first()) continue;
    await knex('ref_items').insert(labels.map((label, sort) => ({ kind, label, sort })));
  }
}

/** Remplit les listes par défaut et rattache les projets existants (ville, localisation, équipements en texte). */
async function backfill(knex) {
  await seedDefaultLists(knex);
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
  if (await knex.schema.hasColumn('projects', 'project_type_id')) await linkProjectTypes(knex);
  if (await knex.schema.hasColumn('ref_items', 'project_types')) await scopePropertyTypes(knex);
}

/**
 * Types de projet auxquels s'applique un type de biens, d'après son libellé (réglable ensuite dans Paramètres) :
 * terrain → lotissement ; « social » → logement social ; penthouse, duplex, « standing » → haut standing ;
 * les autres (appartement, villa, maison…) → tous les projets de logement.
 */
function defaultScope(label, projectTypes) {
  const t = norm(label).toLocaleLowerCase('fr');
  const cats = /terrain|parcelle|\blot\b/.test(t) ? ['lotissement']
    : /social/.test(t) ? ['social', 'social_haut_standing']
    : /penthouse|duplex|standing/.test(t) ? ['haut_standing', 'social_haut_standing']
    : ['social', 'social_haut_standing', 'haut_standing'];
  return projectTypes.filter(p => cats.includes(categoryForProjectType(p.label))).map(p => p.id);
}

/** Types de biens sans réglage : types de projet par défaut (voir defaultScope). */
async function scopePropertyTypes(knex) {
  const projectTypes = await knex('ref_items').where({ kind: 'type_projet' });
  for (const item of await knex('ref_items').where({ kind: 'type_bien' }).whereNull('project_types')) {
    await knex('ref_items').where({ id: item.id }).update({ project_types: JSON.stringify(defaultScope(item.label, projectTypes)) });
  }
}

// Catégorie technique d'avant la liste « Types de projet » → libellé de la liste
const CATEGORY_TYPE_LABELS = {
  social_haut_standing: 'Logement social & haut standing', social: 'Logement social', haut_standing: 'Haut standing', lotissement: 'Lotissement',
};

/**
 * Projets sans type : type de projet d'après la catégorie ; type de biens d'après la 1re ligne de la
 * grille de prix qui cite un type connu (« Villa basse F4 » → Villa basse), ou « Terrain nu » pour un lotissement.
 */
async function linkProjectTypes(knex) {
  const projectTypes = await knex('ref_items').where({ kind: 'type_projet' });
  const propertyTypes = await knex('ref_items').where({ kind: 'type_bien' }).orderBy('sort');
  const lower = s => norm(s).toLocaleLowerCase('fr');
  for (const p of await knex('projects').where(q => q.whereNull('project_type_id').orWhereNull('property_type_id'))) {
    const update = {};
    if (!p.project_type_id && CATEGORY_TYPE_LABELS[p.category]) {
      const type = projectTypes.find(r => sameLabel(r.label, CATEGORY_TYPE_LABELS[p.category]));
      if (type) update.project_type_id = type.id;
    }
    if (!p.property_type_id) {
      const offers = await knex('project_offers').where({ project_id: p.id }).orderBy('sort').pluck('label');
      const fromOffers = offers.map(o => propertyTypes.find(r => lower(o).includes(lower(r.label)))).find(Boolean);
      const land = p.category === 'lotissement' && propertyTypes.find(r => sameLabel(r.label, 'Terrain nu'));
      if (fromOffers || land) update.property_type_id = (fromOffers || land).id;
    }
    if (Object.keys(update).length) await knex('projects').where({ id: p.id }).update(update);
  }
}

/** Recalcule les textes d'un projet (ville, localisation, équipements) à partir des listes. */
async function syncProjectText(trx, projectId) {
  const p = await trx('projects').where({ id: projectId }).first();
  if (!p) return;
  const ids = [p.city_id, p.location_id, p.project_type_id].filter(Boolean);
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
    // Type de projet renommé : la catégorie technique suit (ex. « Lotissement » → lotissement)
    ...(p.project_type_id ? { category: categoryForProjectType(label(p.project_type_id)) } : {}),
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
  // Listes à états (viabilisation, documents du bien) : l'état de chaque case cochée
  for (const r of rows) out[r.kind].push({ id: r.id, label: r.label, archived: !!r.archived, ...(REF_KINDS[r.kind].states ? { state: r.state || 'prevu' } : {}) });
  return out;
}

/**
 * Libellés des états de chaque liste à états (Paramètres › la liste) : valeurs du code, remplacées par celles
 * réglées par l'utilisateur (app_settings « state_labels:<liste> »). Les clés ne changent jamais.
 */
const STATE_KEYS = Object.keys(VIABILISATION_STATES);
const defaultStateLabels = kind => REF_KINDS[kind].state_labels || VIABILISATION_STATES;
async function stateLabels(db) {
  const kinds = FEATURE_KINDS.filter(k => REF_KINDS[k].states);
  const rows = await db('app_settings').whereIn('key', kinds.map(k => `state_labels:${k}`)).select('key', 'value');
  const out = {};
  for (const k of kinds) {
    const saved = json(rows.find(r => r.key === `state_labels:${k}`)?.value, {});
    out[k] = Object.fromEntries(STATE_KEYS.map(s => [s, String(saved?.[s] || '').trim() || defaultStateLabels(k)[s]]));
  }
  return out;
}

/** Projets qui utilisent une valeur (pour refuser la suppression et recalculer après un renommage). */
async function projectsUsing(db, refId) {
  const direct = await db('projects').where(q => { for (const c of PROJECT_REF_COLUMNS) q.orWhere(c, refId); }).pluck('id');
  const linked = await db('project_refs').where({ ref_id: refId }).pluck('project_id');
  const types = await db('project_property_types').where({ item_id: refId }).pluck('project_id');
  return [...new Set([...direct, ...linked, ...types])];
}

/**
 * Type de projet et type de biens choisis dans la fiche projet (listes de Paramètres).
 * Le type de projet fixe aussi la catégorie technique (lotissement ou logement).
 */
async function applyProjectTypes(trx, projectId, { project_type_id, property_type_id, property_type_ids }) {
  const current = await trx('projects').where({ id: projectId }).first();
  const update = {};
  // Plusieurs types de biens cochés (demande du client du 24/10) ; le premier reste dans property_type_id
  if (property_type_ids !== undefined) {
    const ids = [...new Set(property_type_ids)];
    const checked = await trx('project_property_types').where({ project_id: projectId }).pluck('item_id');
    for (const id of ids) {
      const item = await trx('ref_items').where({ id }).first();
      if (!item || item.kind !== 'type_bien') throw new HttpError(400, 'Type de biens inconnu.');
      if (item.archived && !checked.includes(id)) throw new HttpError(400, `« ${item.label} » est archivé : il n’est plus proposé.`);
    }
    // Un type porté par des biens du projet ne se décoche pas
    const removed = checked.filter(id => !ids.includes(id));
    if (removed.length) {
      const used = await trx('lots as l').join('ref_items as r', 'r.id', 'l.property_type_id').where('l.project_id', projectId).whereIn('l.property_type_id', removed).distinct('r.label').pluck('r.label');
      if (used.length) throw new HttpError(409, `Des biens du projet sont du type « ${used.join(' », « ')} » : changez d’abord leur type dans Biens & disponibilités.`);
    }
    await trx('project_property_types').where({ project_id: projectId }).del();
    if (ids.length) await trx('project_property_types').insert(ids.map((item_id, sort) => ({ project_id: projectId, item_id, sort })));
    property_type_id = ids[0] || null;
  } else if (property_type_id !== undefined) {
    // Ancien formulaire (un seul type) : la liste cochée suit
    await trx('project_property_types').where({ project_id: projectId }).del();
    if (property_type_id) await trx('project_property_types').insert({ project_id: projectId, item_id: property_type_id, sort: 0 });
  }
  for (const [column, kind, value] of [['project_type_id', 'type_projet', project_type_id], ['property_type_id', 'type_bien', property_type_id]]) {
    if (value === undefined) continue;
    if (value) {
      const item = await trx('ref_items').where({ id: value }).first();
      if (!item || item.kind !== kind) throw new HttpError(400, 'Valeur de liste inconnue.');
      if (item.archived && current[column] !== value) throw new HttpError(400, `« ${item.label} » est archivé : il n’est plus proposé.`);
      if (column === 'project_type_id') update.category = categoryForProjectType(item.label);
    }
    update[column] = value || null;
  }
  if (Object.keys(update).length) await trx('projects').where({ id: projectId }).update(update);
}

/** Libellés du type de projet et des types de biens cochés, ajoutés aux projets renvoyés à l'admin. */
async function withTypeLabels(db, projects) {
  const ids = [...new Set(projects.flatMap(p => [p.project_type_id, p.property_type_id]).filter(Boolean))];
  const labels = ids.length ? Object.fromEntries((await db('ref_items').whereIn('id', ids).select('id', 'label')).map(r => [r.id, r.label])) : {};
  const links = projects.length ? await db('project_property_types as t').join('ref_items as r', 'r.id', 't.item_id')
    .whereIn('t.project_id', projects.map(p => p.id)).orderBy(['t.project_id', 't.sort']).select('t.project_id', 'r.id', 'r.label') : [];
  return projects.map(p => {
    const types = links.filter(l => l.project_id === p.id).map(l => ({ id: l.id, label: l.label }));
    return { ...p, project_type: labels[p.project_type_id] || null, property_type: labels[p.property_type_id] || null, property_types: types, property_type_ids: types.map(t => t.id) };
  });
}

module.exports = {
  DEFAULT_REFS, PROJECT_REF_COLUMNS, backfill, seedDefaultLists, linkProjectTypes, scopePropertyTypes, defaultScope, syncProjectText, applyProjectRefs, applyProjectTypes, withTypeLabels,
  projectRefs, projectsUsing, norm, sameLabel, stateLabels, defaultStateLabels, STATE_KEYS,
};
