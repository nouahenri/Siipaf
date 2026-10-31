/**
 * ERP · QHSE : adresse de l'API, teintes, notes (Mauvais / Passable / Bon / Très bon), pourcentages, tendances, listes de points
 * de contrôle, photos. Les libellés et les grilles viennent du serveur (QHSE › refs) : rien n'est dupliqué ici.
 */
import { useRef, useState } from 'react';
import { Camera, X, TrendingUp, TrendingDown, Minus, FileText } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useResource, useToast } from '@admin/lib/app-context';
import { Badge } from '@admin/components/ui';

export const QH = '/admin/erp/qhse';
export const useQhseRefs = () => useResource(`${QH}/refs`).data;

export const PILLAR_ORDER = ['qualite', 'hygiene', 'securite', 'environnement'];
export const RATING_TONE = { 1: 'danger', 2: 'warn', 3: 'ok', 4: 'ok' };
export const CONTROL_TONES = { saisi: 'ok', brouillon: '', a_valider: 'warn', valide: 'ok' };
export const AUDIT_TONES = { planifie: '', en_cours: 'brand', a_valider: 'warn', valide: 'ok', annule: '' };
export const ACTION_TONES = { ouverte: 'warn', en_cours: 'brand', levee: 'ok', annulee: '' };
export const GRAVITY_TONES = { mineure: '', majeure: 'warn', critique: 'danger' };

export const frDay = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
export const fmt1 = n => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const body = (f, numbers = []) => {
  const out = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]));
  for (const k of numbers) out[k] = out[k] == null ? null : Number(out[k]);
  return out;
};

/** Note d'un volet : « Bon » (entier) ou « 3,2 · Bon » (moyenne). */
export function RatingBadge({ value, labels, avg = false }) {
  if (value == null) return <span className="muted">—</span>;
  const r = Math.min(4, Math.max(1, Math.round(Number(value))));
  return <Badge tone={RATING_TONE[r]}>{avg ? `${fmt1(value)} · ` : ''}{labels?.[r] || r}</Badge>;
}

/** Pourcentage coloré selon le seuil de sécurité (vert au seuil, orange à 10 points, rouge en dessous). */
export function PctBadge({ value, threshold = 90 }) {
  if (value == null) return <span className="muted">—</span>;
  const v = Number(value);
  return <Badge tone={v >= threshold ? 'ok' : v >= threshold - 10 ? 'warn' : 'danger'}>{Math.round(v).toLocaleString('fr-FR')} %</Badge>;
}

/** Tendance (écart avec la période précédente) : flèche et valeur ; plus haut est toujours meilleur. */
export function Trend({ value, unit = '' }) {
  if (value == null) return <span className="small muted">—</span>;
  if (Math.abs(value) < 0.05) return <span className="small muted row" style={{ gap: 3 }}><Minus size={14} aria-hidden="true" />stable</span>;
  const up = value > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return <span className="small row" style={{ gap: 3, color: up ? 'var(--ok)' : 'var(--danger)' }}><Icon size={14} aria-hidden="true" />{up ? '+' : ''}{fmt1(value)}{unit}</span>;
}

/** Quatre gros boutons Mauvais / Passable / Bon / Très bon (utilisables au pouce sur téléphone). */
export function RatingPicker({ value, onChange, labels, size = 'big', name = 'Note', disabled = false }) {
  return (
    <div className={`qhse-rate ${size}`} role="radiogroup" aria-label={name}>
      {[1, 2, 3, 4].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n} disabled={disabled} data-r={n} className={value === n ? 'on' : ''} onClick={() => onChange(value === n ? null : n)}>
          {labels[n]}
        </button>
      ))}
    </div>
  );
}

/** Conforme / Non conforme / Sans objet. */
export function AnswerPicker({ value, onChange, labels, name = 'Réponse', disabled = false }) {
  return (
    <div className="qhse-rate small" role="radiogroup" aria-label={name}>
      {['conforme', 'non_conforme', 'sans_objet'].map(k => (
        <button key={k} type="button" role="radio" aria-checked={value === k} disabled={disabled} data-a={k} className={value === k ? 'on' : ''} onClick={() => onChange(value === k ? null : k)}>
          {labels[k]}
        </button>
      ))}
    </div>
  );
}

// ─── Points de contrôle d'un volet ────────────────────────────────────────

/** État des points : { clé: { checkpoint_id, pillar, label, rating, answer, remark } } depuis les points enregistrés. */
export function itemsState(saved = []) {
  return Object.fromEntries(saved.map((i, n) => [i.checkpoint_id ? `c${i.checkpoint_id}` : `x${n}`, {
    checkpoint_id: i.checkpoint_id, pillar: i.pillar, label: i.label, rating: i.rating, answer: i.answer, remark: i.remark || '',
  }]));
}
/** Points répondus, au format attendu par le serveur. */
export function itemsPayload(state) {
  return Object.values(state).filter(i => i.rating || i.answer).map(i => ({
    checkpoint_id: i.checkpoint_id || null, pillar: i.pillar, label: i.checkpoint_id ? undefined : i.label, rating: i.rating || null, answer: i.answer || null, remark: i.remark || null,
  }));
}
/** Moyenne arrondie des notes saisies d'un volet (la note globale proposée), ou null. */
export function meanOf(state, pillar) {
  const v = Object.values(state).filter(i => i.pillar === pillar && i.rating).map(i => i.rating);
  return v.length ? Math.min(4, Math.max(1, Math.round(v.reduce((a, b) => a + b, 0) / v.length))) : null;
}
/** Taux de conformité (sans objet exclu) des points d'un volet, ou null. */
export function conformityOf(state, pillar) {
  const v = Object.values(state).filter(i => i.pillar === pillar && (i.answer === 'conforme' || i.answer === 'non_conforme'));
  return v.length ? Math.round((v.filter(i => i.answer === 'conforme').length / v.length) * 100) : null;
}

/** Liste des points d'un volet : les points de la grille actuelle, puis ceux d'anciens contrôles qui n'y figurent plus. */
export function Checklist({ pillar, refs, state, setState, disabled = false }) {
  const note = refs.pillars[pillar].scale === 'note';
  const grid = refs.checkpoints.filter(c => c.pillar === pillar);
  const extras = Object.entries(state).filter(([k, i]) => i.pillar === pillar && !grid.some(c => `c${c.id}` === k));
  const rows = [...grid.map(c => [`c${c.id}`, c.id, c.label]), ...extras.map(([k, i]) => [k, i.checkpoint_id, i.label])];
  const set = (key, id, label, patch) => setState(s => ({ ...s, [key]: { checkpoint_id: id, pillar, label, rating: null, answer: null, remark: '', ...s[key], ...patch } }));
  if (!rows.length) return <p className="small muted" style={{ margin: 0 }}>Aucun point de contrôle dans la grille de ce volet (QHSE › Réglages).</p>;
  return (
    <ul className="qhse-points">
      {rows.map(([key, id, label]) => {
        const cur = state[key] || {};
        return (
          <li key={key}>
            <span className="qhse-point-label">{label}</span>
            {note
              ? <RatingPicker size="small" labels={refs.ratings} value={cur.rating || null} disabled={disabled} name={label} onChange={rating => set(key, id, label, { rating })} />
              : <AnswerPicker labels={refs.answers} value={cur.answer || null} disabled={disabled} name={label} onChange={answer => set(key, id, label, { answer })} />}
          </li>
        );
      })}
    </ul>
  );
}

// ─── Photos ───────────────────────────────────────────────────────────────

export function FileThumbs({ files, onRemove }) {
  if (!files?.length) return null;
  return (
    <div className="thumbs">
      {files.map(f => (
        <div key={f.id} className="thumb">
          <a href={f.url} target="_blank" rel="noreferrer" title={f.name || 'Photo'} style={{ display: 'contents' }}>
            {f.image ? <img src={f.url} alt={f.name || 'Photo jointe'} loading="lazy" /> : <FileText aria-label={f.name || 'Document'} />}
          </a>
          {onRemove && <button type="button" className="thumb-del" onClick={() => onRemove(f)} aria-label="Retirer la photo"><X /></button>}
        </div>
      ))}
    </div>
  );
}

/** Choix de photos avant l'enregistrement (envoyées ensuite avec `uploadFiles`). */
export function PendingPhotos({ files, setFiles }) {
  const input = useRef(null);
  return (
    <div className="thumbs">
      {files.map((f, i) => (
        <div key={`${f.name}-${i}`} className="thumb">
          <img src={URL.createObjectURL(f)} alt={f.name} onLoad={e => URL.revokeObjectURL(e.target.src)} />
          <button type="button" className="thumb-del" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Retirer la photo"><X /></button>
        </div>
      ))}
      {files.length < 8 && (
        <button type="button" className="thumb thumb-add" onClick={() => input.current?.click()}><Camera aria-hidden="true" /><span>Photo</span></button>
      )}
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => { setFiles([...files, ...e.target.files].slice(0, 8)); e.target.value = ''; }} />
    </div>
  );
}

/** Envoie les photos d'un élément (contrôle, audit, constat, action) ; `purpose: 'preuve'` pour la preuve de levée d'une action. */
export async function uploadFiles(kind, id, files, purpose = 'photo') {
  if (!files.length) return [];
  const form = new FormData();
  files.forEach(f => form.append('photos', f));
  form.append('purpose', purpose);
  return api.post(`${QH}/files/${kind}/${id}`, form);
}

/** Photos d'un élément existant : ajout et retrait immédiats. */
export function PhotoBlock({ kind, id, files, onChange, writable, purpose = 'photo', label = 'Ajouter des photos' }) {
  const toast = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const add = async list => {
    setBusy(true);
    try { onChange(await uploadFiles(kind, id, [...list], purpose)); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const remove = async f => {
    try { onChange(await api.del(`${QH}/files/${f.id}`)); } catch (e) { toast(e.message, 'err'); }
  };
  const shown = purpose === 'preuve' ? files.filter(f => f.purpose === 'preuve') : files.filter(f => f.purpose !== 'preuve');
  return (
    <div className="stack" style={{ gap: 8 }}>
      <FileThumbs files={shown} onRemove={writable ? remove : null} />
      {!shown.length && !writable && <span className="small muted">Aucune photo.</span>}
      {writable && (
        <div>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}><Camera />{busy ? 'Envoi…' : label}</button>
          <input ref={input} type="file" accept={purpose === 'preuve' ? 'image/*,application/pdf' : 'image/*'} multiple hidden onChange={e => add(e.target.files)} />
        </div>
      )}
    </div>
  );
}
