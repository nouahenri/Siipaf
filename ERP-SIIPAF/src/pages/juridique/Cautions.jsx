/**
 * Juridique › Cautions et garanties (choix du client du 23/10) : retenues de garantie de la sous-traitance (libérées
 * à la fin du délai de garantie compté depuis la réception), cautions reçues des tiers, cautions données par SIIPAF,
 * et toute autre sorte réglée dans Juridique › Réglages. Alertes avant l'échéance aux délais de Juridique › Réglages (30 puis 7 jours par défaut).
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, ShieldCheck, Search, Check, Pencil, Undo2, Paperclip, FileText, Ban } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useSaved } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Drawer, Modal, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { today, formData } from '../../lib/rh';
import { JUR, GAR_TONES, DaysLeft } from '../../lib/juridique';

const addMonths = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};

export default function Cautions() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('active');
  const [direction, setDirection] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const refs = useResource(`${JUR}/refs`);
  const list = useResource(`${JUR}/cautions${qs({ status, direction, q })}`);
  const open = Number(params.get('fiche')) || null;
  const setOpen = id => setParams(id ? { fiche: String(id) } : {}, { replace: true });
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  // Totaux par sens : additionner une caution reçue et une caution donnée n'aurait pas de sens
  const totals = {};
  for (const g of list.data || []) { totals[g.direction] ||= { n: 0, amount: 0 }; totals[g.direction].n++; totals[g.direction].amount += g.amount_fcfa; }

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="seg" role="group" aria-label="Statut">
            {[['active', 'En cours'], ['', 'Toutes']].map(([k, l]) => <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>)}
          </div>
          <select className="select" style={{ width: 'auto' }} value={direction} onChange={e => setDirection(e.target.value)} aria-label="Sens">
            <option value="">Tous les sens</option>{refs.data && Object.entries(refs.data.directions).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <label style={{ position: 'relative' }}>
            <Search aria-hidden="true" style={{ position: 'absolute', left: 10, top: 10, width: 16, height: 16, opacity: 0.5 }} />
            <input className="input" style={{ paddingLeft: 32, width: 220 }} type="search" placeholder="Référence, tiers, banque, contrat…" value={text} onChange={e => setText(e.target.value)} aria-label="Rechercher" />
          </label>
        </div>
        {can('juridique:write') && <button className="btn btn-primary" onClick={() => setForm({})}><Plus />Nouvelle caution</button>}
      </div>

      <Card bodyClass="">
        <ErrorBox error={list.error} />
        {!list.data ? <div className="card-body"><Skeleton h={220} /></div> : !list.data.length ? (
          <div className="card-body"><Empty icon={ShieldCheck}>Aucune caution.</Empty></div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Référence</th><th>Sorte</th><th>Tiers</th><th className="right">Montant</th><th>Échéance</th><th>Statut</th></tr></thead>
            <tbody>{list.data.map(g => (
              <tr key={g.id} className="clickable" onClick={() => setOpen(g.id)}>
                <td className="small tabular nowrap"><b>{g.reference}</b></td>
                <td>{g.kind_label}<div className="small muted">{[g.direction_label !== g.kind_label && g.direction_label, g.contract_reference].filter(Boolean).join(' · ')}</div></td>
                <td>{g.counterparty_name || '—'}{g.bank && <div className="small muted">{g.bank}</div>}</td>
                <td className="right tabular">{fcfa(g.amount_fcfa)}</td>
                <td className="small">{g.deadline ? <>{g.deadline.label}<div className="nowrap">{date(g.deadline.date)} <DaysLeft n={g.deadline.days_left} /></div></> : '—'}</td>
                <td><Badge tone={GAR_TONES[g.status]}>{g.status_label}</Badge></td>
              </tr>
            ))}</tbody>
            <tfoot>{Object.entries(totals).map(([dir, t]) => (
              <tr key={dir}><td colSpan={3} className="small muted">{refs.data?.directions[dir]} · {t.n}</td><td className="right tabular"><b>{fcfa(t.amount)}</b></td><td colSpan={2} /></tr>
            ))}</tfoot>
          </table></div>
        )}
      </Card>

      {open && refs.data && <GuaranteeDrawer id={open} onClose={() => setOpen(null)} onChange={() => list.reload()} onEdit={g => setForm({ guarantee: g })} />}
      {form && refs.data && <GuaranteeForm guarantee={form.guarantee} refs={refs.data} onClose={() => setForm(null)} onSaved={g => { setForm(null); list.reload(); setOpen(g.id); }} />}
    </div>
  );
}

function GuaranteeDrawer({ id, onClose, onChange, onEdit }) {
  const { can } = useAuth();
  const saved = useSaved();
  const x = useResource(`${JUR}/cautions/${id}`);
  const g = x.data;
  const [closing, setClosing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const write = can('juridique:write');
  const act = async (path, body, message) => {
    setBusy(true); setError(null);
    try { x.setData(await api.post(`${JUR}/cautions/${id}/${path}`, body)); onChange(); saved(message); setClosing(null); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const retenue = g?.direction === 'retenue';
  return (
    <Drawer title={g ? `${g.reference} · ${g.kind_label}` : 'Caution'} onClose={onClose}>
      {x.error ? <ErrorBox error={x.error} /> : !g ? <Skeleton h={300} /> : (
        <div className="stack" style={{ gap: 16 }}>
          <ErrorBox error={error} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><Badge tone={GAR_TONES[g.status]}>{g.status_label}</Badge>{g.direction_label !== g.kind_label && <Badge>{g.direction_label}</Badge>}</div>
          <div>
            <div className="kv"><span>{g.direction === 'donnee' ? 'Bénéficiaire' : 'Tiers'}</span><b>{g.counterparty_name || '—'}</b></div>
            {g.bank && <div className="kv"><span>Banque</span><b>{g.bank}</b></div>}
            <div className="kv"><span>Montant</span><b>{fcfa(g.amount_fcfa)}</b></div>
            {g.contract_label && <div className="kv"><span>Contrat</span><b>{g.contract_label}</b></div>}
            {g.issued_on && <div className="kv"><span>Émise le</span><b>{date(g.issued_on)}</b></div>}
            {retenue ? (
              <>
                <div className="kv"><span>Réception des travaux</span><b>{g.reception_on ? date(g.reception_on) : 'à préciser'}</b></div>
                <div className="kv"><span>Libération prévue</span><b>{g.release_on ? date(g.release_on) : 'à préciser'}</b></div>
              </>
            ) : g.expires_on && <div className="kv"><span>Expire le</span><b>{date(g.expires_on)}</b></div>}
            {g.deadline && <div className="kv"><span>{g.deadline.label}</span><b className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>{date(g.deadline.date)} <DaysLeft n={g.deadline.days_left} /></b></div>}
            <div className="kv"><span>Responsable</span><b>{g.owner_name || '—'}</b></div>
            {g.status !== 'active' && <div className="kv"><span>{g.status_label} le</span><b>{date(g.closed_on)}{g.close_note ? ` · ${g.close_note}` : ''}</b></div>}
          </div>
          {g.notes && <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{g.notes}</p>}
          {g.file_url && <a className="btn" style={{ alignSelf: 'start' }} href={g.file_url} target="_blank" rel="noreferrer"><FileText />Ouvrir l’acte de caution</a>}
          {write && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {g.status === 'active' && <button className="btn" onClick={() => onEdit(g)}><Pencil />Modifier</button>}
              {g.status === 'active' && <button className="btn btn-ghost" onClick={() => setClosing({ status: 'liberee', date: today(), note: '' })}><Ban />{retenue ? 'Libérer ou clore' : 'Mainlevée ou clôture'}</button>}
              {g.status !== 'active' && <button className="btn btn-ghost" disabled={busy} onClick={() => act('reopen', {}, 'Caution remise en cours')}><Undo2 />Remettre en cours</button>}
            </div>
          )}
          {closing && (
            <div className="erp-panel form-grid">
              <Field label="Clôture"><select className="select" value={closing.status} onChange={e => setClosing(s => ({ ...s, status: e.target.value }))}>
                <option value="liberee">{retenue ? 'Retenue libérée (remboursée)' : 'Libérée / mainlevée'}</option><option value="appelee">Mise en jeu</option><option value="expiree">Expirée</option>
              </select></Field>
              <Field label="Date"><input className="input" type="date" value={closing.date} onChange={e => setClosing(s => ({ ...s, date: e.target.value }))} /></Field>
              <Field label="Observation" className="full"><input className="input" maxLength={255} value={closing.note} onChange={e => setClosing(s => ({ ...s, note: e.target.value }))} /></Field>
              <div className="full row" style={{ gap: 8 }}>
                <button className="btn btn-primary" disabled={busy} onClick={() => act('close', { ...closing, note: closing.note.trim() || undefined }, 'Caution close')}><Check />Confirmer</button>
                <button className="btn btn-ghost" onClick={() => setClosing(null)}>Annuler</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function GuaranteeForm({ guarantee: g, refs, onClose, onSaved }) {
  const saved = useSaved();
  const links = useResource(`${JUR}/liens`);
  const kinds = refs.guarantee_kinds.filter(k => k.active || k.id === g?.kind_id);
  const [f, setF] = useState({
    kind_id: g?.kind_id || kinds[0]?.id || '', contract_id: g?.contract_id || '', supplier_id: g?.supplier_id || '', counterparty: g?.counterparty || '',
    bank: g?.bank || '', amount_fcfa: g?.amount_fcfa ?? '', issued_on: g?.issued_on || '', expires_on: g?.expires_on || '',
    reception_on: g?.reception_on || '', release_on: g?.release_on || '', owner_id: g?.owner_id || '', notes: g?.notes || '',
  });
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const kind = refs.guarantee_kinds.find(k => k.id === Number(f.kind_id));
  const retenue = kind?.direction === 'retenue';
  const months = refs.settings.legal_warranty_months;
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  // Contrat choisi : le fournisseur et, pour une retenue, le montant (marché × taux de retenue) sont proposés
  const pickContract = e => {
    const c = links.data?.contracts.find(x => x.id === Number(e.target.value));
    setF(x => ({
      ...x, contract_id: e.target.value, supplier_id: c?.supplier_id || x.supplier_id,
      amount_fcfa: retenue && c?.contract_amount && c?.retention_pct && !x.amount_fcfa ? Math.round(c.contract_amount * c.retention_pct / 100) : x.amount_fcfa,
    }));
  };
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const fields = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? 'null' : v]));
      const data = g ? await api.patch(`${JUR}/cautions/${g.id}`, formData(fields, { file })) : await api.post(`${JUR}/cautions`, formData(fields, { file }));
      saved(g ? 'Caution modifiée' : `Caution enregistrée sous la référence ${data.reference}`);
      onSaved(data);
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title={g ? `Modifier ${g.reference}` : 'Nouvelle caution'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="guarantee-form" disabled={busy}><Check />Enregistrer</button></>}>
      <form id="guarantee-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error || links.error} /></div>
        <Field label="Sorte" hint="Liste réglable dans Juridique › Réglages"><select className="select" value={f.kind_id} onChange={set('kind_id')}>{kinds.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}</select></Field>
        <Field label="Sens"><input className="input" readOnly value={kind ? refs.directions[kind.direction] : ''} /></Field>
        <Field label="Contrat" className="full" hint={retenue ? 'Le montant est proposé d’après le marché et le taux de retenue du contrat' : null}>
          <select className="select" value={f.contract_id} onChange={pickContract}><option value="">— Aucun —</option>{(links.data?.contracts || []).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        </Field>
        <Field label="Fournisseur"><select className="select" value={f.supplier_id} onChange={set('supplier_id')}><option value="">— Aucun —</option>{refs.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Autre tiers" hint="S’il n’est pas dans les fournisseurs"><input className="input" maxLength={160} value={f.counterparty} onChange={set('counterparty')} /></Field>
        <Field label="Montant (FCFA)"><input className="input" type="number" min="1" required value={f.amount_fcfa} onChange={set('amount_fcfa')} /></Field>
        {retenue ? <div /> : <Field label="Banque"><input className="input" maxLength={160} value={f.bank} onChange={set('bank')} /></Field>}
        {retenue ? (
          <>
            <Field label="Réception des travaux"><input className="input" type="date" value={f.reception_on} onChange={e => setF(x => ({ ...x, reception_on: e.target.value, release_on: e.target.value ? addMonths(e.target.value, months) : x.release_on }))} /></Field>
            <Field label="Libération prévue" hint={`Proposée ${months} mois après la réception (Juridique › Réglages)`}><input className="input" type="date" value={f.release_on} onChange={set('release_on')} /></Field>
          </>
        ) : (
          <>
            <Field label="Émise le"><input className="input" type="date" value={f.issued_on} onChange={set('issued_on')} /></Field>
            <Field label="Expire le" hint={`Alerte ${refs.settings.legal_alert_first_days} puis ${refs.settings.legal_alert_second_days} jours avant`}><input className="input" type="date" min={f.issued_on || undefined} value={f.expires_on} onChange={set('expires_on')} /></Field>
          </>
        )}
        <Field label="Responsable" hint="Reçoit les alertes avec le juriste"><select className="select" value={f.owner_id} onChange={set('owner_id')}><option value="">—</option>{refs.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Acte de caution" hint="PDF ou photo, 20 Mo au plus">
          <label className="btn" style={{ alignSelf: 'start' }}><Paperclip />{file ? file.name : g?.file_url ? 'Remplacer le fichier' : 'Joindre le fichier'}<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files[0] || null)} /></label>
        </Field>
        <Field label="Observations" className="full"><textarea className="textarea" rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  );
}
