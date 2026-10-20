import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Truck, FileText, CheckCheck, Wallet, Pencil, Trash2 } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Drawer, Modal, Field, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { useComptaMeta, amt, PAYMENT_STATUS, AccountInput } from '../../lib/compta';
import { splitVatClient } from './vat';

const KINDS = { fournisseur: 'Fournisseur', sous_traitant: 'Sous-traitant', prestataire: 'Prestataire' };

export default function Purchases() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('onglet') || 'factures';
  return (
    <div className="stack">
      <div className="tabs" role="tablist">
        {[['factures', 'Factures d’achat'], ['fournisseurs', 'Fournisseurs et sous-traitants']].map(([id, l]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setParams({ onglet: id })}>{l}</button>
        ))}
      </div>
      {tab === 'factures' ? <Invoices /> : <Suppliers />}
    </div>
  );
}

function Invoices() {
  const { can } = useAuth();
  const { meta } = useComptaMeta();
  const [filters, setFilters] = useState({ status: '', project_id: '' });
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const list = useResource(`/admin/erp/compta/purchases?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v))}`);
  const rows = list.data || [];
  const due = rows.filter(r => r.status === 'validee').reduce((t, r) => t + r.remaining_fcfa, 0);

  return (
    <>
      <div className="row-between">
        <div className="row">
          <select className="select" style={{ width: 'auto' }} value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} aria-label="Statut">
            <option value="">Toutes les factures</option><option value="brouillon">Brouillons</option><option value="validee">Validées</option>
          </select>
          <select className="select" style={{ width: 'auto' }} value={filters.project_id} onChange={e => setFilters(f => ({ ...f, project_id: e.target.value }))} aria-label="Programme">
            <option value="">Tous les programmes</option>
            {meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {list.data && <span className="small muted">Reste à payer : <b>{fcfa(due)}</b></span>}
        </div>
        {can('compta:write') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />Facture d’achat</button>}
      </div>
      <ErrorBox error={list.error} />
      <Card bodyClass="">
        {!list.data ? <div className="card-body"><Skeleton h={200} /></div> : !rows.length ? <div className="card-body"><Empty icon={FileText}>Aucune facture d’achat.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>N°</th><th>Fournisseur</th><th>Objet · programme</th><th>Date</th><th className="right">TTC</th><th className="right">Reste</th><th>État</th></tr></thead>
            <tbody>
              {rows.map(i => {
                const st = i.status === 'brouillon' ? { label: 'Brouillon', tone: '' } : PAYMENT_STATUS[i.payment_status];
                return (
                  <tr key={i.id} className="clickable" onClick={() => setOpenId(i.id)}>
                    <td className="small tabular nowrap">{i.number}{i.supplier_ref && <div className="muted">{i.supplier_ref}</div>}</td>
                    <td className="small"><b>{i.supplier_name}</b></td>
                    <td className="small" style={{ minWidth: 200 }}>{i.label}<div className="muted">{i.project_name || 'Frais généraux'} · {i.expense_account}</div></td>
                    <td className="small nowrap">{date(i.date)}{i.due_date && <div className="muted">éch. {date(i.due_date)}</div>}</td>
                    <td className="right tabular small">{amt(i.amount_ttc)}</td>
                    <td className="right tabular small">{i.status === 'validee' ? amt(i.remaining_fcfa, { zero: '0' }) : '—'}</td>
                    <td><Badge tone={st.tone}>{st.label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </Card>
      {openId && <InvoiceDrawer id={openId} onClose={() => setOpenId(null)} onChange={() => list.reload()} />}
      {creating && <InvoiceForm onClose={() => setCreating(false)} onSaved={i => { setCreating(false); list.reload(); setOpenId(i.id); }} />}
    </>
  );
}

function InvoiceDrawer({ id, onClose, onChange }) {
  const { can } = useAuth();
  const toast = useToast();
  const { meta } = useComptaMeta();
  const inv = useResource(`/admin/erp/compta/purchases/${id}`);
  const [editing, setEditing] = useState(false);
  const [pay, setPay] = useState(null);
  const d = inv.data;
  const act = async (fn, msg) => { try { await fn(); toast(msg); inv.reload(); onChange(); } catch (e) { toast(e.message, 'err'); } };
  const treasury = (meta?.journals || []).filter(j => ['banque', 'caisse', 'mobile'].includes(j.kind) && j.active);

  return (
    <Drawer title={d ? `${d.number} · ${d.supplier_name}` : 'Facture d’achat'} onClose={onClose}>
      {!d ? <Skeleton h={300} /> : (
        <div className="stack" style={{ gap: 16 }}>
          <dl className="dl erp-panel">
            <dt>Objet</dt><dd>{d.label}</dd>
            <dt>Programme</dt><dd>{d.project_name || 'Frais généraux (non affecté)'}</dd>
            <dt>Imputation</dt><dd>{d.expense_account} — {d.expense_label}</dd>
            <dt>Date · échéance</dt><dd>{date(d.date)}{d.due_date ? ` · ${date(d.due_date)}` : ''}</dd>
            <dt>Montants</dt><dd className="tabular">HT {fcfa(d.amount_ht)} · TVA {d.vat_rate} % {fcfa(d.vat_amount)} · <b>TTC {fcfa(d.amount_ttc)}</b></dd>
            {d.status === 'validee' && <><dt>Réglé</dt><dd className="tabular">{fcfa(d.paid_fcfa)} · reste <b>{fcfa(d.remaining_fcfa)}</b></dd></>}
          </dl>
          {d.status === 'brouillon' && can('compta:write') && (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary" onClick={() => act(() => api.post(`/admin/erp/compta/purchases/${d.id}/validate`), 'Facture validée : écriture d’achat créée')}><CheckCheck />Valider la facture</button>
              <button className="btn" onClick={() => setEditing(true)}><Pencil />Modifier</button>
              <button className="btn btn-ghost btn-danger" onClick={() => window.confirm('Supprimer ce brouillon ?') && act(async () => { await api.del(`/admin/erp/compta/purchases/${d.id}`); onClose(); }, 'Facture supprimée')}><Trash2 />Supprimer</button>
            </div>
          )}
          {d.status === 'validee' && (
            <section>
              <div className="row-between">
                <h3 className="erp-h3">Règlements</h3>
                {can('compta:write') && d.remaining_fcfa > 0 && !pay && <button className="btn btn-sm" onClick={() => setPay({ date: new Date().toISOString().slice(0, 10), amount: d.remaining_fcfa, journal_id: treasury[0]?.id || '', reference: '' })}><Wallet />Régler</button>}
              </div>
              {pay && (
                <form className="erp-panel form-grid" style={{ marginBottom: 10 }} onSubmit={e => { e.preventDefault(); act(() => api.post(`/admin/erp/compta/purchases/${d.id}/payments`, { ...pay, amount: Number(pay.amount), journal_id: Number(pay.journal_id), reference: pay.reference || null }), 'Règlement enregistré').then(() => setPay(null)); }}>
                  <Field label="Montant (FCFA)"><input className="input" type="number" min="1" max={d.remaining_fcfa} required value={pay.amount} onChange={e => setPay(p => ({ ...p, amount: e.target.value }))} /></Field>
                  <Field label="Date"><input className="input" type="date" required value={pay.date} onChange={e => setPay(p => ({ ...p, date: e.target.value }))} /></Field>
                  <Field label="Payé par">
                    <select className="select" value={pay.journal_id} onChange={e => setPay(p => ({ ...p, journal_id: e.target.value }))}>
                      {treasury.map(j => <option key={j.id} value={j.id}>{j.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Référence"><input className="input" value={pay.reference} onChange={e => setPay(p => ({ ...p, reference: e.target.value }))} placeholder="N° de chèque, de virement…" /></Field>
                  <div className="full row" style={{ gap: 8 }}><button className="btn btn-sm btn-primary">Enregistrer</button><button type="button" className="btn btn-sm btn-ghost" onClick={() => setPay(null)}>Annuler</button></div>
                </form>
              )}
              {!d.payments.length ? <p className="small muted">Aucun règlement.</p> : (
                <ul className="list">
                  {d.payments.map(p => <li key={p.id} className="list-row" style={{ padding: '8px 0' }}><span className="small">{date(p.date)} · {p.journal_label}{p.reference ? ` · ${p.reference}` : ''}</span><b className="small tabular">{fcfa(p.amount)}</b></li>)}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
      {editing && d && <InvoiceForm invoice={d} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); inv.reload(); onChange(); }} />}
    </Drawer>
  );
}

function InvoiceForm({ invoice, onClose, onSaved }) {
  const { meta } = useComptaMeta();
  const suppliers = useResource('/admin/erp/compta/suppliers');
  const [f, setF] = useState(() => ({
    supplier_id: invoice?.supplier_id || '', supplier_ref: invoice?.supplier_ref || '', date: invoice?.date || new Date().toISOString().slice(0, 10), due_date: invoice?.due_date || '',
    label: invoice?.label || '', project_id: invoice?.project_id || '', expense_account: invoice?.expense_account || meta?.settings.accounts.expense_default || '',
    amount_ttc: invoice?.amount_ttc || '', vat_rate: invoice?.vat_rate ?? meta?.settings.vat_purchases_rate ?? 18,
  }));
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const pickSupplier = id => {
    const s = suppliers.data?.find(x => x.id === Number(id));
    setF(x => ({ ...x, supplier_id: id, expense_account: s?.expense_account || x.expense_account }));
  };
  const { ht, vat } = splitVatClient(Number(f.amount_ttc) || 0, Number(f.vat_rate) || 0);
  const save = async e => {
    e.preventDefault(); setError(null);
    const body = { ...f, supplier_id: Number(f.supplier_id), project_id: Number(f.project_id) || null, amount_ttc: Number(f.amount_ttc), vat_rate: Number(f.vat_rate), due_date: f.due_date || null, supplier_ref: f.supplier_ref || null };
    try { onSaved(invoice ? await api.patch(`/admin/erp/compta/purchases/${invoice.id}`, body) : await api.post('/admin/erp/compta/purchases', body)); } catch (err) { setError(err); }
  };
  return (
    <Modal title={invoice ? `Modifier ${invoice.number}` : 'Nouvelle facture d’achat'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="inv-form">Enregistrer</button></>}>
      <form id="inv-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Fournisseur">
          <select className="select" required value={f.supplier_id} onChange={e => pickSupplier(e.target.value)}>
            <option value="">— Choisir —</option>
            {suppliers.data?.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="N° de facture du fournisseur"><input className="input" maxLength={60} value={f.supplier_ref} onChange={set('supplier_ref')} /></Field>
        <Field label="Objet" className="full"><input className="input" required minLength={2} maxLength={255} value={f.label} onChange={set('label')} placeholder="Ex. Fourniture de ciment, situation n° 2 gros œuvre…" /></Field>
        <Field label="Programme (analytique)">
          <select className="select" value={f.project_id} onChange={set('project_id')}>
            <option value="">Frais généraux</option>
            {meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Compte de charge" hint="Classe 6 (ou 2 pour une immobilisation)"><AccountInput value={f.expense_account} onChange={v => setF(x => ({ ...x, expense_account: v }))} classes={[2, 6]} required /></Field>
        <Field label="Date de la facture"><input className="input" type="date" required value={f.date} onChange={set('date')} /></Field>
        <Field label="Échéance"><input className="input" type="date" value={f.due_date} onChange={set('due_date')} /></Field>
        <Field label="Montant TTC (FCFA)"><input className="input" type="number" min="1" required value={f.amount_ttc} onChange={set('amount_ttc')} /></Field>
        <Field label="Taux de TVA (%)" hint={f.amount_ttc ? `HT ${amt(ht, { zero: '0' })} · TVA ${amt(vat, { zero: '0' })}` : undefined}>
          <select className="select" value={f.vat_rate} onChange={set('vat_rate')}>
            {[0, 9, 18].map(r => <option key={r} value={r}>{r} %</option>)}
          </select>
        </Field>
      </form>
    </Modal>
  );
}

function Suppliers() {
  const { can } = useAuth();
  const list = useResource('/admin/erp/compta/suppliers');
  const [edit, setEdit] = useState(null);
  const rows = list.data || [];
  return (
    <>
      <div className="row-between">
        <span className="small muted">{rows.length} fournisseur(s) · dettes : <b>{fcfa(rows.reduce((t, s) => t + Math.max(0, s.balance), 0))}</b></span>
        {can('compta:write') && <button className="btn btn-primary" onClick={() => setEdit({})}><Plus />Fournisseur</button>}
      </div>
      <Card bodyClass="">
        {!list.data ? <div className="card-body"><Skeleton h={200} /></div> : !rows.length ? <div className="card-body"><Empty icon={Truck}>Aucun fournisseur. Ajoutez vos fournisseurs de matériaux, sous-traitants et prestataires (architectes, notaires…).</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Nom</th><th>Type</th><th>Contact</th><th>NCC · RCCM</th><th>Charge habituelle</th><th className="right">Solde dû</th></tr></thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id} className={can('compta:write') ? 'clickable' : ''} onClick={() => can('compta:write') && setEdit(s)} style={{ opacity: s.active ? 1 : 0.5 }}>
                  <td><b>{s.name}</b></td>
                  <td className="small">{KINDS[s.kind]}</td>
                  <td className="small">{s.phone || '—'}{s.email && <div className="muted">{s.email}</div>}</td>
                  <td className="small">{s.ncc || '—'}{s.rccm && <div className="muted">{s.rccm}</div>}</td>
                  <td className="small tabular">{s.expense_account || '—'}</td>
                  <td className="right tabular small">{amt(s.balance, { zero: '0' })}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
      {edit && <SupplierForm supplier={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </>
  );
}

function SupplierForm({ supplier, onClose, onSaved }) {
  const [f, setF] = useState({ name: supplier.name || '', kind: supplier.kind || 'fournisseur', phone: supplier.phone || '', email: supplier.email || '', address: supplier.address || '', ncc: supplier.ncc || '', rccm: supplier.rccm || '', expense_account: supplier.expense_account || '', notes: supplier.notes || '', active: supplier.active ?? true });
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async e => {
    e.preventDefault(); setError(null);
    const body = { ...f, email: f.email || null, expense_account: f.expense_account || null };
    if (!supplier.id) delete body.active;
    try { await (supplier.id ? api.patch(`/admin/erp/compta/suppliers/${supplier.id}`, body) : api.post('/admin/erp/compta/suppliers', body)); onSaved(); } catch (err) { setError(err); }
  };
  return (
    <Modal title={supplier.id ? supplier.name : 'Nouveau fournisseur'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="sup-form">Enregistrer</button></>}>
      <form id="sup-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Nom ou raison sociale" className="full"><input className="input" required minLength={2} value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Type"><select className="select" value={f.kind} onChange={set('kind')}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Compte de charge habituel"><AccountInput value={f.expense_account} onChange={v => setF(x => ({ ...x, expense_account: v }))} classes={[6]} /></Field>
        <Field label="Téléphone"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="E-mail"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="N° de compte contribuable (NCC)"><input className="input" value={f.ncc} onChange={set('ncc')} /></Field>
        <Field label="RCCM"><input className="input" value={f.rccm} onChange={set('rccm')} /></Field>
        <Field label="Adresse" className="full"><input className="input" value={f.address} onChange={set('address')} /></Field>
        {supplier.id && <label className="checkbox"><input type="checkbox" checked={f.active} onChange={set('active')} />Actif</label>}
      </form>
    </Modal>
  );
}
