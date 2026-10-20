/**
 * Import d'un plan de masse depuis un fichier ZIP ou une page HTML / SVG (export d'un autre logiciel,
 * ancienne carte interactive…). Tout se passe dans le navigateur :
 *  - ZIP : on liste les fichiers utiles (AutoCAD, HTML/SVG, PDF, image) et leurs ressources ;
 *  - HTML / SVG : on retrouve les formes des lots (SVG ou zones cliquables <map><area>),
 *    leur numéro (attribut, titre ou texte posé dessus) et l'image de fond.
 * Le contenu importé n'est jamais exécuté : scripts, iframes et attributs « on… » sont retirés.
 */
import { unzip } from 'fflate';

const MAX_UNZIPPED = 250 * 1024 * 1024;
const LOT_CODE = /^[A-Za-z]{0,3}[-\s]?\d{1,5}[A-Za-z]?$/;

export const kindOf = name => {
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  if (['dwg', 'dxf'].includes(ext)) return 'cad';
  if (['html', 'htm', 'svg'].includes(ext)) return 'html';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image';
  if (ext === 'zip') return 'zip';
  return null;
};

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf', html: 'text/html', htm: 'text/html', dxf: 'application/dxf', dwg: 'application/acad' };
const mimeOf = name => MIME[(name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase()] || 'application/octet-stream';

/** Ouvre un ZIP : { files: Map(chemin → File), candidates: [{ path, kind }] } triés du plus utile au moins utile. */
export async function readZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let total = 0;
  const entries = await new Promise((resolve, reject) => unzip(buf, {
    filter: f => {
      if (/(^|\/)(__MACOSX|\.)/.test(f.name) || f.name.endsWith('/')) return false;
      total += f.originalSize;
      if (total > MAX_UNZIPPED) throw new Error('Archive trop volumineuse une fois décompressée (250 Mo maximum).');
      return true;
    },
  }, (err, data) => (err ? reject(new Error('Archive ZIP illisible ou protégée par mot de passe.')) : resolve(data))));
  const files = new Map();
  for (const [path, bytes] of Object.entries(entries)) {
    const name = path.split('/').pop();
    files.set(path, new File([bytes], name, { type: mimeOf(name) }));
  }
  const rank = { cad: 0, html: 1, pdf: 2, image: 3 };
  const candidates = [...files.keys()]
    .map(path => ({ path, kind: kindOf(path), size: files.get(path).size }))
    .filter(c => c.kind && c.kind !== 'zip')
    // Une image seule n'est retenue comme plan que si elle est grande (pas un logo ou une icône)
    .filter(c => c.kind !== 'image' || c.size > 150 * 1024)
    .sort((a, b) => rank[a.kind] - rank[b.kind] || b.size - a.size);
  if (!candidates.length) throw new Error('Aucun plan dans cette archive (attendu : DWG, DXF, HTML, SVG, PDF ou image).');
  return { files, candidates };
}

/** Résout un chemin relatif d'une page HTML vers un fichier de l'archive. */
function resolveAsset(files, baseDir, ref) {
  if (!files || !ref || /^(data:|https?:|\/\/|#)/i.test(ref)) return null;
  const clean = decodeURIComponent(ref.split(/[?#]/)[0]);
  const parts = (clean.startsWith('/') ? clean.slice(1) : `${baseDir}${clean}`).split('/');
  const out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  const path = out.join('/');
  if (files.has(path)) return files.get(path);
  const base = clean.split('/').pop().toLowerCase();
  for (const [k, f] of files) if (k.split('/').pop().toLowerCase() === base) return f;
  return null;
}

const toDataUrl = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('Ressource illisible.'));
  r.readAsDataURL(blob);
});

const loadImage = src => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Image du plan illisible.'));
  img.src = src;
});

/** Retire tout ce qui pourrait s'exécuter ou charger une ressource extérieure. */
function sanitize(root) {
  root.querySelectorAll('script, iframe, object, embed, foreignObject, link, meta, style[media="print"]').forEach(n => n.remove());
  for (const el of root.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name)) el.removeAttribute(a.name);
      if (/^(href|xlink:href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
  }
}

// « Lot 12 », « lot-12 », « N° 12 », « parcelle_12 » → « 12 »
const cleanCode = s => String(s || '').trim().replace(/^(lot|parcelle|n°|no(?=[\s\d.:#-])|num(éro)?)\s*[-_#:.]?\s*/i, '').trim();
const looksLikeCode = s => LOT_CODE.test(cleanCode(s));

/** Numéro d'un lot porté par l'élément lui-même ou ses parents proches. */
function codeFromAttributes(el) {
  for (let node = el, depth = 0; node && depth < 3 && node.getAttribute; node = node.parentElement, depth++) {
    for (const attr of ['data-lot', 'data-code', 'data-numero', 'data-num', 'data-name', 'data-id', 'aria-label', 'title', 'alt', 'id']) {
      const v = node.getAttribute(attr);
      if (v && looksLikeCode(v)) return cleanCode(v);
      // « lot-12 », « parcelle_12 »
      const m = v && v.match(/(?:lot|parcelle|p)[-_ ]?(\d{1,5}[A-Za-z]?)$/i);
      if (m) return m[1];
    }
    const t = node.querySelector?.(':scope > title');
    if (t && looksLikeCode(t.textContent)) return cleanCode(t.textContent);
  }
  return null;
}

const pointInPolygon = ([x, y], pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const area = pts => Math.abs(pts.reduce((s, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return s + x * y2 - x2 * y; }, 0) / 2);

/** Allège un contour : retire les points en double et presque alignés, 200 points au plus. */
function simplify(pts, tol) {
  let out = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > tol);
  if (out.length > 3 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) <= tol) out.pop();
  out = out.filter((p, i) => {
    const a = out[(i - 1 + out.length) % out.length], b = out[(i + 1) % out.length];
    const cross = Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]));
    return cross / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1) > tol * 0.5;
  });
  while (out.length > 200) out = out.filter((_, i) => i % 2 === 0);
  return out;
}

/* ─── SVG ─────────────────────────────────────────────── */

/** Forme d'un élément SVG en coordonnées du dessin (transformations comprises). */
function svgShape(el, root) {
  const m = root.getScreenCTM().inverse().multiply(el.getScreenCTM());
  const pt = root.createSVGPoint();
  const map = (x, y) => { pt.x = x; pt.y = y; const p = pt.matrixTransform(m); return [p.x, p.y]; };
  const tag = el.tagName.toLowerCase();
  if (tag === 'polygon' || tag === 'polyline') return [...el.points].map(p => map(p.x, p.y));
  if (tag === 'rect') {
    const x = el.x.baseVal.value, y = el.y.baseVal.value, w = el.width.baseVal.value, h = el.height.baseVal.value;
    return [map(x, y), map(x + w, y), map(x + w, y + h), map(x, y + h)];
  }
  const len = el.getTotalLength?.();
  if (!len) return null;
  const n = Math.min(160, Math.max(24, Math.round(len / 4)));
  return Array.from({ length: n }, (_, i) => { const p = el.getPointAtLength((len * i) / n); return map(p.x, p.y); });
}

async function parseSvg(svg, host, assets, baseDir) {
  // Images intégrées au dessin : remplacées par leur contenu (le rendu en image ne charge rien d'extérieur)
  for (const img of svg.querySelectorAll('image')) {
    const href = img.getAttribute('href') || img.getAttribute('xlink:href');
    const f = resolveAsset(assets, baseDir, href);
    if (f) img.setAttribute('href', await toDataUrl(f));
    else if (href && !href.startsWith('data:')) img.remove();
  }
  host.appendChild(svg);
  const vb = svg.viewBox.baseVal;
  const box = vb && vb.width ? { x: vb.x, y: vb.y, w: vb.width, h: vb.height } : (() => { const b = svg.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })();
  const total = box.w * box.h;
  const tol = Math.max(box.w, box.h) / 4000;

  // Textes (numéros posés sur les parcelles) : centre en coordonnées du dessin
  const texts = [...svg.querySelectorAll('text')].map(t => {
    const s = cleanCode(t.textContent);
    if (!LOT_CODE.test(s)) return null;
    const b = t.getBBox();
    const m = svg.getScreenCTM().inverse().multiply(t.getScreenCTM());
    const p = svg.createSVGPoint(); p.x = b.x + b.width / 2; p.y = b.y + b.height / 2;
    const c = p.matrixTransform(m);
    return { code: s, at: [c.x, c.y] };
  }).filter(Boolean);

  const shapes = [];
  for (const el of svg.querySelectorAll('polygon, rect, path, circle, ellipse, polyline')) {
    if (el.closest('defs, clipPath, mask, pattern, marker, symbol')) continue;
    let pts;
    try { pts = svgShape(el, svg); } catch { continue; }
    if (!pts || pts.length < 3) continue;
    pts = simplify(pts, tol);
    if (pts.length < 3) continue;
    const a = area(pts);
    if (a > total * 0.25 || a < total * 1e-6) continue; // fond, cadre, ou poussière
    shapes.push({ el, pts, area: a, code: codeFromAttributes(el) });
  }
  // Numéro manquant : texte posé à l'intérieur (la plus petite forme qui le contient)
  for (const t of texts) {
    const hit = shapes.filter(s => !s.code && pointInPolygon(t.at, s.pts)).sort((a, b) => a.area - b.area)[0];
    if (hit) hit.code = t.code;
  }
  const rel = pts => pts.map(([x, y]) => [Math.min(1, Math.max(0, (x - box.x) / box.w)), Math.min(1, Math.max(0, (y - box.y) / box.h))]);
  const parcels = shapes.filter(s => s.code).map(s => ({ code: s.code, shape: rel(s.pts), area: s.area }));
  const others = shapes.filter(s => !s.code).map(s => ({ shape: rel(s.pts), area: s.area }));

  // Fond : le dessin lui-même rendu en image (largeur 3200 px), formes comprises
  svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
  const width = 3200, height = Math.max(1, Math.round((3200 * box.h) / box.w));
  svg.setAttribute('width', width); svg.setAttribute('height', height);
  const xml = new XMLSerializer().serializeToString(svg);
  const img = await loadImage(URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' })));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  return { source: 'svg', background: blob, width, height, parcels, others };
}

/* ─── Image + zones cliquables (<map><area>) ─────────── */

async function parseImageMap(doc, assets, baseDir) {
  const img = [...doc.querySelectorAll('img[usemap]')][0];
  if (!img) return null;
  const map = doc.querySelector(`map[name="${img.getAttribute('usemap').replace(/^#/, '')}"]`);
  if (!map) return null;
  const src = img.getAttribute('src');
  const file = resolveAsset(assets, baseDir, src) || (src?.startsWith('data:') ? await (await fetch(src)).blob() : null);
  if (!file) throw new Error(`L’image du plan (« ${src} ») n’est pas dans le fichier : importez le ZIP complet (page + image).`);
  const pic = await loadImage(URL.createObjectURL(file));
  // Les coordonnées des zones sont celles de l'image affichée (attributs width/height s'ils existent)
  const w = Number(img.getAttribute('width')) || pic.naturalWidth, h = Number(img.getAttribute('height')) || pic.naturalHeight;
  const parcels = [], others = [];
  for (const a of map.querySelectorAll('area')) {
    const c = (a.getAttribute('coords') || '').split(/[\s,]+/).map(Number).filter(n => !Number.isNaN(n));
    const kind = (a.getAttribute('shape') || 'rect').toLowerCase();
    let pts = [];
    if (kind.startsWith('poly')) for (let i = 0; i + 1 < c.length; i += 2) pts.push([c[i], c[i + 1]]);
    else if (kind.startsWith('rect') && c.length >= 4) pts = [[c[0], c[1]], [c[2], c[1]], [c[2], c[3]], [c[0], c[3]]];
    else if (kind.startsWith('circ') && c.length >= 3) pts = Array.from({ length: 24 }, (_, i) => [c[0] + c[2] * Math.cos((i * Math.PI) / 12), c[1] + c[2] * Math.sin((i * Math.PI) / 12)]);
    if (pts.length < 3) continue;
    const shape = simplify(pts, 0.5).map(([x, y]) => [Math.min(1, Math.max(0, x / w)), Math.min(1, Math.max(0, y / h))]);
    const href = a.getAttribute('href') || '';
    const code = codeFromAttributes(a) || (href.match(/(?:lot|parcelle)[=/_-]?(\d{1,5}[A-Za-z]?)/i) || [])[1] || null;
    (code ? parcels : others).push({ code, shape, area: area(shape) });
  }
  return { source: 'imagemap', background: file, width: pic.naturalWidth, height: pic.naturalHeight, parcels, others };
}

/**
 * Lit une page HTML ou un fichier SVG. `assets` (Map chemin → File) et `path` servent
 * à retrouver les images quand la page vient d'une archive ZIP.
 */
export async function parseHtmlPlan(file, assets = null, path = '') {
  const text = await file.text();
  const isSvg = /\.svg$/i.test(file.name) || /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text);
  const doc = new DOMParser().parseFromString(text, isSvg ? 'image/svg+xml' : 'text/html');
  if (doc.querySelector('parsererror')) throw new Error('Fichier SVG mal formé.');
  sanitize(doc);
  const baseDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';

  const fromMap = await parseImageMap(doc, assets, baseDir);
  if (fromMap && fromMap.parcels.length + fromMap.others.length) return finish(fromMap);

  // Le plus grand dessin SVG de la page
  const svgs = isSvg ? [doc.documentElement] : [...doc.querySelectorAll('svg')];
  if (!svgs.length) throw new Error('Aucun plan trouvé dans cette page : il faut un dessin SVG ou une image avec zones cliquables.');
  const svg = svgs.sort((a, b) => b.querySelectorAll('*').length - a.querySelectorAll('*').length)[0];
  // Le calcul des formes a besoin d'un dessin réellement mis en page (hors de l'écran, invisible)
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:2000px;height:2000px;visibility:hidden;pointer-events:none;overflow:hidden';
  document.body.appendChild(host);
  try {
    const live = document.importNode(svg, true);
    live.setAttribute('width', '2000'); live.setAttribute('height', '2000');
    return finish(await parseSvg(live, host, assets, baseDir));
  } finally { host.remove(); }
}

/** Numéros en double : suffixe « -2 », « -3 »… (à vérifier ensuite dans l'éditeur). */
function finish(result) {
  const seen = {};
  for (const p of result.parcels.sort((a, b) => String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }))) {
    const n = (seen[p.code] = (seen[p.code] || 0) + 1);
    if (n > 1) { p.duplicate = true; p.code = `${p.code}-${n}`; }
  }
  if (!result.parcels.length && !result.others.length) throw new Error('Aucune forme de lot reconnue dans ce plan.');
  return result;
}
