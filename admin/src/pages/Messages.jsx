import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Mail, Phone, Archive, Check } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useResource, useToast } from '../lib/app-context';
import { Card, Drawer, Badge, Empty, ErrorBox, Skeleton } from '../components/ui';
import { dateTime, relative } from '../lib/format';

const STATUS = { nouveau: { label: 'Nouveau', tone: 'brand' }, traite: { label: 'Traité', tone: 'ok' }, archive: { label: 'Archivé', tone: '' } };

export default function Messages() {
  const toast = useToast();
  const { stats } = useOutletContext(); // pastille « nouveaux » du menu
  const [status, setStatus] = useState('nouveau');
  const [open, setOpen] = useState(null);
  const messages = useResource(`/admin/contacts${qs({ status, limit: 100 })}`);

  const setMsgStatus = async (m, next) => {
    try {
      await api.patch(`/admin/contacts/${m.id}`, { status: next });
      toast(`Message ${STATUS[next].label.toLowerCase()}`);
      setOpen(null);
      messages.reload();
      stats.reload();
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="stack">
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {[['nouveau', 'Nouveaux'], ['traite', 'Traités'], ['archive', 'Archivés'], ['', 'Tous']].map(([k, v]) => (
          <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{v}</button>
        ))}
      </div>
      <ErrorBox error={messages.error} />
      <Card bodyClass="">
        {messages.loading && !messages.data ? <div className="card-body"><Skeleton h={160} /></div>
          : !messages.data?.rows.length ? <Empty icon={Mail}>Aucun message.</Empty>
          : (
            <div className="table-wrap"><table className="table"><tbody>
              {messages.data.rows.map(m => (
                <tr key={m.id} className="clickable" onClick={() => setOpen(m)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && setOpen(m)}>
                  <td style={{ width: '30%' }}><strong>{m.name}</strong><div className="small muted">{[m.phone, m.email].filter(Boolean).join(' · ')}</div></td>
                  <td><div className="small"><strong>{m.subject || m.project_name || 'Message'}</strong></div><div className="small muted" style={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.message}</div></td>
                  <td className="small muted nowrap">{relative(m.created_at)}</td>
                  <td className="right"><Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge></td>
                </tr>
              ))}
            </tbody></table></div>
          )}
      </Card>

      {open && (
        <Drawer
          title={open.name}
          onClose={() => setOpen(null)}
          footer={<>
            {open.status !== 'archive' && <button className="btn" onClick={() => setMsgStatus(open, 'archive')}><Archive />Archiver</button>}
            {open.status !== 'traite' && <button className="btn btn-primary" onClick={() => setMsgStatus(open, 'traite')}><Check />Marquer traité</button>}
          </>}
        >
          <div className="row">
            {open.phone && <a className="btn btn-sm" href={`tel:${open.phone}`}><Phone />{open.phone}</a>}
            {open.email && <a className="btn btn-sm" href={`mailto:${open.email}?subject=${encodeURIComponent('Re: ' + (open.subject || 'Votre demande — SIIPAF'))}`}><Mail />Répondre</a>}
          </div>
          <dl className="dl small">
            <dt>Reçu le</dt><dd>{dateTime(open.created_at)}</dd>
            {open.project_name && <><dt>Projet</dt><dd>{open.project_name}</dd></>}
            {open.subject && <><dt>Objet</dt><dd>{open.subject}</dd></>}
          </dl>
          <p style={{ whiteSpace: 'pre-wrap' }}>{open.message}</p>
          <p className="small muted">Ce contact est aussi enregistré dans les prospects.</p>
        </Drawer>
      )}
    </div>
  );
}
