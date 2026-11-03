/**
 * Directions et services de l'entreprise (demande du client du 03/11) : tenus en base (table org_units, RH › Réglages et
 * Administration générale › Réglages) au lieu d'une liste codée en dur. Ce module garde en mémoire une copie à jour que tout
 * le serveur lit comme l'ancienne constante :
 *   DEPARTMENTS  { clé: libellé } de tous les services (un service archivé reste lisible, libellé suivi de « (archivé) ») ;
 *   DIRECTIONS   { clé: libellé } des directions ;
 *   departmentKey  schéma zod d'un service ACTIF (toute nouvelle saisie) ;
 *   moduleOf(clé)  module de l'ERP du service (« Demandes du service »), sinon null.
 * Les objets sont modifiés sur place (jamais remplacés) : `const { DEPARTMENTS } = require(...)` reste valable partout.
 * Rechargés au démarrage, après chaque modification et au plus tard toutes les 30 s (plusieurs processus en production).
 */
const { z } = require('./zod');

// Liste d'avant la table (base pas encore migrée, tests unitaires sans base)
const DEFAULT_SERVICES = {
  direction: 'Direction', commercial: 'Commercial', technique: 'Technique / bureau d’études', chantier: 'Chantier', administratif: 'Administratif',
  comptabilite: 'Comptabilité', juridique: 'Juridique', rh: 'Ressources humaines', sav: 'Client & SAV',
};
const DEFAULT_MODULES = { rh: 'rh', commercial: 'commercial', sav: 'sav', comptabilite: 'compta', juridique: 'juridique', administratif: 'administration' };

/** Modules de l'ERP auxquels un service peut être rattaché, et leur adresse. */
const ERP_MODULES = {
  commercial: 'Service commercial', sav: 'Client & SAV', compta: 'Comptabilité', rh: 'Ressources humaines', achats: 'Achats & stocks',
  juridique: 'Juridique', marketing: 'Marketing & Communication', qhse: 'QHSE', chantiers: 'Chantiers', administration: 'Administration générale',
};

const DEPARTMENTS = { ...DEFAULT_SERVICES };
const DIRECTIONS = {};
const state = { units: [], active: new Set(Object.keys(DEFAULT_SERVICES)), modules: { ...DEFAULT_MODULES }, loadedAt: 0, loading: null };

function fill(target, entries) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, Object.fromEntries(entries));
}

/** Relit la table ; sans table (base non migrée), garde la liste par défaut. */
async function load(db) {
  if (!(await db.schema.hasTable('org_units'))) { state.loadedAt = Date.now(); return state.units; }
  const units = (await db('org_units').orderBy([{ column: 'sort' }, { column: 'label' }])).map(u => ({ ...u, active: !!u.active }));
  const services = units.filter(u => u.kind === 'service');
  fill(DEPARTMENTS, services.map(s => [s.key, s.active ? s.label : `${s.label} (archivé)`]));
  fill(DIRECTIONS, units.filter(u => u.kind === 'direction').map(d => [d.key, d.active ? d.label : `${d.label} (archivée)`]));
  state.units = units;
  state.active = new Set(services.filter(s => s.active).map(s => s.key));
  state.modules = Object.fromEntries(services.filter(s => s.module).map(s => [s.key, s.module]));
  state.loadedAt = Date.now();
  return units;
}

/** Copie à jour (au plus 30 s) ; les appels simultanés attendent la même lecture. */
async function ensure(db, maxAge = 30000) {
  if (Date.now() - state.loadedAt < maxAge) return;
  state.loading ||= load(db).finally(() => { state.loading = null; });
  await state.loading;
}

const isActiveDepartment = key => state.active.has(key);
const departmentKey = z.string().trim().max(20).refine(isActiveDepartment, 'Service inconnu ou archivé.');
const moduleOf = key => state.modules[key] || null;
/** Services rattachés à chaque module : { module: [clés] } (services actifs). */
const moduleDepartments = () => {
  const out = {};
  for (const [key, module] of Object.entries(state.modules)) if (state.active.has(key)) (out[module] ||= []).push(key);
  return out;
};
/** Services d'une direction (clé de direction → clés de services). */
const servicesOf = directionKey => {
  const d = state.units.find(u => u.kind === 'direction' && u.key === directionKey);
  return d ? state.units.filter(u => u.kind === 'service' && u.parent_id === d.id).map(u => u.key) : [];
};
/** Direction d'un service (clé de la direction), sinon null. */
const directionOf = serviceKey => {
  const s = state.units.find(u => u.kind === 'service' && u.key === serviceKey);
  return (s && state.units.find(u => u.kind === 'direction' && u.id === s.parent_id)?.key) || null;
};
/** { clé du service: clé de sa direction } pour les services rattachés à une direction. */
const departmentDirections = () => Object.fromEntries(state.units.filter(u => u.kind === 'service').map(s => [s.key, directionOf(s.key)]).filter(([, d]) => d));
const units = () => state.units;

module.exports = { DEPARTMENTS, DIRECTIONS, ERP_MODULES, departmentKey, isActiveDepartment, moduleOf, moduleDepartments, servicesOf, directionOf, departmentDirections, units, load, ensure };
