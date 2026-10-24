import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Plus, Download, List, Columns3, Users, Phone, Mail as MailIcon, CalendarPlus, Trash2, Upload } from 'lucide-react';
import ImportModal from '../components/ImportModal';
import PortfolioHistory from '../components/PortfolioHistory';
import PipelineBoard from '../components/PipelineBoard';
import { api, qs } from '../lib/api';
import { useAuth, useResource, useToast, useSaved } from '../lib/app-context';
import { Card, Drawer, Field, Badge, Empty, ErrorBox, Skeleton, Pagination } from '../components/ui';
import { LEAD_STAGES, PROSPECT_STAGES, CLIENT_STAGES, FINANCING, SOURCES, APPT_KINDS, APPT_STATUS, stageLabel } from '../lib/domain';
import { date, dateTime, relative, toLocalInput } from '../lib/format';


export default function Leads() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = params.get('vue') === 'pipeline' ? 'pipeline' : 'liste';
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [projectId, setProjectId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => Number(localStorage.getItem('leads.pageSize')) || 25);
  const changePageSize = n => { setPageSize(n); setPage(1); try { localStorage.setItem('leads.pageSize', String(n)); } catch { /* stockage indisponible */ } };
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const projects = useResource('/admin/projects');
  const sellers = useResource(can('leads:all') ? '/admin/users/commerciaux' : null);
  // Commercial : « aucun » = prospects à répartir
  const seller = params.get('commercial') || '';
  const setSeller = v => setParams(p => { const n = new URLSearchParams(p); if (v) n.set('commercial', v); else n.delete('commercial'); return n; });

  const limit = view === 'pipeline' ? 200 : pageSize;
  // Prospects seulement : une personne qui a un code client est dans Clients
  const url = `/admin/leads${qs({ type: 'prospects', q, stage: view === 'liste' ? stage : '', project_id: projectId, assigned_to: seller, limit, offset: view === 'liste' ? (page - 1) * pageSize : 0 })}`;
  const leads = useResource(url);
  useEffect(() => setPage(1), [q, stage, projectId, seller]);

  // Lien de la cloche : /prospects?fiche=ID ouvre la fiche
  const fiche = Number(params.get('fiche')) || null;
  useEffect(() => {
    if (!fiche) return;
    setSelected(fiche);
    setParams(p => { const n = new URLSearchParams(p); n.delete('fiche'); return n; }, { replace: true });
  }, [fiche, setParams]);

  const setView = v => setParams(p => { const n = new URLSearchParams(p); if (v === 'pipeline') n.set('vue', 'pipeline'); else n.delete('vue'); return n; });

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <div className="search">
            <Search aria-hidden="true" />
            <input className="input" placeholder="Nom, e-mail, téléphone…" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un prospect" />
          </div>
          <select className="select" style={{ width: 'auto' }} value={projectId} onChange={e => setProjectId(e.target.value)} aria-label="Projet">
            <option value="">Tous les projets</option>
            {projects.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {view === 'liste' && (
            <select className="select" style={{ width: 'auto' }} value={stage} onChange={e => setStage(e.target.value)} aria-label="Étape">
              <option value="">Toutes les étapes</option>
              {PROSPECT_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          )}
          <select className="select" style={{ width: 'auto' }} value={seller} onChange={e => setSeller(e.target.value)} aria-label="Commercial">
            <option value="">Tous les commerciaux</option>
            <option value="aucun">Non attribués (à répartir)</option>
            {sellers.data?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="row">
          <div className="seg" role="tablist" aria-label="Affichage">
            <button className={view === 'liste' ? 'active' : ''} onClick={() => setView('liste')}><List />Liste</button>
            <button className={view === 'pipeline' ? 'active' : ''} onClick={() => setView('pipeline')}><Columns3 />Pipeline</button>
          </div>
          <a className="btn" href="/api/admin/leads.csv?type=prospects"><Download />Exporter</a>
          {can('leads:write') && <button className="btn" onClick={() => setImporting(true)}><Upload />Importer</button>}
          {can('leads:write') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />Nouveau prospect</button>}
        </div>
      </div>

      <ErrorBox error={leads.error} />
      {view === 'liste'
        ? <LeadTable leads={leads} page={page} setPage={setPage} pageSize={pageSize} setPageSize={changePageSize} onOpen={setSelected} sellers={sellers.data} />
        : <Pipeline leads={leads} onOpen={setSelected} canWrite={can('leads:write')} />}

      {selected && <LeadDrawer id={selected} onClose={() => setSelected(null)} onSaved={leads.reload} projects={projects.data || []} />}
      {importing && <ImportModal mode="prospects" allowModes={can('sales:write') ? ['prospects', 'clients'] : ['prospects']} onClose={() => setImporting(false)} onDone={() => leads.reload()} />}
      {creating && <LeadDrawer onClose={() => setCreating(false)} onSaved={() => { setCreating(false); leads.reload(); }} projects={projects.data || []} />}
    </div>
  );
}

function LeadTable({ leads, page, setPage, pageSize, setPageSize, onOpen, sellers }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const [picked, setPicked] = useState(() => new Set());
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const { rows = [], total = 0 } = leads.data || {};
  useEffect(() => setPicked(new Set()), [leads.data]);
  if (leads.loading && !leads.data) return <Card><Skeleton h={200} /></Card>;
  // Le responsable attribue, répartit et transfère ; un commercial peut prendre pour lui des prospects libres
  const manager = can('leads:all');
  const selectable = can('leads:write') && (manager || rows.some(l => !l.assigned_to));
  const pickable = l => manager || !l.assigned_to;
  const toggle = id => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = rows.filter(pickable);
  const assign = async () => {
    const target = manager ? (to === 'aucun' ? null : Number(to)) : user.id;
    setBusy(true);
    try {
      const out = await api.post('/admin/leads/assign', { ids: [...picked], user_id: target });
      toast(`${out.changed} prospect(s) ${target ? 'attribué(s)' : 'retiré(s)'}`);
      leads.reload();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Card bodyClass="">
      {selectable && picked.size > 0 && (
        <div className="card-body row" style={{ borderBottom: '1px solid var(--border)', paddingTop: 12, paddingBottom: 12 }}>
          <strong className="small">{picked.size} sélectionné(s)</strong>
          {manager ? (
            <>
              <select className="select" style={{ width: 'auto' }} value={to} onChange={e => setTo(e.target.value)} aria-label="Attribuer à">
                <option value="">Attribuer à…</option>
                {sellers?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                <option value="aucun">Retirer le commercial</option>
              </select>
              <button className="btn btn-primary btn-sm" disabled={!to || busy} onClick={assign}>Valider</button>
            </>
          ) : <button className="btn btn-primary btn-sm" disabled={busy} onClick={assign}>Me les attribuer</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>Annuler</button>
        </div>
      )}
      {!rows.length ? <Empty icon={Users}>Aucun prospect ne correspond à ces critères.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>{selectable && <th style={{ width: 36 }}><input type="checkbox" aria-label="Tout sélectionner" checked={all.length > 0 && all.every(l => picked.has(l.id))} onChange={e => setPicked(e.target.checked ? new Set(all.map(l => l.id)) : new Set())} /></th>}<th>Prospect</th><th>Projet / lot</th><th>Étape</th><th>Source</th><th>Commercial</th><th>Mis à jour</th></tr></thead>
            <tbody>
              {rows.map(l => (
                <tr key={l.id} className="clickable" onClick={() => onOpen(l.id)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpen(l.id)}>
                  {selectable && <td onClick={e => e.stopPropagation()}>{pickable(l) && <input type="checkbox" aria-label={`Sélectionner ${l.name}`} checked={picked.has(l.id)} onChange={() => toggle(l.id)} />}</td>}
                  <td><strong>{l.name}</strong>{l.alert_at && !l.seen_at ? <> <Badge tone="brand">Nouveau</Badge></> : null}{l.is_diaspora ? <> <Badge tone="warn">Diaspora</Badge></> : null}<div className="small muted">{[l.phone, l.email].filter(Boolean).join(' · ')}</div></td>
                  <td>{l.project_name || '—'}{l.lot_code && <div className="small muted">Lot {l.lot_code}</div>}</td>
                  <td><Badge tone={l.stage === 'perdu' ? 'danger' : ''}>{stageLabel(l.stage)}</Badge></td>
                  <td className="small">{SOURCES[l.source] || l.source}</td>
                  <td className="small">{l.assigned_name || <span className="muted">Non assigné</span>}</td>
                  <td className="small muted nowrap">{relative(l.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > 0 && <Pagination total={total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} label="prospects" />}
    </Card>
  );
}

function Pipeline({ leads, onOpen, canWrite }) {
  const toast = useToast();
  const [over, setOver] = useState(null);
  if (leads.loading && !leads.data) return <Skeleton h={300} />;
  const rows = leads.data?.rows || [];

  const move = async (id, stage) => {
    const lead = rows.find(r => r.id === id);
    if (!lead || lead.stage === stage) return;
    leads.setData(d => ({ ...d, rows: d.rows.map(r => (r.id === id ? { ...r, stage } : r)) }));
    try {
      const saved = await api.patch(`/admin/leads/${id}`, { stage });
      // Arrivé au paiement : la personne devient client et quitte la liste des prospects
      if (saved.client_code) {
        toast(`${lead.name} devient client (${saved.client_code}) : retrouvez-le dans Clients`);
        leads.reload();
      } else toast(`${lead.name} → ${stageLabel(stage)}`);
    } catch (e) {
      toast(e.message, 'err');
      leads.reload();
    }
  };

  return (
    <PipelineBoard>
      {/* Étapes du prospect, puis « Paiement » : y déposer une fiche en fait un client (elle passe dans Clients) */}
      {[...PROSPECT_STAGES.filter(s => s.id !== 'perdu'), { id: 'paiement', label: 'Paiement → client' }, PROSPECT_STAGES.find(s => s.id === 'perdu')].map(st => {
        const items = rows.filter(r => r.stage === st.id);
        return (
          <div
            key={st.id}
            className={`pipe-col ${over === st.id ? 'drop' : ''}`}
            onDragOver={e => { if (canWrite) { e.preventDefault(); setOver(st.id); } }}
            onDragLeave={() => setOver(null)}
            onDrop={e => { setOver(null); move(Number(e.dataTransfer.getData('text/plain')), st.id); }}
          >
            <div className="pipe-head">{st.label}<span className="n">{items.length}</span></div>
            <div className="pipe-list">
              {items.map(l => (
                <div
                  key={l.id} className="pipe-card" draggable={canWrite} tabIndex={0}
                  onDragStart={e => e.dataTransfer.setData('text/plain', String(l.id))}
                  onClick={() => onOpen(l.id)} onKeyDown={e => e.key === 'Enter' && onOpen(l.id)}
                >
                  <b>{l.name}</b>
                  <div className="meta">{l.project_name || 'Projet non précisé'}{l.lot_code ? ` · lot ${l.lot_code}` : ''}</div>
                  <div className="meta">{l.assigned_name || 'Non assigné'} · {relative(l.updated_at)}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </PipelineBoard>
  );
}

const EMPTY = { name: '', email: '', phone: '', country: '', is_diaspora: false, stage: 'prospection', financing: '', project_id: '', property_type: '', assigned_to: '', message: '' };

function LeadDrawer({ id, onClose, onSaved, projects }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const detail = useResource(id ? `/admin/leads/${id}` : null);
  const sellers = useResource('/admin/users/commerciaux');
  // Fiche ouverte : le serveur la marque vue → compteur du menu et cloche à jour
  const wasNew = detail.data && detail.data.alert_at && !detail.data.seen_at;
  useEffect(() => { if (wasNew) { window.dispatchEvent(new Event('siipaf:notifications')); onSaved?.(); } }, [wasNew]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nouveau prospect : attribué d'office à celui qui établit le contact (modifiable)
  const [form, setForm] = useState(id ? null : { ...EMPTY, assigned_to: String(user.id) });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [appt, setAppt] = useState(null);

  const remove = async () => {
    if (!window.confirm(`Supprimer définitivement ${detail.data?.name || 'ce prospect'} ? Ses rendez-vous et messages seront aussi supprimés.`)) return;
    try { await api.del(`/admin/leads/${id}`); toast('Prospect supprimé'); onSaved?.(); onClose(); } catch (e) { toast(e.message, 'err'); }
  };

  useEffect(() => {
    if (detail.data) {
      const d = detail.data;
      setForm({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map(k => [k, d[k] ?? EMPTY[k]])), is_diaspora: !!d.is_diaspora });
    }
  }, [detail.data]);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const editable = can('leads:write');

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = {
      ...form,
      email: form.email || null, phone: form.phone || null, country: form.country || null,
      financing: form.financing || null, message: form.message || null, property_type: form.property_type || null,
      project_id: form.project_id ? Number(form.project_id) : null,
      assigned_to: form.assigned_to ? Number(form.assigned_to) : null,
    };
    try {
      const out = id ? await api.patch(`/admin/leads/${id}`, body) : await api.post('/admin/leads', body);
      onSaved();
      // Étape paiement ou au-delà : la personne est devenue client et quitte les prospects
      if (out.client_code && !d?.client_code) {
        saved(`${out.name} devient client (${out.client_code}) : retrouvez-le dans Clients`);
        return onClose();
      }
      // Fiche enregistrée : elle se ferme, retour à la liste avec l'accusé
      saved(id ? `Prospect « ${out.name} » mis à jour` : `Prospect « ${out.name} » créé`);
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const createAppt = async () => {
    try {
      await api.post('/admin/appointments', { lead_id: id, kind: appt.kind, starts_at: new Date(appt.starts_at).toISOString(), project_id: form.project_id ? Number(form.project_id) : null, notes: appt.notes || null });
      toast('Rendez-vous planifié');
      setAppt(null);
      detail.reload();
    } catch (e) { toast(e.message, 'err'); }
  };

  const d = detail.data;
  return (
    <Drawer
      title={id ? (d?.name || 'Prospect') : 'Nouveau prospect'}
      onClose={onClose}
      footer={editable && form && <>{id && can('leads:delete') && <button className="btn btn-ghost btn-danger" style={{ marginRight: 'auto' }} onClick={remove}><Trash2 />Supprimer</button>}<button className="btn" onClick={onClose}>Fermer</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></>}
    >
      {!form ? <Skeleton h={300} /> : (
        <>
          {d && (
            <div className="row">
              {d.phone && <a className="btn btn-sm" href={`tel:${d.phone}`}><Phone />Appeler</a>}
              {d.phone && <a className="btn btn-sm" href={`https://wa.me/${d.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">WhatsApp</a>}
              {d.email && <a className="btn btn-sm" href={`mailto:${d.email}`}><MailIcon />E-mail</a>}
              {can('appointments:write') && <button className="btn btn-sm" onClick={() => setAppt({ kind: 'visite', starts_at: toLocalInput(Date.now() + 86400000), notes: '' })}><CalendarPlus />Planifier un RDV</button>}
            </div>
          )}
          {appt && (
            <Card title="Nouveau rendez-vous">
              <div className="form-grid">
                <Field label="Type"><select className="select" value={appt.kind} onChange={e => setAppt({ ...appt, kind: e.target.value })}>{Object.entries(APPT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Date et heure"><input className="input" type="datetime-local" value={appt.starts_at} onChange={e => setAppt({ ...appt, starts_at: e.target.value })} /></Field>
                <Field label="Notes" className="full"><input className="input" value={appt.notes} onChange={e => setAppt({ ...appt, notes: e.target.value })} /></Field>
              </div>
              <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
                <button className="btn btn-sm" onClick={() => setAppt(null)}>Annuler</button>
                <button className="btn btn-sm btn-primary" onClick={createAppt}>Planifier</button>
              </div>
            </Card>
          )}
          <ErrorBox error={error} />
          <fieldset disabled={!editable} style={{ border: 'none' }}>
            <div className="form-grid">
              <Field label="Nom complet" className="full"><input className="input" value={form.name} onChange={set('name')} required /></Field>
              <Field label="Téléphone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
              <Field label="E-mail"><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
              <Field label="Pays de résidence"><input className="input" value={form.country} onChange={set('country')} /></Field>
              <Field label="Financement">
                <select className="select" value={form.financing} onChange={set('financing')}>
                  <option value="">Non précisé</option>
                  {Object.entries(FINANCING).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Étape du circuit" hint={!d?.client_code && CLIENT_STAGES.includes(form.stage) ? 'À l’enregistrement, cette personne devient client (code client attribué) et passe dans Clients.' : undefined}>
                <select className="select" value={form.stage} onChange={set('stage')}>{LEAD_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
              </Field>
              <Field label="Projet">
                <select className="select" value={form.project_id} onChange={set('project_id')}>
                  <option value="">Non précisé</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Type de bien" hint={d?.source === 'site' && d?.property_type ? 'Consulté sur le site' : undefined}>
                <input className="input" value={form.property_type} onChange={set('property_type')} placeholder="Appartement social 3 pièces" />
              </Field>
              <Field label="Commercial assigné">
                <select className="select" value={form.assigned_to} onChange={set('assigned_to')}>
                  <option value="">Non assigné</option>
                  {sellers.data?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <label className="checkbox" style={{ alignSelf: 'end', height: 40 }}><input type="checkbox" checked={form.is_diaspora} onChange={set('is_diaspora')} />Client de la diaspora</label>
              <Field label="Notes / message" className="full"><textarea className="textarea" value={form.message} onChange={set('message')} /></Field>
            </div>
          </fieldset>
          {id && can('leads:read') && <PortfolioHistory leadId={id} />}

          {d && (
            <>
              <dl className="dl small">
                <dt>Source</dt><dd>{SOURCES[d.source] || d.source}</dd>
                <dt>Créé le</dt><dd>{date(d.created_at)}</dd>
              </dl>
              {d.options.length > 0 && (
                <Card title="Options sur lots" bodyClass="">
                  <div className="table-wrap"><table className="table"><tbody>{d.options.map(o => (
                    <tr key={o.id}><td>Lot {o.lot_code}</td><td><Badge tone={o.state === 'active' ? 'warn' : o.state === 'confirmee' ? 'ok' : ''}>{o.state}</Badge></td><td className="small muted right">expire {dateTime(o.expires_at)}</td></tr>
                  ))}</tbody></table></div>
                </Card>
              )}
              {d.appointments.length > 0 && (
                <Card title="Rendez-vous" bodyClass="">
                  <div className="table-wrap"><table className="table"><tbody>{d.appointments.map(a => (
                    <tr key={a.id}><td className="nowrap">{dateTime(a.starts_at)}</td><td>{APPT_KINDS[a.kind]}</td><td className="right"><Badge tone={APPT_STATUS[a.status].tone}>{APPT_STATUS[a.status].label}</Badge></td></tr>
                  ))}</tbody></table></div>
                </Card>
              )}
              {d.messages.length > 0 && (
                <Card title="Messages reçus">
                  <div className="stack" style={{ gap: 12 }}>{d.messages.map(m => (
                    <div key={m.id}><div className="small muted">{dateTime(m.created_at)}{m.subject ? ` · ${m.subject}` : ''}</div><p style={{ whiteSpace: 'pre-wrap' }}>{m.message}</p></div>
                  ))}</div>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </Drawer>
  );
}
