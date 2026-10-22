import { useEffect, useMemo, useState } from 'react';
import { Map, Upload, Search, ChevronRight, Plus } from 'lucide-react';
import LotDrawer from '../components/LotDrawer';
import { LotFormModal, LotStatusModal } from '../components/LotForms';
import { api, qs } from '../lib/api';
import { useAuth, useResource, useToast } from '../lib/app-context';
import { Card, Modal, Field, StatusBadge, Empty, ErrorBox, Skeleton, DistributionBar, Pagination, naturalCompare } from '../components/ui';
import { LOT_STATUSES, lotStatus, bienKind } from '../lib/domain';
import { fcfa, num, dateTime, relative } from '../lib/format';

export default function Lots() {
  const { can } = useAuth();
  const projects = useResource('/admin/projects');
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [action, setAction] = useState(null); // { lot, kind: 'status' }
  const [openLot, setOpenLot] = useState(null);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => Number(localStorage.getItem('lots.pageSize')) || 20);
  const changePageSize = n => { setPageSize(n); setPage(1); try { localStorage.setItem('lots.pageSize', String(n)); } catch { /* stockage indisponible */ } };

  useEffect(() => {
    if (!projectId && projects.data?.length) setProjectId(String(projects.data[0].id));
  }, [projects.data, projectId]);

  const lots = useResource(projectId ? `/admin/lots${qs({ project_id: projectId })}` : null);
  const project = projects.data?.find(p => String(p.id) === projectId);

  const rows = useMemo(() => (lots.data || []).filter(l =>
    (!status || l.status === status) && (!q || `${l.code} ${l.ilot || ''}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => naturalCompare(a.code, b.code)), [lots.data, status, q]);
  useEffect(() => setPage(1), [projectId, status, q]);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const counts = useMemo(() => LOT_STATUSES.map(s => ({ ...s, value: (lots.data || []).filter(l => l.status === s.id).length })), [lots.data]);

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <select className="select" style={{ width: 'auto' }} value={projectId} onChange={e => setProjectId(e.target.value)} aria-label="Projet">
            {projects.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={status} onChange={e => setStatus(e.target.value)} aria-label="Statut">
            <option value="">Tous les statuts</option>
            {LOT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <div className="search" style={{ minWidth: 180 }}>
            <Search aria-hidden="true" />
            <input className="input" placeholder="N° de lot, îlot…" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un lot" />
          </div>
        </div>
        {can('plans:write') && project && (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={() => setImporting(true)}><Upload />Importer des lots</button>
            <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />{bienKind(project.property_type).create}</button>
          </div>
        )}
      </div>

      {project && (
        <Card title={`${project.name} — ${num(lots.data?.length || 0)} lots`}>
          <DistributionBar items={counts} />
        </Card>
      )}

      <ErrorBox error={lots.error} />
      <Card bodyClass="">
        {lots.loading && !lots.data ? <div className="card-body"><Skeleton h={200} /></div>
          : !rows.length ? (
            <Empty icon={Map}>
              {lots.data?.length ? 'Aucun lot ne correspond à ces filtres.' : <>Aucun lot saisi pour ce projet.<br />Importez la liste depuis Excel ; l’éditeur de plan de masse arrive à l’étape suivante.</>}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Lot</th><th>Îlot</th><th className="right">Surface</th><th className="right">Prix</th><th>Statut</th><th>Acquéreur / option</th><th className="right">Payé</th><th /></tr></thead>
                <tbody>
                  {pageRows.map(l => (
                    <tr key={l.id} className="clickable" tabIndex={0} onClick={() => setOpenLot(l.id)} onKeyDown={e => e.key === 'Enter' && setOpenLot(l.id)}>
                      <td><strong>{l.code}</strong></td>
                      <td>{l.ilot || '—'}</td>
                      <td className="right tabular">{l.surface_m2 ? `${num(l.surface_m2)} m²` : '—'}</td>
                      <td className="right tabular nowrap">{fcfa(l.price_fcfa)}</td>
                      <td><StatusBadge status={l.status} /></td>
                      <td className="small">{l.buyer_name ? <strong>{l.buyer_name}</strong>
                        : l.status === 'option' && l.option_expires_at ? <>{l.option_lead_name || 'Option'}<div className="muted">expire {relative(l.option_expires_at)}</div></>
                        : <span className="muted">—</span>}</td>
                      <td className="right small tabular nowrap">{l.sale_id && l.sale_price_fcfa ? <PaidCell paid={l.paid_fcfa} price={l.sale_price_fcfa} /> : <span className="muted">—</span>}</td>
                      <td className="right"><ChevronRight size={16} className="muted" aria-hidden="true" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {rows.length > 0 && <Pagination total={rows.length} page={page} pageSize={pageSize} onPage={setPage} onPageSize={changePageSize} label="lots" />}
      </Card>

      {openLot && <LotDrawer lotId={openLot} onClose={() => setOpenLot(null)} onChanged={lots.reload} onChangeStatus={lot => setAction({ lot, kind: 'status' })} />}
      {/* Après la fiche du lot : la fenêtre de statut s'affiche par-dessus */}
      {action?.kind === 'status' && <LotStatusModal lot={action.lot} onClose={() => setAction(null)} onDone={() => { setAction(null); setOpenLot(null); lots.reload(); }} />}
      {creating && <LotFormModal projectId={project.id} onClose={() => setCreating(false)} onDone={() => { setCreating(false); lots.reload(); projects.reload(); }} />}
      {importing && <ImportModal project={project} onClose={() => setImporting(false)} onDone={() => { setImporting(false); lots.reload(); projects.reload(); }} />}
    </div>
  );
}

const PaidCell = ({ paid, price }) => {
  const pct = Math.min(100, Math.round((Number(paid) / Number(price)) * 100));
  return (
    <div title={`${fcfa(paid)} sur ${fcfa(price)}`}>
      {pct >= 100 ? <span style={{ color: 'var(--ok)', fontWeight: 600 }}>Soldé</span> : `${pct} %`}
      <div className="progress progress-sm"><div style={{ width: `${pct}%` }} /></div>
    </div>
  );
};

/** Import par copier-coller depuis Excel : colonnes N° lot, Îlot, Surface (m²), Prix (FCFA). */
function ImportModal({ project, onClose, onDone }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const c = line.split(/\t|;/).map(x => x.trim());
    const n = v => (v ? Number(v.replace(/[\s ]/g, '').replace(',', '.')) : null);
    return { code: c[0], ilot: c[1] || null, surface_m2: n(c[2]), price_fcfa: c[3] ? Math.round(n(c[3])) : null };
  }).filter(r => r.code && !/^(n°|lot|code)/i.test(r.code)), [text]);
  const invalid = parsed.filter(r => [r.surface_m2, r.price_fcfa].some(v => v != null && Number.isNaN(v)));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.put(`/admin/projects/${project.id}/lots`, parsed);
      toast(`${res.created} lots créés, ${res.updated} mis à jour`);
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Modal
      title={`Importer des lots — ${project.name}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={busy || !parsed.length || invalid.length > 0} onClick={submit}>Importer {parsed.length || ''} lots</button></>}
    >
      <p className="small muted">Copiez depuis Excel les colonnes <strong>N° de lot · Îlot · Surface (m²) · Prix (FCFA)</strong> et collez-les ci-dessous. Un lot déjà existant (même numéro) est mis à jour, sans changer son statut.</p>
      <textarea className="textarea" style={{ minHeight: 180, fontFamily: 'ui-monospace, monospace', fontSize: 13 }} value={text} onChange={e => setText(e.target.value)} placeholder={'A1\tA\t250\t23212000\nA2\tA\t250\t23212000'} />
      <ErrorBox error={error} />
      {invalid.length > 0 && <div className="alert">Valeurs non numériques sur les lots : {invalid.map(r => r.code).join(', ')}</div>}
      {parsed.length > 0 && <p className="small">{parsed.length} lots détectés · premier : <strong>{parsed[0].code}</strong>{parsed[0].surface_m2 ? `, ${num(parsed[0].surface_m2)} m²` : ''}{parsed[0].price_fcfa ? `, ${fcfa(parsed[0].price_fcfa)}` : ''}</p>}
    </Modal>
  );
}
