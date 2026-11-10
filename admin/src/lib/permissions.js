/**
 * Lignes d'une grille de privilèges : les actions détaillées d'un même privilège (même `parent`, ex. « Gérer ses
 * prospects » → créer, modifier, faire avancer…) sont précédées d'une ligne d'intitulé qui coche ou décoche le tout.
 */
/** Nom de rôle comparable : sans majuscules, accents, ponctuation ni espaces en trop (même règle que le serveur, services/roles.js). */
export const roleName = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Forme approchée : féminin et pluriel ramenés au masculin singulier, mots dans l'ordre alphabétique
// (« Assistantes commerciales » ≈ « Assistant commercial » ≈ « Commercial assistant »). Un nom simplement contenu dans un autre
// (« Assistant commercial » / « Commercial ») n'est pas signalé : c'est souvent un rôle différent.
const roleStem = s => roleName(s).split(' ').map(w => (w.length > 4 ? w.replace(/(es|s)$/, '').replace(/e$/, '') : w)).sort().join(' ');

/**
 * Doublons d'un nom de rôle en cours de saisie, parmi les rôles existants (sauf `exceptId`, le rôle modifié) :
 * `same` = rôle de même nom (le serveur le refuse), `close` = rôles au nom proche (au plus 3), à vérifier avant d'en créer un autre,
 * `matches` = autres rôles existants dont un mot commence par chaque mot saisi d'au moins 3 lettres (« juri » → « … / Juridique »),
 * proposés pendant la frappe (au plus 5, `more` = combien d'autres).
 */
export function roleDuplicates(label, roles, exceptId = null) {
  const name = roleName(label);
  const none = { same: null, close: [], matches: [], more: 0 };
  if (name.length < 2) return none;
  const others = (roles || []).filter(r => r.id !== exceptId);
  const same = others.find(r => roleName(r.label) === name) || null;
  const stem = roleStem(label);
  const close = same ? [] : others.filter(r => roleStem(r.label) === stem).slice(0, 3);
  const typed = name.split(' ').filter(w => w.length >= 3);
  const shown = new Set([same, ...close].filter(Boolean).map(r => r.id));
  const all = !typed.length ? [] : others.filter(r => {
    if (shown.has(r.id)) return false;
    const words = roleName(r.label).split(' ');
    return typed.every(t => words.some(w => w.startsWith(t)));
  });
  return { same, close, matches: all.slice(0, 5), more: Math.max(0, all.length - 5) };
}

// `all` : toutes les actions du groupe (grille filtrée par la recherche) — la ligne d'intitulé coche toujours le privilège entier.
export function permRows(items, all = items) {
  const rows = [];
  let last = null;
  for (const p of items) {
    if (p.parent && p.parent !== last) rows.push({ heading: p.parent, ids: all.filter(i => i.parent === p.parent).map(i => i.id) });
    last = p.parent || null;
    rows.push(p);
  }
  return rows;
}

/**
 * Recherche dans le catalogue des privilèges (grille « Rôles & privilèges », fiche d'un rôle) : chaque mot saisi doit se
 * retrouver au début d’un mot, sans tenir compte des accents ni des majuscules, dans le groupe, l'intitulé, le libellé, la précision ou le code.
 * Un groupe dont le nom suffit est gardé en entier ; sinon on ne garde que ses privilèges trouvés (`all` = le groupe complet).
 */
export function filterCatalog(catalog, q) {
  const words = roleName(q).split(' ').filter(Boolean);
  if (!words.length) return catalog;
  const hit = (...parts) => { const n = roleName(parts.filter(Boolean).join(' ')).split(' '); return words.every(w => n.some(x => x.startsWith(w))); };
  return catalog.map(g => {
    if (hit(g.group)) return g;
    const items = g.items.filter(p => hit(g.group, p.parent, p.label, p.hint, p.id));
    return items.length ? { ...g, items, all: g.items } : null;
  }).filter(Boolean);
}
