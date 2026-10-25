import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, CheckCheck, Pencil, PackageCheck, Receipt, XCircle, Send, Undo2 } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource } from '@admin/lib/app-context';
import { Modal, Drawer, Field, ErrorBox, Skeleton, Badge } from '@admin/components/ui';
import { fcfa, date, dateTime } from '@admin/lib/format';
import { APPRO, today, qty, tone, useApproAction } from '../../lib/appro';

export function Select({ value, onChange, rows, empty = 'Choisir…', required = true, disabled = false, label = undefined }) {
  return <select className="select" aria-label={label} value={value ?? ''} required={required} disabled={disabled} onChange={e => onChange(e.target.value)}><option value="">{empty}</option>{rows.map(r => <option key={r.id ?? r.code} value={r.id ?? r.code}>{r.name || r.label}</option>)}</select>;
}
function Events({ rows }) {
  const labels = { creation: 'Création', modification: 'Modification', soumission: 'Soumission au validateur', transmission_direction: 'Transmission à la Direction', confirmation: 'Validation', refus: 'Refus', reprise: 'Reprise en brouillon', annulation: 'Annulation', reception: 'Réception', validation: 'Validation du mouvement', facture_brouillon: 'Facture en brouillon', paiement: 'Règlement fournisseur', devis_recu: 'Devis reçu', issu_devis: 'Commande issue du devis' };
  const extra = e => [e.details?.approver_name && `validateur : ${e.details.approver_name}`, e.details?.substitute && 'à la place du validateur désigné', e.details?.reason,
    e.action === 'paiement' && `${e.details.number} · ${fcfa(e.details.amount)}${e.details.remaining > 0 ? ` · reste ${fcfa(e.details.remaining)}` : ' · soldée'}`].filter(Boolean).map(x => ` · ${x}`).join('');
  return <div><h3 className="erp-h3">Historique</h3><ul className="list">{rows.map(e => <li key={e.id} className="list-row"><div><b className="small">{labels[e.action] || e.action}</b><div className="small muted">{e.user_name || 'Compte supprimé'}{extra(e)}</div></div><span className="small muted">{dateTime(e.created_at)}</span></li>)}</ul></div>;
}
const INVOICE_STATUS = { brouillon: 'Brouillon à contrôler', validee: 'Validée' };
/** Circuit du bon de commande : émission → validation → réception → facture → règlement. */
function OrderCircuit({ d }) {
  const pending = ['a_valider', 'attente_direction'].includes(d.status), received = d.lines.reduce((s, l) => s + l.received_quantity, 0), ordered = d.lines.reduce((s, l) => s + l.quantity, 0);
  const billed = d.invoices.reduce((s, i) => s + i.amount_ttc, 0), paid = d.invoices.reduce((s, i) => s + i.paid_fcfa, 0);
  const decision = d.status === 'refusee' ? `Refusée par ${d.approved_by_name || '—'}` : d.approved_by_name && !pending && d.status !== 'brouillon' && d.status !== 'annulee' ? `Validée par ${d.approved_by_name}` : pending ? `En attente${d.status === 'attente_direction' ? ' de la Direction' : ''}` : d.status === 'brouillon' ? 'à soumettre' : '—';
  const steps = [
    ['Émission', `${d.issuer_name || d.created_by_name || 'Compte supprimé'}${(d.issuer_name ? d.issuer_role : d.created_by_role) ? ` — ${d.issuer_name ? d.issuer_role : d.created_by_role}` : ''}${d.issuer_id && d.created_by !== d.issuer_id ? ` · saisi par ${d.created_by_name || 'compte supprimé'}` : ''}`, true],
    ['Validation', `${d.approver_name ? `${d.approver_name}${d.approver_role ? ` — ${d.approver_role}` : ''}` : d.status === 'brouillon' ? 'Validateur à désigner' : d.status === 'attente_direction' ? 'Direction' : 'Validateur non désigné'} · ${decision}`, ['confirmee', 'partielle', 'recue'].includes(d.status)],
    ['Réception', received ? `${qty(received)} / ${qty(ordered)} reçus · ${d.receipts.length} bon(s) de réception` : 'Aucune réception', d.status === 'recue'],
    ['Facture', d.invoices.length ? d.invoices.map(i => `${i.number} (${INVOICE_STATUS[i.status] || i.status})`).join(', ') : d.receipts.length ? 'À préparer depuis les réceptions' : '—', d.invoices.length > 0 && d.invoices.every(i => i.status === 'validee')],
    ['Règlement', billed ? `${fcfa(paid)} réglés sur ${fcfa(billed)}` : '—', billed > 0 && paid >= billed],
  ];
  return <ol className="appro-circuit">{steps.map(([label, text, done]) => <li key={label} className={done ? 'done' : ''}><b className="small">{label}</b><span className="small muted">{text}</span></li>)}</ol>;
}
function LinesEditor({ lines, setLines, refs, prices, priceRequired }) {
  const update = (i, patch) => setLines(lines.map((l, j) => i === j ? { ...l, ...patch } : l));
  return <div className="stack" style={{ gap: 10 }}>
    <div className="table-wrap"><table className="table" style={{ minWidth: prices ? 660 : 480 }}><thead><tr><th>Article</th><th>Quantité</th><th>Unité</th>{prices && <th>Prix unitaire HT</th>}<th><span className="sr-only">Retirer</span></th></tr></thead><tbody>
      {lines.map((l, i) => { const a = refs.articles.find(a => a.id === Number(l.article_id)); return <tr key={i}>
        <td style={{ minWidth: 220 }}><Select label={`Article ${i + 1}`} value={l.article_id} onChange={v => update(i, { article_id: v })} rows={refs.articles.filter(a => a.active && (!l.required_unit || a.unit === l.required_unit)).map(a => ({ id: a.id, name: `${a.code} · ${a.label}` }))} />{l.need_id && <div className="small muted">Besoin chantier : {l.need_label || l.need_id}</div>}</td>
        <td><input aria-label={`Quantité ${i + 1}`} className="input" style={{ width: 100 }} type="number" min="0.01" max="10000000" step="0.01" required readOnly={!!l.need_id} value={l.quantity} onChange={e => update(i, { quantity: e.target.value })} /></td>
        <td className="small">{a?.unit_label || a?.unit || l.required_unit || '—'}</td>
        {prices && <td><input aria-label={`Prix unitaire HT ${i + 1}`} className="input" style={{ width: 130 }} type="number" min="0" max="1000000000" step="1" required={priceRequired} value={l.unit_price_fcfa ?? ''} onChange={e => update(i, { unit_price_fcfa: e.target.value })} /></td>}
        <td><button type="button" className="btn btn-ghost btn-icon" aria-label={`Retirer l’article ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 /></button></td>
      </tr>; })}
    </tbody></table></div>
    <div><button className="btn btn-sm" type="button" onClick={() => setLines([...lines, { article_id: '', quantity: 1, unit_price_fcfa: '' }])}><Plus />Article</button></div>
    {!refs.articles.some(a => a.active) && <p className="small muted">Créez d’abord les articles dans <Link className="link" to="/achats/articles">Articles</Link>.</p>}
  </div>;
}
/** Validateurs possibles (règle du serveur, lib/domain.js) : ni l'émetteur ni l'auteur de la saisie, sauf le super administrateur ; à partir du plafond, la Direction seule. */
function eligibleApprovers(refs, parties, ttc) {
  const direction = ttc >= refs.settings.direction_threshold;
  return refs.approvers.filter(a => (a.super_admin || !parties.includes(a.id)) && (direction ? a.direction : a.validate || a.direction))
    .map(a => ({ id: a.id, name: `${a.name} — ${a.role_label}${a.direction ? ' · Direction' : ''}` }));
}
export function DocumentForm({ kind, document: d, need, refs, onClose, onSaved }) {
  const isOrder = kind === 'order', url = `${APPRO}/${isOrder ? 'orders' : 'quotes'}`, action = useApproAction(), { user } = useAuth();
  const [f, setF] = useState(() => ({ supplier_id: d?.supplier_id || need?.supplier_id || '', location_id: d?.location_id || refs.locations.find(l => l.worksite_id === need?.worksite_id)?.id || '', date: d?.date || today(), needed_on: d?.needed_on || need?.needed_on || '', vat_rate: d?.vat_rate ?? refs.vat_rate ?? 0, supplier_ref: d?.supplier_ref || '', note: d?.note || '', approver_id: d?.approver_id || '',
    issuer_id: d?.issuer_id || (refs.issuers.some(u => u.id === user?.id) ? user.id : '') }));
  const [lines, setLines] = useState(() => d?.lines.map(l => ({ ...l })) || (need ? [{ article_id: '', quantity: need.quantity, unit_price_fcfa: '', need_id: need.id, need_label: need.label, required_unit: need.unit }] : [{ article_id: '', quantity: 1, unit_price_fcfa: '' }]));
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));
  const total = lines.reduce((sum, l) => sum + Math.round(Number(l.quantity || 0) * Number(l.unit_price_fcfa || 0)), 0), ttc = total + Math.round(total * Number(f.vat_rate || 0) / 100);
  const parties = [Number(f.issuer_id), d?.created_by ?? user?.id].filter(Boolean), approvers = isOrder ? eligibleApprovers(refs, parties, ttc) : [], direction = ttc >= refs.settings.direction_threshold;
  const approverId = approvers.some(a => a.id === Number(f.approver_id)) ? f.approver_id : '';
  const { approver_id: chosen, issuer_id: issuer, ...fields } = f;
  const submit = e => { e.preventDefault(); const body = { ...fields, ...(isOrder ? { issuer_id: Number(issuer) || null, approver_id: Number(approverId) || null } : {}), supplier_id: Number(f.supplier_id), location_id: Number(f.location_id), needed_on: f.needed_on || null, vat_rate: Number(f.vat_rate), lines: lines.map(l => ({ article_id: Number(l.article_id), quantity: Number(l.quantity), unit_price_fcfa: l.unit_price_fcfa === '' || l.unit_price_fcfa == null ? null : Number(l.unit_price_fcfa), need_id: l.need_id || null })) }; action.run(() => d ? api.put(`${url}/${d.id}`, body) : api.post(url, body), isOrder ? 'Bon de commande enregistré' : 'Demande de prix enregistrée', onSaved); };
  return <Modal title={d ? `Modifier ${d.reference}` : isOrder ? 'Nouveau bon de commande' : 'Nouvelle demande de prix'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Retour</button><button className="btn btn-primary" form="appro-document" disabled={action.busy}>{isOrder ? 'Enregistrer le brouillon' : 'Enregistrer'}</button></>}>
    <form id="appro-document" className="stack" onSubmit={submit}><ErrorBox error={action.error} />
      <div className="form-grid">{isOrder ? <Field label="Émis par *" hint={d && d.created_by !== Number(issuer) ? `Saisi par ${d.created_by_name || 'compte supprimé'}.` : 'Compte connecté par défaut ; comptes ayant le droit de préparer les achats.'}>
          <Select label="Émis par" value={issuer} onChange={v => setF(s => ({ ...s, issuer_id: v }))} rows={refs.issuers.map(u => ({ id: u.id, name: `${u.name} — ${u.role_label}${u.id === user?.id ? ' (vous)' : ''}` }))} empty="Choisir l’émetteur…" /></Field>
          : <Field label="Préparée par"><input className="input" readOnly value={d ? `${d.created_by_name || 'Compte supprimé'}${d.created_by_role ? ` — ${d.created_by_role}` : ''}` : `${user?.name || ''}${user?.role_label ? ` — ${user.role_label}` : ''}`} aria-readonly="true" /></Field>}
        {isOrder && <Field label="Validateur de la commande *" hint={direction ? `À partir de ${fcfa(refs.settings.direction_threshold)} TTC : validation par la Direction.` : `Sous le plafond de ${fcfa(refs.settings.direction_threshold)} TTC : un compte ayant le droit de valider les commandes. L’émetteur ne valide pas sa propre commande (sauf le super administrateur).`}>
          <Select label="Validateur de la commande" value={approverId} onChange={v => setF(s => ({ ...s, approver_id: v }))} rows={approvers} empty={approvers.length ? 'Choisir le validateur…' : 'Aucun validateur disponible'} />
          {f.approver_id && !approverId && <span className="small" style={{ color: 'var(--danger)' }}>Le validateur choisi ne peut pas valider ce montant : choisissez-en un autre.</span>}</Field>}
        <Field label="Fournisseur *"><Select value={f.supplier_id} onChange={v => setF(s => ({ ...s, supplier_id: v }))} rows={refs.suppliers} /></Field>
        <Field label="Emplacement de réception *" hint="Un lieu ou un chantier existant. Pour un besoin chantier, choisissez son emplacement."><Select value={f.location_id} onChange={v => setF(s => ({ ...s, location_id: v }))} rows={refs.locations.filter(l => l.active)} /></Field>
        <Field label="Date *"><input className="input" type="date" value={f.date} onChange={set('date')} required /></Field><Field label="Livraison souhaitée"><input className="input" type="date" value={f.needed_on} onChange={set('needed_on')} /></Field>
        <Field label="TVA (%)"><input className="input" type="number" min="0" max="100" step="0.01" value={f.vat_rate} onChange={set('vat_rate')} required /></Field>
        {!isOrder && <Field label="Référence du devis fournisseur"><input className="input" maxLength={100} value={f.supplier_ref} onChange={set('supplier_ref')} /></Field>}
      </div>
      {!refs.locations.length && <p className="small muted">Ajoutez d’abord un emplacement dans <Link to="/achats/stocks?onglet=emplacements" className="link">Stocks › Emplacements</Link>.</p>}
      <LinesEditor lines={lines} setLines={setLines} refs={refs} prices priceRequired={isOrder} />
      <p className="right tabular small">Total HT : <b>{fcfa(total)}</b> · TTC : <b>{fcfa(ttc)}</b></p>
      <Field label="Notes"><textarea className="textarea" maxLength={5000} rows={3} value={f.note} onChange={set('note')} /></Field>
      {isOrder && <p className="small muted">Le bon reste en brouillon : soumettez-le ensuite à son validateur depuis la fiche. Il est prévenu dans sa cloche.</p>}
    </form></Modal>;
}
export function ReceiptForm({ document: d, onClose, onSaved }) {
  const action = useApproAction(), pending = d.lines.filter(l => l.received_quantity < l.quantity);
  const [f, setF] = useState({ date: today(), supplier_ref: '', note: '' }), [quantities, setQuantities] = useState(Object.fromEntries(pending.map(l => [l.id, Math.round((l.quantity - l.received_quantity) * 100) / 100])));
  const submit = e => { e.preventDefault(); action.run(() => api.post(`${APPRO}/orders/${d.id}/receive`, { ...f, lines: pending.filter(l => Number(quantities[l.id]) > 0).map(l => ({ order_line_id: l.id, quantity: Number(quantities[l.id]) })) }), 'Réception enregistrée, stock mis à jour', onSaved); };
  return <Modal title={`Réceptionner ${d.reference}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Retour</button><button className="btn btn-primary" form="appro-receipt" disabled={action.busy}>Confirmer la réception</button></>}><form id="appro-receipt" className="stack" onSubmit={submit}>
    <ErrorBox error={action.error} /><p className="small">Emplacement : <b>{d.location_name}</b>. Indiquez uniquement les quantités effectivement reçues. Le reliquat reste à réceptionner.</p>
    <div className="form-grid"><Field label="Date de réception *"><input className="input" type="date" required value={f.date} onChange={e => setF(s => ({ ...s, date: e.target.value }))} /></Field><Field label="Bon de livraison fournisseur"><input className="input" maxLength={100} value={f.supplier_ref} onChange={e => setF(s => ({ ...s, supplier_ref: e.target.value }))} /></Field></div>
    <div className="table-wrap"><table className="table"><thead><tr><th>Article</th><th>Attendu</th><th>Reçu ce jour</th></tr></thead><tbody>{pending.map(l => <tr key={l.id}><td>{l.label}<div className="small muted">{l.unit}</div></td><td>{qty(l.quantity - l.received_quantity)}</td><td><input aria-label={`Reçu : ${l.label}`} className="input" type="number" min="0" step="0.01" max={Math.round((l.quantity - l.received_quantity) * 100) / 100} required value={quantities[l.id]} onChange={e => setQuantities(q => ({ ...q, [l.id]: e.target.value }))} /></td></tr>)}</tbody></table></div>
    <Field label="Observations"><textarea className="textarea" maxLength={5000} value={f.note} onChange={e => setF(s => ({ ...s, note: e.target.value }))} /></Field><p className="small muted">La réception met à jour le stock physique. Elle ne valide aucune facture ni écriture comptable.</p>
  </form></Modal>;
}
function InvoiceForm({ document: d, refs, onClose, onSaved }) {
  const action = useApproAction(), supplier = refs.suppliers.find(s => s.id === d.supplier_id);
  const [f, setF] = useState({ date: today(), due_date: '', supplier_ref: '', expense_account: refs.accounts.find(a => a.id === supplier?.expense_account_id)?.code || '' });
  const available = d.receipts.filter(r => !r.invoice_id), [selected, setSelected] = useState(available.map(r => r.id));
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));
  return <Modal title={`Préparer la facture — ${d.reference}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Retour</button><button className="btn btn-primary" form="appro-invoice" disabled={action.busy || !selected.length}>Préparer le brouillon</button></>}>
    <form id="appro-invoice" className="stack" onSubmit={e => { e.preventDefault(); action.run(() => api.post(`${APPRO}/orders/${d.id}/invoice`, { ...f, due_date: f.due_date || null, receipt_ids: selected }), 'Facture préparée en brouillon dans la Comptabilité', onSaved); }}>
      <ErrorBox error={action.error} /><p className="small">À partir de la facture du fournisseur, choisissez les réceptions concernées. Le brouillon reprend leurs quantités et les prix de la commande ; vérifiez-le dans la Comptabilité avant validation.</p>
      <div className="form-grid"><Field label="Référence de la facture fournisseur *"><input className="input" maxLength={60} required value={f.supplier_ref} onChange={set('supplier_ref')} /></Field><Field label="Compte de charge ou d’immobilisation *"><Select value={f.expense_account} onChange={v => setF(s => ({ ...s, expense_account: v }))} rows={refs.accounts.map(a => ({ id: a.code, name: `${a.code} · ${a.label}` }))} /></Field>
        <Field label="Date de facture *"><input className="input" type="date" required value={f.date} onChange={set('date')} /></Field><Field label="Échéance"><input className="input" type="date" value={f.due_date} onChange={set('due_date')} /></Field></div>
      <fieldset className="erp-panel stack" style={{ gap: 10 }}><legend className="small">Réceptions non facturées</legend>{available.map(r => <label className="checkbox" key={r.id}><input type="checkbox" checked={selected.includes(r.id)} onChange={e => setSelected(s => e.target.checked ? [...s, r.id] : s.filter(id => id !== r.id))} />{r.reference} · {date(r.date)}{r.supplier_ref ? ` · ${r.supplier_ref}` : ''}</label>)}</fieldset>
    </form></Modal>;
}
export function DocumentDrawer({ kind, id, refs, onClose, onChange, onOrder }) {
  const isOrder = kind === 'order', path = `${APPRO}/${isOrder ? 'orders' : 'quotes'}/${id}`, res = useResource(path), action = useApproAction(), { can, user } = useAuth();
  const [edit, setEdit] = useState(false), [receive, setReceive] = useState(false), [invoice, setInvoice] = useState(false), [refuse, setRefuse] = useState(false), [reason, setReason] = useState(''), [bill, setBill] = useState(null);
  const d = res.data, refresh = () => { action.clear(); res.reload(); onChange(); }, act = (suffix, message, body = {}) => action.run(() => api.post(`${path}/${suffix}`, body), message, refresh);
  // Mêmes règles que le serveur (approDeciderRefusal) : le validateur désigné, ou la Direction qui se substitue ; jamais l'émetteur.
  const pending = isOrder && d && ['a_valider', 'attente_direction'].includes(d.status), own = d && user?.role !== 'super_admin' && [d.issuer_id, d.created_by].includes(user?.id);
  const substitute = pending && d.approver_id && d.approver_id !== user?.id;
  const canDecide = pending && !own && (can('appro:direction') || (d.status === 'a_valider' && can('appro:validate') && (!d.approver_id || d.approver_id === user?.id)));
  const blocked = own ? `Vous avez émis cette commande : la décision revient à ${d.approver_name || 'la Direction'}.` : `Décision réservée à ${d?.approver_name || 'la Direction'}${d?.status === 'attente_direction' ? ' (Direction)' : ' ou à la Direction'}.`;
  return <Drawer title={d ? `${d.reference} · ${d.supplier_name}` : 'Chargement…'} onClose={onClose}><ErrorBox error={res.error || action.error} />{!d ? <Skeleton h={260} /> : <div className="stack">
    <div className="row-between"><Badge tone={tone(d.status)}>{d.status_label}</Badge><span className="small muted">{date(d.date)}</span></div>
    <p>Réception : <b>{d.location_name}</b>{d.needed_on && <span className="small muted"> · souhaitée le {date(d.needed_on)}</span>}</p>
    {isOrder ? <OrderCircuit d={d} /> : <p className="small muted">Préparée par {d.created_by_name || 'compte supprimé'}{d.created_by_role ? ` — ${d.created_by_role}` : ''}</p>}
    <div className="row">
      <Link className="btn btn-sm" to={`/achats/${isOrder ? 'commandes' : 'prix'}/${id}/impression`}>Imprimer / PDF</Link>
      {d.status === 'brouillon' && can('appro:write') && <button className="btn btn-sm" disabled={action.busy} onClick={() => setEdit(true)}><Pencil />Modifier</button>}
      {isOrder && d.status === 'brouillon' && can('appro:write') && <button className="btn btn-primary btn-sm" disabled={action.busy || !d.approver_id} title={d.approver_id ? undefined : 'Choisissez d’abord le validateur (Modifier)'} onClick={() => act('submit', `Commande soumise à ${d.approver_name}`)}><Send />{d.approver_id ? `Soumettre à ${d.approver_name}` : 'Soumettre à validation'}</button>}
      {pending && (canDecide || can('appro:validate') || can('appro:direction')) && <>
        <button className="btn btn-primary btn-sm" disabled={action.busy || !canDecide} title={canDecide ? undefined : blocked} onClick={() => act('approve', 'Commande validée')}><CheckCheck />{substitute && canDecide ? `Valider à la place de ${d.approver_name}` : 'Valider la commande'}</button>
        <button className="btn btn-sm btn-danger" disabled={action.busy || !canDecide} title={canDecide ? undefined : blocked} onClick={() => setRefuse(true)}><XCircle />Refuser</button>
      </>}
      {isOrder && d.status === 'refusee' && can('appro:write') && <button className="btn btn-sm" disabled={action.busy} onClick={() => act('reopen', 'Commande reprise en brouillon')}><Undo2 />Reprendre en brouillon</button>}
      {!isOrder && d.status === 'brouillon' && can('appro:write') && <button className="btn btn-primary btn-sm" disabled={action.busy} onClick={() => act('received', 'Devis fournisseur enregistré')}><CheckCheck />Devis reçu</button>}
      {!isOrder && d.status === 'recue' && can('appro:write') && <button className="btn btn-primary btn-sm" disabled={action.busy} onClick={() => action.run(() => api.post(`${path}/order`), 'Commande préparée', o => { onChange(); onOrder?.(o.id); })}>Préparer la commande</button>}
      {isOrder && ['confirmee', 'partielle'].includes(d.status) && can('appro:stock') && <button className="btn btn-primary btn-sm" disabled={action.busy} onClick={() => setReceive(true)}><PackageCheck />Réceptionner</button>}
      {isOrder && d.receipts.some(r => !r.invoice_id) && can('achats:write') && can('compta:read') && <button className="btn btn-sm" disabled={action.busy} onClick={() => setInvoice(true)}><Receipt />Préparer la facture</button>}
      {(isOrder ? ['brouillon', 'a_valider', 'attente_direction', 'refusee'] : ['brouillon', 'recue']).includes(d.status) && can('appro:write') && <button className="btn btn-ghost btn-sm btn-danger" disabled={action.busy} onClick={() => window.confirm('Annuler ce document ?') && act('cancel', 'Document annulé')}>Annuler</button>}
    </div>
    {isOrder && d.status === 'brouillon' && !d.approver_id && <p className="small muted">Choisissez le validateur avec « Modifier », puis soumettez la commande.</p>}
    {pending && own && <p className="small muted">Vous avez émis cette commande : elle attend la décision de {d.approver_name || 'la Direction'}.</p>}
    {pending && !own && !canDecide && <p className="small muted">En attente de la décision de {d.approver_name || 'la Direction'}{d.status === 'attente_direction' ? ' (Direction)' : ''}.</p>}
    {d.status === 'attente_direction' && <p className="small muted">Validation par la Direction requise à partir de {fcfa(d.approval_threshold)} TTC. Le plafond enregistré lors de la soumission reste applicable à cette commande.</p>}
    {d.refusal_reason && <p className="prewrap small">Motif : {d.refusal_reason}</p>}
    {!isOrder && d.supplier_ref && <p className="small muted">Devis fournisseur : {d.supplier_ref}</p>}
    <div className="table-wrap"><table className="table"><thead><tr><th>Article</th><th>Commandé</th><th>Prix HT</th>{isOrder && <th>Reçu</th>}</tr></thead><tbody>{d.lines.map(l => <tr key={l.id}><td><b>{l.label}</b><div className="small muted">{l.unit}{l.need_id ? ` · besoin n° ${l.need_id}` : ''}</div></td><td className="tabular">{qty(l.quantity)}</td><td className="tabular nowrap">{l.unit_price_fcfa == null ? '—' : fcfa(l.unit_price_fcfa)}</td>{isOrder && <td className="tabular">{qty(l.received_quantity)}</td>}</tr>)}</tbody></table></div>
    {isOrder && <p className="right tabular">HT : {fcfa(d.amount_ht)} · TVA ({d.vat_rate} %) : {fcfa(d.vat_amount)}<br /><b>Total TTC : {fcfa(d.amount_ttc)}</b></p>}
    {d.note && <p className="small prewrap">{d.note}</p>}
    {isOrder && d.receipts.length > 0 && <div><h3 className="erp-h3">Réceptions</h3><ul className="list">{d.receipts.map(r => <li className="list-row" key={r.id}><span>{r.reference}<span className="small muted"> · {date(r.date)}{r.supplier_ref ? ` · ${r.supplier_ref}` : ''}</span></span><Badge tone={r.invoice_id ? 'ok' : ''}>{r.invoice_id ? 'Facture préparée' : 'À facturer'}</Badge></li>)}</ul></div>}
    {bill && <p className="small">{bill.number} préparée. <Link className="link" to="/compta/achats">Contrôler en Comptabilité</Link></p>}
    <Events rows={d.events} />
    {edit && <DocumentForm kind={kind} document={d} refs={refs} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); refresh(); }} />}
    {receive && <ReceiptForm document={d} onClose={() => setReceive(false)} onSaved={() => { setReceive(false); refresh(); }} />}
    {invoice && <InvoiceForm document={d} refs={refs} onClose={() => setInvoice(false)} onSaved={b => { setInvoice(false); setBill(b); refresh(); }} />}
    {refuse && <Modal title={`Refuser ${d.reference}`} onClose={() => setRefuse(false)} footer={<><button className="btn btn-ghost" onClick={() => setRefuse(false)}>Retour</button><button className="btn btn-primary" form="appro-refuse" disabled={action.busy}>Confirmer le refus</button></>}><form id="appro-refuse" className="stack" onSubmit={e => { e.preventDefault(); action.run(() => api.post(`${path}/refuse`, { reason }), 'Commande refusée', () => { setRefuse(false); refresh(); }); }}><ErrorBox error={action.error} /><Field label="Motif *"><textarea className="textarea" minLength={3} maxLength={500} required value={reason} onChange={e => setReason(e.target.value)} /></Field></form></Modal>}
  </div>}</Drawer>;
}
export function MovementForm({ document: d, refs, onClose, onSaved }) {
  const action = useApproAction(), [f, setF] = useState({ kind: d?.kind || 'transfert', from_location_id: d?.from_location_id || '', to_location_id: d?.to_location_id || '', date: d?.date || today(), note: d?.note || '' });
  const [lines, setLines] = useState(d?.lines || [{ article_id: '', quantity: 1 }]), loc = refs.locations.filter(l => l.active);
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));
  return <Modal title={d ? `Modifier ${d.reference}` : 'Nouveau mouvement de stock'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Retour</button><button className="btn btn-primary" form="appro-move" disabled={action.busy}>Enregistrer le brouillon</button></>}><form id="appro-move" className="stack" onSubmit={e => { e.preventDefault(); const body = { ...f, from_location_id: f.from_location_id ? Number(f.from_location_id) : null, to_location_id: f.to_location_id ? Number(f.to_location_id) : null, lines: lines.map(l => ({ article_id: Number(l.article_id), quantity: Number(l.quantity) })) }; action.run(() => d ? api.put(`${APPRO}/movements/${d.id}`, body) : api.post(`${APPRO}/movements`, body), 'Mouvement enregistré en brouillon', onSaved); }}>
    <ErrorBox error={action.error} /><div className="form-grid"><Field label="Type *"><select className="select" value={f.kind} onChange={set('kind')}><option value="entree">Entrée / stock initial</option><option value="sortie">Sortie / consommation</option><option value="transfert">Transfert</option></select></Field><Field label="Date *"><input className="input" type="date" required value={f.date} onChange={set('date')} /></Field>
      {f.kind !== 'entree' && <Field label="Départ *"><Select value={f.from_location_id} onChange={v => setF(s => ({ ...s, from_location_id: v }))} rows={loc} /></Field>}{f.kind !== 'sortie' && <Field label="Arrivée *"><Select value={f.to_location_id} onChange={v => setF(s => ({ ...s, to_location_id: v }))} rows={loc.filter(l => f.kind !== 'transfert' || l.id !== Number(f.from_location_id))} /></Field>}
    </div><LinesEditor lines={lines} setLines={setLines} refs={refs} /><Field label="Motif / référence de pièce *" hint="Précisez la pièce de réception, le stock initial, la consommation ou la raison de la correction."><textarea className="textarea" minLength={3} maxLength={5000} required value={f.note} onChange={set('note')} /></Field><p className="small muted">Le stock change uniquement lors de la validation du mouvement. Une sortie ou un transfert est refusé si le stock disponible est insuffisant.</p>
  </form></Modal>;
}
export function MovementDrawer({ id, refs, onClose, onChange }) {
  const res = useResource(`${APPRO}/movements/${id}`), action = useApproAction(), { can } = useAuth(), [edit, setEdit] = useState(false), d = res.data;
  const refresh = () => { action.clear(); res.reload(); onChange(); };
  return <Drawer title={d?.reference || 'Mouvement de stock'} onClose={onClose}><ErrorBox error={res.error || action.error} />{!d ? <Skeleton h={200} /> : <div className="stack"><div className="row-between"><b>{d.kind_label}</b><Badge tone={tone(d.status)}>{d.status === 'valide' ? 'Validé' : d.status === 'annule' ? 'Annulé' : 'Brouillon'}</Badge></div><p className="small">{date(d.date)} · {d.from_name || 'Fournisseur / entrée'} → {d.to_name || 'Consommation'}</p>
    {d.status === 'brouillon' && can('appro:stock') && <div className="row"><button className="btn btn-primary" disabled={action.busy} onClick={() => action.run(() => api.post(`${APPRO}/movements/${id}/post`), 'Mouvement validé, stock mis à jour', refresh)}><CheckCheck />Valider le mouvement</button><button className="btn" disabled={action.busy} onClick={() => setEdit(true)}><Pencil />Modifier</button><button className="btn btn-ghost btn-danger" disabled={action.busy} onClick={() => window.confirm('Annuler ce brouillon ?') && action.run(() => api.post(`${APPRO}/movements/${id}/cancel`), 'Mouvement annulé', refresh)}>Annuler</button></div>}
    <div className="table-wrap"><table className="table"><thead><tr><th>Article</th><th className="right">Quantité</th></tr></thead><tbody>{d.lines.map(l => <tr key={l.id}><td>{l.label}</td><td className="right tabular">{qty(l.quantity)} {l.unit}</td></tr>)}</tbody></table></div><p className="small prewrap">{d.note}</p><Events rows={d.events} />
    {edit && <MovementForm document={d} refs={refs} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); refresh(); }} />}
  </div>}</Drawer>;
}
export function ArticleForm({ article: a, refs, onClose, onSaved }) {
  const action = useApproAction(), [f, setF] = useState({ code: a?.code || '', label: a?.label || '', unit: a?.unit || '', min_quantity: a?.min_quantity ?? 0, active: a?.active ?? true });
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));
  return <Modal title={a ? `Modifier ${a.code}` : 'Nouvel article'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Retour</button><button className="btn btn-primary" form="appro-article" disabled={action.busy}>Enregistrer</button></>}><form id="appro-article" className="stack" onSubmit={e => { e.preventDefault(); const body = { ...f, min_quantity: Number(f.min_quantity) }; action.run(() => a ? api.put(`${APPRO}/articles/${a.id}`, body) : api.post(`${APPRO}/articles`, body), 'Article enregistré', onSaved); }}><ErrorBox error={action.error} />
    <div className="form-grid"><Field label="Code article *"><input className="input" maxLength={40} required value={f.code} onChange={set('code')} /></Field><Field label="Désignation *"><input className="input" minLength={2} maxLength={200} required value={f.label} onChange={set('label')} /></Field>
      <Field label="Unité *" hint="Unités existantes des chantiers. Un article utilisé conserve son unité."><Select value={f.unit} onChange={v => setF(s => ({ ...s, unit: v }))} rows={a?.unit && !refs.units.some(u => u.code === a.unit) ? [...refs.units, { code: a.unit, label: a.unit_label || a.unit }] : refs.units} /></Field><Field label="Seuil de stock par défaut" hint="Alerte quand la quantité disponible est inférieure ou égale à ce seuil. Un seuil propre peut être saisi par emplacement."><input className="input" type="number" min="0" max="10000000" step="0.01" required value={f.min_quantity} onChange={set('min_quantity')} /></Field></div>
    <label className="checkbox"><input type="checkbox" checked={f.active} onChange={e => setF(v => ({ ...v, active: e.target.checked }))} />Article actif</label>
  </form></Modal>;
}
export function LocationForm({ refs, onClose, onSaved }) {
  const action = useApproAction(), [value, setValue] = useState('');
  const rows = [...refs.places.filter(p => !refs.locations.some(l => l.place_id === p.id)).map(p => ({ id: `p:${p.id}`, name: `Lieu · ${p.name}` })), ...refs.worksites.filter(w => !refs.locations.some(l => l.worksite_id === w.id)).map(w => ({ id: `w:${w.id}`, name: `Chantier · ${w.reference} — ${w.name}` }))];
  return <Modal title="Ajouter un emplacement de stock" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Retour</button><button className="btn btn-primary" form="appro-location" disabled={action.busy || !rows.length}>Enregistrer</button></>}><form id="appro-location" className="stack" onSubmit={e => { e.preventDefault(); const [type, id] = value.split(':'); action.run(() => api.post(`${APPRO}/locations`, type === 'p' ? { place_id: Number(id) } : { worksite_id: Number(id) }), 'Emplacement de stock ajouté', onSaved); }}><ErrorBox error={action.error} /><Field label="Lieu ou chantier existant *"><Select value={value} onChange={setValue} rows={rows} /></Field><p className="small muted">Les dépôts et lieux sont ceux de l’Administration générale ; les chantiers sont ceux du module Chantiers. Chaque emplacement conserve son propre stock.</p>{!rows.length && <p className="small">Tous les lieux et chantiers disponibles ont déjà un emplacement de stock.</p>}</form></Modal>;
}
export function MinimumForm({ balance: b, onClose, onSaved }) {
  const action = useApproAction(), [inherit, setInherit] = useState(b.min_units == null), [value, setValue] = useState(b.min_quantity);
  return <Modal title={`Seuil — ${b.label}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Retour</button><button className="btn btn-primary" form="appro-minimum" disabled={action.busy}>Enregistrer</button></>}><form id="appro-minimum" className="stack" onSubmit={e => { e.preventDefault(); action.run(() => api.put(`${APPRO}/stock/minimum`, { article_id: b.article_id, location_id: b.location_id, min_quantity: inherit ? null : Number(value) }), 'Seuil de stock enregistré', onSaved); }}><ErrorBox error={action.error} /><p>{b.location_name}</p><label className="checkbox"><input type="checkbox" checked={inherit} onChange={e => setInherit(e.target.checked)} />Reprendre le seuil par défaut de l’article</label><Field label={`Seuil pour cet emplacement (${b.unit})`}><input className="input" type="number" min="0" max="10000000" step="0.01" required disabled={inherit} value={value} onChange={e => setValue(e.target.value)} /></Field></form></Modal>;
}



