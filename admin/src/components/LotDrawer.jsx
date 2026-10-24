import { useState } from 'react';
import { Phone, Mail as MailIcon, FileText, Plus, Trash2, Paperclip, ExternalLink, Pencil } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast, useSaved } from '../lib/app-context';
import { Drawer, Card, Field, Badge, StatusBadge, Skeleton, ErrorBox, Empty } from './ui';
import { MediaPicker } from './MediaLibrary';
import { ScheduleTab, AccessTab, SiteTab, MessageThread } from './ClientSpace';
import { LotFormModal, SaleEditModal } from './LotForms';
import LeadAutocomplete from './LeadAutocomplete';
import { FINANCING, lotStatus, stageLabel } from '../lib/domain';
import { fcfa, num, date, dateTime, relative } from '../lib/format';

export const PAYMENT_METHODS = { virement: 'Virement', mobile_money: 'Mobile Money', especes: 'Espèces', cheque: 'Chèque', autre: 'Autre' };
export const DOC_STATUS = {
  a_fournir: { label: 'À fournir', tone: '' },
  en_cours: { label: 'En cours', tone: 'warn' },
  signe: { label: 'Signé', tone: 'ok' },
  delivre: { label: 'Délivré', tone: 'ok' },
};
const SALE_STATUS = { en_cours: { label: 'Paiement en cours', tone: 'warn' }, solde: { label: 'Soldé', tone: 'ok' }, desiste: { label: 'Désisté', tone: 'danger' } };

/** Fiche complète d'un lot : bien, acquéreur, paiements, documents, historique. */
export default function LotDrawer({ lotId, onClose, onChanged, onChangeStatus }) {
  const { can } = useAuth();
  const detail = useResource(`/admin/lots/${lotId}/detail`);
  const [tab, setTab] = useState('apercu');
  const d = detail.data;
  const sale = d?.sale;

  const refresh = data => {
    if (data) detail.setData(prev => ({ ...prev, sale: data }));
    else detail.reload();
    onChanged?.();
  };

  const tabs = [
    { id: 'apercu', label: 'Aperçu' },
    ...(sale ? [{ id: 'paiements', label: `Paiements (${sale.payments.length})` }, { id: 'echeancier', label: 'Échéancier' }, { id: 'documents', label: 'Documents' }] : []),
    { id: 'chantier', label: 'Chantier' },
    ...(sale ? [
      ...(can('client_messages') ? [{ id: 'messages', label: 'Messages' }] : []),
      { id: 'acces', label: 'Accès client' },
    ] : []),
    { id: 'historique', label: 'Historique' },
  ];

  return (
    <Drawer
      title={d ? <>Lot {d.code} <span className="muted" style={{ fontWeight: 400 }}>· {d.project.name}</span></> : 'Lot'}
      onClose={onClose}
      footer={d && can('lots:status') && <button className="btn" onClick={() => onChangeStatus(d)}>Changer le statut</button>}
    >
      {!d ? <Skeleton h={300} /> : (
        <>
          <div className="row-between">
            <StatusBadge status={d.status} />
            {sale && <Badge tone={SALE_STATUS[sale.status].tone}>{SALE_STATUS[sale.status].label}</Badge>}
          </div>
          <div className="tabs" role="tablist" style={{ marginBottom: 0 }}>
            {tabs.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
          </div>
          {tab === 'apercu' && <Overview d={d} sale={sale} onOpened={() => detail.reload().then(onChanged)} onSaleChange={refresh} onLotChanged={() => detail.reload().then(onChanged)} onDeleted={() => { onChanged?.(); onClose(); }} />}
          {tab === 'paiements' && sale && <Payments sale={sale} onChange={refresh} />}
          {tab === 'echeancier' && sale && <ScheduleTab sale={sale} onChange={refresh} />}
          {tab === 'documents' && sale && <Documents sale={sale} onChange={refresh} />}
          {tab === 'chantier' && <SiteTab lot={d} />}
          {tab === 'messages' && sale && <MessageThread leadId={sale.lead.id} saleId={sale.id} />}
          {tab === 'acces' && sale && <AccessTab sale={sale} />}
          {tab === 'historique' && <History items={d.history} />}
        </>
      )}
    </Drawer>
  );
}

function Overview({ d, sale, onOpened, onSaleChange, onLotChanged, onDeleted }) {
  const { can } = useAuth();
  const toast = useToast();
  const [opening, setOpening] = useState(false);
  const [editLot, setEditLot] = useState(false);
  const [editSale, setEditSale] = useState(false);
  const deletable = ['disponible', 'bloque'].includes(d.status) && !sale && !d.past_sales;
  const removeLot = async () => {
    if (!window.confirm(`Supprimer définitivement le lot ${d.code} ?`)) return;
    try { await api.del(`/admin/lots/${d.id}`); toast(`Lot ${d.code} supprimé`); onDeleted(); } catch (e) { toast(e.message, 'err'); }
  };
  const docsDone = sale ? sale.documents.filter(x => x.status === 'signe' || x.status === 'delivre').length : 0;

  return (
    <div className="stack">
      <Card title="Le bien" actions={can('plans:write') && <div className="row" style={{ gap: 4 }}>
        <button className="btn btn-sm" onClick={() => setEditLot(true)}><Pencil />Modifier</button>
        {deletable && <button className="btn btn-sm btn-ghost btn-icon btn-danger" onClick={removeLot} title="Supprimer le lot" aria-label="Supprimer le lot"><Trash2 /></button>}
      </div>}>
        <dl className="dl small">
          <dt>Projet</dt><dd>{d.project.name}</dd>
          <dt>Lot / îlot</dt><dd>{d.code}{d.ilot ? ` · îlot ${d.ilot}` : ''}</dd>
          <dt>Type de bien</dt><dd>{d.offer?.label || '—'}</dd>
          <dt>Surface</dt><dd>{d.surface_m2 ? `${num(d.surface_m2)} m²` : '—'}</dd>
          <dt>Prix catalogue</dt><dd className="tabular">{fcfa(d.price_fcfa)}</dd>
        </dl>
      </Card>

      {d.option && (
        <Card title="Option en cours">
          <p><strong>{d.option.lead_name}</strong> — {[d.option.lead_phone, d.option.lead_email].filter(Boolean).join(' · ')}</p>
          <p className="small muted">Expire {relative(d.option.expires_at)} ({dateTime(d.option.expires_at)})</p>
        </Card>
      )}

      {sale ? (
        <>
          <Card title="Acquéreur" actions={can('sales:write') && sale.status !== 'desiste' && <button className="btn btn-sm" onClick={() => setEditSale(true)}><Pencil />Modifier le dossier</button>}>
            <div className="row-between" style={{ alignItems: 'flex-start' }}>
              <div>
                <strong style={{ fontSize: 15 }}>{sale.lead.name}</strong>
                {sale.lead.is_diaspora && <> <Badge tone="warn">Diaspora</Badge></>}
                <div className="small muted">{sale.lead.client_code} · {stageLabel(sale.lead.stage)}{sale.lead.country ? ` · ${sale.lead.country}` : ''}</div>
              </div>
              <div className="row">
                {sale.lead.phone && <a className="btn btn-sm btn-icon" href={`tel:${sale.lead.phone}`} aria-label="Appeler"><Phone /></a>}
                {sale.lead.email && <a className="btn btn-sm btn-icon" href={`mailto:${sale.lead.email}`} aria-label="E-mail"><MailIcon /></a>}
              </div>
            </div>
            <dl className="dl small" style={{ marginTop: 12 }}>
              <dt>Financement</dt><dd>{FINANCING[sale.financing] || '—'}</dd>
              <dt>Réservé le</dt><dd>{date(sale.reserved_at)}</dd>
              {sale.signed_at && <><dt>Contrat signé le</dt><dd>{date(sale.signed_at)}</dd></>}
              {sale.notes && <><dt>Notes</dt><dd style={{ whiteSpace: 'pre-line' }}>{sale.notes}</dd></>}
            </dl>
          </Card>

          <Card title="Situation financière">
            <div className="grid grid-3" style={{ gap: 12 }}>
              <div><div className="small muted">Prix convenu</div><strong className="tabular">{fcfa(sale.price_fcfa)}</strong></div>
              <div><div className="small muted">Payé</div><strong className="tabular" style={{ color: 'var(--ok)' }}>{fcfa(sale.paid_fcfa)}</strong></div>
              <div><div className="small muted">Reste à payer</div><strong className="tabular" style={{ color: sale.remaining_fcfa ? 'var(--brand)' : 'var(--ok)' }}>{sale.remaining_fcfa ? fcfa(sale.remaining_fcfa) : 'Soldé'}</strong></div>
            </div>
            <div className="progress" role="progressbar" aria-valuenow={sale.percent_paid} aria-valuemin="0" aria-valuemax="100" aria-label="Part payée">
              <div style={{ width: `${sale.percent_paid}%` }} />
            </div>
            <div className="small muted">{sale.percent_paid} % payé · dernier versement {sale.payments[0] ? date(sale.payments[0].paid_at) : '—'}</div>
          </Card>

          <Card title={`Dossier administratif — ${docsDone}/${sale.documents.length} finalisés`} bodyClass="">
            <div className="table-wrap"><table className="table"><tbody>
              {sale.documents.map(doc => (
                <tr key={doc.id}>
                  <td>{doc.label}{doc.note && <div className="small muted">{doc.note}</div>}</td>
                  <td className="right"><Badge tone={DOC_STATUS[doc.status].tone} dot>{DOC_STATUS[doc.status].label}</Badge></td>
                </tr>
              ))}
            </tbody></table></div>
          </Card>
        </>
      ) : (
        <Card title="Acquéreur">
          {d.past_sales > 0 && <p className="small muted" style={{ marginBottom: 8 }}>{d.past_sales} dossier(s) précédent(s) clos par désistement.</p>}
          {['vendu', 'reserve'].includes(d.status) && <p className="small" style={{ marginBottom: 10 }}>Ce lot est {lotStatus(d.status).label.toLowerCase()} mais aucun dossier d’acquisition n’est ouvert.</p>}
          {can('sales:write') && d.status !== 'bloque'
            ? (opening ? <OpenSaleForm d={d} onDone={() => { setOpening(false); onOpened(); }} onCancel={() => setOpening(false)} />
              : <button className="btn btn-primary" onClick={() => setOpening(true)}><Plus />Ouvrir le dossier d’acquisition</button>)
            : <p className="muted">Aucun acquéreur.</p>}
        </Card>
      )}
      {editLot && <LotFormModal projectId={d.project.id} lot={d} onClose={() => setEditLot(false)} onDone={() => { setEditLot(false); onLotChanged(); }} />}
      {editSale && <SaleEditModal sale={sale} onClose={() => setEditSale(false)} onDone={data => { setEditSale(false); onSaleChange(data); }} />}
    </div>
  );
}

function OpenSaleForm({ d, onDone, onCancel }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: d.option?.lead_name || '', phone: d.option?.lead_phone || '', email: d.option?.lead_email || '',
    lead_id: d.option?.lead_id || null, price_fcfa: d.price_fcfa ?? '', financing: '', notes: '',
  });
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value, ...(['name', 'phone', 'email'].includes(k) ? { lead_id: null } : {}) }));
  const setName = name => setF(x => ({ ...x, name, lead_id: null, ...(x.lead_id ? { phone: '', email: '' } : {}) }));
  const pickLead = lead => setF(x => ({ ...x, lead_id: lead.id, name: lead.name, phone: lead.phone || '', email: lead.email || '', financing: lead.financing || x.financing }));

  const submit = async () => {
    setError(null);
    try {
      await api.post(`/admin/lots/${d.id}/sale`, {
        ...(f.lead_id ? { lead_id: f.lead_id } : { name: f.name, phone: f.phone || undefined, email: f.email || undefined }),
        price_fcfa: f.price_fcfa ? Math.round(Number(String(f.price_fcfa).replace(/\s/g, ''))) : undefined,
        financing: f.financing || undefined, notes: f.notes || undefined,
      });
      toast('Dossier d’acquisition ouvert — le lot est réservé');
      onDone();
    } catch (e) { setError(e); }
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <ErrorBox error={error} />
      {f.lead_id && <p className="small alert alert-ok">Fiche existante sélectionnée : ce dossier sera rattaché à {f.name}.</p>}
      <div className="form-grid">
        <LeadAutocomplete value={f.name} selectedId={f.lead_id} onChange={setName} onSelect={pickLead} />
        <Field label="Téléphone" hint={f.lead_id ? 'Coordonnée de la fiche sélectionnée.' : undefined}><input className="input" value={f.phone} onChange={set('phone')} readOnly={!!f.lead_id} /></Field>
        <Field label="E-mail"><input className="input" type="email" value={f.email} onChange={set('email')} readOnly={!!f.lead_id} /></Field>
        <Field label="Prix convenu (FCFA)"><input className="input tabular" inputMode="numeric" value={f.price_fcfa} onChange={set('price_fcfa')} /></Field>
        <Field label="Financement">
          <select className="select" value={f.financing} onChange={set('financing')}>
            <option value="">Non précisé</option>
            {Object.entries(FINANCING).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Notes" className="full"><input className="input" value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-sm" onClick={onCancel}>Annuler</button>
        <button className="btn btn-sm btn-primary" onClick={submit}>Ouvrir le dossier</button>
      </div>
    </div>
  );
}

function Payments({ sale, onChange }) {
  const { can } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ amount_fcfa: '', paid_at: today, method: 'virement', reference: '', note: '' });
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const editable = can('payments:write') && sale.status !== 'desiste';

  const add = async () => {
    setError(null);
    try {
      const data = await api.post(`/admin/sales/${sale.id}/payments`, {
        amount_fcfa: Math.round(Number(String(f.amount_fcfa).replace(/[\s ]/g, ''))), paid_at: f.paid_at, method: f.method,
        reference: f.reference || undefined, note: f.note || undefined,
      });
      setF({ ...f, amount_fcfa: '', reference: '', note: '' });
      saved('Versement enregistré');
      onChange(data);
    } catch (e) { setError(e); }
  };
  const remove = async p => {
    if (!window.confirm(`Supprimer le versement de ${fcfa(p.amount_fcfa)} du ${date(p.paid_at)} ?`)) return;
    try { onChange(await api.del(`/admin/payments/${p.id}`)); toast('Versement supprimé'); } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="stack">
      <div className="grid grid-3" style={{ gap: 12 }}>
        <div className="card kpi"><span className="kpi-label">Payé</span><span className="kpi-value" style={{ fontSize: 18 }}>{fcfa(sale.paid_fcfa)}</span></div>
        <div className="card kpi"><span className="kpi-label">Reste</span><span className="kpi-value" style={{ fontSize: 18 }}>{fcfa(sale.remaining_fcfa)}</span></div>
        <div className="card kpi"><span className="kpi-label">Avancement</span><span className="kpi-value" style={{ fontSize: 18 }}>{sale.percent_paid} %</span></div>
      </div>
      {editable && sale.remaining_fcfa > 0 && (
        <Card title="Enregistrer un versement">
          <ErrorBox error={error} />
          <div className="form-grid">
            <Field label="Montant (FCFA)"><input className="input tabular" inputMode="numeric" value={f.amount_fcfa} onChange={set('amount_fcfa')} placeholder={String(sale.remaining_fcfa)} /></Field>
            <Field label="Date du paiement"><input className="input" type="date" max={today} value={f.paid_at} onChange={set('paid_at')} /></Field>
            <Field label="Moyen de paiement"><select className="select" value={f.method} onChange={set('method')}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Référence"><input className="input" value={f.reference} onChange={set('reference')} placeholder="N° de transaction, de chèque…" /></Field>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-primary btn-sm" disabled={!f.amount_fcfa} onClick={add}><Plus />Enregistrer</button>
          </div>
        </Card>
      )}
      <Card title="Historique des versements" bodyClass="">
        {!sale.payments.length ? <Empty>Aucun versement enregistré.</Empty> : (
          <div className="table-wrap"><table className="table"><tbody>
            {sale.payments.map(p => (
              <tr key={p.id}>
                <td className="nowrap">{date(p.paid_at)}</td>
                <td>{PAYMENT_METHODS[p.method]}{p.reference && <div className="small muted">{p.reference}</div>}</td>
                <td className="right tabular nowrap"><strong>{fcfa(p.amount_fcfa)}</strong><div className="small muted">{p.recorded_by_name || ''}</div></td>
                {can('payments:write') && <td style={{ width: 40 }}><button className="btn btn-sm btn-ghost btn-icon btn-danger" onClick={() => remove(p)} aria-label="Supprimer le versement"><Trash2 /></button></td>}
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
    </div>
  );
}

function Documents({ sale, onChange }) {
  const { can } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const [picker, setPicker] = useState(null);
  const editable = can('documents:write');

  const patch = async (doc, body) => {
    try { onChange(await api.patch(`/admin/documents/${doc.id}`, body)); saved('Document mis à jour'); } catch (e) { toast(e.message, 'err'); }
  };
  const addDoc = async () => {
    const label = window.prompt('Nom du document (ex. : Permis de construire)');
    if (!label) return;
    try { onChange(await api.post(`/admin/sales/${sale.id}/documents`, { type: 'autre', label })); } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="stack">
      <p className="small muted">Les documents marqués « visible client » apparaîtront dans l’espace client de l’acquéreur.</p>
      <Card title="Pièces du dossier" bodyClass="" actions={editable && <button className="btn btn-sm" onClick={addDoc}><Plus />Ajouter</button>}>
        <div className="table-wrap"><table className="table"><tbody>
          {sale.documents.map(doc => (
            <tr key={doc.id}>
              <td>
                <strong>{doc.label}</strong>
                {doc.url && <div><a className="small" href={doc.url} target="_blank" rel="noreferrer"><FileText size={13} /> {doc.original_name} <ExternalLink size={12} /></a></div>}
                {editable ? (
                  <input className="input" style={{ height: 30, marginTop: 6, fontSize: 12 }} defaultValue={doc.note || ''} placeholder="Note (ex. : déposé au MCLU le…)" onBlur={e => e.target.value !== (doc.note || '') && patch(doc, { note: e.target.value || null })} aria-label={`Note pour ${doc.label}`} />
                ) : doc.note && <div className="small muted">{doc.note}</div>}
              </td>
              <td style={{ width: 150 }}>
                {editable ? (
                  <select className="select" style={{ height: 32 }} value={doc.status} onChange={e => patch(doc, { status: e.target.value })} aria-label={`Statut de ${doc.label}`}>
                    {Object.entries(DOC_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                ) : <Badge tone={DOC_STATUS[doc.status].tone} dot>{DOC_STATUS[doc.status].label}</Badge>}
                {editable && (
                  <div className="row" style={{ marginTop: 6, gap: 4 }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setPicker(doc)} title="Joindre un fichier"><Paperclip />Fichier</button>
                    <label className="checkbox small" title="Visible par le client"><input type="checkbox" checked={doc.visible_client} onChange={e => patch(doc, { visible_client: e.target.checked })} />Client</label>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody></table></div>
      </Card>
      {picker && <MediaPicker type="" selectedId={picker.media_id} onPick={m => patch(picker, { media_id: m.id })} onClose={() => setPicker(null)} />}
    </div>
  );
}

const History = ({ items }) => (
  !items.length ? <p className="muted">Aucun mouvement.</p> : (
    <ol className="stack" style={{ listStyle: 'none', gap: 14 }}>
      {items.map(h => (
        <li key={h.id} style={{ borderLeft: '1px solid var(--border-strong)', paddingLeft: 14 }}>
          <div className="row">{h.from_status && <><StatusBadge status={h.from_status} />→</>}<StatusBadge status={h.to_status} /></div>
          <div className="small muted" style={{ marginTop: 4 }}>
            {dateTime(h.created_at)} · {h.user_name || 'Automatique / site'}{h.lead_name ? ` · ${h.lead_name}` : ''}{h.reason ? ` · ${h.reason}` : ''}
          </div>
        </li>
      ))}
    </ol>
  )
);
