/**
 * Conversion d'un plan de masse AutoCAD (DWG ou DXF) en carte interactive.
 *
 * 1. Lecture du fichier dans le navigateur (LibreDWG en WebAssembly, chargé à la demande).
 * 2. Les parcelles sont reconstituées à partir du réseau de traits : découpage aux croisements,
 *    graphe planaire, cellules fermées (« faces »).
 * 3. Chaque cellule reçoit le numéro de lot écrit à l'intérieur et, s'il existe, la surface écrite
 *    (« 400 m² ») ; une cellule sans surface écrite mais avec un numéro est écartée quand le plan
 *    porte des surfaces (c'est alors un numéro d'îlot ou un repère).
 * 4. Le dessin est rendu en image (fond de la carte) et les parcelles en coordonnées relatives 0–1.
 */

import { api } from './api';

const TOL = 0.05; // tolérance de raccord des traits (unités du dessin, en général le mètre)

/** Nettoie un texte AutoCAD (codes de mise en forme MTEXT). */
export const cleanText = t => String(t ?? '')
  .replace(/\{\\[^;]*;/g, '').replace(/\\[A-Za-z][^;]*;/g, '').replace(/\\P/gi, ' ')
  .replace(/[{}]/g, '').replace(/\\~/g, ' ').replace(/\s+/g, ' ').trim();

const LOT_NUMBER = /^[A-Za-z]{0,3}[-\s]?\d{1,5}[A-Za-z]?$/;
const AREA = /^(\d+(?:[.,]\d+)?)\s*m(²|2)?$/i;

/** Envoie le fichier au serveur (lecture LibreDWG) ; renvoie les entités et un résumé par calque. */
export async function readDrawing(file) {
  if (!/\.(dwg|dxf)$/i.test(file.name)) throw new Error('Choisissez un fichier .dwg ou .dxf.');
  const form = new FormData();
  form.append('file', file);
  const { entities } = await api.post('/admin/cad/parse', form);
  const layers = {};
  for (const e of entities) {
    const l = (layers[e.layer] ||= { name: e.layer, lines: 0, texts: 0, numbers: 0, areas: 0 });
    if (['LINE', 'LWPOLYLINE', 'POLYLINE2D', 'ARC', 'CIRCLE'].includes(e.type)) l.lines++;
    if (e.type === 'TEXT' || e.type === 'MTEXT') {
      l.texts++;
      const t = cleanText(e.text);
      if (LOT_NUMBER.test(t)) l.numbers++;
      if (AREA.test(t)) l.areas++;
    }
  }
  return { entities, layers: Object.values(layers).sort((a, b) => b.lines + b.texts - (a.lines + a.texts)) };
}

const arcPoints = (c, r, a0, a1) => {
  if (a1 < a0) a1 += Math.PI * 2;
  const n = Math.max(4, Math.ceil((a1 - a0) / (Math.PI / 18)));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: c.x + r * Math.cos(a0 + ((a1 - a0) * i) / n), y: c.y + r * Math.sin(a0 + ((a1 - a0) * i) / n) }));
};

/** Segments [a, b] de toutes les entités linéaires des calques choisis. */
export function segmentsOf(entities, layerSet) {
  const segs = [];
  const chain = pts => { for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]); };
  for (const e of entities) {
    if (layerSet && !layerSet.has(e.layer)) continue;
    if (e.type === 'LINE') segs.push([e.startPoint, e.endPoint]);
    else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE2D') {
      const v = e.vertices || [];
      chain(v);
      if ((e.flag & 1) && v.length > 2) segs.push([v[v.length - 1], v[0]]);
    } else if (e.type === 'ARC') chain(arcPoints(e.center, e.radius, e.startAngle, e.endAngle));
    else if (e.type === 'CIRCLE') chain(arcPoints(e.center, e.radius, 0, Math.PI * 2));
  }
  return segs.filter(([a, b]) => a && b && Number.isFinite(a.x) && Number.isFinite(b.x) && Math.hypot(b.x - a.x, b.y - a.y) > 1e-9);
}

/** Textes (position + contenu nettoyé) des calques choisis. */
export function textsOf(entities, layerSet) {
  return entities.filter(e => (e.type === 'TEXT' || e.type === 'MTEXT') && (!layerSet || layerSet.has(e.layer)))
    .map(e => ({ t: cleanText(e.text), p: e.insertionPoint || e.startPoint, h: e.textHeight || 1, layer: e.layer }))
    .filter(x => x.t && x.p);
}

function intersect(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  const et = TOL / Math.hypot(r.x, r.y), eu = TOL / Math.hypot(s.x, s.y);
  if (t < -et || t > 1 + et || u < -eu || u > 1 + eu) return null;
  return [Math.min(1, Math.max(0, t)), Math.min(1, Math.max(0, u))];
}

const shoelace = pts => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2;
const insidePoly = (pt, pts) => {
  let r = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
};
/** Retire les sommets alignés (allège les formes sans les changer). */
function simplify(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const len = Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y) || 1;
    if (Math.abs(cross) / len > 1e-3) out.push(b);
  }
  return out.length >= 3 ? out : pts;
}

/** Cellules fermées du réseau de traits (aire > 1 unité²). */
export function buildFaces(segs) {
  const cuts = segs.map(() => [0, 1]);
  const bb = segs.map(([a, b]) => [Math.min(a.x, b.x) - TOL, Math.max(a.x, b.x) + TOL, Math.min(a.y, b.y) - TOL, Math.max(a.y, b.y) + TOL]);
  const order = segs.map((_, i) => i).sort((i, j) => bb[i][0] - bb[j][0]);
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj];
      if (bb[j][0] > bb[i][1]) break; // balayage : plus aucun recouvrement possible en x
      if (bb[i][2] > bb[j][3] || bb[j][2] > bb[i][3]) continue;
      const r = intersect(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
      if (r) { cuts[i].push(r[0]); cuts[j].push(r[1]); }
    }
  }
  const index = new Map(); const verts = [];
  const vid = p => { const k = `${Math.round(p.x / TOL)}:${Math.round(p.y / TOL)}`; if (!index.has(k)) { index.set(k, verts.length); verts.push(p); } return index.get(k); };
  const adj = new Map(); const seen = new Set();
  const link = (u, v) => { (adj.get(u) || adj.set(u, []).get(u)).push(v); };
  segs.forEach(([a, b], i) => {
    const ts = [...new Set(cuts[i].map(t => Math.round(t * 1e6) / 1e6))].sort((x, y) => x - y);
    for (let k = 0; k < ts.length - 1; k++) {
      const u = vid({ x: a.x + (b.x - a.x) * ts[k], y: a.y + (b.y - a.y) * ts[k] });
      const v = vid({ x: a.x + (b.x - a.x) * ts[k + 1], y: a.y + (b.y - a.y) * ts[k + 1] });
      if (u === v) continue;
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      if (seen.has(key)) continue;
      seen.add(key); link(u, v); link(v, u);
    }
  });
  // Impasses : traits qui ne ferment rien
  let changed = true;
  while (changed) {
    changed = false;
    for (const [u, ns] of adj) {
      if (ns.length !== 1) continue;
      const v = ns[0]; adj.delete(u);
      const rest = adj.get(v).filter(w => w !== u);
      if (rest.length) adj.set(v, rest); else adj.delete(v);
      changed = true;
    }
  }
  const angle = (u, v) => Math.atan2(verts[v].y - verts[u].y, verts[v].x - verts[u].x);
  for (const [u, ns] of adj) ns.sort((a, b) => angle(u, a) - angle(u, b));
  const used = new Set(); const faces = [];
  for (const [u0, ns] of adj) for (const v0 of ns) {
    if (used.has(`${u0}>${v0}`)) continue;
    const cycle = []; let u = u0, v = v0, guard = 0;
    while (!used.has(`${u}>${v}`) && guard++ < 20000) {
      used.add(`${u}>${v}`); cycle.push(u);
      const around = adj.get(v); const i = around.indexOf(u);
      const w = around[(i - 1 + around.length) % around.length];
      u = v; v = w;
    }
    if (cycle.length >= 3) {
      const pts = cycle.map(k => verts[k]);
      const area = shoelace(pts);
      if (area > 1) faces.push({ pts: simplify(pts), area });
    }
  }
  return faces;
}

/**
 * Parcelles : cellules contenant exactement un numéro de lot.
 * Si le plan porte des surfaces écrites, seules les cellules qui en ont une sont retenues.
 */
export function findParcels(faces, texts) {
  const numbers = texts.filter(x => LOT_NUMBER.test(x.t));
  const areas = texts.filter(x => AREA.test(x.t));
  const requireArea = areas.length >= numbers.length * 0.5;
  const parcels = []; const skipped = { multi: 0, noArea: 0 };
  const placed = new Set(); const islandNumbers = new Set();
  for (const f of faces.sort((a, b) => a.area - b.area)) {
    const inNum = numbers.filter(n => !placed.has(n) && insidePoly(n.p, f.pts));
    if (inNum.length === 0) continue;
    if (inNum.length > 1) { skipped.multi++; continue; }
    const inArea = areas.filter(a => insidePoly(a.p, f.pts));
    if (requireArea && !inArea.length) { skipped.noArea++; islandNumbers.add(inNum[0]); continue; }
    placed.add(inNum[0]);
    const written = inArea.length ? Number(AREA.exec(inArea[0].t)[1].replace(',', '.')) : null;
    parcels.push({ code: inNum[0].t.replace(/\s+/g, ''), pts: f.pts, area: Math.round(f.area), surface: written ?? Math.round(f.area) });
  }
  // Numéros en double : le second reçoit un suffixe à vérifier
  const seen = {};
  for (const p of parcels.sort((a, b) => a.code.localeCompare(b.code, 'fr', { numeric: true }))) {
    seen[p.code] = (seen[p.code] || 0) + 1;
    if (seen[p.code] > 1) { p.duplicate = true; p.code = `${p.code}-${seen[p.code]}`; }
  }
  // Numéros de lots non reconnus (hors numéros d'îlots) : à créer « à placer » et à dessiner à la main
  const taken = new Set(parcels.map(p => p.code));
  const missing = [...new Set(numbers.filter(n => !placed.has(n) && !islandNumbers.has(n)).map(n => n.t.replace(/\s+/g, '')))]
    .filter(c => !taken.has(c)).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
  return { parcels, numbers: numbers.length, missing, skipped, requireArea };
}

/** Emprise du dessin (calques de traits), avec une marge de 3 %. */
export function extentsOf(segs) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [a, b] of segs) for (const p of [a, b]) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const m = Math.max(maxX - minX, maxY - minY) * 0.03;
  return { minX: minX - m, minY: minY - m, maxX: maxX + m, maxY: maxY + m };
}

/** Rendu du dessin en image PNG (fond de la carte interactive). */
export async function renderPlan(entities, layerSet, ext, { width = 3200, textLayers } = {}) {
  const W = ext.maxX - ext.minX, H = ext.maxY - ext.minY;
  const height = Math.round((width * H) / W);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const k = width / W;
  const X = x => (x - ext.minX) * k, Y = y => (ext.maxY - y) * k;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#4b5563'; ctx.lineWidth = Math.max(1, width / 2400); ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [a, b] of segmentsOf(entities, layerSet)) { ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); }
  ctx.stroke();
  ctx.fillStyle = '#374151'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const t of textsOf(entities, textLayers)) {
    if (AREA.test(t.t)) continue; // surfaces : affichées par la carte, pas sur le fond
    const px = Math.max(9, t.h * k * 0.9);
    ctx.font = `${px}px Poppins, Arial, sans-serif`;
    ctx.fillText(t.t, X(t.p.x), Y(t.p.y));
  }
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  return { blob, width, height };
}

/** Coordonnées relatives 0–1 de l'image (y vers le bas), arrondies au 1/100 000. */
export const toRelative = (pts, ext) => {
  const W = ext.maxX - ext.minX, H = ext.maxY - ext.minY;
  const r = v => Math.round(v * 1e5) / 1e5;
  return pts.map(p => [r((p.x - ext.minX) / W), r((ext.maxY - p.y) / H)]);
};

/**
 * Parcelles sans numéro sur le plan (tranches non encore numérotées) : cellules de taille et de forme
 * comparables aux lots numérotés. Numérotation provisoire « préfixe + 001 », de haut en bas puis de gauche à droite.
 */
export function findUnnumbered(faces, parcels, { min, max, prefix = 'P' }) {
  const sig = pts => pts.map(v => `${v.x.toFixed(2)},${v.y.toFixed(2)}`).sort().join('|');
  const taken = new Set(parcels.map(p => sig(p.pts)));
  const compactness = f => {
    const xs = f.pts.map(p => p.x), ys = f.pts.map(p => p.y);
    return f.area / ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) || 1);
  };
  const centre = f => ({ x: f.pts.reduce((s, p) => s + p.x, 0) / f.pts.length, y: f.pts.reduce((s, p) => s + p.y, 0) / f.pts.length });
  const cells = faces.filter(f => f.area >= min && f.area <= max && f.pts.length <= 8 && compactness(f) > 0.45 && !taken.has(sig(f.pts)));
  const row = Math.sqrt((min + max) / 2) || 20; // hauteur d'une rangée ≈ côté d'un lot
  cells.sort((a, b) => { const ca = centre(a), cb = centre(b); return Math.round(cb.y / row) - Math.round(ca.y / row) || ca.x - cb.x; });
  return cells.map((f, i) => ({ code: `${prefix}${String(i + 1).padStart(3, '0')}`, pts: f.pts, area: Math.round(f.area), surface: Math.round(f.area), provisional: true }));
}

/** Plage de surface par défaut : celle des lots numérotés, élargie. */
export function defaultAreaRange(parcels) {
  const a = parcels.map(p => p.area).sort((x, y) => x - y);
  if (!a.length) return { min: 200, max: 1500 };
  return { min: Math.round(a[Math.floor(a.length * 0.05)] * 0.8), max: Math.round(a[Math.floor(a.length * 0.95)] * 1.25) };
}
