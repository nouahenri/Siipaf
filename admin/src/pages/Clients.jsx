import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Search, UserCheck, Phone, Mail as MailIcon, ExternalLink, Upload, Plus } from 'lucide-react';
import { useAuth, useResource, useToast } from '../lib/app-context';
import { api } from '../lib/api';
import { Card, Drawer, Badge, Empty, ErrorBox, Skeleton, Pagination, Modal, Field } from '../components/ui';
import { AccessTab, MessageThread } from '../components/ClientSpace';
import LotDrawer from '../components/LotDrawer';
import ImportModal from '../components/ImportModal';
import { FINANCING } from '../lib/domain';
import { fcfa, dateTime, relative } from '../lib/format';

const STATUS = {
  en_cours: { label: 'Paiement en cours', tone: 'warn' },
  solde: { label: 'Soldé', tone: 'ok' },
  desiste: { label: 'Désisté', tone: 'danger' },
  sans_dossier: { label: 'Sans dossier', tone: '' },
};
const FILTERS = [['', 'Tous'], ['retard', 'En retard'], ['en_cours', 'En cours'], ['solde', 'Soldés'], ['sans_dossier', 'Sans dossier'], ['sans_acces', 'Sans accès'], ['desiste', 'Désistés']];

const accessLabel = a => (!a ? { label: 'Pas d’accès', tone: '' }
  : !a.active ? { label: 'Suspendu', tone: 'danger' }
  : a.must_change_password ? { label: 'Invité', tone: 'warn' }
  : { label: 'Actif', tone: 'ok' });

/** Clients : prospects devenus acquéreurs (ils ont un code client et au moins un dossier). */
export default function Clients() {
  const { can } = useAuth();
  const { stats } = useOutletContext();
  const clients = useResource('/admin/clients');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [open, setOpen] = useState(null);
  const [lotId, setLotId] = useState(null);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [drawerTab, setDrawerTab] = useState('dossiers');

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return (clients.data || []).filter(c => {
      if (filter === 'retard' && !c.overdue_count) return false;
      if (filter === 'sans_acces' && c.access) return false;
      if (['en_cours', 'solde', 'desiste', 'sans_dossier'].includes(filter) && c.status !== filter) return false;
      if (!term) return true;
      return [c.name, c.client_code, c.email, c.property_type, c.legacy_number && `n° ${c.legacy_number}`, ...c.sales.map(s => `${s.project_name} ${s.lot_code}`)].some(v => (v || '').toLowerCase().includes(term))
        || (digits.length >= 4 && (c.phone || '').replace(/\D/g, '').includes(digits));
    });
  }, [clients.data, q, filter]);
  const counts = useMemo(() => {
    const all = clients.data || [];
    return { '': all.length, retard: all.filter(c => c.overdue_count).length, en_cours: all.filter(c => c.status === 'en_cours').length,
      solde: all.filter(c => c.status === 'solde').length, sans_dossier: all.filter(c => c.status === 'sans_dossier').length, sans_acces: all.filter(c => !c.access).length, desiste: all.filter(c => c.status === 'desiste').length };
  }, [clients.data]);
  const shown = rows.slice((page - 1) * pageSize, page * pageSize);
  const current = open && clients.data?.find(c => c.lead_id === open);

  return (
    <div className="stack">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          {FILTERS.map(([k, v]) => (
            <button key={k} className={filter === k ? 'active' : ''} onClick={() => { setFilter(k); setPage(1); }}>{v} <span className="muted">{counts[k] ?? ''}</span></button>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div className="search" style={{ minWidth: 240 }}>
            <Search aria-hidden="true" />
            <input className="input" placeholder="Nom, code, téléphone, lot…" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} aria-label="Rechercher un client" />
          </div>
          {can('sales:write') && <button className="btn" onClick={() => setImporting(true)}><Upload />Importer</button>}
          {can('sales:write') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />Nouveau client</button>}
        </div>
      </div>
      <ErrorBox error={clients.error} />
      <Card bodyClass="">
        {clients.loading && !clients.data ? <div className="card-body"><Skeleton h={180} /></div>
          : !rows.length ? <Empty icon={UserCheck}>{clients.data?.length ? 'Aucun client ne correspond.' : 'Aucun client : un prospect devient client à l’ouverture de son dossier d’acquisition.'}</Empty>
          : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Client</th><th>Bien(s)</th><th className="right">Payé</th><th>Situation</th><th>Espace client</th></tr></thead>
              <tbody>
                {shown.map(c => {
                  const st = STATUS[c.status];
                  const acc = accessLabel(c.access);
                  const pct = c.price_fcfa ? Math.round((c.paid_fcfa / c.price_fcfa) * 100) : 0;
                  return (
                    <tr key={c.lead_id} className="clickable" tabIndex={0} onClick={() => { setDrawerTab('dossiers'); setOpen(c.lead_id); }} onKeyDown={e => { if (e.key === 'Enter') { setDrawerTab('dossiers'); setOpen(c.lead_id); } }}>
                      <td>
                        <strong>{c.name}</strong>{c.is_diaspora && <> <Badge tone="warn">Diaspora</Badge></>}
                        <div className="small muted tabular">{c.client_code}{c.legacy_number ? ` · N° ${c.legacy_number}` : ''}{c.phone ? ` · ${c.phone}` : ''}</div>
                      </td>
                      <td className="small">{c.sales.filter(s => s.status !== 'desiste').map(s => <div key={s.id}>{s.project_name} · Lot {s.lot_code}</div>)}{c.status === 'desiste' && <span className="muted">—</span>}{c.status === 'sans_dossier' && <span className="muted">{[c.property_type, c.project_name].filter(Boolean).join(' · ') || '—'}</span>}</td>
                      <td className="right tabular nowrap">{['desiste', 'sans_dossier'].includes(c.status) ? '—' : <><strong>{pct} %</strong><div className="small muted">{fcfa(c.paid_fcfa)}</div></>}</td>
                      <td>
                        <Badge tone={st.tone} dot>{st.label}</Badge>
                        {c.overdue_count > 0 && <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }}>{c.overdue_count} retard{c.overdue_count > 1 ? 's' : ''} · {fcfa(c.overdue_fcfa)}</div>}
                      </td>
                      <td>
                        <Badge tone={acc.tone}>{acc.label}</Badge>
                        {c.unread_messages > 0 && <div className="small" style={{ marginTop: 4 }}><Badge tone="brand">{c.unread_messages} message{c.unread_messages > 1 ? 's' : ''}</Badge></div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        {rows.length > 0 && <Pagination total={rows.length} page={page} pageSize={pageSize} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} label="clients" />}
      </Card>

      {current && !lotId && (
        <ClientDrawer key={current.lead_id} client={current} initialTab={drawerTab} onClose={() => { setOpen(null); clients.reload(); stats.reload(); }} onOpenLot={setLotId} canMessages={can('client_messages')} />
      )}
      {creating && (
        <NewClientModal clients={clients.data || []} onClose={() => setCreating(false)}
          onCreated={c => { setCreating(false); setDrawerTab('acces'); setOpen(c.lead_id); clients.reload(); stats.reload(); }} />
      )}
      {importing && <ImportModal mode="clients" allowModes={can('leads:write') ? ['clients', 'prospects'] : ['clients']} onClose={() => setImporting(false)} onDone={() => clients.reload()} />}
      {lotId && <LotDrawer lotId={lotId} onClose={() => { setLotId(null); clients.reload(); }} onChanged={() => clients.reload()} onChangeStatus={() => {}} />}
    </div>
  );
}

function ClientDrawer({ client, initialTab = 'dossiers', onClose, onOpenLot, canMessages }) {
  const [tab, setTab] = useState(initialTab);
  const live = client.sales.find(s => s.status !== 'desiste') || client.sales[0];
  // AccessTab attend un dossier avec son acquéreur
  const saleForAccess = { ...live, lead: { id: client.lead_id, name: client.name, client_code: client.client_code, phone: client.phone } };
  const tabs = [['dossiers', `Dossiers (${client.sales.length})`], ['acces', 'Accès client'], ...(canMessages ? [['messages', 'Messages']] : [])];

  return (
    <Drawer title={<>{client.name} <span className="muted tabular" style={{ fontWeight: 400 }}>· {client.client_code}</span></>} onClose={onClose}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {client.phone && <a className="btn btn-sm" href={`tel:${client.phone}`}><Phone />{client.phone}</a>}
        {client.email && <a className="btn btn-sm" href={`mailto:${client.email}`}><MailIcon />{client.email}</a>}
        {client.country && <Badge>{client.country}</Badge>}
        {client.legacy_number && <Badge>N° {client.legacy_number} (ancienne plateforme)</Badge>}
      </div>
      <div className="tabs" role="tablist" style={{ marginBottom: 0 }}>
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === 'dossiers' && (
        <div className="stack">
          {!client.sales.length && (
            <Card title="Sans dossier d’acquisition">
              <dl className="dl small">
                <dt>Type de bien</dt><dd>{client.property_type || '—'}</dd>
                <dt>Programme</dt><dd>{client.project_name || '—'}</dd>
              </dl>
              <p className="small muted" style={{ marginTop: 10 }}>Client repris de l’ancienne plateforme. Pour saisir son lot, son prix et son échéancier : Lots › fiche du lot › « Ouvrir le dossier d’acquisition », puis choisissez ce client dans la liste (son code {client.client_code} est conservé).</p>
            </Card>
          )}
          {client.sales.map(s => (
            <Card key={s.id} title={`${s.project_name} · Lot ${s.lot_code}`} actions={<button className="btn btn-sm" onClick={() => onOpenLot(s.lot_id)}><ExternalLink />Ouvrir la fiche</button>}>
              <dl className="dl small">
                <dt>Situation</dt><dd><Badge tone={STATUS[s.status].tone} dot>{STATUS[s.status].label}</Badge></dd>
                <dt>Financement</dt><dd>{FINANCING[s.financing] || '—'}</dd>
                <dt>Prix convenu</dt><dd className="tabular">{fcfa(s.price_fcfa)}</dd>
                <dt>Payé</dt><dd className="tabular">{fcfa(s.paid_fcfa)} ({s.percent_paid} %)</dd>
                <dt>Reste</dt><dd className="tabular">{fcfa(s.remaining_fcfa)}</dd>
                {s.overdue_count > 0 && <><dt>En retard</dt><dd className="tabular" style={{ color: 'var(--danger)' }}>{fcfa(s.overdue_fcfa)} ({s.overdue_count})</dd></>}
                {s.next_due && <><dt>Prochaine échéance</dt><dd className="tabular">{fcfa(s.next_due.remaining_fcfa)} · {relative(s.next_due.due_date)}</dd></>}
              </dl>
            </Card>
          ))}
          {client.access?.last_login_at && <p className="small muted">Dernière connexion à l’espace client : {dateTime(client.access.last_login_at)}</p>}
        </div>
      )}
      {tab === 'acces' && <AccessTab sale={saleForAccess} />}
      {tab === 'messages' && <MessageThread leadId={client.lead_id} saleId={live?.status !== 'desiste' ? live?.id : undefined} />}
    </Drawer>
  );
}

const EMPTY_CLIENT = { name: '', first_name: '', phone: '', email: '', country: '', is_diaspora: false, property_type: '', project_id: '' };

/** Nouveau client sans dossier : son lot, son prix et son programme se rattachent ensuite. */
function NewClientModal({ clients, onClose, onCreated }) {
  const toast = useToast();
  const projects = useResource('/admin/projects');
  const [f, setF] = useState(EMPTY_CLIENT);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(v => ({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  // Types de bien déjà utilisés, proposés à la saisie
  const types = useMemo(() => [...new Set(clients.map(c => c.property_type).filter(Boolean))].sort(), [clients]);

  const submit = async e => {
    e.preventDefault();
    setError(null);
    if (!f.phone.trim() && !f.email.trim()) { setError(new Error('Indiquez un téléphone ou un e-mail.')); return; }
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
      const out = await api.post('/admin/clients', { ...body, project_id: f.project_id ? Number(f.project_id) : null });
      toast(`Client créé — ${out.client_code}`);
      onCreated(out);
    } catch (err) { setError(err); }
    setBusy(false);
  };

  return (
    <Modal title="Nouveau client" onClose={onClose}
      footer={<>
        <button className="btn" type="button" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" type="submit" form="new-client" disabled={busy}><Plus />Créer le client</button>
      </>}>
      <ErrorBox error={error} />
      <p className="small muted" style={{ marginBottom: 12 }}>Le client reçoit un code client et apparaît « sans dossier ». Son lot et son prix s’ajoutent ensuite depuis la fiche du lot ; son espace client s’ouvre à l’étape suivante.</p>
      <form id="new-client" className="form-grid" onSubmit={submit}>
        <Field label="Nom *"><input className="input" value={f.name} onChange={set('name')} required minLength={2} autoFocus /></Field>
        <Field label="Prénom(s)"><input className="input" value={f.first_name} onChange={set('first_name')} /></Field>
        <Field label="Téléphone" hint="Avec l’indicatif, ex. +225 07 08 97 26 71"><input className="input" type="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="E-mail"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Type de bien">
          <input className="input" list="client-types" value={f.property_type} onChange={set('property_type')} placeholder="Villa basse jumelée 4 pièces" />
          <datalist id="client-types">{types.map(t => <option key={t} value={t} />)}</datalist>
        </Field>
        <Field label="Programme">
          <select className="select" value={f.project_id} onChange={set('project_id')}>
            <option value="">À rattacher plus tard</option>
            {projects.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Pays de résidence"><input className="input" value={f.country} onChange={set('country')} /></Field>
        <Field label=" "><label className="checkbox small"><input type="checkbox" checked={f.is_diaspora} onChange={set('is_diaspora')} />Client de la diaspora</label></Field>
      </form>
    </Modal>
  );
}
