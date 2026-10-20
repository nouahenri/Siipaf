import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, FilePlus2, CheckCircle2, RotateCcw, ClipboardList, Plus } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field, Badge } from '@admin/components/ui';
import { date } from '@admin/lib/format';
import { useSavMeta } from '../../components/SavBits';
import { PhotoPicker, Thumbs } from '../../components/Photos';
import { SalePicker } from './NewTicket';

export default function Reserves() {
  const { can } = useAuth();
  const toast = useToast();
  const meta = useSavMeta();
  const [status, setStatus] = useState('ouverte');
  const [projectId, setProjectId] = useState('');
  const [pv, setPv] = useState(false);
  const list = useResource(`/admin/erp/sav/reserves?status=${status}${projectId ? `&project_id=${projectId}` : ''}`);
  const write = can('sav:write');

  const act = async (fn, msg) => {
    try { await fn(); toast(msg); list.reload(); } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <div className="seg" role="group" aria-label="Statut des réserves">
            {[['ouverte', 'À lever'], ['levee', 'Levées'], ['', 'Toutes']].map(([v, l]) => (
              <button key={v} className={status === v ? 'active' : ''} aria-pressed={status === v} onClick={() => setStatus(v)}>{l}</button>
            ))}
          </div>
          <select className="select" style={{ width: 'auto' }} value={projectId} onChange={e => setProjectId(e.target.value)} aria-label="Programme">
            <option value="">Tous les programmes</option>
            {meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {write && <button className="btn btn-primary" onClick={() => setPv(true)}><FilePlus2 />Procès-verbal de livraison</button>}
      </div>
      <ErrorBox error={list.error} />
      <Card bodyClass="">
        {!list.data ? <div className="card-body"><Skeleton h={200} /></div> : !list.data.length ? (
          <div className="card-body"><Empty icon={ClipboardCheck}>{status === 'ouverte' ? 'Aucune réserve à lever.' : 'Aucune réserve.'}</Empty></div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Réserve</th><th>Client · lot</th><th>Relevée le</th><th>À lever avant</th><th>Statut</th><th /></tr></thead>
            <tbody>
              {list.data.map(r => (
                <tr key={r.id}>
                  <td style={{ minWidth: 220 }}><b>{r.label}</b><div className="muted small">{[r.location, meta?.categories[r.category]].filter(Boolean).join(' · ') || '—'}</div></td>
                  <td>{r.client_name}<div className="muted small">{r.project_name}{r.lot_code ? ` · lot ${r.lot_code}` : ''}</div></td>
                  <td className="small nowrap">{date(r.noted_at)}</td>
                  <td className="small nowrap">{r.deadline ? date(r.deadline) : '—'} {r.late && <Badge tone="danger">dépassé</Badge>}</td>
                  <td>{r.status === 'levee' ? <Badge tone="ok">Levée {r.lifted_at ? `le ${date(r.lifted_at)}` : ''}</Badge> : <Badge tone="warn">À lever</Badge>}</td>
                  <td className="nowrap right">
                    {r.ticket_id && <Link className="btn btn-sm btn-ghost" to={`/sav/reclamations?t=${r.ticket_id}`}><ClipboardList />Réclamation</Link>}
                    {write && !r.ticket_id && r.status === 'ouverte' && (
                      <button className="btn btn-sm btn-ghost" onClick={() => act(() => api.post(`/admin/erp/sav/reserves/${r.id}/ticket`), 'Réclamation ouverte pour suivre la réserve')}><Plus />Suivre</button>
                    )}
                    {write && (r.status === 'ouverte'
                      ? <button className="btn btn-sm" onClick={() => act(() => api.patch(`/admin/erp/sav/reserves/${r.id}`, { status: 'levee' }), 'Réserve levée')}><CheckCircle2 />Lever</button>
                      : <button className="btn btn-sm btn-ghost" onClick={() => act(() => api.patch(`/admin/erp/sav/reserves/${r.id}`, { status: 'ouverte' }), 'Réserve rouverte')}><RotateCcw />Rouvrir</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
      {pv && <DeliveryReport onClose={() => { setPv(false); list.reload(); }} />}
    </div>
  );
}

/** PV de livraison d'un dossier : date (départ des garanties) et réserves relevées. */
function DeliveryReport({ onClose }) {
  const toast = useToast();
  const meta = useSavMeta();
  const [sale, setSale] = useState(null);
  const detail = useResource(sale ? `/admin/erp/sav/sales/${sale.id}` : null);
  const [deliveredAt, setDeliveredAt] = useState('');
  const [form, setForm] = useState({ label: '', location: '', category: '', deadline: '' });
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const d = detail.data;
  const day = v => (v ? String(v).slice(0, 10) : '');

  const saveDate = async () => {
    setBusy(true); setError(null);
    try { await api.patch(`/admin/erp/sav/sales/${sale.id}/delivery`, { delivered_at: deliveredAt || null }); toast('Date de livraison enregistrée'); detail.reload(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const addReserve = async e => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post(`/admin/erp/sav/sales/${sale.id}/reserves`, {
        label: form.label, location: form.location || null, category: form.category || null, deadline: form.deadline || null,
        media_ids: photos.map(p => p.id),
      });
      setForm({ label: '', location: '', category: '', deadline: '' }); setPhotos([]);
      toast('Réserve ajoutée');
      detail.reload();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <Modal title="Procès-verbal de livraison" onClose={onClose} footer={<button className="btn" onClick={onClose}>Terminer</button>}>
      <div className="stack" style={{ gap: 16 }}>
        <ErrorBox error={error} />
        <Field label="Dossier du client"><SalePicker value={sale} onChange={s => { setSale(s); setDeliveredAt(s ? day(s.delivered_at) : ''); }} autoFocus /></Field>
        {sale && !d && <Skeleton h={120} />}
        {d && (
          <>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <Field label="Date de livraison (PV signé)">
                <input className="input" type="date" value={deliveredAt} onChange={e => setDeliveredAt(e.target.value)} />
              </Field>
              <button className="btn" disabled={busy || deliveredAt === day(d.delivered_at)} onClick={saveDate}>Enregistrer la date</button>
            </div>
            {d.warranty_ends && (
              <p className="small muted">
                Garanties jusqu’au : parfait achèvement <b>{date(d.warranty_ends.parfait_achevement)}</b> · biennale <b>{date(d.warranty_ends.biennale)}</b> · décennale <b>{date(d.warranty_ends.decennale)}</b>
              </p>
            )}
            <section>
              <h3 className="erp-h3">Réserves relevées ({d.reserves.length})</h3>
              {!d.reserves.length ? <p className="muted small">Aucune réserve : livraison sans réserve.</p> : (
                <ul className="stack" style={{ gap: 8, listStyle: 'none' }}>
                  {d.reserves.map(r => (
                    <li key={r.id} className="erp-panel">
                      <div className="row-between"><b>{r.label}</b>{r.status === 'levee' ? <Badge tone="ok">Levée</Badge> : <Badge tone="warn">À lever</Badge>}</div>
                      <div className="small muted">{[r.location, meta?.categories[r.category], r.deadline && `avant le ${date(r.deadline)}`].filter(Boolean).join(' · ')}</div>
                      <Thumbs files={r.media} size={56} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <form className="erp-panel stack" style={{ gap: 12 }} onSubmit={addReserve}>
              <b>Ajouter une réserve</b>
              <div className="form-grid">
                <Field label="Réserve" className="full"><input className="input" required minLength={2} maxLength={255} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Ex. Carreau fêlé devant la douche" /></Field>
                <Field label="Emplacement"><input className="input" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} /></Field>
                <Field label="Type">
                  <select className="select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                    <option value="">—</option>
                    {meta && Object.entries(meta.categories).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </Field>
                <Field label="À lever avant le"><input className="input" type="date" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} /></Field>
              </div>
              <PhotoPicker value={photos} onChange={setPhotos} leadId={sale.lead_id} />
              <div><button className="btn btn-primary btn-sm" disabled={busy}><Plus />Ajouter</button></div>
            </form>
          </>
        )}
      </div>
    </Modal>
  );
}
