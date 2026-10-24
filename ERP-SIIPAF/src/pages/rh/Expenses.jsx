import { useState } from 'react';
import { Check, X, BookOpen, Wallet, Receipt, Plus, FileText, Undo2 } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Drawer } from '@admin/components/ui';
import { date, dateTime, fcfa } from '@admin/lib/format';
import { RH, today, useRhMeta } from '../../lib/rh';
import { ExpenseForm, ExpenseBadge } from '../../components/RhForms';
import { placeLabel } from '../../components/PlacePicker';

const JOURNALS = { BQ: 'Banque (virement, chèque)', CA: 'Caisse (espèces)', MM: 'Mobile Money' };

/**
 * Notes de frais (référence : Odoo Notes de frais) : à approuver par le responsable ou le service RH,
 * à comptabiliser puis rembourser par la comptabilité.
 */
export default function Expenses() {
  const { meta } = useRhMeta();
  const [scope, setScope] = useState('todo');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const list = useResource(`${RH}/expenses${qs(scope === 'todo' ? { to_do: '1' } : { status })}`);
  const rows = list.data || [];
  const total = rows.reduce((t, x) => t + x.amount, 0);
  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <div className="seg" role="group" aria-label="Affichage"><button className={scope === 'todo' ? 'active' : ''} onClick={() => setScope('todo')}>À traiter</button><button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>Toutes</button></div>
          {scope === 'all' && <select className="select" style={{ width: 'auto' }} value={status} onChange={e => setStatus(e.target.value)} aria-label="Statut"><option value="">Tous les statuts</option>{meta && Object.entries(meta.expense_statuses).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select>}
          {list.data && <span className="small muted">{rows.length} note(s) · {fcfa(total)}</span>}
        </div>
        {meta?.me && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />Ma note de frais</button>}
      </div>
      <ErrorBox error={list.error} />
      <Card bodyClass="">
        {!list.data ? <div className="card-body"><Skeleton h={200} /></div> : !rows.length ? <div className="card-body"><Empty icon={Receipt}>{scope === 'todo' ? 'Rien à traiter pour l’instant.' : 'Aucune note de frais.'}</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Référence</th><th>Employé</th><th>Date</th><th>Dépense</th><th className="right">Montant TTC</th><th>Statut</th></tr></thead>
            <tbody>{rows.map(x => (
              <tr key={x.id} className="clickable" onClick={() => setOpen(x.id)}>
                <td className="small tabular">{x.reference}</td><td><b>{x.employee_name}</b></td><td className="small nowrap">{date(x.date)}</td>
                <td>{x.label}<div className="small muted">{x.category_label}{` · ${placeLabel(x)}`}{x.paid_by === 'societe' ? ' · payée par la société' : ''}</div></td>
                <td className="right tabular">{fcfa(x.amount)}</td><td><ExpenseBadge x={x} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {open && <ExpenseDrawer id={open} onClose={() => setOpen(null)} onChange={list.reload} />}
      {creating && <ExpenseForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); list.reload(); }} />}
    </div>
  );
}

function ExpenseDrawer({ id, onClose, onChange }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const x = useResource(`${RH}/expenses/${id}`);
  const [note, setNote] = useState('');
  const [journal, setJournal] = useState('CA');
  const [payJournal, setPayJournal] = useState('MM');
  const [payDate, setPayDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const act = async (action, body = {}) => {
    setBusy(true);
    try { x.setData(await api.post(`${RH}/expenses/${id}/${action}`, body)); onChange(); toast({ approve: 'Note approuvée', refuse: 'Note refusée', post: 'Écriture passée en comptabilité', reset: 'Note remise en brouillon' }[action]); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const reimburse = async () => {
    setBusy(true);
    try { await api.post(`${RH}/expenses/reimburse`, { ids: [id], journal: payJournal, date: payDate }); saved('Remboursement enregistré en comptabilité'); x.reload(); onChange(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const d = x.data;
  const own = d && d.employee_user_id === user.id;
  const vat = d && d.vat_rate ? Math.round(d.amount - d.amount / (1 + d.vat_rate / 100)) : 0;
  return (
    <Drawer title={d ? `${d.reference} · ${d.employee_name}` : 'Note de frais'} onClose={onClose}>
      {!d ? <Skeleton h={300} /> : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row-between"><ExpenseBadge x={d} /><b className="tabular" style={{ fontSize: 20 }}>{fcfa(d.amount)}</b></div>
          <div>
            <div className="kv"><span>Dépense</span><b>{d.label}</b></div>
            <div className="kv"><span>Date</span><b>{date(d.date)}</b></div>
            <div className="kv"><span>Catégorie</span><b>{d.category_label} <span className="muted">(compte {d.account})</span></b></div>
            <div className="kv"><span>TVA incluse</span><b>{vat ? `${fcfa(vat)} (${d.vat_rate} %)` : '—'}</b></div>
            <div className="kv"><span>Payée par</span><b>{d.paid_by === 'societe' ? 'la société' : 'l’employé (à rembourser)'}</b></div>
            <div className="kv"><span>Affectation</span><b>{placeLabel(d)}</b></div>
            {d.approved_by_name && <div className="kv"><span>{d.status === 'refusee' ? 'Refusée par' : 'Approuvée par'}</span><b>{d.approved_by_name} · {dateTime(d.approved_at)}</b></div>}
            {d.entry_number && <div className="kv"><span>Écriture</span><b>{d.entry_number}</b></div>}
            {d.paid_at && <div className="kv"><span>Remboursée le</span><b>{date(d.paid_at)}</b></div>}
          </div>
          {d.refusal_reason && <div className="alert">Motif du refus : {d.refusal_reason}</div>}
          {d.receipt_url && (d.receipt_mime || '').startsWith('image/')
            ? <a href={d.receipt_url} target="_blank" rel="noreferrer"><img className="receipt" src={d.receipt_url} alt={`Reçu ${d.reference}`} /></a>
            : d.receipt_url && <a className="btn" href={d.receipt_url} target="_blank" rel="noreferrer"><FileText />Ouvrir le reçu</a>}

          {d.status === 'soumise' && !own && (
            <div className="erp-panel stack" style={{ gap: 10 }}>
              <Field label="Commentaire (obligatoire pour un refus)"><textarea className="textarea" rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
              <div className="row" style={{ gap: 8 }}><button className="btn btn-primary" disabled={busy} onClick={() => act('approve')}><Check />Approuver</button><button className="btn" disabled={busy || !note.trim()} onClick={() => act('refuse', { note })}><X />Refuser</button></div>
            </div>
          )}
          {d.status === 'approuvee' && can('frais:post') && (
            <div className="erp-panel stack" style={{ gap: 10 }}>
              <p className="small">Charge {d.account} au débit{vat ? ', TVA récupérable 4452' : ''} ; au crédit {d.paid_by === 'societe' ? 'le compte de trésorerie qui a payé' : `le compte 422100 de ${d.employee_name}`}.</p>
              {d.paid_by === 'societe' && <Field label="Payée depuis"><select className="select" value={journal} onChange={e => setJournal(e.target.value)}>{Object.entries(JOURNALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
              <button className="btn btn-primary" disabled={busy} onClick={() => act('post', d.paid_by === 'societe' ? { journal } : {})}><BookOpen />Comptabiliser</button>
            </div>
          )}
          {d.status === 'comptabilisee' && can('frais:post') && (
            <div className="erp-panel form-grid">
              <Field label="Remboursé par"><select className="select" value={payJournal} onChange={e => setPayJournal(e.target.value)}>{Object.entries(JOURNALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Date"><input className="input" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} /></Field>
              <div className="full"><button className="btn btn-primary" disabled={busy} onClick={reimburse}><Wallet />Enregistrer le remboursement</button></div>
            </div>
          )}
          {['soumise', 'refusee'].includes(d.status) && (own || can('frais:approve')) && <button className="btn btn-ghost" disabled={busy} onClick={() => act('reset')}><Undo2 />Remettre en brouillon</button>}
        </div>
      )}
    </Drawer>
  );
}
