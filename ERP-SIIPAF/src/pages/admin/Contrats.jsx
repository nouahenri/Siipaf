import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, FileClock, FileText, Paperclip, Check, Pencil, Ban, Undo2, Search, RefreshCw, Trash2, Receipt } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Drawer, Modal, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { today, formData } from '../../lib/rh';
import PlacePicker, { placeLabel } from '../../components/PlacePicker';

const URL = '/admin/erp/contrats';
const STATUS_TONES = { actif: 'ok', termine: '', resilie: '' };

/** Jours restants avant une échéance : rouge si dépassée, or à 7 jours, neutre au-delà. */
function DaysLeft({ n }) {
  if (n < 0) return <Badge tone="danger">dépassée de {-n} j</Badge>;
  if (n === 0) return <Badge tone="danger">aujourd’hui</Badge>;
  return <Badge tone={n <= 7 ? 'warn' : ''}>dans {n} j</Badge>;
}

/**
 * Contrats et échéances (choix du client du 22/10) : tous les contrats de l'entreprise, leur fin ou renouvellement
 * tacite, le préavis, la révision de prix, les paiements périodiques (facture d'achat en brouillon en Comptabilité)
 * et les pièces à renouveler. Alertes (par défaut 30 puis 7 jours avant, Administration générale › Réglages) au responsable du contrat et au responsable d'exploitation.
 */
export default function Contrats() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('echeances');
  const [horizon, setHorizon] = useState(60);
  const [status, setStatus] = useState('actif');
  const [kind, setKind] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null); // {} nouveau, { contract } modification
  const refs = useResource(`${URL}/refs`);
  const deadlines = useResource(tab === 'echeances' ? `${URL}/echeances?days=${horizon}` : null);
  const list = useResource(tab === 'contrats' ? `${URL}${qs({ status, kind, q })}` : null);
  const open = Number(params.get('fiche')) || null;
  const setOpen = id => setParams(id ? { fiche: String(id) } : {}, { replace: true });
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const reload = () => { deadlines.reload?.(); list.reload?.(); };

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="seg" role="group" aria-label="Affichage">
            <button className={tab === 'echeances' ? 'active' : ''} onClick={() => setTab('echeances')}>Échéances</button>
            <button className={tab === 'contrats' ? 'active' : ''} onClick={() => setTab('contrats')}>Contrats</button>
          </div>
          {tab === 'echeances' ? (
            <select className="select" style={{ width: 'auto' }} value={horizon} onChange={e => setHorizon(Number(e.target.value))} aria-label="Horizon">
              <option value={30}>30 prochains jours</option><option value={60}>60 prochains jours</option><option value={90}>3 prochains mois</option><option value={365}>12 prochains mois</option>
            </select>
          ) : (
            <>
              <select className="select" style={{ width: 'auto' }} value={status} onChange={e => setStatus(e.target.value)} aria-label="Statut">
                <option value="">Tous</option>{refs.data && Object.entries(refs.data.statuses).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <select className="select" style={{ width: 'auto' }} value={kind} onChange={e => setKind(e.target.value)} aria-label="Type">
                <option value="">Tous les types</option>{refs.data && Object.entries(refs.data.kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <label style={{ position: 'relative' }}>
                <Search aria-hidden="true" style={{ position: 'absolute', left: 10, top: 10, width: 16, height: 16, opacity: 0.5 }} />
                <input className="input" style={{ paddingLeft: 32, width: 220 }} type="search" placeholder="Référence, objet, cocontractant…" value={text} onChange={e => setText(e.target.value)} aria-label="Rechercher" />
              </label>
            </>
          )}
        </div>
        {can('contrats:write') && <button className="btn btn-primary" onClick={() => setForm({})}><Plus />Nouveau contrat</button>}
      </div>

      {tab === 'echeances' ? (
        <Card bodyClass="">
          <ErrorBox error={deadlines.error} />
          {!deadlines.data ? <div className="card-body"><Skeleton h={220} /></div> : !deadlines.data.length ? (
            <div className="card-body"><Empty icon={FileClock}>Aucune échéance sur la période.</Empty></div>
          ) : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Date</th><th>Échéance</th><th>Contrat</th><th>Cocontractant</th><th>Responsable</th><th className="right">Montant</th></tr></thead>
              <tbody>{deadlines.data.map(d => (
                <tr key={`${d.contract_id}-${d.key}`} className="clickable" onClick={() => setOpen(d.contract_id)}>
                  <td className="nowrap"><span className="small">{date(d.date)}</span><div><DaysLeft n={d.days_left} /></div></td>
                  <td>{d.label}{d.kind === 'paiement' && <div className="small muted">Facture d’achat préparée {refs.data?.invoice_lead_days} jours avant</div>}</td>
                  <td><b className="small tabular">{d.reference}</b><div>{d.title}</div></td>
                  <td>{d.counterparty_name || '—'}</td>
                  <td className="small">{d.owner_name || '—'}</td>
                  <td className="right tabular">{d.amount_ttc ? fcfa(d.amount_ttc) : ''}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      ) : (
        <Card bodyClass="">
          <ErrorBox error={list.error} />
          {!list.data ? <div className="card-body"><Skeleton h={220} /></div> : !list.data.length ? (
            <div className="card-body"><Empty icon={FileClock}>Aucun contrat.</Empty></div>
          ) : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Référence</th><th>Contrat</th><th>Cocontractant</th><th>Responsable</th><th>Fin</th><th>Prochaine échéance</th><th>Statut</th></tr></thead>
              <tbody>{list.data.map(c => (
                <tr key={c.id} className="clickable" onClick={() => setOpen(c.id)}>
                  <td className="small tabular nowrap"><b>{c.reference}</b></td>
                  <td>{c.title}<div className="small muted">{c.kind_label} · {placeLabel(c)}</div></td>
                  <td>{c.counterparty_name || '—'}</td>
                  <td className="small">{c.owner_name || '—'}</td>
                  <td className="small nowrap">{c.end_date ? date(c.end_date) : 'Indéterminée'}{c.tacit_renewal && <div className="muted">tacite reconduction</div>}</td>
                  <td className="small">{c.next_deadline ? <>{c.next_deadline.label}<div className="nowrap">{date(c.next_deadline.date)} <DaysLeft n={c.next_deadline.days_left} /></div></> : '—'}</td>
                  <td><Badge tone={STATUS_TONES[c.status]}>{c.status_label}</Badge></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}

      {open && refs.data && <ContractDrawer id={open} refs={refs.data} onClose={() => setOpen(null)} onChange={reload} onEdit={c => setForm({ contract: c })} />}
      {form && refs.data && <ContractForm contract={form.contract} refs={refs.data} onClose={() => setForm(null)} onSaved={c => { setForm(null); reload(); setOpen(c.id); }} />}
    </div>
  );
}

function ContractDrawer({ id, refs, onClose, onChange, onEdit }) {
  const { can } = useAuth();
  const toast = useToast();
  const x = useResource(`${URL}/${id}`);
  const c = x.data;
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(null); // { status, date, reason }
  const [doc, setDoc] = useState(null); // {} nouvelle pièce, { doc } renouvellement
  const write = can('contrats:write');
  const canGuarantees = ['juridique:read', 'juridique:write', 'direction:read', 'compta:read'].some(can);
  const act = async (path, body, message) => {
    setBusy(true);
    try { x.setData(await api.post(`${URL}/${id}/${path}`, body)); onChange(); toast(message); setClosing(null); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const removeDoc = async d => {
    if (!window.confirm(`Retirer la pièce « ${d.label} » ?`)) return;
    try { x.setData(await api.del(`${URL}/documents/${d.id}`)); onChange(); toast('Pièce retirée'); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Drawer title={c ? `${c.reference} · ${c.kind_label}` : 'Contrat'} onClose={onClose}>
      {x.error ? <ErrorBox error={x.error} /> : !c ? <Skeleton h={300} /> : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Badge tone={STATUS_TONES[c.status]}>{c.status_label}</Badge>
            {c.tacit_renewal && <Badge>Tacite reconduction</Badge>}
          </div>
          <div>
            <h3 style={{ margin: '0 0 8px' }}>{c.title}</h3>
            <div className="kv"><span>Cocontractant</span><b>{c.counterparty_name || '—'}</b></div>
            <div className="kv"><span>Affectation</span><b>{placeLabel(c)}</b></div>
            <div className="kv"><span>Responsable</span><b>{c.owner_name || '—'}</b></div>
            <div className="kv"><span>Durée</span><b>du {date(c.start_date)} {c.end_date ? `au ${date(c.end_date)}` : '— indéterminée'}</b></div>
            {c.tacit_renewal && <div className="kv"><span>Reconduction</span><b>par périodes de {c.renewal_months || 12} mois</b></div>}
            {c.notice_days ? <div className="kv"><span>Préavis</span><b>{c.notice_days} jours</b></div> : null}
            {c.contract_amount ? <div className="kv"><span>Montant du contrat</span><b>{fcfa(c.contract_amount)}</b></div> : null}
            {c.retention_pct ? <div className="kv"><span>Retenue de garantie</span><b>{c.retention_pct} %</b></div> : null}
            {c.kind === 'sous_traitance' && <div className="kv"><span>Situations</span><b>TVA {c.vat_rate || 0} % · compte {c.expense_account || 'du sous-traitant'}</b></div>}
            {c.frequency && <div className="kv"><span>Paiement</span><b>{c.frequency_label} · {fcfa(c.amount_ttc)} TTC{c.vat_rate ? ` (TVA ${c.vat_rate} %)` : ''} · compte {c.expense_account || '—'}</b></div>}
            {c.revision_date && <div className="kv"><span>Révision de prix</span><b>{date(c.revision_date)}{c.revision_note ? ` · ${c.revision_note}` : ''}</b></div>}
            {c.status !== 'actif' && <div className="kv"><span>{c.status === 'resilie' ? 'Résilié le' : 'Terminé le'}</span><b>{date(c.closed_on)}{c.close_reason ? ` · ${c.close_reason}` : ''}</b></div>}
          </div>
          {c.notes && <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{c.notes}</p>}
          {c.file_url && <a className="btn" style={{ alignSelf: 'start' }} href={c.file_url} target="_blank" rel="noreferrer"><FileText />Ouvrir le contrat signé</a>}

          {c.deadlines.length > 0 && (
            <div className="erp-panel">
              <b>Échéances</b>
              {c.deadlines.map(d => <div key={d.key} className="kv"><span style={{ flexShrink: 1 }}>{d.label}</span><b className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap', textAlign: 'right' }}>{date(d.date)} <DaysLeft n={d.days_left} /></b></div>)}
            </div>
          )}

          <div className="erp-panel">
            <div className="row-between"><b>Pièces à renouveler</b>{write && c.status === 'actif' && <button className="btn btn-ghost" onClick={() => setDoc({})}><Plus />Ajouter</button>}</div>
            {!c.documents.length ? <p className="small muted" style={{ margin: '6px 0 0' }}>Aucune pièce suivie (attestation d’assurance, caution, attestations fiscale et CNPS…).</p> : c.documents.map(d => (
              <div key={d.id} className="kv">
                <span style={{ flexShrink: 1 }}>{d.label}<div className="small muted">{d.kind_label}</div></span>
                <b className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  {d.expires_on ? <>expire le {date(d.expires_on)}</> : 'sans échéance'}
                  {d.file_url && <a className="btn btn-ghost btn-icon" href={d.file_url} target="_blank" rel="noreferrer" aria-label={`Ouvrir ${d.label}`}><FileText /></a>}
                  {write && <button className="btn btn-ghost btn-icon" onClick={() => setDoc({ doc: d })} aria-label={`Renouveler ${d.label}`} title="Renouveler"><RefreshCw /></button>}
                  {write && <button className="btn btn-ghost btn-icon" onClick={() => removeDoc(d)} aria-label={`Retirer ${d.label}`}><Trash2 /></button>}
                </b>
              </div>
            ))}
          </div>

          {c.guarantees?.length > 0 && (
            <div className="erp-panel">
              <b>Cautions et retenues de garantie</b>
              {c.guarantees.map(g => (
                <div key={g.id} className="kv">
                  <span style={{ flexShrink: 1 }}>{canGuarantees ? <Link to={`/juridique/cautions?fiche=${g.id}`}>{g.reference}</Link> : g.reference} · {g.kind_label}</span>
                  <b className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>{fcfa(g.amount_fcfa)} {g.deadline ? <>{date(g.deadline.date)} <DaysLeft n={g.deadline.days_left} /></> : <Badge>{g.status_label}</Badge>}</b>
                </div>
              ))}
              <p className="small muted" style={{ margin: '6px 0 0' }}>Suivies dans Juridique › Cautions et garanties.</p>
            </div>
          )}

          {c.invoices?.length > 0 && (
            <div className="erp-panel">
              <b>Factures d’achat préparées</b>
              {c.invoices.map(i => (
                <div key={i.due_date} className="kv"><span style={{ flexShrink: 1 }}><Receipt style={{ width: 14, height: 14, verticalAlign: -2 }} /> Échéance du {date(i.due_date)}</span><b>{i.number || 'supprimée'}{i.amount_ttc ? ` · ${fcfa(i.amount_ttc)}` : ''} {i.status && <Badge tone={i.status === 'validee' ? 'ok' : 'warn'}>{i.status === 'validee' ? 'validée' : i.status === 'annulee' ? 'annulée' : 'brouillon'}</Badge>}</b></div>
              ))}
              <p className="small muted" style={{ margin: '6px 0 0' }}>Le comptable les vérifie et les valide dans Comptabilité › Achats et fournisseurs.</p>
            </div>
          )}

          {write && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {c.status === 'actif' && <button className="btn" onClick={() => onEdit(c)}><Pencil />Modifier</button>}
              {c.status === 'actif' && <button className="btn btn-ghost" onClick={() => setClosing({ status: 'resilie', date: today(), reason: '' })}><Ban />Résilier ou terminer</button>}
              {c.status !== 'actif' && <button className="btn btn-ghost" disabled={busy} onClick={() => act('reopen', {}, 'Contrat remis en cours')}><Undo2 />Remettre en cours</button>}
            </div>
          )}
          {closing && (
            <div className="erp-panel form-grid">
              <Field label="Clôture"><select className="select" value={closing.status} onChange={e => setClosing(s => ({ ...s, status: e.target.value }))}><option value="resilie">Résiliation</option><option value="termine">Fin normale</option></select></Field>
              <Field label="Date"><input className="input" type="date" value={closing.date} onChange={e => setClosing(s => ({ ...s, date: e.target.value }))} /></Field>
              <Field label={`Motif${closing.status === 'resilie' ? '' : ' (facultatif)'}`} className="full"><input className="input" value={closing.reason} onChange={e => setClosing(s => ({ ...s, reason: e.target.value }))} /></Field>
              <div className="full row" style={{ gap: 8 }}>
                <button className="btn btn-primary" disabled={busy || (closing.status === 'resilie' && !closing.reason.trim())} onClick={() => act('close', { ...closing, reason: closing.reason.trim() || undefined }, closing.status === 'resilie' ? 'Contrat résilié' : 'Contrat terminé')}><Check />Confirmer</button>
                <button className="btn btn-ghost" onClick={() => setClosing(null)}>Annuler</button>
              </div>
            </div>
          )}
        </div>
      )}
      {doc && c && <DocForm contract={c} doc={doc.doc} refs={refs} onClose={() => setDoc(null)} onSaved={data => { setDoc(null); x.setData(data); onChange(); }} />}
    </Drawer>
  );
}

function DocForm({ contract, doc, refs, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ kind: doc?.kind || 'attestation_assurance', label: doc?.label || '', expires_on: doc?.expires_on || '' });
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const body = formData({ ...f, label: f.label || refs.doc_kinds[f.kind], expires_on: f.expires_on || 'null' }, { file });
      const data = doc ? await api.patch(`${URL}/documents/${doc.id}`, body) : await api.post(`${URL}/${contract.id}/documents`, body);
      toast(doc ? 'Pièce renouvelée' : 'Pièce ajoutée');
      onSaved(data);
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title={doc ? `Renouveler « ${doc.label} »` : 'Pièce à renouveler'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="doc-form" disabled={busy}><Check />Enregistrer</button></>}>
      <form id="doc-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Type"><select className="select" value={f.kind} onChange={set('kind')}>{Object.entries(refs.doc_kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Expire le" hint={`Alerte ${refs.alert_days[0]} puis ${refs.alert_days[1]} jours avant`}><input className="input" type="date" value={f.expires_on} onChange={set('expires_on')} /></Field>
        <Field label="Intitulé" className="full"><input className="input" maxLength={160} value={f.label} onChange={set('label')} placeholder={refs.doc_kinds[f.kind]} /></Field>
        <Field label="Fichier" className="full" hint="PDF ou photo, 20 Mo au plus">
          <label className="btn" style={{ alignSelf: 'start' }}><Paperclip />{file ? file.name : doc?.file_url ? 'Remplacer le fichier' : 'Joindre le fichier'}<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files[0] || null)} /></label>
        </Field>
      </form>
    </Modal>
  );
}

/** Contrat : création ou modification ; `preset` propose des valeurs (marché de sous-traitance créé depuis un chantier). */
export function ContractForm({ contract: c, preset = null, refs, onClose, onSaved }) {
  const p = c || preset || {};
  const toast = useToast();
  const [f, setF] = useState({
    kind: p.kind || 'fournisseur', kind_other: p.kind_other || '', title: p.title || '', supplier_id: p.supplier_id || '', counterparty: p.counterparty || '',
    site: { project_id: p.project_id || null, worksite_id: p.worksite_id || null, place_id: p.place_id || null }, owner_id: p.owner_id || '', start_date: p.start_date || today(), end_date: p.end_date || '',
    tacit_renewal: p.tacit_renewal || false, renewal_months: p.renewal_months || 12, notice_days: p.notice_days ?? '', contract_amount: p.contract_amount ?? '',
    retention_pct: p.retention_pct ?? '', frequency: p.frequency || '', amount_ttc: p.amount_ttc ?? '', vat_rate: p.vat_rate ?? 0,
    expense_account: p.expense_account || '', next_payment_date: p.next_payment_date || '', revision_date: p.revision_date || '', revision_note: p.revision_note || '', notes: p.notes || '',
  });
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      // Champ vidé : « null » efface la valeur enregistrée
      const { site, ...rest } = f;
      const fields = Object.fromEntries(Object.entries({ ...rest, ...site }).map(([k, v]) => [k, v === '' || v == null ? 'null' : v]));
      if (!f.frequency) Object.assign(fields, { amount_ttc: 'null', next_payment_date: 'null' });
      // Sans tacite reconduction, pas de période de reconduction (le formulaire en propose 12 mois si on la coche)
      if (!f.tacit_renewal) fields.renewal_months = 'null';
      const body = formData(fields, { file });
      const saved = c ? await api.patch(`${URL}/${c.id}`, body) : await api.post(URL, body);
      toast(c ? 'Contrat modifié' : `Contrat enregistré sous la référence ${saved.reference}`);
      onSaved(saved);
    } catch (err) { setError(err); setBusy(false); }
  };
  const sub = f.kind === 'sous_traitance';
  return (
    <Modal title={c ? `Modifier ${c.reference}` : 'Nouveau contrat'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="contract-form" disabled={busy}><Check />Enregistrer</button></>}>
      <form id="contract-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Type de contrat"><select className="select" value={f.kind} onChange={set('kind')}>{Object.entries(refs.kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {f.kind === 'autre' ? <Field label="Nature du contrat"><input className="input" required maxLength={100} value={f.kind_other} onChange={set('kind_other')} placeholder="Convention, partenariat, mandat…" /></Field> : <div />}
        <Field label="Objet" className="full"><input className="input" required minLength={3} maxLength={200} value={f.title} onChange={set('title')} placeholder="Gardiennage du siège, bail du dépôt de Bingerville…" /></Field>
        <Field label="Fournisseur" hint="Fichier de la Comptabilité ; requis pour les paiements périodiques">
          <select className="select" value={f.supplier_id} onChange={set('supplier_id')}><option value="">— Aucun —</option>{refs.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </Field>
        <Field label="Autre cocontractant" hint="Bailleur, assureur… s’il n’est pas dans les fournisseurs"><input className="input" maxLength={160} value={f.counterparty} onChange={set('counterparty')} /></Field>
        <Field label="Responsable du contrat" hint="Reçoit les alertes avec le responsable d’exploitation"><select className="select" value={f.owner_id} onChange={set('owner_id')}><option value="">—</option>{refs.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label={sub ? 'Chantier (sous-traitance)' : 'Affectation'} hint="Programme, chantier ou lieu (bail du siège, abonnement d’un bureau…) ; vide : siège social"><PlacePicker value={f.site} onChange={v => setF(x => ({ ...x, site: v }))} /></Field>

        <Field label="Début"><input className="input" type="date" required value={f.start_date} onChange={set('start_date')} /></Field>
        <Field label="Fin" hint="Vide : durée indéterminée"><input className="input" type="date" min={f.start_date} value={f.end_date} onChange={set('end_date')} /></Field>
        <div className="full row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.tacit_renewal} onChange={set('tacit_renewal')} />Tacite reconduction</label>
          {f.tacit_renewal && <Field label="Par périodes de (mois)"><input className="input" type="number" min="1" max="120" style={{ width: 120 }} value={f.renewal_months} onChange={set('renewal_months')} /></Field>}
          <Field label="Préavis (jours)"><input className="input" type="number" min="0" max="730" style={{ width: 120 }} value={f.notice_days} onChange={set('notice_days')} /></Field>
        </div>
        <Field label={sub ? 'Montant du marché HT (FCFA)' : 'Montant du contrat (FCFA)'} hint={sub ? 'Base des situations de travaux (avancement en %) ; vide : montants saisis à chaque situation' : 'Pour information'}><input className="input" type="number" min="0" value={f.contract_amount} onChange={set('contract_amount')} /></Field>
        {sub ? <Field label="Retenue de garantie (%)" hint="Vide : taux par défaut réglé dans Chantiers › Réglages"><input className="input" type="number" min="0" max="100" step="0.5" value={f.retention_pct} onChange={set('retention_pct')} /></Field> : <div />}
        {/* Marché de sous-traitance : TVA et compte des factures préparées à chaque situation validée */}
        {sub && <>
          <Field label="TVA des situations"><select className="select" value={f.vat_rate} onChange={set('vat_rate')}><option value="0">0 %</option><option value="9">9 %</option><option value="18">18 %</option></select></Field>
          <Field label="Compte de charge" hint="Vide : celui de la fiche du sous-traitant"><input className="input" maxLength={12} value={f.expense_account} onChange={set('expense_account')} placeholder="604 (sous-traitance)…" /></Field>
        </>}

        <Field label="Paiement périodique" hint={`Prépare une facture d’achat en brouillon ${refs.invoice_lead_days} jours avant chaque échéance`}><select className="select" value={f.frequency} onChange={set('frequency')}><option value="">Aucun</option>{Object.entries(refs.frequencies).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}</select></Field>
        {f.frequency ? (
          <>
            <Field label="Prochaine échéance"><input className="input" type="date" required value={f.next_payment_date} onChange={set('next_payment_date')} /></Field>
            <Field label="Montant de chaque paiement (TTC)"><input className="input" type="number" min="1" required value={f.amount_ttc} onChange={set('amount_ttc')} /></Field>
            {!sub && <Field label="TVA incluse"><select className="select" value={f.vat_rate} onChange={set('vat_rate')}><option value="0">0 %</option><option value="9">9 %</option><option value="18">18 %</option></select></Field>}
            {!sub && <Field label="Compte de charge" hint="Vide : celui de la fiche du fournisseur" className="full"><input className="input" maxLength={12} value={f.expense_account} onChange={set('expense_account')} placeholder="622200 (loyers), 625 (assurances)…" /></Field>}
          </>
        ) : <div />}

        <Field label="Révision de prix"><input className="input" type="date" value={f.revision_date} onChange={set('revision_date')} /></Field>
        <Field label="Modalité de révision"><input className="input" maxLength={255} value={f.revision_note} onChange={set('revision_note')} placeholder="Indexation annuelle de 3 %…" /></Field>
        <Field label="Contrat signé" className="full" hint="PDF ou photo, 20 Mo au plus">
          <label className="btn" style={{ alignSelf: 'start' }}><Paperclip />{file ? file.name : c?.file_url ? 'Remplacer le fichier' : 'Joindre le contrat'}<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files[0] || null)} /></label>
        </Field>
        <Field label="Observations" className="full"><textarea className="textarea" rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  );
}
