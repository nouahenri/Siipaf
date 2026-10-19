import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Search, UserCheck, Phone, Mail as MailIcon, ExternalLink, Upload } from 'lucide-react';
import { useAuth, useResource } from '../lib/app-context';
import { Card, Drawer, Badge, Empty, ErrorBox, Skeleton, Pagination } from '../components/ui';
import { AccessTab, MessageThread } from '../components/ClientSpace';
import LotDrawer from '../components/LotDrawer';
import ImportModal from '../components/ImportModal';
import { FINANCING } from '../lib/domain';
import { fcfa, dateTime, relative } from '../lib/format';

const STATUS = {
  en_cours: { label: 'Paiement en cours', tone: 'warn' },
  solde: { label: 'Soldé', tone: 'ok' },
  desiste: { label: 'Désisté', tone: 'danger' },
};
const FILTERS = [['', 'Tous'], ['retard', 'En retard'], ['en_cours', 'En cours'], ['solde', 'Soldés'], ['sans_acces', 'Sans accès'], ['desiste', 'Désistés']];

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

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return (clients.data || []).filter(c => {
      if (filter === 'retard' && !c.overdue_count) return false;
      if (filter === 'sans_acces' && c.access) return false;
      if (['en_cours', 'solde', 'desiste'].includes(filter) && c.status !== filter) return false;
      if (!term) return true;
      return [c.name, c.client_code, c.email, ...c.sales.map(s => `${s.project_name} ${s.lot_code}`)].some(v => (v || '').toLowerCase().includes(term))
        || (digits.length >= 4 && (c.phone || '').replace(/\D/g, '').includes(digits));
    });
  }, [clients.data, q, filter]);
  const counts = useMemo(() => {
    const all = clients.data || [];
    return { '': all.length, retard: all.filter(c => c.overdue_count).length, en_cours: all.filter(c => c.status === 'en_cours').length,
      solde: all.filter(c => c.status === 'solde').length, sans_acces: all.filter(c => !c.access).length, desiste: all.filter(c => c.status === 'desiste').length };
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
                    <tr key={c.lead_id} className="clickable" tabIndex={0} onClick={() => setOpen(c.lead_id)} onKeyDown={e => e.key === 'Enter' && setOpen(c.lead_id)}>
                      <td>
                        <strong>{c.name}</strong>{c.is_diaspora && <> <Badge tone="warn">Diaspora</Badge></>}
                        <div className="small muted tabular">{c.client_code}{c.phone ? ` · ${c.phone}` : ''}</div>
                      </td>
                      <td className="small">{c.sales.filter(s => s.status !== 'desiste').map(s => <div key={s.id}>{s.project_name} · Lot {s.lot_code}</div>)}{c.status === 'desiste' && <span className="muted">—</span>}</td>
                      <td className="right tabular nowrap">{c.status === 'desiste' ? '—' : <><strong>{pct} %</strong><div className="small muted">{fcfa(c.paid_fcfa)}</div></>}</td>
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
        <ClientDrawer client={current} onClose={() => { setOpen(null); clients.reload(); stats.reload(); }} onOpenLot={setLotId} canMessages={can('client_messages')} />
      )}
      {importing && <ImportModal mode="clients" allowModes={can('leads:write') ? ['clients', 'prospects'] : ['clients']} onClose={() => setImporting(false)} onDone={() => clients.reload()} />}
      {lotId && <LotDrawer lotId={lotId} onClose={() => { setLotId(null); clients.reload(); }} onChanged={() => clients.reload()} onChangeStatus={() => {}} />}
    </div>
  );
}

function ClientDrawer({ client, onClose, onOpenLot, canMessages }) {
  const [tab, setTab] = useState('dossiers');
  const live = client.sales.find(s => s.status !== 'desiste') || client.sales[0];
  // AccessTab attend un dossier avec son acquéreur
  const saleForAccess = live && { ...live, lead: { id: client.lead_id, name: client.name, client_code: client.client_code, phone: client.phone } };
  const tabs = [['dossiers', `Dossiers (${client.sales.length})`], ['acces', 'Accès client'], ...(canMessages ? [['messages', 'Messages']] : [])];

  return (
    <Drawer title={<>{client.name} <span className="muted tabular" style={{ fontWeight: 400 }}>· {client.client_code}</span></>} onClose={onClose}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {client.phone && <a className="btn btn-sm" href={`tel:${client.phone}`}><Phone />{client.phone}</a>}
        {client.email && <a className="btn btn-sm" href={`mailto:${client.email}`}><MailIcon />{client.email}</a>}
        {client.country && <Badge>{client.country}</Badge>}
      </div>
      <div className="tabs" role="tablist" style={{ marginBottom: 0 }}>
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === 'dossiers' && (
        <div className="stack">
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
      {tab === 'acces' && (saleForAccess ? <AccessTab sale={saleForAccess} /> : <Empty>Aucun dossier.</Empty>)}
      {tab === 'messages' && <MessageThread leadId={client.lead_id} saleId={live?.status !== 'desiste' ? live?.id : undefined} />}
    </Drawer>
  );
}
