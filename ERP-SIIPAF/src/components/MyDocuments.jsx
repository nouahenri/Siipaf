import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpenCheck, FileText, Check, ListChecks } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, Modal, Badge, Field } from '@admin/components/ui';
import { date, dateTime } from '@admin/lib/format';

const URL = '/admin/erp/documents';

/**
 * Mon espace : documents internes adressés au compte (notes de service, procédures, PV, modèles) avec l'accusé
 * « J'ai lu et compris », et actions des PV qui lui sont confiées.
 */
export default function MyDocuments() {
  const r = useResource(`${URL}/moi`);
  const [params, setParams] = useSearchParams();
  const open = Number(params.get('document')) || null;
  const setOpen = id => setParams(id ? { document: String(id) } : {}, { replace: true });
  const docs = r.data?.documents || [];
  const actions = (r.data?.actions || []).filter(a => a.status === 'a_faire');
  const toRead = docs.filter(d => d.to_read).length;
  return (
    <>
      <Card title={`Documents internes${toRead ? ` · ${toRead} à lire` : ''}`} bodyClass="">
        {!r.data ? <div className="card-body"><Skeleton h={60} /></div> : !docs.length ? (
          <div className="card-body"><Empty icon={BookOpenCheck}>Aucun document ne vous est adressé : notes de service, procédures, PV de réunion et modèles apparaîtront ici.</Empty></div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Document</th><th>Publié le</th><th>Lecture</th></tr></thead>
            <tbody>{docs.map(d => (
              <tr key={d.id} className="clickable" onClick={() => setOpen(d.id)}>
                <td><b>{d.title}</b><div className="small muted">{d.kind_label} · {d.reference}{d.version > 1 ? ` · version ${d.version}` : ''}</div></td>
                <td className="small nowrap">{d.published_at ? date(d.published_at.slice(0, 10)) : '—'}</td>
                <td>{!d.ack_required ? <span className="small muted">À consulter</span> : d.my_read_at ? <Badge tone="ok">Lu le {date(d.my_read_at.slice(0, 10))}</Badge>
                  : <Badge tone={d.late ? 'danger' : 'warn'}>{d.late ? 'En retard' : d.ack_deadline ? `À lire avant le ${date(d.ack_deadline)}` : 'À lire'}</Badge>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {actions.length > 0 && (
        <Card title="Mes actions de réunion" bodyClass="">
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Action</th><th>PV</th><th>Échéance</th><th /></tr></thead>
            <tbody>{actions.map(a => <ActionRow key={a.id} a={a} onDone={r.reload} />)}</tbody>
          </table></div>
        </Card>
      )}
      {open && <DocReader id={open} onClose={() => setOpen(null)} onRead={r.reload} />}
    </>
  );
}

function ActionRow({ a, onDone }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const done = async () => {
    try { await api.patch(`${URL}/actions/${a.id}`, { status: 'fait', done_note: note.trim() || null }); toast('Action déclarée faite'); onDone(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <tr>
      <td>{a.label}</td>
      <td className="small">{a.reference}<div className="muted">{a.doc_title}</div></td>
      <td className="small nowrap">{a.due_date ? <Badge tone={a.late ? 'danger' : ''}>{date(a.due_date)}</Badge> : '—'}</td>
      <td className="right">{editing ? (
        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <input className="input" style={{ width: 180 }} placeholder="Commentaire (facultatif)" value={note} onChange={e => setNote(e.target.value)} />
          <button className="btn btn-primary btn-sm" onClick={done}><Check />Fait</button>
        </div>
      ) : <button className="btn btn-sm" onClick={() => setEditing(true)}><ListChecks />Déclarer faite</button>}</td>
    </tr>
  );
}

/** Lecture d'un document et accusé « J'ai lu et compris ». */
export function DocReader({ id, onClose, onRead }) {
  const toast = useToast();
  const x = useResource(`${URL}/${id}`);
  const d = x.data;
  const [busy, setBusy] = useState(false);
  const read = async () => {
    setBusy(true);
    try { x.setData(await api.post(`${URL}/${id}/lu`)); toast('Lecture confirmée'); onRead?.(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const mustAck = d && d.ack_required && d.is_recipient && !d.my_read_at && d.status === 'publie';
  return (
    <Modal title={d ? `${d.kind_label} · ${d.reference}` : 'Document'} onClose={onClose}
      footer={d && (mustAck ? <><button className="btn btn-ghost" onClick={onClose}>Plus tard</button><button className="btn btn-primary" disabled={busy} onClick={read}><Check />J’ai lu et compris</button></>
        : <button className="btn" onClick={onClose}>Fermer</button>)}>
      {x.error ? <p className="alert">{x.error.message}</p> : !d ? <Skeleton h={200} /> : (
        <div className="stack" style={{ gap: 12 }}>
          <div>
            <h3 style={{ margin: '0 0 4px' }}>{d.title}</h3>
            <p className="small muted" style={{ margin: 0 }}>
              {d.author_name ? `${d.author_name} · ` : ''}{d.published_at ? `publié le ${dateTime(d.published_at)}` : 'brouillon'}{d.version > 1 ? ` · version ${d.version}` : ''}
              {d.meeting_date ? ` · réunion du ${date(d.meeting_date)}` : ''}
            </p>
          </div>
          {d.versions?.[0]?.change_note && d.version > 1 && <div className="alert" style={{ background: 'var(--gold-soft)', color: 'var(--ink)' }}>Ce qui change : {d.versions[0].change_note}</div>}
          {d.body && <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{d.body}</div>}
          {d.file_url && <a className="btn" style={{ alignSelf: 'start' }} href={d.file_url} target="_blank" rel="noreferrer"><FileText />Ouvrir {d.file_name || 'le fichier'}</a>}
          {d.actions?.length > 0 && (
            <Field label="Actions décidées">
              <ul className="list">{d.actions.map(a => <li key={a.id} className="list-row"><span>{a.label}<div className="small muted">{a.owner_name || '—'}{a.due_date ? ` · avant le ${date(a.due_date)}` : ''}</div></span><Badge tone={a.status === 'fait' ? 'ok' : a.late ? 'danger' : ''}>{a.status_label}</Badge></li>)}</ul>
            </Field>
          )}
          {d.my_read_at && <p className="small muted" style={{ margin: 0 }}>Vous avez confirmé la lecture le {dateTime(d.my_read_at)}.</p>}
          {mustAck && d.ack_deadline && <p className="small muted" style={{ margin: 0 }}>À confirmer avant le {date(d.ack_deadline)}.</p>}
        </div>
      )}
    </Modal>
  );
}
