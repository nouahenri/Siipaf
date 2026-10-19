/**
 * Lecture des plans AutoCAD (DWG, DXF) côté serveur avec LibreDWG (WebAssembly).
 * Le dashboard reçoit une géométrie allégée (traits, arcs, textes) et y détecte lui-même les parcelles.
 */
const path = require('path');
const { HttpError } = require('../lib/http');

let enginePromise;
/** Moteur LibreDWG (version module ESM, chargée une seule fois) et ses types de fichiers. */
function engine() {
  if (!enginePromise) {
    enginePromise = import('@mlightcad/libredwg-web').then(async mod => {
      const wasmDir = path.join(path.dirname(require.resolve('@mlightcad/libredwg-web')), '..', 'wasm');
      return { lib: await mod.LibreDwg.create(wasmDir), types: mod.Dwg_File_Type };
    }).catch(err => { enginePromise = null; throw err; });
  }
  return enginePromise;
}

const pt = p => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null);

/** Ne garde que ce qui sert à dessiner le plan et à reconnaître les lots. */
function compact(e) {
  const base = { type: e.type, layer: e.layer };
  switch (e.type) {
    case 'LINE': return { ...base, startPoint: pt(e.startPoint), endPoint: pt(e.endPoint) };
    case 'LWPOLYLINE':
    case 'POLYLINE2D': return { ...base, type: 'LWPOLYLINE', flag: e.flag || 0, vertices: (e.vertices || []).map(pt).filter(Boolean) };
    case 'ARC': return { ...base, center: pt(e.center), radius: e.radius, startAngle: e.startAngle, endAngle: e.endAngle };
    case 'CIRCLE': return { ...base, center: pt(e.center), radius: e.radius };
    case 'TEXT':
    case 'MTEXT': return { ...base, text: String(e.text ?? '').slice(0, 500), insertionPoint: pt(e.insertionPoint || e.startPoint), textHeight: e.textHeight || 1 };
    default: return null;
  }
}

async function parseCad(buffer, filename) {
  const isDxf = /\.dxf$/i.test(filename || '');
  if (!isDxf && buffer.slice(0, 4).toString('latin1') !== 'AC10') {
    throw new HttpError(400, 'Ce fichier n’est pas un plan AutoCAD (DWG ou DXF).');
  }
  const { lib, types } = await engine();
  const raw = lib.dwg_read_data(new Uint8Array(buffer), isDxf ? types.DXF : types.DWG);
  if (!raw) throw new HttpError(400, 'Plan illisible. Enregistrez-le depuis AutoCAD au format DWG 2013 ou DXF, puis réessayez.');
  let db;
  try { db = lib.convert(raw); } finally { try { lib.dwg_free(raw); } catch { /* déjà libéré */ } }
  const entities = (db.entities || []).filter(e => e.isVisible !== false).map(compact).filter(Boolean);
  if (!entities.length) throw new HttpError(400, 'Aucun trait ni texte lisible dans ce plan.');
  return { entities };
}

module.exports = { parseCad };
