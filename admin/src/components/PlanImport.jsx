/**
 * Import d'un plan de masse, quel que soit le format : image, PDF, AutoCAD (DWG/DXF),
 * page HTML ou SVG (ancienne carte interactive, export d'un logiciel), ou archive ZIP qui en contient.
 * Sert à la création d'un plan et à sa reconversion (planId).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, Check, Loader2, FileArchive, FileCode2, FileImage, FileText, PenTool } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../lib/app-context';
import { pdfToImage } from '../lib/pdf';
import { kindOf, readZip, parseHtmlPlan } from '../lib/planImport';
import { savePlan, summaryText } from '../lib/planSave';
import { Field, ErrorBox, Badge } from './ui';
import CadImport from './CadImport';

const ACCEPT = '.dwg,.dxf,.zip,.html,.htm,.svg,.pdf,.png,.jpg,.jpeg,.webp';
const KIND_LABEL = { cad: 'Plan AutoCAD', html: 'Page HTML / dessin SVG', pdf: 'Document PDF', image: 'Image' };
const KIND_ICON = { cad: PenTool, html: FileCode2, pdf: FileText, image: FileImage };

export default function PlanImport({ projectId, planId, onDone }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [step, setStep] = useState(null); // { kind, file, assets, path } ou { zip }
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [over, setOver] = useState(false);
  const input = useRef();

  const route = (file, assets = null, path = '') => {
    const kind = kindOf(path || file.name);
    if (kind === 'image') return saveImage(file, kind);
    setStep({ kind, file, assets, path });
  };

  const handle = async file => {
    setError(null);
    if (!name && !planId) setName(file.name.replace(/\.[^.]+$/, ''));
    const kind = kindOf(file.name);
    if (!kind) return setError(new Error('Format non pris en charge : DWG, DXF, ZIP, HTML, SVG, PDF, JPG ou PNG.'));
    if (kind !== 'zip') return route(file);
    setBusy('Ouverture de l’archive…');
    try {
      const zip = await readZip(file);
      setBusy('');
      // Un seul plan possible dans l'archive : on l'ouvre directement
      const best = zip.candidates.filter(c => c.kind === zip.candidates[0].kind);
      if (zip.candidates.length === 1 || (best.length === 1 && zip.candidates[0].kind !== 'image')) {
        const c = zip.candidates[0];
        return route(zip.files.get(c.path), zip.files, c.path);
      }
      setStep({ zip });
    } catch (e) { setBusy(''); setError(e); }
  };

  // Image ou PDF : seule l'image de fond change ; en reconversion les formes des lots sont conservées
  const saveImage = async (file, kind) => {
    try {
      let upload = file, width, height;
      if (kind === 'pdf') {
        setBusy('Conversion du PDF en image…');
        ({ file: upload, width, height } = await pdfToImage(file));
      } else {
        ({ width, height } = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => reject(new Error('Image illisible.'));
          img.src = URL.createObjectURL(file);
        }));
      }
      setBusy('Envoi…');
      const form = new FormData();
      form.append('files', upload);
      form.append('meta', JSON.stringify([{ width, height, alt: 'Plan de masse' }]));
      const [m] = await api.post('/admin/media', form);
      const plan = planId
        ? await api.patch(`/admin/plans/${planId}`, { media_id: m.id, width, height })
        : await api.post('/admin/plans', { project_id: projectId, name: name || 'Plan de masse', media_id: m.id, width, height });
      toast(planId ? 'Image du plan remplacée — les lots dessinés sont conservés' : 'Plan ajouté — vous pouvez dessiner les lots');
      onDone(plan);
    } catch (e) { setError(e); setBusy(''); }
  };

  if (step?.kind === 'cad') return <CadImport projectId={projectId} planId={planId} initialFile={step.file} onDone={onDone} onCancel={() => setStep(null)} />;
  // PDF : détection des parcelles s'il est vectoriel, sinon (ou au choix) simple image de fond
  if (step?.kind === 'pdf') return <CadImport pdf projectId={projectId} planId={planId} initialFile={step.file} onDone={onDone} onCancel={() => setStep(null)} onUseImage={f => { setStep(null); saveImage(f, 'pdf'); }} />;
  if (step?.kind === 'html') return <HtmlImport projectId={projectId} planId={planId} name={name} step={step} onDone={onDone} onCancel={() => setStep(null)} />;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <ErrorBox error={error} />
      {busy ? <p className="row" style={{ gap: 8 }}><Loader2 className="spin" size={18} />{busy}</p> : step?.zip ? (
        <>
          <p className="small muted">Cette archive contient plusieurs plans possibles : choisissez celui à importer.</p>
          <div className="stack" style={{ gap: 6 }}>
            {step.zip.candidates.map(c => {
              const Icon = KIND_ICON[c.kind];
              return (
                <button key={c.path} className="btn" style={{ justifyContent: 'flex-start', height: 'auto', padding: '10px 12px', textAlign: 'left' }} onClick={() => route(step.zip.files.get(c.path), step.zip.files, c.path)}>
                  <Icon /><span><strong>{c.path}</strong><br /><span className="small muted">{KIND_LABEL[c.kind]} · {(c.size / 1024 / 1024).toFixed(1)} Mo</span></span>
                </button>
              );
            })}
          </div>
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setStep(null)}>← Choisir un autre fichier</button>
        </>
      ) : (
        <>
          {!planId && <Field label="Nom du plan" hint="Ex. : Tranche 1, Îlots A à D…"><input className="input" value={name} onChange={e => setName(e.target.value)} /></Field>}
          <div className={`dropzone dropzone-stack ${over ? 'over' : ''}`} role="button" tabIndex={0}
            onClick={() => input.current.click()} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && input.current.click()}
            onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); e.dataTransfer.files[0] && handle(e.dataTransfer.files[0]); }}>
            <FileUp />
            <strong>Déposez le plan ici ou cliquez pour le choisir</strong>
            <span className="small muted">AutoCAD (DWG, DXF) · ZIP · HTML ou SVG · PDF · JPG, PNG</span>
            <input ref={input} type="file" hidden accept={ACCEPT} onChange={e => { e.target.files[0] && handle(e.target.files[0]); e.target.value = ''; }} />
          </div>
          <ul className="small muted" style={{ paddingLeft: 18, display: 'grid', gap: 4 }}>
            <li><strong>AutoCAD, PDF vectoriel, HTML/SVG ou ZIP</strong> : les parcelles et leurs numéros sont reconnus automatiquement, la carte et les lots sont créés en une fois.</li>
            <li><strong>Image ou PDF scanné</strong> : {planId ? 'remplace seulement l’image de fond ; les lots déjà dessinés restent à leur place (même cadrage conseillé).' : 'les lots se dessinent ensuite à la main dans l’éditeur.'}</li>
            <li><FileArchive size={13} style={{ verticalAlign: '-2px' }} /> Un ZIP peut contenir la page HTML et ses images : elles sont retrouvées automatiquement.</li>
          </ul>
        </>
      )}
    </div>
  );
}

/** Page HTML / SVG : aperçu des lots reconnus puis création de la carte. */
function HtmlImport({ projectId, planId, name, step, onDone, onCancel }) {
  const toast = useToast();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState('Lecture du plan…');
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('disponible');
  const [extra, setExtra] = useState({ on: false, prefix: 'P' });

  useEffect(() => {
    let alive = true;
    parseHtmlPlan(step.file, step.assets, step.path)
      .then(r => { if (alive) { setResult({ ...r, preview: URL.createObjectURL(r.background) }); setExtra(x => ({ ...x, on: !r.parcels.length })); setBusy(''); } })
      .catch(e => { if (alive) { setError(e); setBusy(''); } });
    return () => { alive = false; };
  }, [step]);

  // Formes sans numéro : numérotation provisoire de gauche à droite, de haut en bas
  const unnumbered = useMemo(() => {
    if (!result || !extra.on) return [];
    const prefix = extra.prefix.trim() || 'P';
    const center = s => s.reduce((a, [x, y]) => [a[0] + x / s.length, a[1] + y / s.length], [0, 0]);
    return [...result.others]
      .map(o => ({ ...o, c: center(o.shape) }))
      .sort((a, b) => Math.round(a.c[1] * 40) - Math.round(b.c[1] * 40) || a.c[0] - b.c[0])
      .map((o, i) => ({ code: `${prefix}${String(i + 1).padStart(3, '0')}`, shape: o.shape }));
  }, [result, extra]);

  const create = async () => {
    setError(null);
    try {
      const lots = [...result.parcels, ...unnumbered].map(p => ({ code: String(p.code).slice(0, 40), shape: p.shape.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]), status }));
      const { plan, summary } = await savePlan({ projectId, planId, name, image: result.background, width: result.width, height: result.height, lots, onStep: setBusy });
      toast(`${planId ? 'Plan reconverti' : 'Carte créée'} : ${summaryText(summary)}`);
      onDone(plan);
    } catch (e) { setError(e); setBusy(''); }
  };

  const ratio = result ? result.height / result.width : 1;
  const pts = s => s.map(([x, y]) => `${x * 1000},${y * 1000 * ratio}`).join(' ');
  const total = result ? result.parcels.length + unnumbered.length : 0;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="small muted">{step.path || step.file.name}</div>
      <ErrorBox error={error} />
      {busy && <p className="row" style={{ gap: 8 }}><Loader2 className="spin" size={18} />{busy}</p>}
      {result && !busy && (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Badge tone="ok" dot>{result.parcels.length} lot(s) numéroté(s)</Badge>
            {result.others.length > 0 && <Badge dot>{result.others.length} forme(s) sans numéro</Badge>}
            {result.parcels.some(p => p.duplicate) && <Badge tone="danger" dot>Numéros en double</Badge>}
            <Badge>{result.source === 'imagemap' ? 'Image + zones cliquables' : 'Dessin SVG'}</Badge>
          </div>
          <div className="cad-preview" style={{ position: 'relative', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
            <img src={result.preview} alt="" style={{ width: '100%', display: 'block' }} />
            <svg viewBox={`0 0 1000 ${1000 * ratio}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} role="img" aria-label="Aperçu des lots reconnus">
              {unnumbered.map(p => <polygon key={p.code} points={pts(p.shape)} fill="rgba(11,107,168,.28)" stroke="#0b6ba8" strokeWidth="0.8"><title>{p.code} (provisoire)</title></polygon>)}
              {result.parcels.map(p => <polygon key={p.code} points={pts(p.shape)} fill={p.duplicate ? 'rgba(192,38,45,.45)' : 'rgba(46,158,91,.4)'} stroke={p.duplicate ? '#c0262d' : '#2e9e5b'} strokeWidth="0.8"><title>Lot {p.code}</title></polygon>)}
            </svg>
          </div>
          {result.others.length > 0 && (
            <div className="card" style={{ padding: 12, background: 'var(--surface-2)' }}>
              <label className="checkbox"><input type="checkbox" checked={extra.on} onChange={e => setExtra(x => ({ ...x, on: e.target.checked }))} />Créer aussi les <strong>{result.others.length} formes sans numéro</strong> (numérotation provisoire)</label>
              {extra.on && <Field label="Préfixe des numéros provisoires" hint={`Ex. : ${extra.prefix || 'P'}001, ${extra.prefix || 'P'}002…`}><input className="input" value={extra.prefix} maxLength={6} onChange={e => setExtra(x => ({ ...x, prefix: e.target.value }))} style={{ maxWidth: 160 }} /></Field>}
            </div>
          )}
          <Field label="Statut des nouveaux lots">
            <select className="select" value={status} onChange={e => setStatus(e.target.value)} style={{ maxWidth: 320 }}>
              <option value="disponible">Disponible</option>
              <option value="bloque">Non commercialisé (à ouvrir plus tard)</option>
            </select>
          </Field>
          <p className="small muted">Un lot dont le numéro existe déjà dans le projet garde son statut et son dossier ; il reçoit seulement sa forme.{planId && ' Les lots de ce plan absents du nouveau fichier passent dans « Lots à placer ».'}</p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={onCancel}>← Autre fichier</button>
            <button className="btn btn-primary" disabled={!total} onClick={create}><Check />{planId ? 'Reconvertir le plan' : 'Créer la carte'} ({total} lots)</button>
          </div>
        </>
      )}
      {error && !result && <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={onCancel}>← Autre fichier</button>}
    </div>
  );
}
