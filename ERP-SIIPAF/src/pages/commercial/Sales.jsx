import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, FileSignature, Plus } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Drawer, Field, Badge, Pagination, Advance } from '@admin/components/ui';
import { INSTALLMENT_STATUS } from '@admin/lib/domain';
import { date, fcfa } from '@admin/lib/format';
import { useCommercialMeta, compact } from '../../lib/commercial';
import LeadDrawer from './LeadDrawer';
import DeedSteps from '../../components/DeedSteps';

const STATUS = { en_cours: ['En cours', 'warn'], solde: ['Soldé', 'ok'], desiste: ['Désisté', 'danger'] };
const METHODS = { virement: 'Virement', mobile_money: 'Mobile Money', especes: 'Espèces', cheque: 'Chèque', autre: 'Autre' };

export default function Sales() {
  const meta = useCommercialMeta();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const filters = { project_id: params.get('project_id') || '', status: params.get('status') || '', vefa: params.get('vefa') || '', overdue: params.get('overdue') || '' };
  const saleId = Number(params.get('d')) || null;
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const list = useResource(`/admin/erp/commercial/sales${qs({ ...filters, q: debounced })}`);
  const set = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); setPage(1); };
  const rows = list.data || [];
  const live = rows.filter(r => r.status !== 'desiste');
  const sum = k => live.reduce((s, r) => s + (r[k] || 0), 0);

  return (
    <div className="stack">
      <div className="row">
        <label className="search">
          <Search aria-hidden="true" />
          <input className="input" type="search" placeholder="Client, code client, lot…" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher" />
        </label>
        <select className="select" style={{ width: 'auto' }} value={filters.project_id} onChange={e => set('project_id', e.target.value)} aria-label="Programme">
          <option value="">Tous les programmes</option>
          {meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={filters.status} onChange={e => set('status', e.target.value)} aria-label="Statut">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="checkbox small"><input type="checkbox" checked={!!filters.vefa} onChange={e => set('vefa', e.target.checked ? '1' : '')} />VEFA seulement</label>
        <label className="checkbox small"><input type="checkbox" checked={!!filters.overdue} onChange={e => set('overdue', e.target.checked ? '1' : '')} />Avec retard</label>
      </div>
      <ErrorBox error={list.error} />
      {list.data && (
        <div className="grid grid-4">
          <div className="card kpi"><span className="kpi-label">Dossiers actifs</span><span className="kpi-value">{live.length}</span></div>
          <div className="card kpi tint-blue"><span className="kpi-label">Montant vendu</span><span className="kpi-value">{compact(sum('price_fcfa'))}</span><span className="kpi-foot">FCFA</span></div>
          <div className="card kpi tint-green"><span className="kpi-label">Encaissé</span><span className="kpi-value">{compact(sum('paid_fcfa'))}</span><span className="kpi-foot">reste {compact(sum('remaining_fcfa'))}</span></div>
          <div className="card kpi tint-amber"><span className="kpi-label">Impayés échus</span><span className="kpi-value">{compact(sum('overdue_fcfa'))}</span><span className="kpi-foot">{live.filter(r => r.overdue_count).length} dossier(s) en retard</span></div>
        </div>
      )}
      <Card bodyClass="">
        {!list.data ? <div className="card-body"><Skeleton h={240} /></div> : !rows.length ? <div className="card-body"><Empty icon={FileSignature}>Aucun dossier ne correspond.</Empty></div> : (
          <>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Client</th><th>Bien</th><th>Paiement</th><th className="right">Prix</th><th>Payé</th><th>Avancement</th><th>Prochaine échéance</th><th>Statut</th></tr></thead>
              <tbody>
                {rows.slice((page - 1) * pageSize, page * pageSize).map(s => (
                  <tr key={s.id} className="clickable" onClick={() => set('d', String(s.id))}>
                    <td><b>{s.client_name}</b><div className="small muted">{s.client_code}{s.assigned_name ? ` · ${s.assigned_name}` : ''}</div></td>
                    <td className="small">{s.project_name}<div className="muted">{s.ilot ? `îlot ${s.ilot} · ` : ''}lot {s.lot_code}</div></td>
                    <td className="small">{s.vefa ? <Badge tone="brand">VEFA</Badge> : (meta?.financings[s.financing] || '—')}</td>
                    <td className="right tabular small">{compact(s.price_fcfa)}</td>
                    <td style={{ minWidth: 110 }}><div className="progress progress-sm" style={{ marginLeft: 0 }}><div style={{ width: `${s.percent_paid}%` }} /></div><span className="small tabular">{s.percent_paid} %</span></td>
                    <td>{s.status === 'desiste' ? <span className="muted">—</span> : <Advance value={s.progress_pct} />}</td>
                    <td className="small">{s.overdue_count ? <Badge tone="danger">{fcfa(s.overdue_fcfa)} en retard</Badge> : s.next_due ? `${date(s.next_due.due_date)} · ${compact(s.next_due.remaining_fcfa)}` : '—'}</td>
                    <td><Badge tone={STATUS[s.status][1]}>{STATUS[s.status][0]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <Pagination total={rows.length} page={page} pageSize={pageSize} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} label="dossiers" />
          </>
        )}
      </Card>
      {saleId && <SaleDrawer id={saleId} onClose={() => set('d', '')} onChange={() => list.reload()} />}
    </div>
  );
}

export function SaleDrawer({ id, onClose, onChange }) {
  const { can } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const meta = useCommercialMeta();
  const s = useResource(`/admin/erp/commercial/sales/${id}`);
  const [leadId, setLeadId] = useState(null);
  const [pay, setPay] = useState(null);
  const d = s.data;

  const record = async e => {
    e.preventDefault();
    try {
      await api.post(`/admin/sales/${id}/payments`, { amount_fcfa: Number(pay.amount_fcfa), paid_at: pay.paid_at, method: pay.method, reference: pay.reference || undefined });
      setPay(null); saved('Versement enregistré'); s.reload(); onChange?.();
    } catch (err) { toast(err.message, 'err'); }
  };

  return (
    <Drawer title={d ? `${d.client_name} · lot ${d.lot_code}` : 'Dossier de vente'} onClose={onClose}>
      {!d ? <Skeleton h={400} /> : (
        <div className="stack" style={{ gap: 18 }}>
          <div className="row" style={{ gap: 8 }}>
            <Badge tone={STATUS[d.status][1]}>{STATUS[d.status][0]}</Badge>
            {d.vefa ? <Badge tone="brand">VEFA — appels de fonds</Badge> : <Badge>{meta?.financings[d.financing] || 'Financement à préciser'}</Badge>}
            <button className="btn btn-sm btn-ghost" onClick={() => setLeadId(d.lead_id)}>Fiche client</button>
          </div>
          <section className="erp-panel">
            <dl className="dl">
              <dt>Programme</dt><dd>{d.project_name}{d.ilot ? ` · îlot ${d.ilot}` : ''} · lot {d.lot_code}</dd>
              <dt>Prix convenu</dt><dd><b>{fcfa(d.price_fcfa)}</b></dd>
              <dt>Encaissé</dt><dd>{fcfa(d.paid_fcfa)} ({d.percent_paid} %) · reste {fcfa(d.remaining_fcfa)}</dd>
              <dt>Avancement chantier</dt><dd><Advance value={d.progress_pct} /></dd>
              <dt>Réservation</dt><dd>{date(d.reserved_at)}{d.signed_at ? ` · acte signé le ${date(d.signed_at)}` : ''}</dd>
              {d.promised_delivery_on && <><dt>Livraison promise</dt><dd>{date(d.promised_delivery_on)}</dd></>}
              {d.overdue_count > 0 && <><dt>Retard</dt><dd style={{ color: 'var(--danger)' }}>{fcfa(d.overdue_fcfa)} sur {d.overdue_count} échéance(s)</dd></>}
            </dl>
          </section>

          <section>
            <h3 className="erp-h3">Circuit jusqu’à l’acte</h3>
            <DeedSteps saleId={id} onChange={() => { s.reload(); onChange?.(); }} />
          </section>

          <section>
            <h3 className="erp-h3">{d.vefa ? 'Appels de fonds' : 'Échéancier'}</h3>
            {d.vefa ? (
              <ol className="calls">
                {d.schedule.calls.map(c => {
                  const line = d.schedule.lines.find(l => l.seq === c.seq);
                  const st = line ? INSTALLMENT_STATUS[line.status] : null;
                  return (
                    <li key={c.id} className={c.status === 'appele' ? 'called' : ''}>
                      <span className="call-dot" aria-hidden="true" />
                      <div className="row-between" style={{ gap: 8 }}>
                        <span><b>{c.label}</b> <span className="muted small">{c.pct} %</span><div className="small muted">{c.status === 'appele' ? `Appelé le ${date(c.called_at)} · à régler avant le ${date(c.due_date)}` : 'Étape non atteinte'}</div></span>
                        <span className="right"><span className="tabular small"><b>{fcfa(c.amount_fcfa)}</b></span><div>{st ? <Badge tone={st.tone}>{st.label}</Badge> : <Badge>À venir</Badge>}</div></span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : !d.schedule.lines.length ? <p className="small muted">Pas d’échéancier.</p> : (
              <div className="table-wrap"><table className="table">
                <tbody>
                  {d.schedule.lines.slice(0, 60).map(l => (
                    <tr key={l.seq}><td className="small">{l.label}</td><td className="small">{date(l.due_date)}</td><td className="right tabular small">{fcfa(l.amount_fcfa)}</td><td><Badge tone={INSTALLMENT_STATUS[l.status].tone}>{INSTALLMENT_STATUS[l.status].label}</Badge></td></tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </section>

          <section>
            <div className="row-between">
              <h3 className="erp-h3">Versements ({d.payments.length})</h3>
              {can('payments:write') && !pay && <button className="btn btn-sm" onClick={() => setPay({ amount_fcfa: d.schedule.next_due?.remaining_fcfa || '', paid_at: new Date().toISOString().slice(0, 10), method: 'virement', reference: '' })}><Plus />Versement</button>}
            </div>
            {pay && (
              <form className="erp-panel form-grid" onSubmit={record} style={{ marginBottom: 10 }}>
                <Field label="Montant (FCFA)"><input className="input" type="number" min="1" required value={pay.amount_fcfa} onChange={e => setPay(p => ({ ...p, amount_fcfa: e.target.value }))} /></Field>
                <Field label="Date"><input className="input" type="date" required value={pay.paid_at} onChange={e => setPay(p => ({ ...p, paid_at: e.target.value }))} /></Field>
                <Field label="Moyen">
                  <select className="select" value={pay.method} onChange={e => setPay(p => ({ ...p, method: e.target.value }))}>
                    {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Référence"><input className="input" value={pay.reference} onChange={e => setPay(p => ({ ...p, reference: e.target.value }))} /></Field>
                <div className="full row" style={{ gap: 8 }}><button className="btn btn-sm btn-primary">Enregistrer</button><button type="button" className="btn btn-sm btn-ghost" onClick={() => setPay(null)}>Annuler</button></div>
              </form>
            )}
            {!d.payments.length ? <p className="small muted">Aucun versement.</p> : (
              <ul className="list">
                {d.payments.map(p => (
                  <li key={p.id} className="list-row" style={{ padding: '8px 0' }}>
                    <span className="small">{date(p.paid_at)} · {METHODS[p.method]}{p.reference ? ` · ${p.reference}` : ''}</span>
                    <b className="small tabular">{fcfa(p.amount_fcfa)}</b>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {leadId && <LeadDrawer id={leadId} onClose={() => setLeadId(null)} />}
    </Drawer>
  );
}
