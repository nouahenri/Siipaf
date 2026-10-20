import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, List, Columns3, ClipboardList } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Pagination } from '@admin/components/ui';
import { date, relative } from '@admin/lib/format';
import { useSavMeta, SavStatus, Priority, Overdue } from '../../components/SavBits';
import { STATUS_COLORS, WARRANTY_SHORT } from '../../lib/sav';
import TicketDrawer from './TicketDrawer';
import NewTicket from './NewTicket';

const VIEW_KEY = 'siipaf-erp-sav-view';
const readView = () => { try { return localStorage.getItem(VIEW_KEY) || 'liste'; } catch { return 'liste'; } };
const BOARD = ['nouveau', 'qualifie', 'planifie', 'en_cours', 'resolu'];

export default function Tickets() {
  const { can } = useAuth();
  const toast = useToast();
  const meta = useSavMeta();
  const [params, setParams] = useSearchParams();
  const [view, setViewState] = useState(readView);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [creating, setCreating] = useState(false);
  const [dragOver, setDragOver] = useState(null);

  const filters = {
    status: params.get('status') || '', priority: params.get('priority') || '', category: params.get('category') || '',
    project_id: params.get('project_id') || '', open: params.get('open') || '', overdue: params.get('overdue') || '',
  };
  const setFilter = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); p.delete('t'); setParams(p); setPage(1); };
  const openTicket = id => { const p = new URLSearchParams(params); if (id) p.set('t', id); else p.delete('t'); setParams(p); };
  const setView = v => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* navigation privée */ } };

  useEffect(() => { const id = setTimeout(() => { setDebounced(q); setPage(1); }, 300); return () => clearTimeout(id); }, [q]);

  const listUrl = view === 'liste'
    ? `/admin/erp/sav/tickets${qs({ ...filters, q: debounced, limit: pageSize, offset: (page - 1) * pageSize })}`
    : `/admin/erp/sav/tickets${qs({ ...filters, status: filters.status || BOARD.join(','), q: debounced, limit: 200 })}`;
  const list = useResource(listUrl);
  const ticketId = Number(params.get('t')) || null;

  const drop = async (ticket, to) => {
    setDragOver(null);
    if (!ticket || ticket.status === to) return;
    if (!(meta?.transitions?.[ticket.status] || []).includes(to)) {
      toast(`Passage de « ${meta.status_labels[ticket.status]} » à « ${meta.status_labels[to]} » non autorisé.`, 'err');
      return;
    }
    list.setData(d => ({ ...d, rows: d.rows.map(t => (t.id === ticket.id ? { ...t, status: to } : t)) }));
    try { await api.post(`/admin/erp/sav/tickets/${ticket.id}/status`, { status: to }); } catch (e) { toast(e.message, 'err'); }
    list.reload();
  };

  const rows = list.data?.rows || [];

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <label className="search">
            <Search aria-hidden="true" />
            <input className="input" type="search" placeholder="Référence, client, lot, titre…" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher" />
          </label>
          {view === 'liste' && (
            <select className="select" style={{ width: 'auto' }} value={filters.open ? 'open' : filters.status} onChange={e => {
              const v = e.target.value; const p = new URLSearchParams(params);
              p.delete('open'); p.delete('status'); p.delete('t');
              if (v === 'open') p.set('open', '1'); else if (v) p.set('status', v);
              setParams(p); setPage(1);
            }} aria-label="Statut">
              <option value="">Tous les statuts</option>
              <option value="open">En cours de traitement</option>
              {meta?.statuses.map(s => <option key={s} value={s}>{meta.status_labels[s]}</option>)}
            </select>
          )}
          <select className="select" style={{ width: 'auto' }} value={filters.priority} onChange={e => setFilter('priority', e.target.value)} aria-label="Priorité">
            <option value="">Toutes priorités</option>
            {meta && Object.entries(meta.priorities).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={filters.category} onChange={e => setFilter('category', e.target.value)} aria-label="Type de problème">
            <option value="">Tous les types</option>
            {meta && Object.entries(meta.categories).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={filters.project_id} onChange={e => setFilter('project_id', e.target.value)} aria-label="Programme">
            <option value="">Tous les programmes</option>
            {meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {filters.overdue && <button className="btn btn-sm" onClick={() => setFilter('overdue', '')}>En retard ✕</button>}
        </div>
        <div className="row">
          <div className="seg" role="group" aria-label="Affichage">
            <button className={view === 'liste' ? 'active' : ''} onClick={() => setView('liste')} aria-pressed={view === 'liste'}><List aria-hidden="true" />Liste</button>
            <button className={view === 'tableau' ? 'active' : ''} onClick={() => setView('tableau')} aria-pressed={view === 'tableau'}><Columns3 aria-hidden="true" />Tableau</button>
          </div>
          {can('sav:write') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />Nouvelle réclamation</button>}
        </div>
      </div>
      <ErrorBox error={list.error} />

      {view === 'liste' ? (
        <Card bodyClass="">
          {!list.data ? <div className="card-body"><Skeleton h={240} /></div> : !rows.length ? (
            <div className="card-body"><Empty icon={ClipboardList}>Aucune réclamation ne correspond.</Empty></div>
          ) : (
            <>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Réclamation</th><th>Client · lot</th><th>Statut</th><th>Priorité</th><th>Garantie</th><th>Échéance</th><th>Responsable</th></tr></thead>
                <tbody>
                  {rows.map(t => (
                    <tr key={t.id} className="clickable" onClick={() => openTicket(t.id)}>
                      <td style={{ minWidth: 220 }}>
                        <b>{t.title}</b>
                        <div className="muted small">{t.ref} · {meta?.categories[t.category] || t.category} · {date(t.created_at)}</div>
                      </td>
                      <td style={{ minWidth: 160 }}>{t.client_name || '—'}<div className="muted small">{t.project_name || '—'}{t.lot_code ? ` · lot ${t.lot_code}` : ''}</div></td>
                      <td><SavStatus status={t.status} meta={meta} /></td>
                      <td><Priority priority={t.priority} meta={meta} /></td>
                      <td className="small nowrap">{WARRANTY_SHORT[t.warranty] || '—'}</td>
                      <td className="small nowrap">{t.overdue ? <Overdue /> : meta?.open_statuses.includes(t.status) ? relative(t.due_at) : '—'}</td>
                      <td className="small">{t.assigned_name || <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <Pagination total={list.data.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} label="réclamations" />
            </>
          )}
        </Card>
      ) : (
        <div className="pipeline">
          {BOARD.map(st => {
            const col = rows.filter(t => t.status === st);
            return (
              <div key={st} className={`pipe-col ${dragOver === st ? 'drop' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(st); }} onDragLeave={() => setDragOver(null)}
                onDrop={e => { e.preventDefault(); drop(rows.find(t => t.id === Number(e.dataTransfer.getData('text/plain'))), st); }}>
                <div className="pipe-head"><i className="dot" style={{ background: STATUS_COLORS[st] }} />{meta?.status_labels[st] || st}<span className="n">{col.length}</span></div>
                <div className="pipe-list">
                  {!list.data && <Skeleton h={60} />}
                  {col.map(t => (
                    <div key={t.id} className="pipe-card" draggable={can('sav:write')} onDragStart={e => e.dataTransfer.setData('text/plain', String(t.id))}
                      onClick={() => openTicket(t.id)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && openTicket(t.id)}>
                      <b>{t.title}</b>
                      <div className="meta">{t.ref} · {t.client_name || '—'}{t.lot_code ? ` · ${t.lot_code}` : ''}</div>
                      <div className="row" style={{ gap: 6, marginTop: 6 }}>
                        <Priority priority={t.priority} meta={meta} />
                        {t.overdue && <Overdue />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {ticketId && <TicketDrawer id={ticketId} onClose={() => openTicket(null)} onChange={() => list.reload()} />}
      {creating && <NewTicket onClose={() => setCreating(false)} onCreated={t => { setCreating(false); list.reload(); openTicket(t.id); }} />}
    </div>
  );
}
