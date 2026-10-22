import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, MousePointer2, Pentagon, Square, Hand, ZoomIn, ZoomOut, Maximize, Undo2, Copy, Trash2, Save, Search, Eye, EyeOff, ChevronDown,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast } from '../lib/app-context';
import { Field, ErrorBox, Skeleton, StatusBadge } from '../components/ui';
import { LOT_STATUSES, lotStatus, gridOfferFor } from '../lib/domain';
import { fcfa } from '../lib/format';
import PlanManage from '../components/PlanManage';
import { LotStatusModal, GridHint } from '../components/LotForms';

/* ─── Géométrie (coordonnées relatives 0–1 du plan) ─────────────────────── */
const clamp01 = v => Math.min(1, Math.max(0, v));
const bbox = pts => {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};
const centroid = pts => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) { const b = bbox(pts); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; }
  return [cx / (3 * a), cy / (3 * a)];
};
const round = v => Math.round(v * 1e6) / 1e6;

/** Numéro suivant : A12 → A13 ; sinon le plus grand nombre du projet + 1. */
function nextCode(lots, from) {
  const used = new Set(lots.map(l => l.code));
  const m = from && from.match(/^(.*?)(\d+)$/);
  let prefix = m ? m[1] : '', n = m ? Number(m[2]) : Math.max(0, ...lots.map(l => Number((l.code.match(/(\d+)$/) || [])[1] || 0)));
  let code;
  do { n += 1; code = `${prefix}${n}`; } while (used.has(code));
  return code;
}

let keySeq = 0;
const withKey = l => ({ ...l, key: l.id ? `id-${l.id}` : `new-${++keySeq}` });

export default function PlanEditor() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const plan = useResource(`/admin/plans/${id}`);
  const editable = can('plans:write');
  const navigate = useNavigate();

  const [lots, setLots] = useState([]);
  const [dirty, setDirty] = useState(new Set());
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tool, setTool] = useState('select');
  const [draft, setDraft] = useState([]); // points du polygone en cours
  const [cursor, setCursor] = useState(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [showImage, setShowImage] = useState(true);
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [statusLot, setStatusLot] = useState(null);

  const viewport = useRef(null);
  const stage = useRef(null);
  const drag = useRef(null);
  const spaceDown = useRef(false);

  const W = plan.data?.width || 2000;
  const H = plan.data?.height || 1400;

  useEffect(() => {
    if (!plan.data) return;
    setLots(plan.data.lots.map(withKey));
    setDirty(new Set());
    setHistory([]);
  }, [plan.data]);

  // Ajuste le plan à l'écran
  const fit = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    const s = Math.min(el.clientWidth / W, el.clientHeight / H) * 0.95;
    setView({ s, x: (el.clientWidth - W * s) / 2, y: (el.clientHeight - H * s) / 2 });
  }, [W, H]);
  useEffect(() => { if (plan.data) requestAnimationFrame(fit); }, [plan.data, fit]);

  // Avertit avant de quitter avec des modifications non enregistrées
  useEffect(() => {
    const onBefore = e => { if (dirty.size) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [dirty]);

  /* ─── Modifications avec historique d'annulation ─────────────────────── */
  const commit = useCallback((updater, touchedKeys) => {
    setLots(prev => {
      setHistory(h => [...h.slice(-49), { lots: prev, dirty }]);
      return updater(prev);
    });
    setDirty(d => new Set([...d, ...touchedKeys]));
  }, [dirty]);

  const undo = useCallback(() => {
    setHistory(h => {
      if (!h.length) return h;
      const last = h[h.length - 1];
      setLots(last.lots);
      setDirty(last.dirty);
      return h.slice(0, -1);
    });
  }, []);

  const updateLot = (key, patch) => commit(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)), [key]);

  const selectedLot = lots.find(l => l.key === selected);

  /** Termine un dessin : l'attribue au lot sélectionné s'il n'est pas placé, sinon crée un lot. */
  const finishShape = pts => {
    const shape = pts.map(([x, y]) => [round(clamp01(x)), round(clamp01(y))]);
    setDraft([]);
    if (selectedLot && !selectedLot.shape) {
      updateLot(selectedLot.key, { shape, plan_id: Number(id) });
      return;
    }
    const last = selectedLot || lots[lots.length - 1];
    const lot = withKey({ code: nextCode(lots, last?.code), ilot: last?.ilot || '', status: 'disponible', shape, plan_id: Number(id), offer_id: last?.offer_id || null, price_fcfa: last?.price_fcfa ?? null, surface_m2: last?.surface_m2 ?? null });
    commit(prev => [...prev, lot], [lot.key]);
    setSelected(lot.key);
  };

  const duplicate = () => {
    if (!selectedLot?.shape) return;
    const b = bbox(selectedLot.shape);
    const dx = (b.x1 - b.x0) * 1.0;
    if (b.x1 + dx > 1) return toast('Pas assez de place à droite pour dupliquer.', 'err');
    const lot = withKey({ ...selectedLot, id: undefined, status: 'disponible', code: nextCode(lots, selectedLot.code), shape: selectedLot.shape.map(([x, y]) => [round(x + dx), y]) });
    delete lot.id;
    commit(prev => [...prev, lot], [lot.key]);
    setSelected(lot.key);
  };

  const removeFromPlan = () => {
    if (!selectedLot) return;
    if (!selectedLot.id) {
      commit(prev => prev.filter(l => l.key !== selectedLot.key), []);
      setDirty(d => { const n = new Set(d); n.delete(selectedLot.key); return n; });
      setSelected(null);
    } else {
      updateLot(selectedLot.key, { shape: null, plan_id: null });
    }
  };

  const deleteLot = async () => {
    if (!selectedLot?.id) return removeFromPlan();
    if (!window.confirm(`Supprimer définitivement le lot ${selectedLot.code} ?`)) return;
    try {
      await api.del(`/admin/lots/${selectedLot.id}`);
      setLots(prev => prev.filter(l => l.key !== selectedLot.key));
      setSelected(null);
      toast(`Lot ${selectedLot.code} supprimé`);
    } catch (e) { toast(e.message, 'err'); }
  };

  /* ─── Enregistrement ─────────────────────────────────────────────────── */
  const save = async () => {
    const codes = lots.map(l => l.code.trim());
    const dup = codes.find((c, i) => codes.indexOf(c) !== i);
    if (dup) return setError(new Error(`Le numéro de lot « ${dup} » est utilisé deux fois.`));
    if (codes.some(c => !c)) return setError(new Error('Chaque lot doit avoir un numéro.'));
    setSaving(true);
    setError(null);
    const payload = l => ({
      code: l.code.trim(), ilot: l.ilot || null, plan_id: l.shape ? Number(id) : null, offer_id: l.offer_id || null,
      surface_m2: l.surface_m2 === '' || l.surface_m2 == null ? null : Number(l.surface_m2),
      price_fcfa: l.price_fcfa === '' || l.price_fcfa == null ? null : Math.round(Number(l.price_fcfa)),
      shape: l.shape || null,
    });
    try {
      const changed = lots.filter(l => dirty.has(l.key));
      for (const l of changed.filter(l => l.id)) await api.patch(`/admin/lots/${l.id}`, payload(l));
      const created = changed.filter(l => !l.id);
      if (created.length) await api.put(`/admin/projects/${plan.data.project.id}/lots`, created.map(payload));
      toast(`${changed.length} lot(s) enregistré(s)`);
      await plan.reload();
    } catch (e) { setError(e); } finally { setSaving(false); }
  };

  const togglePublish = async () => {
    try {
      await api.patch(`/admin/plans/${id}`, { published: !plan.data.published });
      toast(plan.data.published ? 'Plan retiré du site' : 'Plan publié sur le site');
      plan.reload();
    } catch (e) { toast(e.message, 'err'); }
  };

  /* ─── Souris : conversion écran → plan ───────────────────────────────── */
  const toPlan = e => {
    const r = stage.current.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  const onWheel = e => {
    e.preventDefault();
    const r = viewport.current.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    setView(v => {
      const s = Math.min(20, Math.max(0.05, v.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      return { s, x: mx - (mx - v.x) * (s / v.s), y: my - (my - v.y) * (s / v.s) };
    });
  };
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const zoomBy = f => {
    const el = viewport.current;
    const mx = el.clientWidth / 2, my = el.clientHeight / 2;
    setView(v => { const s = Math.min(20, Math.max(0.05, v.s * f)); return { s, x: mx - (mx - v.x) * (s / v.s), y: my - (my - v.y) * (s / v.s) }; });
  };

  const onPointerDown = e => {
    if (!plan.data) return;
    const p = toPlan(e);
    const panning = tool === 'pan' || e.button === 1 || spaceDown.current;
    if (panning) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, v: view };
    } else if (tool === 'rect' && editable) {
      drag.current = { kind: 'rect', start: p };
      setDraft([p, p, p, p]);
    } else if (tool === 'polygon' && editable) {
      if (draft.length >= 3) {
        const [fx, fy] = draft[0];
        const r = stage.current.getBoundingClientRect();
        if (Math.hypot((p[0] - fx) * r.width, (p[1] - fy) * r.height) < 12) return finishShape(draft);
      }
      setDraft(d => [...d, p]);
      return;
    } else {
      // Outil sélection : clic dans le vide = désélectionner et déplacer la vue
      setSelected(null);
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, v: view };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = e => {
    if (!plan.data) return;
    const p = toPlan(e);
    setCursor(p);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setView({ ...d.v, x: d.v.x + e.clientX - d.sx, y: d.v.y + e.clientY - d.sy });
    } else if (d.kind === 'rect') {
      const [x0, y0] = d.start;
      setDraft([[x0, y0], [p[0], y0], p, [x0, p[1]]]);
    } else if (d.kind === 'vertex' || d.kind === 'move') {
      const dx = p[0] - d.start[0], dy = p[1] - d.start[1];
      setLots(prev => prev.map(l => {
        if (l.key !== d.key) return l;
        const shape = d.kind === 'vertex'
          ? d.shape.map((pt, i) => (i === d.index ? [round(clamp01(p[0])), round(clamp01(p[1]))] : pt))
          : d.shape.map(([x, y]) => [round(clamp01(x + dx)), round(clamp01(y + dy))]);
        return { ...l, shape };
      }));
      d.moved = true;
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'rect') {
      const b = bbox(draft);
      const r = stage.current.getBoundingClientRect();
      if ((b.x1 - b.x0) * r.width > 6 && (b.y1 - b.y0) * r.height > 6) finishShape(draft);
      else setDraft([]);
    } else if ((d.kind === 'vertex' || d.kind === 'move') && d.moved) {
      // Inscrit le déplacement dans l'historique d'annulation
      setHistory(h => [...h.slice(-49), { lots: d.before, dirty }]);
      setDirty(s => new Set([...s, d.key]));
    }
  };

  const startShapeDrag = (e, lot, kind, index) => {
    if (!editable || tool !== 'select' || spaceDown.current) return;
    e.stopPropagation();
    setSelected(lot.key);
    if (!lot.shape) return;
    drag.current = { kind, key: lot.key, index, start: toPlan(e), shape: lot.shape, before: lots };
    viewport.current.setPointerCapture(e.pointerId);
  };

  const insertVertex = (e, lot, i) => {
    if (!editable) return;
    e.stopPropagation();
    const a = lot.shape[i], b = lot.shape[(i + 1) % lot.shape.length];
    const mid = [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)];
    const shape = [...lot.shape.slice(0, i + 1), mid, ...lot.shape.slice(i + 1)];
    updateLot(lot.key, { shape });
  };

  const removeVertex = (e, lot, i) => {
    if (!editable || !e.altKey || lot.shape.length <= 3) return false;
    e.stopPropagation();
    updateLot(lot.key, { shape: lot.shape.filter((_, j) => j !== i) });
    return true;
  };

  /* ─── Clavier ────────────────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = e => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === ' ') { spaceDown.current = e.type === 'keydown'; e.preventDefault(); return; }
      if (e.type !== 'keydown') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty.size) save(); }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
      else if (e.key === 'Escape') { setDraft([]); setSelected(null); }
      else if (e.key === 'Enter' && tool === 'polygon' && draft.length >= 3) finishShape(draft);
      else if (e.key === 'Backspace' && tool === 'polygon' && draft.length) setDraft(d => d.slice(0, -1));
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLot && editable) removeFromPlan();
      else if (e.key === 'v') setTool('select');
      else if (e.key === 'p') setTool('polygon');
      else if (e.key === 'r') setTool('rect');
      else if (e.key === 'h') setTool('pan');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); };
  });

  const placed = lots.filter(l => l.shape);
  const unplaced = lots.filter(l => !l.shape);
  const filtered = useMemo(() => lots.filter(l => !q || `${l.code} ${l.ilot || ''}`.toLowerCase().includes(q.toLowerCase())), [lots, q]);

  if (plan.loading && !plan.data) return <Skeleton h={500} />;
  if (plan.error) return <ErrorBox error={plan.error} />;
  if (!plan.data.image) return <ErrorBox error={new Error('Ce plan n’a pas d’image. Ajoutez une image ou un PDF depuis la fiche du projet.')} />;

  const px = 1 / view.s; // 1 pixel écran en unités du plan
  const TOOLS = [
    { id: 'select', icon: MousePointer2, label: 'Sélectionner / déplacer (V)' },
    { id: 'polygon', icon: Pentagon, label: 'Dessiner un polygone (P)' },
    { id: 'rect', icon: Square, label: 'Dessiner un rectangle (R)' },
    { id: 'pan', icon: Hand, label: 'Déplacer la vue (H ou Espace)' },
  ];

  return (
    <div className="plan-editor">
      <div className="row-between">
        <div className="row">
          <Link to={`/projets/${plan.data.project.id}`} className="btn btn-ghost"><ArrowLeft />{plan.data.project.name}</Link>
          <strong>{plan.data.name}</strong>
          <span className="small muted tabular">{placed.length} lots placés · {unplaced.length} à placer</span>
        </div>
        <div className="row">
          {plan.data.archived_at && <span className="badge">Archivé</span>}
          {editable && !plan.data.archived_at && <button className="btn" onClick={togglePublish}>{plan.data.published ? <><EyeOff />Retirer du site</> : <><Eye />Publier sur le site</>}</button>}
          {editable && <PlanManage plan={plan.data} projectId={plan.data.project.id}
            onChanged={() => { if (dirty.size && !window.confirm('Des modifications ne sont pas enregistrées : recharger le plan quand même ?')) return; setDirty(new Set()); plan.reload(); }}
            onDeleted={() => navigate(`/projets/${plan.data.project.id}`)} />}
          {editable && <button className="btn btn-primary" disabled={!dirty.size || saving} onClick={save}><Save />{saving ? 'Enregistrement…' : `Enregistrer${dirty.size ? ` (${dirty.size})` : ''}`}</button>}
        </div>
      </div>
      <ErrorBox error={error} />

      <div className="plan-layout">
        <div className="plan-canvas card">
          <div className="plan-toolbar" role="toolbar" aria-label="Outils">
            {TOOLS.filter(t => editable || t.id === 'select' || t.id === 'pan').map(t => (
              <button key={t.id} className={`btn btn-icon btn-sm ${tool === t.id ? 'tool-active' : 'btn-ghost'}`} onClick={() => { setTool(t.id); setDraft([]); }} title={t.label} aria-label={t.label} aria-pressed={tool === t.id}><t.icon /></button>
            ))}
            <span className="tb-sep" />
            {editable && <button className="btn btn-icon btn-sm btn-ghost" onClick={undo} disabled={!history.length} title="Annuler (Ctrl+Z)" aria-label="Annuler"><Undo2 /></button>}
            {editable && <button className="btn btn-icon btn-sm btn-ghost" onClick={duplicate} disabled={!selectedLot?.shape} title="Dupliquer à droite (Ctrl+D)" aria-label="Dupliquer"><Copy /></button>}
            <span className="tb-sep" />
            <button className="btn btn-icon btn-sm btn-ghost" onClick={() => zoomBy(1.3)} title="Zoom avant" aria-label="Zoom avant"><ZoomIn /></button>
            <button className="btn btn-icon btn-sm btn-ghost" onClick={() => zoomBy(1 / 1.3)} title="Zoom arrière" aria-label="Zoom arrière"><ZoomOut /></button>
            <button className="btn btn-icon btn-sm btn-ghost" onClick={fit} title="Ajuster à l’écran" aria-label="Ajuster à l’écran"><Maximize /></button>
            <label className="checkbox small" style={{ marginLeft: 8 }}><input type="checkbox" checked={showImage} onChange={e => setShowImage(e.target.checked)} />Image du plan</label>
          </div>

          <div
            ref={viewport}
            className={`plan-viewport tool-${tool}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setCursor(null)}
            onDoubleClick={() => tool === 'polygon' && draft.length >= 3 && finishShape(draft)}
          >
            <div ref={stage} className="plan-stage" style={{ width: W, height: H, transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>
              {showImage && <img src={plan.data.image} alt="" draggable="false" width={W} height={H} />}
              <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
                {placed.map(l => {
                  const pts = l.shape.map(([x, y]) => `${x * W},${y * H}`).join(' ');
                  const isSel = l.key === selected;
                  const st = lotStatus(l.status);
                  const [cx, cy] = centroid(l.shape);
                  const b = bbox(l.shape);
                  const showLabel = (b.x1 - b.x0) * W * view.s > 22;
                  return (
                    <g key={l.key}>
                      <polygon
                        points={pts}
                        fill={st.color} fillOpacity={isSel ? 0.55 : 0.35}
                        stroke={isSel ? '#111' : st.color} strokeWidth={(isSel ? 2.5 : 1.5) * px} strokeLinejoin="round"
                        style={{ cursor: tool === 'select' ? (isSel ? 'move' : 'pointer') : undefined }}
                        onPointerDown={e => startShapeDrag(e, l, 'move')}
                      >
                        <title>{`Lot ${l.code} — ${st.label}`}</title>
                      </polygon>
                      {showLabel && (
                        <text x={cx * W} y={cy * H} fontSize={11 * px} textAnchor="middle" dominantBaseline="central" className="lot-label" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 * px }}>{l.code}</text>
                      )}
                      {isSel && editable && tool === 'select' && l.shape.map((pt, i) => {
                        const nx = l.shape[(i + 1) % l.shape.length];
                        return (
                          <g key={i}>
                            <circle cx={((pt[0] + nx[0]) / 2) * W} cy={((pt[1] + nx[1]) / 2) * H} r={4 * px} className="mid-handle" onPointerDown={e => insertVertex(e, l, i)}><title>Ajouter un sommet</title></circle>
                            <circle cx={pt[0] * W} cy={pt[1] * H} r={6 * px} className="handle" onPointerDown={e => { if (!removeVertex(e, l, i)) startShapeDrag(e, l, 'vertex', i); }}><title>Glisser pour déplacer — Alt+clic pour supprimer</title></circle>
                          </g>
                        );
                      })}
                    </g>
                  );
                })}
                {draft.length > 0 && (
                  <g className="draft">
                    <polyline points={[...draft, ...(tool === 'polygon' && cursor ? [cursor] : [])].map(([x, y]) => `${x * W},${y * H}`).join(' ')} fill="rgba(210,16,30,.12)" stroke="var(--brand)" strokeWidth={2 * px} strokeDasharray={`${6 * px} ${4 * px}`} />
                    {tool === 'polygon' && draft.map(([x, y], i) => <circle key={i} cx={x * W} cy={y * H} r={(i === 0 ? 7 : 4) * px} fill={i === 0 ? '#fff' : 'var(--brand)'} stroke="var(--brand)" strokeWidth={2 * px} />)}
                  </g>
                )}
              </svg>
            </div>
            <div className="plan-hint small">
              {tool === 'polygon' ? (draft.length ? 'Cliquez pour ajouter des sommets · clic sur le 1er point, double-clic ou Entrée pour fermer · Retour arrière pour annuler un point' : 'Cliquez sur chaque coin du lot')
                : tool === 'rect' ? 'Cliquez-glissez pour dessiner un lot rectangulaire'
                : 'Molette : zoom · glisser dans le vide : déplacer la vue · Suppr : retirer le lot du plan'}
            </div>
          </div>
          <div className="legend" style={{ padding: '10px 14px', marginTop: 0, borderTop: '1px solid var(--border)' }}>
            {LOT_STATUSES.map(s => <span key={s.id} className="legend-item"><i style={{ background: s.color }} />{s.label}</span>)}
          </div>
        </div>

        <aside className="plan-side">
          {selectedLot ? (
            <LotPanel lot={selectedLot} offers={plan.data.offers} editable={editable} canStatus={can('lots:status')} onStatus={() => setStatusLot(selectedLot)}
              onChange={patch => updateLot(selectedLot.key, patch)} onRemove={removeFromPlan} onDelete={deleteLot} onClose={() => setSelected(null)} />
          ) : (
            <div className="card card-body small muted">
              Sélectionnez un lot sur le plan ou dans la liste.<br />
              Pour placer un lot importé, choisissez-le dans « À placer » puis dessinez-le.
            </div>
          )}
          <div className="card">
            <div className="card-head" style={{ padding: '10px 14px' }}>
              <div className="search" style={{ minWidth: 0, flex: 1 }}><Search aria-hidden="true" /><input className="input" style={{ height: 34 }} placeholder="Chercher un lot" value={q} onChange={e => setQ(e.target.value)} aria-label="Chercher un lot" /></div>
            </div>
            <div className="lot-list">
              {unplaced.length > 0 && <div className="lot-list-title">À placer ({unplaced.length})</div>}
              {filtered.filter(l => !l.shape).map(l => <LotRow key={l.key} l={l} active={l.key === selected} dirty={dirty.has(l.key)} onClick={() => { setSelected(l.key); if (editable) setTool('polygon'); }} />)}
              <div className="lot-list-title">Placés ({placed.length})</div>
              {filtered.filter(l => l.shape).map(l => <LotRow key={l.key} l={l} active={l.key === selected} dirty={dirty.has(l.key)} onClick={() => { setSelected(l.key); setTool('select'); }} />)}
            </div>
          </div>
        </aside>
      </div>
      {/* Le statut est enregistré tout de suite (avec son historique), hors du bouton « Enregistrer » */}
      {statusLot && <LotStatusModal lot={statusLot} onClose={() => setStatusLot(null)}
        onDone={to => {
          // Aussi dans l'historique : « Annuler » ne doit pas faire réapparaître l'ancien statut
          const withStatus = list => list.map(l => (l.key === statusLot.key ? { ...l, status: to } : l));
          setLots(withStatus);
          setHistory(h => h.map(e => ({ ...e, lots: withStatus(e.lots) })));
          setStatusLot(null);
        }} />}
    </div>
  );
}

const LotRow = ({ l, active, dirty, onClick }) => (
  <button className={`lot-row ${active ? 'active' : ''}`} onClick={onClick}>
    <i style={{ background: lotStatus(l.status).color }} aria-hidden="true" />
    <strong>{l.code}</strong>
    <span className="muted">{l.ilot ? `îlot ${l.ilot}` : ''}</span>
    {dirty && <span className="dirty-dot" title="Modifié, non enregistré" aria-label="non enregistré" />}
  </button>
);

function LotPanel({ lot, offers, editable, canStatus, onStatus, onChange, onRemove, onDelete, onClose }) {
  const set = k => e => onChange({ [k]: e.target.value });
  // Grille de prix : la surface désigne la ligne ; le prix suit tant qu'il n'a pas été saisi à la main
  const grid = gridOfferFor(offers, lot.surface_m2, lot.offer_id);
  const setSurface = e => {
    const before = gridOfferFor(offers, lot.surface_m2, lot.offer_id);
    const hit = gridOfferFor(offers, e.target.value, lot.offer_id);
    const followsGrid = lot.price_fcfa == null || lot.price_fcfa === '' || (before && Number(lot.price_fcfa) === Number(before.price_fcfa));
    // Prix venu de la grille et plus de ligne pour la nouvelle surface : on le vide plutôt que d'afficher un prix faux
    const next = !followsGrid ? {} : hit ? { price_fcfa: hit.price_fcfa, offer_id: hit.id } : before ? { price_fcfa: '' } : {};
    onChange({ surface_m2: e.target.value, ...next });
  };
  const pickOffer = e => {
    const offer = offers.find(o => String(o.id) === e.target.value);
    onChange({ offer_id: offer ? offer.id : null, ...(offer && (lot.price_fcfa == null || lot.price_fcfa === '') ? { price_fcfa: offer.price_fcfa } : {}) });
  };
  return (
    <div className="card">
      <div className="card-head" style={{ padding: '12px 16px' }}>
        <h2>Lot {lot.code || '—'}</h2>
        <div className="spacer" />
        {canStatus && lot.id ? (
          <button type="button" className="btn btn-ghost btn-sm" style={{ paddingInline: 6 }} onClick={onStatus} title="Changer le statut" aria-label={`Statut : ${lotStatus(lot.status).label} — changer`}>
            <StatusBadge status={lot.status} /><ChevronDown aria-hidden="true" />
          </button>
        ) : <StatusBadge status={lot.status} />}
      </div>
      <fieldset disabled={!editable} className="card-body stack" style={{ gap: 12, border: 'none' }}>
        <div className="form-grid" style={{ gap: 12 }}>
          <Field label="N° de lot"><input className="input" value={lot.code} onChange={set('code')} /></Field>
          <Field label="Îlot"><input className="input" value={lot.ilot || ''} onChange={set('ilot')} /></Field>
          <Field label="Type de bien" className="full" hint={!offers.length ? 'Aucune ligne dans la grille de prix du projet : remplissez-la dans la fiche projet pour choisir le type.' : undefined}>
            <select className="select" value={lot.offer_id || ''} onChange={pickOffer}>
              <option value="">Non précisé</option>
              {offers.map(o => <option key={o.id} value={o.id}>{[o.label, o.surface && (/m/.test(o.surface) ? o.surface : `${o.surface} m²`), o.price_fcfa && fcfa(o.price_fcfa)].filter(Boolean).join(' · ')}</option>)}
            </select>
          </Field>
          <Field label="Surface (m²)"><input className="input tabular" inputMode="decimal" value={lot.surface_m2 ?? ''} onChange={setSurface} /></Field>
          <Field label="Prix (FCFA)" hint={lot.price_fcfa ? fcfa(lot.price_fcfa) : undefined}><input className="input tabular" inputMode="numeric" value={lot.price_fcfa ?? ''} placeholder={grid ? String(grid.price_fcfa) : undefined} onChange={set('price_fcfa')} /></Field>
          <GridHint grid={grid} lot={lot} hasGrid={offers.length > 0} onApply={() => onChange({ price_fcfa: grid.price_fcfa, offer_id: grid.id })} />
        </div>
        {canStatus && !lot.id && <p className="small muted">Enregistrez ce nouveau lot pour pouvoir changer son statut.</p>}
        {editable && (
          <div className="row">
            {lot.shape && <button type="button" className="btn btn-sm" onClick={onRemove}>Retirer du plan</button>}
            <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={onDelete}><Trash2 />Supprimer le lot</button>
            <div style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>Fermer</button>
          </div>
        )}
      </fieldset>
    </div>
  );
}
