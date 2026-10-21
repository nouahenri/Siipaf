/**
 * Lecture d'un plan de masse PDF vectoriel (export AutoCAD, Covadis, ArchiCAD…) dans le navigateur.
 * Produit les mêmes entités que la lecture d'un DWG (traits, polylignes, textes répartis en calques),
 * pour passer ensuite par la même détection de parcelles (cadPlan.js).
 *
 * - Traits : chemins du 1er feuillet, transformations comprises ; calque = calque du PDF (contenu
 *   optionnel, conservé par AutoCAD) ou, à défaut, couleur du trait.
 * - Textes : morceaux d'une même ligne recollés (« 400 » + « m² »), position = centre du texte ;
 *   regroupés par taille de police (les numéros de lots ont en général tous la même).
 * - Unités : les points PDF sont convertis en mètres à l'échelle donnée (1/1000 par défaut) ;
 *   l'échelle réelle se déduit ensuite des surfaces écrites sur le plan.
 */
import { summarizeLayers } from './cadPlan';

const PT_MM = 25.4 / 72; // 1 point PDF en millimètres papier

/** Mètres sur le terrain pour 1 point PDF, à l'échelle 1/scale. */
export const metersPerPoint = scale => (PT_MM * scale) / 1000;

const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m, x, y) => ({ x: x * m[0] + y * m[2] + m[4], y: x * m[1] + y * m[3] + m[5] });
const hex = (r, g, b) => `#${[r, g, b].map(v => Number(v).toString(16).padStart(2, '0')).join('')}`;
const fmt = n => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** Courbe de Bézier ramenée à des segments. */
function bezier(p0, p1, p2, p3, n = 8) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

/** Traits du feuillet (en points PDF), répartis en calques. */
export async function readPaths(page, pdfjs, optional) {
  const { OPS } = pdfjs;
  const { fnArray, argsArray } = await page.getOperatorList();
  const STROKE = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const FILL = new Set([OPS.fill, OPS.eoFill]);
  let state = { ctm: [1, 0, 0, 1, 0, 0], stroke: '#000000', fill: '#000000' };
  const stack = [];
  const marked = []; // calques ouverts (contenu optionnel) ; null = marquage sans calque
  let subpaths = [];
  const entities = [];

  const layerName = () => {
    for (let i = marked.length - 1; i >= 0; i--) if (marked[i]) return marked[i];
    return null;
  };
  const hidden = () => marked.some(m => m === false);

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], args = argsArray[i];
    switch (fn) {
      case OPS.save: stack.push(state); state = { ...state }; break;
      case OPS.restore: state = stack.pop() || state; break;
      case OPS.transform: state.ctm = mul(args, state.ctm); break;
      case OPS.paintFormXObjectBegin:
        stack.push(state); state = { ...state };
        if (Array.isArray(args[0]) && args[0].length === 6) state.ctm = mul(args[0], state.ctm);
        break;
      case OPS.paintFormXObjectEnd: state = stack.pop() || state; break;
      case OPS.setStrokeRGBColor: state.stroke = hex(...args); break;
      case OPS.setFillRGBColor: state.fill = hex(...args); break;
      case OPS.beginMarkedContentProps: {
        const [tag, props] = args;
        if (tag === 'OC' && props && optional) {
          const ids = props.type === 'OCMD' ? props.ids || [] : [props.id];
          const group = ids.map(id => optional.getGroup(id)).find(Boolean);
          // false : calque masqué dans le PDF (on ne le lit pas)
          marked.push(group ? (optional.isVisible(props) ? group.name || null : false) : null);
        } else marked.push(null);
        break;
      }
      case OPS.beginMarkedContent: marked.push(null); break;
      case OPS.endMarkedContent: marked.pop(); break;
      case OPS.constructPath: {
        const [ops, coords] = args;
        let cur = null, start = null, j = 0;
        const at = (x, y) => apply(state.ctm, x, y);
        for (const op of ops) {
          if (op === OPS.moveTo) { start = cur = at(coords[j++], coords[j++]); subpaths.push({ pts: [cur], closed: false }); }
          else if (op === OPS.lineTo) { cur = at(coords[j++], coords[j++]); subpaths.at(-1)?.pts.push(cur); }
          else if (op === OPS.curveTo) {
            const c1 = at(coords[j++], coords[j++]), c2 = at(coords[j++], coords[j++]), end = at(coords[j++], coords[j++]);
            if (cur) subpaths.at(-1)?.pts.push(...bezier(cur, c1, c2, end));
            cur = end;
          } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
            const a = at(coords[j++], coords[j++]), end = at(coords[j++], coords[j++]);
            if (cur) subpaths.at(-1)?.pts.push(...(op === OPS.curveTo2 ? bezier(cur, cur, a, end) : bezier(cur, a, end, end)));
            cur = end;
          } else if (op === OPS.rectangle) {
            const x = coords[j++], y = coords[j++], w = coords[j++], h = coords[j++];
            subpaths.push({ pts: [at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h)], closed: true });
            start = cur = at(x, y);
          } else if (op === OPS.closePath) {
            const sp = subpaths.at(-1);
            if (sp) sp.closed = true;
            cur = start;
          }
        }
        break;
      }
      default:
        if (STROKE.has(fn) || FILL.has(fn) || fn === OPS.endPath) {
          // endPath : chemin de découpe, rien à dessiner
          if (fn !== OPS.endPath && !hidden()) {
            const layer = layerName() || (STROKE.has(fn) ? `Traits ${state.stroke}` : `Remplissage ${state.fill}`);
            for (const sp of subpaths) {
              if (sp.pts.length < 2) continue;
              entities.push({ type: 'LWPOLYLINE', layer, flag: sp.closed || fn === OPS.closeStroke ? 1 : 0, vertices: sp.pts });
            }
          }
          subpaths = [];
        }
    }
  }
  return entities;
}

/** Textes du feuillet : morceaux d'une même ligne recollés, position au centre. */
export async function readTexts(page) {
  const { items } = await page.getTextContent();
  const pieces = items.filter(it => it.str && it.str.trim() && it.transform).map(it => {
    const [a, b, c, d, e, f] = it.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || 1;
    const angle = Math.atan2(b, a);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return { str: it.str, size, angle, cos, sin, u: e * cos + f * sin, v: -e * sin + f * cos, w: it.width || it.str.length * size * 0.5, e, f };
  });
  // Regroupe par direction, taille et ligne, puis recolle de gauche à droite
  const lines = new Map();
  for (const p of pieces) {
    const key = `${Math.round((p.angle * 180) / Math.PI)}|${Math.round(p.size * 4)}|${Math.round(p.v / (p.size * 0.3))}`;
    (lines.get(key) || lines.set(key, []).get(key)).push(p);
  }
  const texts = [];
  for (const group of lines.values()) {
    group.sort((x, y) => x.u - y.u);
    let cur = null;
    const flush = () => { if (cur) texts.push(cur); cur = null; };
    for (const p of group) {
      const gap = cur ? p.u - (cur.u + cur.w) : Infinity;
      if (cur && gap < p.size * 0.6) {
        cur.str += (gap > p.size * 0.15 && !cur.str.endsWith(' ') ? ' ' : '') + p.str;
        cur.w = p.u + p.w - cur.u;
      } else { flush(); cur = { ...p }; }
    }
    flush();
  }
  return texts.map(t => ({
    str: t.str.replace(/\s+/g, ' ').trim(),
    size: t.size,
    // Centre du texte : milieu de la ligne, un tiers de la hauteur au-dessus de la ligne de base
    x: t.e + t.cos * (t.w / 2) - t.sin * (t.size * 0.35),
    y: t.f + t.sin * (t.w / 2) + t.cos * (t.size * 0.35),
  })).filter(t => t.str);
}

/**
 * Lit le PDF (1er feuillet) et renvoie les entités en points PDF.
 * `toEntities(scale)` les convertit en mètres à l'échelle 1/scale, au format attendu par cadPlan.js.
 */
export async function readPdfDrawing(file) {
  if (!/\.pdf$/i.test(file.name)) throw new Error('Choisissez un fichier PDF.');
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await doc.getPage(1);
  const optional = await doc.getOptionalContentConfig().catch(() => null);
  const [paths, texts] = await Promise.all([readPaths(page, pdfjs, optional), readTexts(page)]);
  if (!paths.length) throw new Error('Ce PDF ne contient pas de traits : c’est une image (plan scanné). Utilisez-le comme image de fond.');
  return { paths, texts, pages: doc.numPages };
}

/** Entités en mètres (échelle 1/scale), au format des entités DWG. */
export function pdfEntities(raw, scale) {
  const k = metersPerPoint(scale);
  const P = p => ({ x: p.x * k, y: p.y * k });
  return [
    ...raw.paths.map(e => ({ ...e, vertices: e.vertices.map(P) })),
    ...raw.texts.map(t => ({ type: 'TEXT', layer: `Textes ${fmt(t.size)} pt`, text: t.str, insertionPoint: P(t), textHeight: t.size * k })),
  ];
}

/** Lecture complète au format de readDrawing (cadPlan.js), à l'échelle 1/scale. */
export function pdfDrawing(raw, scale) {
  const entities = pdfEntities(raw, scale);
  return { entities, layers: summarizeLayers(entities) };
}
