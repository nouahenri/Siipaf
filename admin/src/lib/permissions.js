/**
 * Lignes d'une grille de privilèges : les actions détaillées d'un même privilège (même `parent`, ex. « Gérer ses
 * prospects » → créer, modifier, faire avancer…) sont précédées d'une ligne d'intitulé qui coche ou décoche le tout.
 */
export function permRows(items) {
  const rows = [];
  let last = null;
  for (const p of items) {
    if (p.parent && p.parent !== last) rows.push({ heading: p.parent, ids: items.filter(i => i.parent === p.parent).map(i => i.id) });
    last = p.parent || null;
    rows.push(p);
  }
  return rows;
}
