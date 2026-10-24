import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Truck, Check, Pencil, Search, Trash2, FileText, Paperclip, RefreshCw, Fuel, Wrench, UserRound, HardHat, Undo2, X } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Drawer, Modal, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { today, formData } from '../../lib/rh';
import { RESERVATION_TONES, slotLabel } from '../../components/VehicleRequests';
import { CostsToValidate, FuelCards, FixedAssets } from '../../components/ParcCompta';
import PlacePicker, { placeLabel } from '../../components/PlacePicker';

const URL = '/admin/erp/parc';
const STATUS_TONES = { disponible: 'ok', affecte: '', maintenance: 'warn', reforme: '' };
const STATE = { du: ['danger', 'à faire'], bientot: ['warn', 'à prévoir'], ok: ['', 'prévu'] };
export const COST_TONES = { a_valider: 'warn', validee: 'ok', rejetee: 'danger', note_de_frais: '' };
const meter = (v, unit) => (v == null ? '—' : `${Number(v).toLocaleString('fr-FR')} ${unit === 'h' ? 'h' : 'km'}`);

function DueBadge({ item }) {
  if (item.days_left != null && item.days_left < 0) return <Badge tone="danger">dépassée de {-item.days_left} j</Badge>;
  const [tone, label] = STATE[item.state] || STATE.ok;
  // Le compteur peut rendre un entretien proche avant sa date : l'état prime sur le nombre de jours
  const days = item.days_left != null ? `dans ${item.days_left} j` : null;
  return <Badge tone={tone}>{item.state === 'ok' ? days || label : item.state === 'bientot' && days && item.days_left <= 7 ? days : label}</Badge>;
}

/**
 * Parc auto et matériel (choix du client du 22/10) : biens (véhicules, engins, matériel, informatique, autres),
 * affectation à un employé ou à un chantier, échéances administratives, entretien (km, heures, date), carburant,
 * coûts par chantier, réservations de véhicules demandées depuis Mon espace. Les services généraux gèrent.
 */
export default function Parc() {
  const { can } = useAuth();
  const write = can('parc:write');
  // Onglets de la Comptabilité (choix du client du 23/10) : dépenses à valider, cartes carburant, immobilisations
  const compta = can('achats:write') || can('compta:read');
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('onglet') || 'biens');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const refs = useResource(`${URL}/refs`);
  const badges = useResource(`${URL}/badges`);
  const open = Number(params.get('fiche')) || null;
  const setOpen = id => setParams(id ? { fiche: String(id) } : {}, { replace: true });
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const list = useResource(tab === 'biens' ? `${URL}/assets${qs({ kind, status, q })}` : null);
  const b = badges.data || {};
  const reload = () => { list.reload?.(); badges.reload(); };

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="seg" role="group" aria-label="Affichage">
            {[['biens', 'Biens'], ['echeances', 'Échéances et entretien', b.late], ['reservations', 'Réservations', b.requests], ['couts', 'Coûts'],
              ...(compta ? [['valider', 'À valider (Compta)', b.costs_to_validate], ['cartes', 'Cartes carburant'], ['immobilisations', 'Immobilisations']] : [])].map(([k, l, n]) => (
              <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}{n > 0 && <span> {n}</span>}</button>
            ))}
          </div>
          {tab === 'biens' && refs.data && (
            <>
              <select className="select" style={{ width: 'auto' }} value={kind} onChange={e => setKind(e.target.value)} aria-label="Type"><option value="">Tous les biens</option>{Object.entries(refs.data.kinds).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}</select>
              <select className="select" style={{ width: 'auto' }} value={status} onChange={e => setStatus(e.target.value)} aria-label="Statut"><option value="">En service</option>{Object.entries(refs.data.statuses).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <label style={{ position: 'relative' }}>
                <Search aria-hidden="true" style={{ position: 'absolute', left: 10, top: 10, width: 16, height: 16, opacity: 0.5 }} />
                <input className="input" style={{ paddingLeft: 32, width: 220 }} type="search" placeholder="Code, immatriculation, détenteur…" value={text} onChange={e => setText(e.target.value)} aria-label="Rechercher" />
              </label>
            </>
          )}
        </div>
        {write && tab === 'biens' && <button className="btn btn-primary" onClick={() => setForm({})}><Plus />Nouveau bien</button>}
      </div>

      {tab === 'biens' && (
        <Card bodyClass="">
          <ErrorBox error={list.error} />
          {!list.data ? <div className="card-body"><Skeleton h={220} /></div> : !list.data.length ? <div className="card-body"><Empty icon={Truck}>Aucun bien.</Empty></div> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Code</th><th>Bien</th><th>Immatriculation / série</th><th>Affecté à</th><th className="right">Compteur</th><th>Statut</th></tr></thead>
              <tbody>{list.data.map(a => (
                <tr key={a.id} className="clickable" onClick={() => setOpen(a.id)}>
                  <td className="small tabular nowrap"><b>{a.code}</b></td>
                  <td>{a.name}<div className="small muted">{a.kind_label}{a.brand ? ` · ${a.brand}${a.model ? ` ${a.model}` : ''}` : ''}{a.pool ? ' · véhicule de service' : ''}</div></td>
                  <td className="small">{a.plate || a.serial || '—'}</td>
                  <td className="small">{a.holder || 'Dépôt'}</td>
                  <td className="right small tabular nowrap">{a.meter ? meter(a.meter_value, a.meter) : ''}</td>
                  <td><Badge tone={STATUS_TONES[a.status]}>{a.status_label}</Badge></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}
      {tab === 'echeances' && <Deadlines onOpen={setOpen} />}
      {tab === 'reservations' && <Reservations write={write} onChange={badges.reload} />}
      {tab === 'couts' && <Costs />}
      {compta && tab === 'valider' && <CostsToValidate onOpen={setOpen} onChange={badges.reload} />}
      {compta && tab === 'cartes' && <FuelCards />}
      {compta && tab === 'immobilisations' && <FixedAssets onOpen={setOpen} />}

      {open && refs.data && <AssetDrawer id={open} refs={refs.data} write={write} onClose={() => setOpen(null)} onChange={reload} onEdit={a => setForm({ asset: a })} />}
      {form && refs.data && <AssetForm asset={form.asset} refs={refs.data} onClose={() => setForm(null)} onSaved={a => { setForm(null); reload(); setOpen(a.id); }} />}
    </div>
  );
}

function Deadlines({ onOpen }) {
  const [days, setDays] = useState(60);
  const list = useResource(`${URL}/echeances?days=${days}`);
  return (
    <Card bodyClass="" title="Échéances administratives et entretiens" actions={
      <select className="select" style={{ width: 'auto' }} value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Horizon">
        <option value={30}>30 prochains jours</option><option value={60}>60 prochains jours</option><option value={90}>3 prochains mois</option><option value={365}>12 prochains mois</option>
      </select>}>
      <ErrorBox error={list.error} />
      {!list.data ? <div className="card-body"><Skeleton h={200} /></div> : !list.data.length ? <div className="card-body"><Empty icon={Wrench}>Rien à prévoir sur la période.</Empty></div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Bien</th><th>Échéance</th><th>Date</th><th className="right">Compteur</th><th>État</th></tr></thead>
          <tbody>{list.data.map(d => (
            <tr key={d.key} className="clickable" onClick={() => onOpen(d.asset_id)}>
              <td><b className="small tabular">{d.code}</b> {d.name}{d.plate && <div className="small muted">{d.plate}</div>}</td>
              <td>{d.kind === 'entretien' ? <><Wrench style={{ width: 14, height: 14, verticalAlign: -2 }} /> {d.label}</> : d.label}</td>
              <td className="small nowrap">{d.date ? date(d.date) : '—'}</td>
              <td className="right small tabular nowrap">{d.next_meter != null ? `${meter(d.meter_value, d.meter_unit)} / ${meter(d.next_meter, d.meter_unit)}` : ''}</td>
              <td><DueBadge item={d} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

function Reservations({ write, onChange }) {
  const [scope, setScope] = useState('demandee');
  const list = useResource(`${URL}/reservations${qs(scope === 'demandee' ? { status: 'demandee' } : scope === 'avenir' ? { status: 'accordee', upcoming: '1' } : {})}`);
  const [deciding, setDeciding] = useState(null);
  return (
    <Card bodyClass="" title="Demandes de véhicule" actions={
      <div className="seg" role="group" aria-label="Demandes">
        <button className={scope === 'demandee' ? 'active' : ''} onClick={() => setScope('demandee')}>À traiter</button>
        <button className={scope === 'avenir' ? 'active' : ''} onClick={() => setScope('avenir')}>Accordées à venir</button>
        <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>Toutes</button>
      </div>}>
      <ErrorBox error={list.error} />
      {!list.data ? <div className="card-body"><Skeleton h={160} /></div> : !list.data.length ? <div className="card-body"><Empty icon={Truck}>Aucune demande. Les employés demandent un véhicule depuis RH › Mon espace.</Empty></div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Créneau</th><th>Demandeur</th><th>Motif</th><th>Véhicule</th><th>Statut</th><th /></tr></thead>
          <tbody>{list.data.map(r => (
            <tr key={r.id}>
              <td className="small nowrap">{slotLabel(r)}</td>
              <td>{r.requested_by_name}</td>
              <td>{r.purpose}<div className="small muted">{[r.destination, r.passengers && `${r.passengers} passager(s)`].filter(Boolean).join(' · ')}</div></td>
              <td className="small">{r.asset_code ? `${r.asset_code} · ${r.asset_name}${r.asset_plate ? ` (${r.asset_plate})` : ''}` : '—'}</td>
              <td><Badge tone={RESERVATION_TONES[r.status]}>{r.status_label}</Badge>{r.decision_note && <div className="small muted">{r.decision_note}</div>}</td>
              <td className="right">{write && r.status === 'demandee' && <button className="btn btn-primary btn-sm" onClick={() => setDeciding(r)}>Traiter</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {deciding && <DecideForm resa={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); list.reload(); onChange(); }} />}
    </Card>
  );
}

function DecideForm({ resa, onClose, onDone }) {
  const toast = useToast();
  const free = useResource(`${URL}/vehicules-libres${qs({ start_at: resa.start_at, end_at: resa.end_at, except: resa.id })}`);
  const [asset, setAsset] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async status => {
    setBusy(true);
    try {
      await api.post(`${URL}/reservations/${resa.id}/decide`, { status, asset_id: status === 'accordee' ? Number(asset) : null, note: note.trim() || null });
      toast(status === 'accordee' ? 'Véhicule accordé — le demandeur est prévenu par e-mail' : 'Demande refusée');
      onDone();
    } catch (e) { toast(e.message, 'err'); setBusy(false); }
  };
  const vehicles = free.data || [];
  return (
    <Modal title={`Demande de ${resa.requested_by_name}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Fermer</button><button className="btn" disabled={busy || !note.trim()} onClick={() => decide('refusee')} title={!note.trim() ? 'Indiquez le motif du refus' : undefined}><X />Refuser</button><button className="btn btn-primary" disabled={busy || !asset} onClick={() => decide('accordee')}><Check />Accorder</button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <div>
          <div className="kv"><span>Créneau</span><b>{slotLabel(resa)}</b></div>
          <div className="kv"><span>Motif</span><b>{resa.purpose}</b></div>
          {resa.destination && <div className="kv"><span>Destination</span><b>{resa.destination}</b></div>}
        </div>
        <Field label="Véhicule libre sur ce créneau">
          {!free.data ? <Skeleton h={36} /> : !vehicles.length ? <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>Aucun véhicule libre : refusez la demande ou libérez un véhicule.</p> : (
            <select className="select" value={asset} onChange={e => setAsset(e.target.value)}>
              <option value="">— Choisir —</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.code} · {v.name}{v.plate ? ` (${v.plate})` : ''}{v.pool ? '' : ' — hors pool'}</option>)}
            </select>
          )}
        </Field>
        <Field label="Message au demandeur (obligatoire pour un refus)"><input className="input" maxLength={255} value={note} onChange={e => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function Costs() {
  const [to, setTo] = useState(today());
  const [from, setFrom] = useState(() => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10); });
  const r = useResource(`${URL}/couts${qs({ du: from, au: to })}`);
  const refs = useResource(`${URL}/refs`);
  const kinds = refs.data?.cost_kinds || {};
  const d = r.data;
  const Table = ({ rows, title }) => (
    <Card title={title} bodyClass="">
      {!rows.length ? <div className="card-body"><Empty icon={Fuel}>Aucune dépense sur la période.</Empty></div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{title.includes('chantier') ? 'Chantier' : 'Bien'}</th><th>Détail</th><th className="right">Litres</th><th className="right">Total</th></tr></thead>
          <tbody>{rows.map(g => (
            <tr key={g.key}>
              <td><b>{g.label}</b></td>
              <td className="small muted">{Object.entries(g.by_kind).map(([k, v]) => `${kinds[k] || k} ${fcfa(v)}`).join(' · ')}</td>
              <td className="right small tabular">{g.liters ? Math.round(g.liters).toLocaleString('fr-FR') : ''}</td>
              <td className="right tabular"><b>{fcfa(g.total)}</b></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Field label="Du"><input className="input" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="Au"><input className="input" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></Field>
        {d && <div style={{ alignSelf: 'end' }}><span className="muted small">Total de la période</span><div style={{ fontSize: 22, fontWeight: 600 }} className="tabular">{fcfa(d.total)}</div></div>}
      </div>
      <ErrorBox error={r.error} />
      {!d ? <Skeleton h={240} /> : (
        <>
          <Table rows={d.by_project} title="Coût par chantier" />
          <Table rows={d.by_asset} title="Coût par bien" />
        </>
      )}
    </div>
  );
}

function AssetDrawer({ id, refs, write, onClose, onChange, onEdit }) {
  const toast = useToast();
  const x = useResource(`${URL}/assets/${id}`);
  const a = x.data;
  const [panel, setPanel] = useState(null); // assign | release | cost | doc | plan
  const set = data => { x.setData(data); onChange(); setPanel(null); };
  const call = async (method, path, body, message) => {
    try { set(await api[method](`${URL}${path}`, body)); toast(message); } catch (e) { toast(e.message, 'err'); }
  };
  const remove = (path, label) => window.confirm(`Retirer ${label} ?`) && call('del', path, undefined, 'Retiré');
  return (
    <Drawer title={a ? `${a.code} · ${a.name}` : 'Bien'} onClose={onClose}>
      {x.error ? <ErrorBox error={x.error} /> : !a ? <Skeleton h={300} /> : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Badge tone={STATUS_TONES[a.status]}>{a.status_label}</Badge>
            <Badge>{a.kind_label}</Badge>
            {a.pool && <Badge>Véhicule de service</Badge>}
          </div>
          <div>
            {(a.brand || a.model) && <div className="kv"><span>Marque et modèle</span><b>{[a.brand, a.model, a.year].filter(Boolean).join(' ')}</b></div>}
            {a.plate && <div className="kv"><span>Immatriculation</span><b>{a.plate}</b></div>}
            {a.serial && <div className="kv"><span>N° de série / châssis</span><b>{a.serial}</b></div>}
            {a.meter && <div className="kv"><span>Compteur</span><b>{meter(a.meter_value, a.meter)}{a.meter_at ? ` au ${date(a.meter_at)}` : ''}</b></div>}
            <div className="kv"><span>Affecté à</span><b>{a.holder || 'Dépôt'}</b></div>
            <div className="kv"><span>Responsable</span><b>{a.manager_name || '—'}</b></div>
            {a.acquired_on && <div className="kv"><span>Acquis le</span><b>{date(a.acquired_on)}{a.purchase_amount ? ` · ${fcfa(a.purchase_amount)}` : ''}{a.supplier_name ? ` · ${a.supplier_name}` : ''}</b></div>}
            <div className="kv"><span>Dépenses sur 12 mois</span><b>{fcfa(a.costs_12m.total)}</b></div>
            {a.consumption && <div className="kv"><span>Consommation moyenne</span><b>{a.consumption.value.toLocaleString('fr-FR')} {a.consumption.unit}</b></div>}
          </div>
          {a.notes && <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{a.notes}</p>}

          {write && a.status !== 'reforme' && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {a.status === 'affecte' ? <button className="btn" onClick={() => setPanel('release')}><Undo2 />{a.project_id ? 'Retour au dépôt' : 'Restitution'}</button>
                : <button className="btn btn-primary" onClick={() => setPanel('assign')}><UserRound />Affecter</button>}
              {a.status === 'affecte' && <button className="btn btn-ghost" onClick={() => setPanel('assign')}><HardHat />Réaffecter</button>}
              <button className="btn" onClick={() => setPanel('cost')}><Fuel />Dépense ou plein</button>
              <button className="btn btn-ghost" onClick={() => onEdit(a)}><Pencil />Modifier</button>
            </div>
          )}
          {panel === 'assign' && <AssignPanel a={a} refs={refs} onCancel={() => setPanel(null)} onSubmit={body => call('post', `/assets/${a.id}/assign`, body, 'Affectation enregistrée')} />}
          {panel === 'release' && <ReleasePanel a={a} onCancel={() => setPanel(null)} onSubmit={body => call('post', `/assets/${a.id}/release`, body, 'Restitution enregistrée')} />}
          {panel === 'cost' && <CostPanel a={a} refs={refs} onCancel={() => setPanel(null)} onSubmit={body => call('post', `/assets/${a.id}/costs`, body, 'Dépense enregistrée')} />}

          <div className="erp-panel">
            <div className="row-between"><b>Échéances administratives</b>{write && <button className="btn btn-ghost btn-sm" onClick={() => setPanel(panel === 'doc' ? null : 'doc')}><Plus />Ajouter</button>}</div>
            {panel === 'doc' && <DocForm refs={refs} onCancel={() => setPanel(null)} onSubmit={body => call('post', `/assets/${a.id}/documents`, body, 'Échéance ajoutée')} />}
            {!a.documents.length ? <p className="small muted" style={{ margin: '6px 0 0' }}>Assurance, visite technique, vignette, carte de transport…</p> : a.documents.map(d => (
              <div key={d.id} className="kv">
                <span style={{ flexShrink: 1 }}>{d.label}{(d.reference || d.amount_estimate != null) && <div className="small muted">{[d.reference, d.amount_estimate != null && `à prévoir : ${fcfa(d.amount_estimate)}`].filter(Boolean).join(' · ')}</div>}</span>
                <b className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  {d.expires_on ? `au ${date(d.expires_on)}` : '—'}
                  {d.file_url && <a className="btn btn-ghost btn-icon" href={d.file_url} target="_blank" rel="noreferrer" aria-label={`Ouvrir ${d.label}`}><FileText /></a>}
                  {write && <RenewDoc d={d} onSaved={data => { set(data); toast('Échéance renouvelée'); }} />}
                  {write && <button className="btn btn-ghost btn-icon" onClick={() => remove(`/documents/${d.id}`, d.label)} aria-label={`Retirer ${d.label}`}><Trash2 /></button>}
                </b>
              </div>
            ))}
          </div>

          <div className="erp-panel">
            <div className="row-between"><b>Entretien</b>{write && <button className="btn btn-ghost btn-sm" onClick={() => setPanel(panel === 'plan' ? null : 'plan')}><Plus />Plan d’entretien</button>}</div>
            {panel === 'plan' && <PlanForm a={a} onCancel={() => setPanel(null)} onSubmit={body => call('post', `/assets/${a.id}/plans`, body, 'Plan d’entretien ajouté')} />}
            {!a.plans.length ? <p className="small muted" style={{ margin: '6px 0 0' }}>Vidange tous les 10 000 km ou 6 mois, révision toutes les 250 heures…</p> : a.plans.map(p => (
              <div key={p.id} className="kv">
                <span style={{ flexShrink: 1 }}>{p.label}<div className="small muted">{[p.every_km && `${p.every_km.toLocaleString('fr-FR')} km`, p.every_hours && `${p.every_hours} h`, p.every_months && `${p.every_months} mois`].filter(Boolean).join(' ou ')} · dernier : {p.last_date ? date(p.last_date) : '—'}{p.last_meter != null ? `, ${meter(p.last_meter, a.meter)}` : ''}</div></span>
                <b className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap', textAlign: 'right' }}>
                  <span>{[p.next_date && date(p.next_date), p.next_meter != null && meter(p.next_meter, a.meter)].filter(Boolean).join(' ou ')}</span>
                  <Badge tone={STATE[p.state][0]}>{STATE[p.state][1]}</Badge>
                  {write && <button className="btn btn-ghost btn-icon" onClick={() => remove(`/plans/${p.id}`, p.label)} aria-label={`Retirer ${p.label}`}><Trash2 /></button>}
                </b>
              </div>
            ))}
          </div>

          <div className="erp-panel">
            <b>Dépenses</b>
            {!a.costs.length ? <p className="small muted" style={{ margin: '6px 0 0' }}>Aucune dépense saisie.</p> : a.costs.slice(0, 30).map(c => (
              <div key={c.id} className="kv">
                <span style={{ flexShrink: 1 }}>{date(c.date)} · {c.kind_label}<div className="small muted">{[c.label, c.liters && `${c.liters} L`, c.meter_value != null && meter(c.meter_value, a.meter), placeLabel(c), c.payment_label, c.supplier_name || c.card_label || c.employee_name, c.invoice_number && `facture ${c.invoice_number}`, c.entry_number && `écriture ${c.entry_number}`].filter(Boolean).join(' · ')}</div>{c.reject_reason && <div className="small" style={{ color: 'var(--danger)' }}>Rejetée : {c.reject_reason}</div>}</span>
                <b className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}><span style={c.status === 'rejetee' ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>{fcfa(c.amount)}</span>{c.status && <Badge tone={COST_TONES[c.status]}>{c.status_label}</Badge>}{write && c.status !== 'validee' && <button className="btn btn-ghost btn-icon" onClick={() => remove(`/costs/${c.id}`, 'cette dépense')} aria-label="Retirer la dépense"><Trash2 /></button>}</b>
              </div>
            ))}
          </div>

          {a.reservations.length > 0 && (
            <div className="erp-panel">
              <b>Réservations à venir</b>
              {a.reservations.map(r => <div key={r.id} className="kv"><span style={{ flexShrink: 1 }}>{slotLabel(r)}</span><b>{r.requested_by_name}<div className="small muted">{r.purpose}</div></b></div>)}
            </div>
          )}

          {a.assignments.length > 0 && (
            <div className="erp-panel">
              <b>Historique des affectations</b>
              {a.assignments.map(g => (
                <div key={g.id} className="kv">
                  <span style={{ flexShrink: 1 }}>{date(g.start_date)} → {g.end_date ? date(g.end_date) : 'en cours'}<div className="small muted">{[g.condition_out && `remis : ${g.condition_out}`, g.condition_in && `rendu : ${g.condition_in}`].filter(Boolean).join(' · ')}</div></span>
                  <b>{g.kind === 'chantier' ? `Chantier ${g.target}` : g.target}</b>
                </div>
              ))}
            </div>
          )}

          {write && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {a.status !== 'maintenance' && a.status !== 'reforme' && <button className="btn btn-ghost btn-sm" onClick={() => call('post', `/assets/${a.id}/status`, { status: 'maintenance' }, 'Bien signalé en panne')}><Wrench />Signaler en panne</button>}
              {a.status === 'maintenance' && <button className="btn btn-ghost btn-sm" onClick={() => call('post', `/assets/${a.id}/status`, { status: 'disponible' }, 'Bien remis en service')}><Check />Remettre en service</button>}
              {a.status !== 'reforme' && <button className="btn btn-ghost btn-sm" onClick={() => window.confirm('Réformer ce bien (vendu, cédé, hors d’usage) ?') && call('post', `/assets/${a.id}/status`, { status: 'reforme' }, 'Bien réformé')}><X />Réformer</button>}
              {a.status === 'reforme' && <button className="btn btn-ghost btn-sm" onClick={() => call('post', `/assets/${a.id}/status`, { status: 'disponible' }, 'Bien remis en service')}><Undo2 />Remettre en service</button>}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function AssignPanel({ a, refs, onCancel, onSubmit }) {
  const [f, setF] = useState({ kind: a.kind === 'engin' ? 'chantier' : 'employe', employee_id: '', site: { project_id: null, worksite_id: null, place_id: null }, date: today(), condition: '', meter: a.meter_value ?? '' });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const ready = f.kind === 'employe' ? f.employee_id : f.site.project_id;
  return (
    <div className="erp-panel form-grid">
      <Field label="Affecter à"><select className="select" value={f.kind} onChange={set('kind')}><option value="employe">Un employé (remise)</option><option value="chantier">Un chantier (envoi)</option></select></Field>
      {f.kind === 'employe'
        ? <Field label="Employé"><select className="select" value={f.employee_id} onChange={set('employee_id')}><option value="">—</option>{refs.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
        : <Field label="Chantier" hint="Programme entier ou chantier précis (ERP › Chantiers)"><PlacePicker value={f.site} onChange={v => setF(x => ({ ...x, site: v }))} programmesOnly empty="—" /></Field>}
      <Field label="Date"><input className="input" type="date" value={f.date} onChange={set('date')} /></Field>
      {a.meter ? <Field label={`Compteur (${a.meter})`}><input className="input" type="number" min="0" value={f.meter} onChange={set('meter')} /></Field> : <div />}
      <Field label="État à la remise" className="full"><input className="input" maxLength={255} value={f.condition} onChange={set('condition')} placeholder="Bon état, rayure portière gauche…" /></Field>
      <div className="full row" style={{ gap: 8 }}>
        <button className="btn btn-primary" disabled={!ready} onClick={() => onSubmit({ kind: f.kind, employee_id: Number(f.employee_id) || null, project_id: f.site.project_id, worksite_id: f.site.worksite_id, date: f.date, condition: f.condition.trim() || null, meter: f.meter === '' ? null : Number(f.meter) })}><Check />Enregistrer</button>
        <button className="btn btn-ghost" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

function ReleasePanel({ a, onCancel, onSubmit }) {
  const [f, setF] = useState({ date: today(), condition: '', meter: a.meter_value ?? '' });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  return (
    <div className="erp-panel form-grid">
      <Field label="Date"><input className="input" type="date" value={f.date} onChange={set('date')} /></Field>
      {a.meter ? <Field label={`Compteur (${a.meter})`}><input className="input" type="number" min="0" value={f.meter} onChange={set('meter')} /></Field> : <div />}
      <Field label="État au retour" className="full"><input className="input" maxLength={255} value={f.condition} onChange={set('condition')} /></Field>
      <div className="full row" style={{ gap: 8 }}>
        <button className="btn btn-primary" onClick={() => onSubmit({ date: f.date, condition: f.condition.trim() || null, meter: f.meter === '' ? null : Number(f.meter) })}><Check />Enregistrer le retour</button>
        <button className="btn btn-ghost" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

function CostPanel({ a, refs, onCancel, onSubmit }) {
  const [f, setF] = useState({ kind: a.meter ? 'carburant' : 'reparation', date: today(), amount: '', liters: '', meter_value: '', label: '', site: { project_id: a.project_id || null, worksite_id: a.worksite_id || null, place_id: null }, plan_id: '', payment_mode: '', supplier_id: '', vat_rate: '0', fuel_card_id: '', employee_id: a.employee_id || '' });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const fuel = f.kind === 'carburant';
  const card = refs.cards.find(c => String(c.id) === String(f.fuel_card_id));
  const ready = Number(f.amount) > 0 && (!fuel || f.liters) && f.payment_mode && (f.payment_mode !== 'fournisseur' || f.supplier_id) && (f.payment_mode !== 'carte' || f.fuel_card_id) && (f.payment_mode !== 'employe' || f.employee_id);
  return (
    <div className="erp-panel form-grid">
      <Field label="Nature"><select className="select" value={f.kind} onChange={set('kind')}>{Object.entries(refs.cost_kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Date"><input className="input" type="date" max={today()} value={f.date} onChange={set('date')} /></Field>
      <Field label="Montant (FCFA)"><input className="input" type="number" min="0" required value={f.amount} onChange={set('amount')} /></Field>
      {fuel ? <Field label="Litres"><input className="input" type="number" min="0" step="0.01" value={f.liters} onChange={set('liters')} /></Field> : <div />}
      {a.meter ? <Field label={`Compteur (${a.meter})`} hint={fuel ? 'Pour la consommation' : undefined}><input className="input" type="number" min="0" value={f.meter_value} onChange={set('meter_value')} /></Field> : <div />}
      <Field label="Payée par" hint="Crée la pièce à valider par la Comptabilité"><select className="select" required value={f.payment_mode} onChange={set('payment_mode')}><option value="">— Choisir —</option>{Object.entries(refs.payment_modes).filter(([k]) => k !== 'carte' || fuel).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select></Field>
      {f.payment_mode === 'fournisseur' ? <Field label="Fournisseur" hint="Une facture d’achat en brouillon est préparée"><select className="select" value={f.supplier_id} onChange={set('supplier_id')}><option value="">—</option>{refs.suppliers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        : f.payment_mode === 'carte' ? <Field label="Carte carburant" hint={card ? `Solde : ${fcfa(card.balance)}` : 'Cartes gérées par la Comptabilité'}><select className="select" value={f.fuel_card_id} onChange={set('fuel_card_id')}><option value="">—</option>{refs.cards.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
        : f.payment_mode === 'employe' ? <Field label="Employé qui a payé" hint="Se fait rembourser par sa note de frais (Mon espace)"><select className="select" value={f.employee_id} onChange={set('employee_id')}><option value="">—</option>{refs.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
        : <div />}
      {f.payment_mode === 'fournisseur' && <Field label="TVA incluse"><select className="select" value={f.vat_rate} onChange={set('vat_rate')}><option value="0">0 %</option><option value="9">9 %</option><option value="18">18 %</option></select></Field>}
      <Field label="Affectation" hint="Programme, chantier ou lieu ; vide : siège social"><PlacePicker value={f.site} onChange={v => setF(x => ({ ...x, site: v }))} /></Field>
      {f.kind === 'entretien' && a.plans.length > 0 && <Field label="Plan d’entretien réalisé"><select className="select" value={f.plan_id} onChange={set('plan_id')}><option value="">—</option>{a.plans.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>}
      <Field label="Détail" className="full"><input className="input" maxLength={200} value={f.label} onChange={set('label')} placeholder="Station, garage, pièce changée…" /></Field>
      <div className="full row" style={{ gap: 8 }}>
        <button className="btn btn-primary" disabled={!ready} onClick={() => onSubmit({
          kind: f.kind, date: f.date, amount: Number(f.amount), liters: fuel ? Number(f.liters) : null, meter_value: f.meter_value === '' ? null : Number(f.meter_value),
          label: f.label.trim() || null, ...f.site, plan_id: f.plan_id ? Number(f.plan_id) : null,
          payment_mode: f.payment_mode, supplier_id: f.payment_mode === 'fournisseur' ? Number(f.supplier_id) : null, vat_rate: f.payment_mode === 'fournisseur' ? Number(f.vat_rate) : 0,
          fuel_card_id: f.payment_mode === 'carte' ? Number(f.fuel_card_id) : null, employee_id: f.payment_mode === 'employe' ? Number(f.employee_id) : null,
        })}><Check />Enregistrer</button>
        <button className="btn btn-ghost" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

function DocForm({ refs, onCancel, onSubmit }) {
  const [f, setF] = useState({ kind: 'assurance', label: '', reference: '', expires_on: '', amount_estimate: '' });
  const [file, setFile] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  return (
    <div className="form-grid" style={{ marginTop: 10 }}>
      <Field label="Type"><select className="select" value={f.kind} onChange={set('kind')}>{Object.entries(refs.doc_kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Expire le" hint="Alerte 30 puis 7 jours avant"><input className="input" type="date" value={f.expires_on} onChange={set('expires_on')} /></Field>
      <Field label="Intitulé"><input className="input" maxLength={160} value={f.label} onChange={set('label')} placeholder={refs.doc_kinds[f.kind]} /></Field>
      <Field label="Référence"><input className="input" maxLength={80} value={f.reference} onChange={set('reference')} placeholder="N° de police, de PV…" /></Field>
      <Field label="Montant à prévoir (FCFA)" hint="Apparaît dans la trésorerie de la Comptabilité à l’approche de l’échéance" className="full"><input className="input" type="number" min="0" value={f.amount_estimate} onChange={set('amount_estimate')} /></Field>
      <div className="full row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="btn"><Paperclip />{file ? file.name : 'Joindre le justificatif'}<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files[0] || null)} /></label>
        <button className="btn btn-primary" onClick={() => onSubmit(formData({ ...f, label: f.label || refs.doc_kinds[f.kind], expires_on: f.expires_on || 'null', reference: f.reference || 'null', amount_estimate: f.amount_estimate || 'null' }, { file }))}><Check />Enregistrer</button>
        <button className="btn btn-ghost" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

/** Renouvellement : nouvelle date d'expiration (et nouveau justificatif au besoin). */
function RenewDoc({ d, onSaved }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [expires, setExpires] = useState(d.expires_on || '');
  const [amount, setAmount] = useState(d.amount_estimate ?? '');
  const [file, setFile] = useState(null);
  const save = async () => {
    try { onSaved(await api.patch(`${URL}/documents/${d.id}`, formData({ expires_on: expires || 'null', amount_estimate: amount === '' ? 'null' : amount }, { file }))); setOpen(false); } catch (e) { toast(e.message, 'err'); }
  };
  if (!open) return <button className="btn btn-ghost btn-icon" onClick={() => setOpen(true)} aria-label={`Renouveler ${d.label}`} title="Renouveler"><RefreshCw /></button>;
  return (
    <Modal title={`Renouveler « ${d.label} »`} onClose={() => setOpen(false)}
      footer={<><button className="btn btn-ghost" onClick={() => setOpen(false)}>Annuler</button><button className="btn btn-primary" onClick={save}><Check />Enregistrer</button></>}>
      <div className="form-grid">
        <Field label="Nouvelle date d’expiration"><input className="input" type="date" value={expires} onChange={e => setExpires(e.target.value)} /></Field>
        <Field label="Montant à prévoir (FCFA)" hint="Trésorerie de la Comptabilité"><input className="input" type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <Field label="Justificatif"><label className="btn" style={{ alignSelf: 'start' }}><Paperclip />{file ? file.name : 'Joindre'}<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files[0] || null)} /></label></Field>
      </div>
    </Modal>
  );
}

function PlanForm({ a, onCancel, onSubmit }) {
  const [f, setF] = useState({ label: a.meter === 'h' ? 'Révision' : 'Vidange', every_km: '', every_hours: '', every_months: '', last_date: today(), last_meter: a.meter_value ?? '' });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const n = v => (v === '' ? null : Number(v));
  return (
    <div className="form-grid" style={{ marginTop: 10 }}>
      <Field label="Entretien" className="full"><input className="input" maxLength={120} value={f.label} onChange={set('label')} /></Field>
      {a.meter === 'km' && <Field label="Tous les (km)"><input className="input" type="number" min="1" value={f.every_km} onChange={set('every_km')} placeholder="10000" /></Field>}
      {a.meter === 'h' && <Field label="Toutes les (heures)"><input className="input" type="number" min="1" value={f.every_hours} onChange={set('every_hours')} placeholder="250" /></Field>}
      <Field label="Ou tous les (mois)"><input className="input" type="number" min="1" max="120" value={f.every_months} onChange={set('every_months')} placeholder="6" /></Field>
      <Field label="Dernier fait le"><input className="input" type="date" value={f.last_date} onChange={set('last_date')} /></Field>
      {a.meter && <Field label={`À (${a.meter})`}><input className="input" type="number" min="0" value={f.last_meter} onChange={set('last_meter')} /></Field>}
      <div className="full row" style={{ gap: 8 }}>
        <button className="btn btn-primary" disabled={!f.label.trim() || (!f.every_km && !f.every_hours && !f.every_months)} onClick={() => onSubmit({ label: f.label.trim(), every_km: n(f.every_km), every_hours: n(f.every_hours), every_months: n(f.every_months), last_date: f.last_date || null, last_meter: n(f.last_meter) })}><Check />Enregistrer</button>
        <button className="btn btn-ghost" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

function AssetForm({ asset: a, refs, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({
    kind: a?.kind || 'vehicule', kind_other: a?.kind_other || '', name: a?.name || '', brand: a?.brand || '', model: a?.model || '', serial: a?.serial || '',
    plate: a?.plate || '', year: a?.year || '', acquired_on: a?.acquired_on || '', purchase_amount: a?.purchase_amount ?? '', supplier_id: a?.supplier_id || '',
    meter_value: a?.meter_value ?? '', manager_id: a?.manager_id || '', pool: a?.pool ?? false, notes: a?.notes || '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const kind = refs.kinds[f.kind];
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]));
      for (const k of ['year', 'purchase_amount', 'supplier_id', 'meter_value', 'manager_id']) if (body[k] != null) body[k] = Number(body[k]);
      if (a) delete body.kind;
      const saved = a ? await api.patch(`${URL}/assets/${a.id}`, body) : await api.post(`${URL}/assets`, body);
      toast(a ? 'Bien modifié' : `Bien enregistré sous le code ${saved.code}`);
      onSaved(saved);
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title={a ? `Modifier ${a.code}` : 'Nouveau bien'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="asset-form" disabled={busy}><Check />Enregistrer</button></>}>
      <form id="asset-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Type de bien" hint={a ? 'Le type ne change pas : le code en dépend' : `Code attribué : ${kind.prefix}-…`}><select className="select" disabled={!!a} value={f.kind} onChange={set('kind')}>{Object.entries(refs.kinds).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}</select></Field>
        {f.kind === 'autre' ? <Field label="Nature du matériel"><input className="input" required maxLength={100} value={f.kind_other} onChange={set('kind_other')} placeholder="Container, citerne, bungalow…" /></Field> : <div />}
        <Field label="Désignation" className="full"><input className="input" required minLength={2} maxLength={160} value={f.name} onChange={set('name')} placeholder="Toyota Hilux double cabine, pelleteuse CAT 320, groupe électrogène 20 kVA…" /></Field>
        <Field label="Marque"><input className="input" maxLength={80} value={f.brand} onChange={set('brand')} /></Field>
        <Field label="Modèle"><input className="input" maxLength={80} value={f.model} onChange={set('model')} /></Field>
        {f.kind === 'vehicule' && <Field label="Immatriculation"><input className="input" maxLength={30} value={f.plate} onChange={set('plate')} /></Field>}
        <Field label={f.kind === 'vehicule' ? 'N° de châssis' : 'N° de série'}><input className="input" maxLength={80} value={f.serial} onChange={set('serial')} /></Field>
        <Field label="Année"><input className="input" type="number" min="1950" max="2100" value={f.year} onChange={set('year')} /></Field>
        {kind.meter && <Field label={kind.meter === 'km' ? 'Kilométrage actuel' : 'Heures moteur actuelles'}><input className="input" type="number" min="0" value={f.meter_value} onChange={set('meter_value')} /></Field>}
        <Field label="Acquis le"><input className="input" type="date" value={f.acquired_on} onChange={set('acquired_on')} /></Field>
        <Field label="Prix d’acquisition (FCFA)"><input className="input" type="number" min="0" value={f.purchase_amount} onChange={set('purchase_amount')} /></Field>
        <Field label="Fournisseur"><select className="select" value={f.supplier_id} onChange={set('supplier_id')}><option value="">—</option>{refs.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Responsable du bien" hint="Reçoit les alertes avec le responsable d’exploitation"><select className="select" value={f.manager_id} onChange={set('manager_id')}><option value="">—</option>{refs.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        {f.kind === 'vehicule' && <label className="full row" style={{ gap: 6 }}><input type="checkbox" checked={f.pool} onChange={set('pool')} />Véhicule de service, proposé aux demandes de réservation</label>}
        <Field label="Observations" className="full"><textarea className="textarea" rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  );
}
