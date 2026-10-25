/**
 * Chantiers › Fiche › lot 5 (choix du client du 25/10) : travaux modificatifs des acquéreurs (TMA : demande, devis
 * du conducteur, réponse de l'acquéreur dans son espace, réalisation), besoins en matériaux (demandé → validé →
 * commandé → livré) et réception d'un lot (PV, réserves au SAV, dernier appel de fonds).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Check, FileText, Pencil, Trash2, CheckCircle2, XCircle, ShoppingCart, PackageCheck, Wrench, Ban, X } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Modal, Badge } from '@admin/components/ui';
import { date, fcfa, num } from '@admin/lib/format';
import { CH } from '../../lib/chantiers';
import { today } from '../../lib/rh';

export const TMA_TONES = { demandee: 'warn', chiffree: 'brand', acceptee: 'ok', refusee: 'danger', annulee: '', realisee: 'ok' };
const NEED_TONES = { demande: 'warn', valide: 'brand', refuse: 'danger', commande: 'brand', livre: 'ok', annule: '' };

/** Formulaire multipart : champs vides omis, un fichier sous « file ». */
function formData(fields, file) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== '' && v != null) f.append(k, typeof v === 'boolean' ? String(v) : v);
  if (file) f.append('file', file);
  return f;
}

// ─── TMA ────────────────────────────────────────────────────────────────────

export function Tma({ w }) {
  const { can } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const res = useResource(`${CH}/${w.id}/tma`);
  const sales = useResource(`${CH}/${w.id}/livraisons`);
  const [form, setForm] = useState(false);
  const [quote, setQuote] = useState(null);
  const manage = w.can_manage;
  const canRequest = manage || can('sales:write');
  const act = async (t, body, msg) => {
    try { await api.patch(`${CH}/tma/${t.id}`, body); saved(msg); res.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="stack">
      <div className="callout-erp"><Wrench /><span className="small">
        Un acquéreur demande des <b>travaux modificatifs</b> (au commercial ou dans son espace client) ; le <b>conducteur chiffre le devis</b> ;
        l’acquéreur <b>l’accepte ou le refuse dans son espace client</b>. Accepté, son montant s’ajoute à l’échéancier du dossier (la Comptabilité est prévenue et l’écriture est préparée), puis les travaux sont réalisés.
      </span></div>
      <Card title="Travaux modificatifs des acquéreurs" bodyClass=""
        actions={canRequest && <button className="btn btn-primary" onClick={() => setForm(true)}><Plus />Nouvelle demande</button>}>
        <ErrorBox error={res.error} />
        {!res.data ? <div className="card-body"><Skeleton h={120} /></div> : !res.data.length ? <div className="card-body"><Empty icon={Wrench}>Aucune demande de travaux modificatifs.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Demande</th><th>Lot · acquéreur</th><th>État</th><th className="right">Devis</th><th /></tr></thead>
            <tbody>{res.data.map(t => (
              <tr key={t.id}>
                <td><b>{t.title}</b><div className="small muted">{t.reference} · {t.source_label} · le {date(t.created_at)}</div>
                  {t.description && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{t.description}</div>}
                  {t.client_note && <div className="small muted">Acquéreur : « {t.client_note} »</div>}</td>
                <td><b className="tabular">{t.lot_code}</b><div className="small">{t.client_name}</div></td>
                <td><Badge tone={TMA_TONES[t.status]}>{t.status_label}</Badge>
                  {t.due_date && <div className="small muted">à régler avant le {date(t.due_date)}</div>}
                  {t.done_on && <div className="small muted">réalisée le {date(t.done_on)}</div>}</td>
                <td className="right tabular small">{t.amount_fcfa != null ? <><b>{fcfa(t.amount_fcfa)}</b>{t.delay_days && <div className="muted">{t.delay_days} jours</div>}</> : '—'}</td>
                <td className="right nowrap">
                  {t.file_url && <a className="btn btn-ghost btn-icon" href={t.file_url} target="_blank" rel="noreferrer" aria-label="Ouvrir le devis"><FileText /></a>}
                  {manage && ['demandee', 'chiffree'].includes(t.status) && <button className="btn btn-sm btn-primary" onClick={() => setQuote(t)}>{t.status === 'demandee' ? 'Chiffrer' : 'Revoir le devis'}</button>}
                  {manage && t.status === 'acceptee' && <button className="btn btn-sm btn-primary" onClick={() => act(t, { status: 'realisee', done_on: today() }, 'Travaux réalisés')}><Check />Réalisée</button>}
                  {canRequest && ['demandee', 'chiffree'].includes(t.status) && <button className="btn btn-sm btn-ghost" onClick={() => window.confirm('Annuler cette demande ?') && act(t, { status: 'annulee' }, 'Demande annulée')}><Ban />Annuler</button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {form && <TmaForm sales={(sales.data?.rows || []).filter(r => !r.delivered_at)} onClose={() => setForm(false)} onSaved={() => { setForm(false); res.reload(); }} />}
      {quote && <QuoteForm t={quote} onClose={() => setQuote(null)} onSaved={() => { setQuote(null); res.reload(); }} />}
    </div>
  );
}

/** Demande de TMA pour un dossier (lots vendus de la zone, non livrés). */
export function TmaForm({ sales, saleId = null, onClose, onSaved }) {
  const saved = useSaved();
  const [f, setF] = useState({ sale_id: saleId || sales?.[0]?.sale_id || '', title: '', description: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.post(`${CH}/tma`, { sale_id: Number(f.sale_id), title: f.title, description: f.description || null });
      saved('Demande enregistrée : le conducteur est prévenu pour chiffrer');
      onSaved();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal title="Demande de travaux modificatifs" onClose={onClose}
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="tma-form" disabled={busy || !f.sale_id}><Check />Enregistrer</button></>}>
      <form id="tma-form" className="form-grid" onSubmit={submit}>
        <div className="full"><ErrorBox error={error} /></div>
        {!saleId && (
          <Field label="Dossier (lot · acquéreur)" className="full" hint="Lots vendus de la zone du chantier, pas encore livrés">
            <select className="select" required value={f.sale_id} onChange={e => setF({ ...f, sale_id: e.target.value })}>
              {!sales?.length && <option value="">Aucun lot vendu à livrer</option>}
              {sales?.map(s => <option key={s.sale_id} value={s.sale_id}>Lot {s.lot_code} — {s.client_name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Travaux demandés" className="full"><input className="input" required minLength={3} maxLength={200} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Carrelage grand format au séjour, prise supplémentaire…" /></Field>
        <Field label="Précisions" className="full"><textarea className="textarea" rows={3} maxLength={4000} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

function QuoteForm({ t, onClose, onSaved }) {
  const saved = useSaved();
  const [f, setF] = useState({ amount_fcfa: t.amount_fcfa ?? '', delay_days: t.delay_days ?? '', quote_note: t.quote_note || '' });
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.post(`${CH}/tma/${t.id}/devis`, formData(f, file));
      saved('Devis envoyé : l’acquéreur répond dans son espace client');
      onSaved();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Devis — ${t.title}`} onClose={onClose}
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="quote-form" disabled={busy}><Check />Envoyer à l’acquéreur</button></>}>
      <form id="quote-form" className="form-grid" onSubmit={submit}>
        <div className="full"><ErrorBox error={error} /></div>
        <p className="small muted full" style={{ margin: 0 }}>Lot {t.lot_code} · {t.client_name}. Le devis est annoncé dans l’espace client de l’acquéreur, qui l’accepte ou le refuse.</p>
        <Field label="Montant TTC (FCFA)"><input className="input" type="number" required min={1} value={f.amount_fcfa} onChange={e => setF({ ...f, amount_fcfa: e.target.value })} /></Field>
        <Field label="Délai de réalisation (jours)"><input className="input" type="number" min={1} max={730} value={f.delay_days} onChange={e => setF({ ...f, delay_days: e.target.value })} /></Field>
        <Field label="Détail du devis" className="full"><textarea className="textarea" rows={3} maxLength={2000} value={f.quote_note} onChange={e => setF({ ...f, quote_note: e.target.value })} placeholder="Fourniture et pose…" /></Field>
        <Field label="Devis signé ou détaillé (PDF, image)" className="full"><input className="input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files[0] || null)} /></Field>
      </form>
    </Modal>
  );
}

// ─── Besoins en matériaux ───────────────────────────────────────────────────

export function Needs({ w, refs }) {
  const { can } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const res = useResource(`${CH}/${w.id}/besoins`);
  const [form, setForm] = useState(null);
  const manage = w.can_manage;
  const move = async (n, body, msg) => {
    try { await api.post(`${CH}/${w.id}/besoins/${n.id}/statut`, body); saved(msg); res.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const remove = async n => {
    if (!window.confirm(`Supprimer le besoin « ${n.label} » ?`)) return;
    try { await api.del(`${CH}/${w.id}/besoins/${n.id}`); saved('Besoin supprimé'); res.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="stack">
      <div className="callout-erp"><ShoppingCart /><span className="small">
        Le chantier exprime ses <b>besoins en matériaux</b> ; ils sont <b>transmis aux Achats</b>, qui les commandent par un bon de commande soumis à validation
        (ou les refusent avec un motif). La réception du bon de commande sur ce chantier les passe à « Livré ». Unités réglables dans Chantiers › Réglages.
      </span></div>
      <Card title="Besoins en matériaux" bodyClass="" actions={manage && <button className="btn btn-primary" onClick={() => setForm({})}><Plus />Nouveau besoin</button>}>
        <ErrorBox error={res.error} />
        {!res.data ? <div className="card-body"><Skeleton h={120} /></div> : !res.data.length ? <div className="card-body"><Empty icon={ShoppingCart}>Aucun besoin exprimé.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Article</th><th className="right">Quantité</th><th>Souhaité le</th><th>État</th><th>Fournisseur</th><th /></tr></thead>
            <tbody>{res.data.map(n => (
              <tr key={n.id}>
                <td><b>{n.label}</b>{n.phase_label && <div className="small muted">{n.phase_label}</div>}{n.note && <div className="small muted">{n.note}</div>}
                  <div className="small muted">Demandé par {n.requested_by_name || '—'}{n.validated_by_name ? ` · ${n.status === 'refuse' ? 'refusé' : 'traité'} par ${n.validated_by_name}` : ''}</div>
                  {n.refusal_reason && <div className="small" style={{ color: 'var(--danger)' }}>Motif : {n.refusal_reason}</div>}</td>
                <td className="right tabular nowrap">{num(n.quantity)} {n.unit_label}{n.estimate_fcfa != null && <div className="small muted">≈ {fcfa(n.estimate_fcfa)}</div>}</td>
                <td className="small nowrap">{n.needed_on ? date(n.needed_on) : '—'}</td>
                <td><Badge tone={NEED_TONES[n.status]}>{n.status_label}</Badge>
                  {n.ordered_on && <div className="small muted">commandé le {date(n.ordered_on)}</div>}
                  {n.delivered_on && <div className="small muted">livré le {date(n.delivered_on)}</div>}</td>
                <td className="small">{n.supplier_name || '—'}</td>
                <td className="right nowrap">
                  {/* Suite donnée par les Achats : le chantier suit, il ne valide ni ne commande. */}
                  {can('appro:read') && ['demande', 'valide', 'commande'].includes(n.status) && <Link className="btn btn-sm btn-ghost" to="/achats/besoins"><ShoppingCart />Suivi Achats</Link>}
                  {manage && n.status === 'demande' && <><button className="btn btn-ghost btn-icon" onClick={() => setForm(n)} aria-label={`Modifier ${n.label}`}><Pencil /></button><button className="btn btn-ghost btn-icon" onClick={() => remove(n)} aria-label={`Supprimer ${n.label}`}><Trash2 /></button></>}
                  {manage && n.status === 'valide' && <button className="btn btn-ghost btn-icon" onClick={() => window.confirm('Annuler ce besoin ?') && move(n, { status: 'annule' }, 'Besoin annulé')} aria-label="Annuler le besoin"><Ban /></button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {form && <NeedForm w={w} refs={refs} need={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); res.reload(); }} />}
    </div>
  );
}

function NeedForm({ w, refs, need, onClose, onSaved }) {
  const saved = useSaved();
  const units = Object.entries(refs.units || {});
  const [f, setF] = useState({
    label: need?.label || '', quantity: need?.quantity ?? '', unit: need?.unit || units[0]?.[0] || '', needed_on: need?.needed_on || '',
    phase_id: need?.phase_id || '', supplier_id: need?.supplier_id || '', estimate_fcfa: need?.estimate_fcfa ?? '', note: need?.note || '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    const body = {
      label: f.label, quantity: Number(f.quantity), unit: f.unit, needed_on: f.needed_on || null, phase_id: f.phase_id ? Number(f.phase_id) : null,
      supplier_id: f.supplier_id ? Number(f.supplier_id) : null, estimate_fcfa: f.estimate_fcfa === '' ? null : Number(f.estimate_fcfa), note: f.note || null,
    };
    try {
      if (need) await api.patch(`${CH}/${w.id}/besoins/${need.id}`, body); else await api.post(`${CH}/${w.id}/besoins`, body);
      saved(need ? 'Besoin modifié' : 'Besoin envoyé pour validation');
      onSaved();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal title={need ? 'Modifier le besoin' : 'Nouveau besoin en matériaux'} onClose={onClose}
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="need-form" disabled={busy}><Check />Enregistrer</button></>}>
      <form id="need-form" className="form-grid" onSubmit={submit}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Article" className="full"><input className="input" required minLength={2} maxLength={200} value={f.label} onChange={set('label')} placeholder="Ciment CPJ 42,5, fer de 12, parpaings de 15…" /></Field>
        <Field label="Quantité"><input className="input" type="number" required min={0.01} step="0.01" value={f.quantity} onChange={set('quantity')} /></Field>
        <Field label="Unité" hint="Liste réglable dans Chantiers › Réglages"><select className="select" required value={f.unit} onChange={set('unit')}>{units.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Souhaité le"><input className="input" type="date" value={f.needed_on} onChange={set('needed_on')} /></Field>
        <Field label="Phase"><select className="select" value={f.phase_id} onChange={set('phase_id')}><option value="">—</option>{w.phases.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
        <Field label="Fournisseur pressenti"><select className="select" value={f.supplier_id} onChange={set('supplier_id')}><option value="">—</option>{refs.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Coût estimé (FCFA)"><input className="input" type="number" min={0} value={f.estimate_fcfa} onChange={set('estimate_fcfa')} /></Field>
        <Field label="Note" className="full"><input className="input" maxLength={1000} value={f.note} onChange={set('note')} /></Field>
      </form>
    </Modal>
  );
}

// ─── Réception d'un lot ─────────────────────────────────────────────────────

export function HandoverForm({ w, row, refs, onClose, onSaved }) {
  const saved = useSaved();
  const [f, setF] = useState({ handed_on: today(), client_signed: true, attendees: '', note: '' });
  const [reserves, setReserves] = useState([]);
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const setR = (i, k, v) => setReserves(rs => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    const list = reserves.filter(r => r.label.trim()).map(r => ({ label: r.label.trim(), location: r.location || null, category: r.category || null, deadline: r.deadline || null }));
    try {
      const out = await api.post(`${CH}/${w.id}/livraisons/${row.sale_id}/reception`, formData({ ...f, reserves: JSON.stringify(list) }, file));
      saved(`Lot ${row.lot_code} réceptionné : ${out.reserves} réserve(s) ouverte(s) au SAV${out.declaration_id ? ', dernier appel de fonds à déclarer' : ''}`);
      onSaved(out);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Réception du lot ${row.lot_code} — ${row.client_name}`} onClose={onClose}
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="handover-form" disabled={busy}><Check />Enregistrer le PV</button></>}>
      <form id="handover-form" className="form-grid" onSubmit={submit}>
        <div className="full"><ErrorBox error={error} /></div>
        <p className="small muted full" style={{ margin: 0 }}>
          La date de réception devient la date de livraison du dossier (départ des garanties). Les réserves s’ouvrent dans Client &amp; SAV › Réserves ; l’acquéreur voit le PV et leur levée dans son espace.
          {row.vefa && ' Dossier VEFA : l’étape « Livraison » de ce lot est signalée à la Direction pour le dernier appel de fonds.'}
        </p>
        <Field label="Réceptionné le"><input className="input" type="date" required max={today()} value={f.handed_on} onChange={e => setF({ ...f, handed_on: e.target.value })} /></Field>
        <Field label="PV signé par l’acquéreur"><label className="row small" style={{ gap: 8, minHeight: 38 }}><input type="checkbox" checked={f.client_signed} onChange={e => setF({ ...f, client_signed: e.target.checked })} />Oui</label></Field>
        <Field label="Présents" className="full"><input className="input" maxLength={255} value={f.attendees} onChange={e => setF({ ...f, attendees: e.target.value })} placeholder="L’acquéreur, le conducteur, le commercial…" /></Field>
        <Field label="PV de réception (PDF, image)" className="full"><input className="input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files[0] || null)} /></Field>
        <div className="full stack" style={{ gap: 8 }}>
          <div className="row-between"><b className="small">Réserves notées ({reserves.length})</b><button type="button" className="btn btn-sm" onClick={() => setReserves(rs => [...rs, { label: '', location: '', category: '', deadline: '' }])}><Plus />Ajouter une réserve</button></div>
          {reserves.map((r, i) => (
            <div key={i} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" style={{ flex: '2 1 220px' }} required minLength={2} maxLength={255} value={r.label} onChange={e => setR(i, 'label', e.target.value)} placeholder="Fissure sur l’enduit, porte qui frotte…" aria-label="Réserve" />
              <input className="input" style={{ flex: '1 1 120px' }} maxLength={120} value={r.location} onChange={e => setR(i, 'location', e.target.value)} placeholder="Pièce, façade" aria-label="Emplacement" />
              <select className="select" style={{ flex: '1 1 160px' }} value={r.category} onChange={e => setR(i, 'category', e.target.value)} aria-label="Catégorie"><option value="">Catégorie…</option>{Object.entries(refs.sav_categories || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input className="input" style={{ flex: '0 1 150px' }} type="date" value={r.deadline} onChange={e => setR(i, 'deadline', e.target.value)} aria-label="Levée attendue avant le" title="Levée attendue avant le" />
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setReserves(rs => rs.filter((_, j) => j !== i))} aria-label="Retirer la réserve"><X /></button>
            </div>
          ))}
        </div>
        <Field label="Note" className="full"><textarea className="textarea" rows={2} maxLength={4000} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}
