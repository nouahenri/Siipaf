/**
 * Conversion d'un plan AutoCAD (DWG / DXF) en carte interactive :
 * lecture → choix des calques → parcelles détectées (aperçu) → image de fond + lots créés.
 */
import { useEffect, useMemo, useState } from 'react';
import { FileUp, Wand2, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { savePlan, summaryText } from '../lib/planSave';
import { useToast } from '../lib/app-context';
import { Field, ErrorBox, Badge } from './ui';
import { readDrawing, segmentsOf, textsOf, buildFaces, findParcels, findUnnumbered, defaultAreaRange, extentsOf, renderPlan, toRelative } from '../lib/cadPlan';

/** planId : reconversion d'un plan existant ; initialFile : fichier déjà choisi (ex. tiré d'un ZIP). */
export default function CadImport({ projectId, planId, initialFile, onDone, onCancel }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [lineLayers, setLineLayers] = useState(new Set());
  const [numberLayer, setNumberLayer] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('disponible');
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [extra, setExtra] = useState({ on: false, prefix: 'P', min: 200, max: 1500 });

  const open = async f => {
    setError(null); setAnalysis(null); setFile(f); setName(f.name.replace(/\.[^.]+$/, ''));
    setBusy('Lecture du plan AutoCAD sur le serveur…');
    try {
      const d = await readDrawing(f);
      setDrawing(d);
      // Calque des numéros : celui qui porte le plus de numéros ; calques de traits : le plus fourni + celui des numéros
      const num = [...d.layers].sort((a, b) => b.numbers - a.numbers)[0];
      const mostLines = [...d.layers].sort((a, b) => b.lines - a.lines)[0];
      setNumberLayer(num?.numbers ? num.name : '');
      setLineLayers(new Set([mostLines?.name, num?.lines ? num.name : null].filter(Boolean)));
    } catch (e) { setDrawing(null); setError(e); }
    setBusy('');
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialFile) open(initialFile); }, [initialFile]);

  const analyse = () => {
    setError(null); setBusy('Recherche des parcelles…');
    // Laisse le navigateur afficher le message avant le calcul
    setTimeout(() => {
      try {
        const segs = segmentsOf(drawing.entities, lineLayers);
        if (!segs.length) throw new Error('Aucun trait sur les calques choisis.');
        const faces = buildFaces(segs);
        const res = findParcels(faces, textsOf(drawing.entities, new Set([numberLayer])));
        setAnalysis({ ...res, ext: extentsOf(segs), segs, faces });
        const range = defaultAreaRange(res.parcels);
        setExtra(x => ({ ...x, ...range, on: !res.parcels.length }));
      } catch (e) { setError(e); }
      setBusy('');
    }, 30);
  };

  const create = async () => {
    setError(null);
    try {
      setBusy('Création de l’image du plan…');
      const textLayers = new Set(drawing.layers.filter(l => l.texts).map(l => l.name));
      const { blob, width, height } = await renderPlan(drawing.entities, lineLayers, analysis.ext, { textLayers });
      const lots = [
        ...[...analysis.parcels, ...unnumbered].map(p => ({ code: p.code, shape: toRelative(p.pts, analysis.ext), surface_m2: p.surface, status })),
        ...analysis.missing.map(code => ({ code, status })),
      ];
      const { plan, summary } = await savePlan({ projectId, planId, name, image: blob, width, height, lots, onStep: setBusy });
      toast(`${planId ? 'Plan reconverti' : 'Carte créée'} : ${summaryText(summary)}`);
      onDone(plan);
    } catch (e) { setError(e); setBusy(''); }
  };

  // Parcelles sans numéro (option) : recalculées quand la plage ou le préfixe change
  const unnumbered = useMemo(() => (analysis && extra.on
    ? findUnnumbered(analysis.faces, analysis.parcels, { min: Number(extra.min) || 0, max: Number(extra.max) || Infinity, prefix: extra.prefix.trim() || 'P' })
    : []), [analysis, extra]);

  // Aperçu : traits en gris, parcelles numérotées en vert, sans numéro en bleu
  const preview = useMemo(() => {
    if (!analysis) return null;
    const { ext, segs, parcels } = analysis;
    const W = ext.maxX - ext.minX, H = ext.maxY - ext.minY;
    const s = 1000 / W;
    const X = x => ((x - ext.minX) * s).toFixed(1), Y = y => ((ext.maxY - y) * s).toFixed(1);
    const lines = segs.map(([a, b]) => `M${X(a.x)} ${Y(a.y)}L${X(b.x)} ${Y(b.y)}`).join('');
    const path = pts => `M${pts.map(q => `${X(q.x)} ${Y(q.y)}`).join('L')}Z`;
    return { w: 1000, h: Math.round(H * s), lines, parcels: parcels.map(p => ({ code: p.code, dup: p.duplicate, d: path(p.pts) })), extra: unnumbered.map(p => ({ code: p.code, d: path(p.pts) })) };
  }, [analysis, unnumbered]);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <ErrorBox error={error} />
      {!drawing && !busy && (
        <>
          <p className="small muted">Déposez le plan de masse au format AutoCAD : les parcelles et leurs numéros sont reconnus automatiquement et deviennent des lots cliquables sur la carte.</p>
          <label className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
            <FileUp />Choisir un fichier DWG ou DXF
            <input type="file" hidden accept=".dwg,.dxf" onChange={e => e.target.files[0] && open(e.target.files[0])} />
          </label>
          {onCancel && <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onCancel}>← Revenir</button>}
        </>
      )}
      {busy && <p className="row" style={{ gap: 8 }}><Loader2 className="spin" size={18} />{busy}</p>}

      {drawing && !busy && (
        <>
          <div className="small muted">{file.name} · {drawing.entities.length} éléments · {drawing.layers.length} calques</div>
          <div className="form-grid">
            {!planId && <Field label="Nom du plan"><input className="input" value={name} onChange={e => setName(e.target.value)} /></Field>}
            <Field label="Calque des numéros de lots">
              <select className="select" value={numberLayer} onChange={e => { setNumberLayer(e.target.value); setAnalysis(null); }}>
                {drawing.layers.filter(l => l.texts).map(l => <option key={l.name} value={l.name}>{l.name} — {l.numbers} numéro(s), {l.areas} surface(s)</option>)}
              </select>
            </Field>
          </div>
          <div>
            <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Calques qui tracent les limites des parcelles</div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {drawing.layers.filter(l => l.lines).map(l => (
                <label key={l.name} className="checkbox small" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px' }}>
                  <input type="checkbox" checked={lineLayers.has(l.name)} onChange={e => { const n = new Set(lineLayers); e.target.checked ? n.add(l.name) : n.delete(l.name); setLineLayers(n); setAnalysis(null); }} />
                  {l.name} <span className="muted">({l.lines})</span>
                </label>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>Astuce : n’ajoutez pas les calques d’axes, de cotes ou de hachures, ils découpent les parcelles.</p>
          </div>
          {!analysis && <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={!lineLayers.size || !numberLayer} onClick={analyse}><Wand2 />Détecter les parcelles</button>}
        </>
      )}

      {analysis && !busy && (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Badge tone="ok" dot>{analysis.parcels.length} parcelle(s) détectée(s)</Badge>
            {unnumbered.length > 0 && <Badge tone="" dot>{unnumbered.length} sans numéro (provisoires)</Badge>}
            {analysis.missing.length > 0 && <Badge tone="warn" dot>{analysis.missing.length} lot(s) à placer à la main</Badge>}
            {analysis.parcels.some(p => p.duplicate) && <Badge tone="danger" dot>Numéros en double</Badge>}
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: '#fff' }} className="cad-preview">
            <svg viewBox={`0 0 ${preview.w} ${preview.h}`} style={{ width: '100%', height: 'auto', maxHeight: 420, display: 'block' }} role="img" aria-label="Aperçu des parcelles détectées">
              <path d={preview.lines} stroke="#9ca3af" strokeWidth="0.6" fill="none" />
              {preview.extra.map(p => <path key={p.code} d={p.d} fill="rgba(11,107,168,.28)" stroke="#0b6ba8" strokeWidth="0.6"><title>{p.code} (provisoire)</title></path>)}
              {preview.parcels.map(p => <path key={p.code} d={p.d} fill={p.dup ? 'rgba(192,38,45,.45)' : 'rgba(46,158,91,.35)'} stroke={p.dup ? '#c0262d' : '#2e9e5b'} strokeWidth="0.8"><title>Lot {p.code}</title></path>)}
            </svg>
          </div>
          {analysis.missing.length > 0 && <p className="small"><AlertTriangle size={14} style={{ verticalAlign: '-2px', color: 'var(--warn)' }} /> Non reconnus (traits non fermés) : <strong>{analysis.missing.join(', ')}</strong>. Ils seront créés dans « Lots à placer » : dessinez-les ensuite dans l’éditeur.</p>}
          {analysis.parcels.some(p => p.duplicate) && <p className="small" style={{ color: 'var(--danger)' }}>Certains numéros apparaissent deux fois (suffixe « -2 ») : vérifiez-les dans l’éditeur après l’import, ou retirez un calque.</p>}
          <div className="card" style={{ padding: 12, background: 'var(--surface-2)' }}>
            <label className="checkbox"><input type="checkbox" checked={extra.on} onChange={e => setExtra(x => ({ ...x, on: e.target.checked }))} />Créer aussi les parcelles <strong>sans numéro</strong> sur le plan (numérotation provisoire)</label>
            {extra.on && (
              <div className="form-grid" style={{ marginTop: 10 }}>
                <Field label="Préfixe des numéros provisoires" hint={`Ex. : ${extra.prefix || 'P'}001, ${extra.prefix || 'P'}002…`}><input className="input" value={extra.prefix} maxLength={6} onChange={e => setExtra(x => ({ ...x, prefix: e.target.value }))} /></Field>
                <Field label="Surface retenue (m²)" hint="Écarte les voies, places et grands îlots.">
                  <div className="row" style={{ gap: 6 }}>
                    <input className="input tabular" inputMode="numeric" value={extra.min} onChange={e => setExtra(x => ({ ...x, min: e.target.value }))} aria-label="Surface minimale" />
                    <span className="muted">à</span>
                    <input className="input tabular" inputMode="numeric" value={extra.max} onChange={e => setExtra(x => ({ ...x, max: e.target.value }))} aria-label="Surface maximale" />
                  </div>
                </Field>
              </div>
            )}
          </div>
          <div className="form-grid">
            <Field label="Statut des nouveaux lots">
              <select className="select" value={status} onChange={e => setStatus(e.target.value)}>
                <option value="disponible">Disponible</option>
                <option value="bloque">Non commercialisé (à ouvrir plus tard)</option>
              </select>
            </Field>
          </div>
          <p className="small muted">Un lot dont le numéro existe déjà dans le projet garde son statut et son dossier ; il reçoit seulement sa forme et sa surface.{planId && ' Les lots de ce plan absents du nouveau fichier passent dans « Lots à placer ».'}</p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={() => setAnalysis(null)}>Modifier les calques</button>
            <button className="btn btn-primary" disabled={!analysis.parcels.length && !unnumbered.length} onClick={create}><Check />{planId ? 'Reconvertir le plan' : 'Créer la carte'} ({analysis.parcels.length + unnumbered.length} lots)</button>
          </div>
        </>
      )}
    </div>
  );
}
