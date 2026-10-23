/**
 * Parc auto et matériel ↔ Comptabilité (choix du client du 23/10) : onglets de la page Parc réservés à la
 * Comptabilité — dépenses à valider (une seule validation : la facture ou l'écriture préparée par le Parc), cartes
 * carburant prépayées (recharges, solde), registre des immobilisations (amortissement linéaire au prorata,
 * dotations de l'exercice, sortie de l'actif).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, Fuel, Plus, Landmark, Pencil, LogOut } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useSaved, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Modal, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { useComptaMeta } from '../lib/compta';
import { today } from '../lib/rh';

const URL = '/admin/erp/parc';
const TONES = { a_valider: 'warn', validee: 'ok', rejetee: 'danger', note_de_frais: '' };
const treasury = meta => (meta?.journals || []).filter(j => ['banque', 'caisse', 'mobile'].includes(j.kind) && j.active);

/** Dépenses saisies au Parc, en attente de la Comptabilité (ou toutes). */
export function CostsToValidate({ onOpen, onChange }) {
  const { can } = useAuth();
  const saved = useSaved();
  const toast = useToast();
  const [status, setStatus] = useState('a_valider');
  const [reject, setReject] = useState(null); // { cost, reason }
  const list = useResource(`${URL}/compta/depenses${qs({ status })}`);
  const write = can('achats:write');
  const act = async (fn, message) => {
    try { await fn(); saved(message); list.reload(); onChange?.(); setReject(null); } catch (e) { toast(e.message, 'err'); }
  };
  const rows = list.data || [];
  return (
    <div className="stack">
      <div className="row-between">
        <div className="seg" role="group" aria-label="Dépenses">
          {[['a_valider', 'À valider'], ['validee', 'Validées'], ['rejetee', 'Rejetées'], ['', 'Toutes']].map(([k, l]) => <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
        <span className="small muted">Valider une dépense valide sa facture d’achat ou son écriture ; la rejeter supprime la pièce en brouillon.</span>
      </div>
      <Card bodyClass="">
        <ErrorBox error={list.error} />
        {!list.data ? <div className="card-body"><Skeleton h={200} /></div> : !rows.length ? <div className="card-body"><Empty icon={Fuel}>Aucune dépense.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Date</th><th>Bien</th><th>Dépense</th><th>Paiement</th><th>Pièce</th><th className="right">Montant</th><th>État</th>{write && status === 'a_valider' && <th />}</tr></thead>
            <tbody>{rows.map(c => (
              <tr key={c.id}>
                <td className="small nowrap">{date(c.date)}</td>
                <td><button className="btn-link" onClick={() => onOpen(c.asset_id)}><b className="small tabular">{c.asset_code}</b></button><div className="small muted">{c.asset_name}{c.asset_plate ? ` · ${c.asset_plate}` : ''}</div></td>
                <td>{c.kind_label}<div className="small muted">{[c.label, c.liters && `${c.liters} L`, c.project_name || 'Frais généraux'].filter(Boolean).join(' · ')}</div></td>
                <td className="small">{c.payment_label}<div className="muted">{c.supplier_name || c.card_label || c.employee_name || ''}</div></td>
                <td className="small">{c.invoice_number ? <Link to="/compta/achats">Facture {c.invoice_number}</Link> : c.entry_id ? <Link to="/compta/ecritures">Écriture {c.entry_number || 'brouillon'}</Link> : '—'}</td>
                <td className="right tabular">{fcfa(c.amount)}</td>
                <td><Badge tone={TONES[c.status]}>{c.status_label}</Badge>{c.reject_reason && <div className="small muted">{c.reject_reason}</div>}</td>
                {write && status === 'a_valider' && (
                  <td className="right nowrap">
                    <button className="btn btn-sm btn-primary" onClick={() => act(() => api.post(`${URL}/costs/${c.id}/validate`), 'Dépense validée')}><Check />Valider</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setReject({ cost: c, reason: '' })}><X />Rejeter</button>
                  </td>
                )}
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {reject && (
        <Modal title={`Rejeter la dépense ${reject.cost.asset_code} — ${reject.cost.kind_label}`} onClose={() => setReject(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setReject(null)}>Annuler</button><button className="btn btn-primary" disabled={reject.reason.trim().length < 3} onClick={() => act(() => api.post(`${URL}/costs/${reject.cost.id}/reject`, { reason: reject.reason.trim() }), 'Dépense rejetée')}><X />Rejeter</button></>}>
          <Field label="Motif" hint="Communiqué à la personne qui a saisi la dépense"><input className="input" autoFocus maxLength={255} value={reject.reason} onChange={e => setReject(r => ({ ...r, reason: e.target.value }))} placeholder="Doublon, montant erroné, facture manquante…" /></Field>
        </Modal>
      )}
    </div>
  );
}

/** Cartes carburant prépayées : la recharge est une avance à la station, chaque plein la consomme. */
export function FuelCards() {
  const { can } = useAuth();
  const saved = useSaved();
  const toast = useToast();
  const { meta } = useComptaMeta();
  const list = useResource(`${URL}/cartes`);
  const refs = useResource(`${URL}/refs`);
  const [form, setForm] = useState(null); // { card? }
  const [load, setLoad] = useState(null); // { card, date, amount, journal_id, reference }
  const act = async (fn, message) => {
    try { await fn(); saved(message); list.reload(); setForm(null); setLoad(null); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="stack">
      <div className="row-between">
        <span className="small muted">Recharge : avance versée à la station (compte {meta?.settings?.accounts?.fuel_card || '4091'}) ; un plein payé par la carte la consomme. Le solde est contrôlé à chaque plein.</span>
        {can('achats:write') && <button className="btn btn-primary" onClick={() => setForm({})}><Plus />Nouvelle carte</button>}
      </div>
      {list.error && <ErrorBox error={list.error} />}
      {!list.data ? <Skeleton h={160} /> : !list.data.length ? <Card><Empty icon={Fuel}>Aucune carte carburant.</Empty></Card> : (
        <div className="grid grid-2">
          {list.data.map(c => (
            <Card key={c.id} title={<span>{c.label}{!c.active && <Badge> désactivée</Badge>}</span>} actions={can('achats:write') && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setForm({ card: c })} aria-label={`Modifier ${c.label}`}><Pencil /></button>}>
              <div className="kv"><span>Station</span><b>{c.supplier_name}</b></div>
              {c.number && <div className="kv"><span>N° de carte</span><b>{c.number}</b></div>}
              <div className="kv"><span>Solde</span><b style={{ color: c.balance <= 0 ? 'var(--danger)' : undefined }}>{fcfa(c.balance)}</b></div>
              {c.loads.length > 0 && <div className="small muted" style={{ marginTop: 8 }}>Dernières recharges : {c.loads.slice(0, 3).map(l => `${date(l.date)} · ${fcfa(l.amount)}`).join(' — ')}</div>}
              {can('achats:pay') && c.active && <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setLoad({ card: c, date: today(), amount: '', journal_id: treasury(meta)[0]?.id || '', reference: '' })}><Landmark />Recharger</button>}
            </Card>
          ))}
        </div>
      )}
      {form && refs.data && <CardForm card={form.card} suppliers={refs.data.suppliers} onClose={() => setForm(null)}
        onSave={body => act(() => (form.card ? api.patch(`${URL}/cartes/${form.card.id}`, body) : api.post(`${URL}/cartes`, body)), form.card ? 'Carte modifiée' : 'Carte ajoutée')} />}
      {load && (
        <Modal title={`Recharger ${load.card.label}`} onClose={() => setLoad(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setLoad(null)}>Annuler</button><button className="btn btn-primary" disabled={!(Number(load.amount) > 0 && load.journal_id)} onClick={() => act(() => api.post(`${URL}/cartes/${load.card.id}/recharges`, { date: load.date, amount: Number(load.amount), journal_id: Number(load.journal_id), reference: load.reference || null }), 'Carte rechargée')}><Check />Enregistrer</button></>}>
          <div className="form-grid">
            <Field label="Date"><input className="input" type="date" value={load.date} onChange={e => setLoad(l => ({ ...l, date: e.target.value }))} /></Field>
            <Field label="Montant (FCFA)"><input className="input" type="number" min="1" value={load.amount} onChange={e => setLoad(l => ({ ...l, amount: e.target.value }))} /></Field>
            <Field label="Payée par" hint="Journal de trésorerie de l’écriture"><select className="select" value={load.journal_id} onChange={e => setLoad(l => ({ ...l, journal_id: e.target.value }))}>{treasury(meta).map(j => <option key={j.id} value={j.id}>{j.code} — {j.label}</option>)}</select></Field>
            <Field label="Référence"><input className="input" maxLength={120} value={load.reference} onChange={e => setLoad(l => ({ ...l, reference: e.target.value }))} placeholder="N° de virement, de reçu…" /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CardForm({ card, suppliers, onClose, onSave }) {
  const [f, setF] = useState({ label: card?.label || '', number: card?.number || '', supplier_id: card?.supplier_id || '', active: card ? card.active : true, notes: card?.notes || '' });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  return (
    <Modal title={card ? `Modifier ${card.label}` : 'Nouvelle carte carburant'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={f.label.trim().length < 2 || !f.supplier_id} onClick={() => onSave({ label: f.label.trim(), number: f.number.trim() || null, supplier_id: Number(f.supplier_id), active: f.active, notes: f.notes.trim() || null })}><Check />Enregistrer</button></>}>
      <div className="form-grid">
        <Field label="Intitulé"><input className="input" maxLength={120} value={f.label} onChange={set('label')} placeholder="Carte TotalEnergies 01" /></Field>
        <Field label="N° de carte"><input className="input" maxLength={40} value={f.number} onChange={set('number')} placeholder="…4521" /></Field>
        <Field label="Station (fournisseur)" hint="Fichier des fournisseurs de la Comptabilité" className="full"><select className="select" value={f.supplier_id} onChange={set('supplier_id')}><option value="">—</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Observations" className="full"><input className="input" maxLength={500} value={f.notes} onChange={set('notes')} /></Field>
        {card && <label className="checkbox"><input type="checkbox" checked={f.active} onChange={set('active')} />Carte en service (proposée pour les pleins)</label>}
      </div>
    </Modal>
  );
}

/** Registre des immobilisations du parc, dotations de l'exercice, sortie de l'actif. */
export function FixedAssets({ onOpen }) {
  const { can } = useAuth();
  const saved = useSaved();
  const toast = useToast();
  const { meta } = useComptaMeta();
  const reg = useResource(`${URL}/immobilisations`);
  const [edit, setEdit] = useState(null); // ligne du registre ou bien à compléter
  const [out, setOut] = useState(null); // { a, date, price, journal_id }
  const write = can('compta:entries');
  const r = reg.data;
  const act = async (fn, message) => {
    try { const data = await fn(); reg.setData(data.register || data); saved(message); setEdit(null); setOut(null); } catch (e) { toast(e.message, 'err'); }
  };
  if (reg.error) return <ErrorBox error={reg.error} />;
  if (!r) return <Skeleton h={240} />;
  const fy = r.fiscal_year;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <Card><div className="kv"><span>Valeur d’origine</span><b>{fcfa(r.totals.value)}</b></div></Card>
        <Card><div className="kv"><span>Amortissements cumulés</span><b>{fcfa(r.totals.cumul)}</b></div></Card>
        <Card><div className="kv"><span>Valeur nette au {date(r.day)}</span><b>{fcfa(r.totals.net)}</b></div></Card>
        <Card><div className="kv"><span>Dotation {fy ? `de l’exercice ${fy.label}` : '(aucun exercice ouvert)'}</span><b>{fcfa(r.totals.year_dotation)}</b></div></Card>
      </div>
      {fy && (
        <div className="row-between erp-panel">
          <span className="small">
            {r.dotations_entry ? <>Dotations de l’exercice {fy.label} passées : écriture {r.dotations_entry.number || 'en brouillon'} <Badge tone={r.dotations_entry.status === 'valide' ? 'ok' : 'warn'}>{r.dotations_entry.status === 'valide' ? 'validée' : 'brouillon'}</Badge></>
              : <>Les dotations de l’exercice {fy.label} (681 / 284) sont à passer avant sa clôture.</>}
          </span>
          {write && fy.status === 'ouvert' && r.totals.year_dotation > 0 && r.dotations_entry?.status !== 'valide' && (
            <button className="btn btn-primary btn-sm" onClick={() => act(() => api.post(`${URL}/immobilisations/dotations`, { fiscal_year_id: fy.id }), 'Dotations passées (écriture en brouillon)')}><Landmark />{r.dotations_entry ? 'Recalculer les dotations' : 'Passer les dotations'}</button>
          )}
        </div>
      )}
      <Card title="Biens immobilisés" bodyClass="">
        {!r.fixed.length ? <div className="card-body"><Empty icon={Landmark}>Aucun bien immobilisé : complétez ci-dessous la fiche des biens du parc.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Bien</th><th>Compte</th><th>Mise en service</th><th className="right">Valeur d’origine</th><th className="right">Durée</th><th className="right">Cumul</th><th className="right">Valeur nette</th><th className="right">Dotation de l’exercice</th>{write && <th />}</tr></thead>
            <tbody>{r.fixed.map(a => (
              <tr key={a.id}>
                <td><button className="btn-link" onClick={() => onOpen(a.id)}><b className="small tabular">{a.code}</b></button><div className="small muted">{a.name}{a.disposed_on ? ` · sorti le ${date(a.disposed_on)}` : ''}</div></td>
                <td className="small tabular">{a.account}</td>
                <td className="small nowrap">{date(a.in_service_on)}</td>
                <td className="right tabular">{fcfa(a.fixed_value)}</td>
                <td className="right small">{a.depreciation_years} ans{!a.own_years && <div className="muted">par défaut</div>}</td>
                <td className="right tabular">{fcfa(a.cumul)}</td>
                <td className="right tabular">{fcfa(a.net)}</td>
                <td className="right tabular">{a.year_dotation != null ? fcfa(a.year_dotation) : '—'}</td>
                {write && (
                  <td className="right nowrap">
                    {!a.disposal_entry_id && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEdit(a)} aria-label={`Modifier l’immobilisation ${a.code}`} title="Modifier"><Pencil /></button>}
                    {!a.disposal_entry_id && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setOut({ a, date: today(), price: '', journal_id: treasury(meta)[0]?.id || '' })} aria-label={`Sortir ${a.code} de l’actif`} title="Sortie de l’actif (cession, réforme)"><LogOut /></button>}
                  </td>
                )}
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {r.to_complete.length > 0 && (
        <Card title="Biens du parc à compléter (reprise)" bodyClass="">
          <p className="card-body small muted" style={{ margin: 0 }}>Pour chaque bien à amortir, indiquez sa valeur d’origine, sa mise en service et, s’il est déjà en partie amorti, les amortissements pratiqués jusqu’à la reprise (aucune écriture rétroactive).</p>
          <ul className="list">{r.to_complete.map(a => (
            <li key={a.id} className="list-row">
              <span><b className="small tabular">{a.code}</b> {a.name}<span className="small muted"> · {a.kind_label}{a.purchase_amount ? ` · achat ${fcfa(a.purchase_amount)}` : ''}{a.acquired_on ? ` le ${date(a.acquired_on)}` : ''}</span></span>
              {write && <button className="btn btn-sm" onClick={() => setEdit({ ...a, fixed_value: a.purchase_amount, in_service_on: a.acquired_on })}><Plus />Immobiliser</button>}
            </li>
          ))}</ul>
        </Card>
      )}
      {edit && <FixedForm a={edit} years={r.years} onClose={() => setEdit(null)} onSave={body => act(() => api.patch(`${URL}/assets/${edit.id}/immobilisation`, body), 'Immobilisation enregistrée')} />}
      {out && (
        <Modal title={`Sortie de l’actif — ${out.a.code} ${out.a.name}`} onClose={() => setOut(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setOut(null)}>Annuler</button><button className="btn btn-primary" onClick={() => window.confirm('Passer l’écriture de sortie de l’actif ? Le bien passera « réformé » dans le parc.') && act(() => api.post(`${URL}/assets/${out.a.id}/sortie`, { date: out.date, price: Number(out.price) || 0, journal_id: Number(out.price) ? Number(out.journal_id) : null }), 'Sortie de l’actif passée (écriture en brouillon)')}><Check />Passer l’écriture</button></>}>
          <div className="form-grid">
            <Field label="Date de sortie"><input className="input" type="date" value={out.date} onChange={e => setOut(o => ({ ...o, date: e.target.value }))} /></Field>
            <Field label="Prix de cession (FCFA)" hint="Vide : mise au rebut"><input className="input" type="number" min="0" value={out.price} onChange={e => setOut(o => ({ ...o, price: e.target.value }))} /></Field>
            {Number(out.price) > 0 && <Field label="Encaissé sur" className="full"><select className="select" value={out.journal_id} onChange={e => setOut(o => ({ ...o, journal_id: e.target.value }))}>{treasury(meta).map(j => <option key={j.id} value={j.id}>{j.code} — {j.label}</option>)}</select></Field>}
            <p className="full small muted" style={{ margin: 0 }}>Écriture : amortissements cumulés (284) et valeur nette (81) au débit, valeur d’origine au crédit ; prix de cession en produit (82).</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function FixedForm({ a, years, onClose, onSave }) {
  const [f, setF] = useState({
    fixed_value: a.fixed_value ?? '', in_service_on: a.in_service_on || '', depreciation_years: a.own_years ?? '', prior_depreciation: a.prior_depreciation || '', prior_as_of: a.prior_as_of || '',
  });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const def = a.kind ? years[a.kind] : null;
  return (
    <Modal title={`Immobilisation — ${a.code} ${a.name}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!(Number(f.fixed_value) > 0 && f.in_service_on)} onClick={() => onSave({
        fixed_value: Number(f.fixed_value), in_service_on: f.in_service_on, depreciation_years: f.depreciation_years === '' ? null : Number(f.depreciation_years),
        prior_depreciation: Number(f.prior_depreciation) || 0, prior_as_of: f.prior_as_of || null,
      })}><Check />Enregistrer</button></>}>
      <div className="form-grid">
        <Field label="Valeur d’origine HT (FCFA)"><input className="input" type="number" min="1" value={f.fixed_value} onChange={set('fixed_value')} /></Field>
        <Field label="Mise en service"><input className="input" type="date" value={f.in_service_on} onChange={set('in_service_on')} /></Field>
        <Field label="Durée d’amortissement (années)" hint={`Vide : durée par défaut de la sorte de bien${def ? ` (${def} ans)` : ''}, réglée dans Comptabilité › Paramètres`}><input className="input" type="number" min="1" max="50" value={f.depreciation_years} onChange={set('depreciation_years')} /></Field>
        <div />
        <Field label="Amortissements déjà pratiqués (FCFA)" hint="Reprise d’un bien déjà en partie amorti"><input className="input" type="number" min="0" value={f.prior_depreciation} onChange={set('prior_depreciation')} /></Field>
        <Field label="Arrêtés au" hint="Date de la reprise (fin du dernier exercice amorti)"><input className="input" type="date" value={f.prior_as_of} onChange={set('prior_as_of')} /></Field>
      </div>
    </Modal>
  );
}

/** Échéances administratives du parc à payer (trésorerie de la Comptabilité). */
export function ParcPayables({ days = 60 }) {
  const x = useResource(`${URL}/a-payer?days=${days}`);
  const d = x.data;
  if (x.error || !d) return null;
  return (
    <Card title={`Parc : échéances à payer (${days} j)`} actions={<span className="small muted">{fcfa(d.total)}{d.unknown ? ` · ${d.unknown} sans montant` : ''}</span>} bodyClass="">
      {!d.items.length ? <div className="card-body"><Empty icon={Fuel}>Aucune échéance du parc à venir.</Empty></div> : (
        <ul className="list">{d.items.slice(0, 8).map(i => (
          <li key={i.id}><Link to={`/compta/parc?fiche=${i.asset_id}`} className="list-row">
            <span style={{ minWidth: 0, flex: 1 }}><strong className="ellipsis">{i.label}</strong><span className="small muted ellipsis">{i.code} {i.name}{i.plate ? ` · ${i.plate}` : ''}</span></span>
            <span className="small nowrap">{i.amount_estimate != null ? fcfa(i.amount_estimate) : 'montant à préciser'} · {date(i.expires_on)}</span>
          </Link></li>
        ))}</ul>
      )}
    </Card>
  );
}
