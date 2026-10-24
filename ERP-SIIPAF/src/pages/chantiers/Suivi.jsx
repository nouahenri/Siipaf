/**
 * Chantiers › Fiche › suivi (lot 3, choix du client du 24/10) : journal quotidien, points d'avancement publiés pour
 * les acquéreurs, étapes signalées par le conducteur et déclarées par la Direction seule (elles émettent les appels
 * de fonds VEFA), livraisons promises et retards prévus.
 */
import { useState } from 'react';
import { BookText, Camera, Check, Trash2, Megaphone, Flag, CheckCircle2, XCircle, Truck, Pencil, FileText, Users } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Modal, Badge } from '@admin/components/ui';
import { date, dateTime, fcfa, num } from '@admin/lib/format';
import { CH } from '../../lib/chantiers';
import { today } from '../../lib/rh';

const DECL_TONES = { signalee: 'warn', declaree: 'ok', refusee: 'danger' };

/** Formulaire multipart : champs vides omis, plusieurs photos sous le même nom. */
function multipart(fields, files = [], name = 'photos') {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== '' && v != null) f.append(k, typeof v === 'boolean' ? String(v) : v);
  for (const file of files) f.append(name, file);
  return f;
}

function PhotoInput({ files, setFiles, label = 'Ajouter des photos', max = 8 }) {
  return (
    <label className="btn" style={{ alignSelf: 'start' }}>
      <Camera />{files.length ? `${files.length} photo(s) choisie(s)` : label}
      <input type="file" hidden multiple accept="image/jpeg,image/png,image/webp" onChange={e => setFiles([...e.target.files].slice(0, max))} />
    </label>
  );
}

// ─── Journal quotidien ──────────────────────────────────────────────────────

export function Journal({ w, refs }) {
  const toast = useToast();
  const res = useResource(`${CH}/${w.id}/journal`);
  const [page, setPage] = useState(null);
  const removePhoto = async p => {
    if (!window.confirm('Retirer cette photo du journal ?')) return;
    try { res.setData(await api.del(`${CH}/${w.id}/journal/photos/${p.id}`)); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="stack">
      <Card title="Journal de chantier" actions={w.can_manage && <button className="btn btn-primary" onClick={() => setPage({ day: today() })}><BookText />Journal du jour</button>} bodyClass="">
        <ErrorBox error={res.error} />
        {!res.data ? <div className="card-body"><Skeleton h={160} /></div> : !res.data.length ? <div className="card-body"><Empty icon={BookText}>Aucune page de journal. Chaque jour : météo, effectif, travaux réalisés, incidents, photos.</Empty></div> : (
          <ul className="list">
            {res.data.map(j => (
              <li key={j.id} className="list-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
                <div className="row-between" style={{ width: '100%' }}>
                  <b>{date(j.day)}</b>
                  <span className="row small muted" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {j.weather_label && <Badge>{j.weather_label}</Badge>}
                    <span><Users className="ico" />{j.headcount ?? '—'} présent(s){j.pointed ? ` · ${j.pointed} pointé(s)` : ''}</span>
                    {w.can_manage && <button className="btn btn-ghost btn-icon" onClick={() => setPage(j)} aria-label={`Compléter le journal du ${date(j.day)}`}><Pencil /></button>}
                  </span>
                </div>
                {j.work_done && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{j.work_done}</div>}
                {j.incidents && <div className="small" style={{ whiteSpace: 'pre-wrap', color: 'var(--danger)' }}>Incident : {j.incidents}</div>}
                {j.notes && <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{j.notes}</div>}
                {j.photos.length > 0 && (
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {j.photos.map(p => (
                      <span key={p.id} className="journal-photo">
                        <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.name || 'Photo du chantier'} loading="lazy" /></a>
                        {w.can_manage && <button className="btn btn-ghost btn-icon" onClick={() => removePhoto(p)} aria-label="Retirer la photo"><Trash2 /></button>}
                      </span>
                    ))}
                  </div>
                )}
                <span className="small muted">{j.created_by_name ? `Tenu par ${j.created_by_name}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {page && <JournalForm w={w} refs={refs} page={page} onClose={() => setPage(null)} onSaved={d => { setPage(null); res.setData(d); }} />}
    </div>
  );
}

function JournalForm({ w, refs, page: p, onClose, onSaved }) {
  const saved = useSaved();
  const [f, setF] = useState({ day: p.day || today(), weather: p.weather || '', headcount: p.headcount ?? '', work_done: p.work_done || '', incidents: p.incidents || '', notes: p.notes || '' });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const out = await api.post(`${CH}/${w.id}/journal`, multipart({ ...f, weather: f.weather || 'null', headcount: f.headcount === '' ? 'null' : f.headcount, work_done: f.work_done.trim() || 'null', incidents: f.incidents.trim() || 'null', notes: f.notes.trim() || 'null' }, files));
      saved('Journal enregistré');
      onSaved(out);
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title={`Journal du ${date(f.day)}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="journal-form" disabled={busy}><Check />Enregistrer</button></>}>
      <form id="journal-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Jour" hint="Une page par jour : la saisie du même jour complète la page"><input className="input" type="date" required max={today()} value={f.day} disabled={!!p.id} onChange={set('day')} /></Field>
        <Field label="Météo" hint="Liste réglable dans Chantiers › Réglages"><select className="select" value={f.weather} onChange={set('weather')}><option value="">—</option>{Object.entries(refs.weather).map(([k, l]) => <option key={k} value={k}>{l}</option>)}{p.weather && !refs.weather[p.weather] && <option value={p.weather}>{refs.weather_labels[p.weather] || p.weather} (désactivé)</option>}</select></Field>
        <Field label="Effectif présent" hint="Ouvriers et sous-traitants sur le chantier"><input className="input" type="number" min="0" value={f.headcount} onChange={set('headcount')} /></Field>
        <div />
        <Field label="Travaux réalisés" className="full"><textarea className="textarea" rows={3} maxLength={4000} value={f.work_done} onChange={set('work_done')} /></Field>
        <Field label="Incidents" hint="Accident, panne, intempérie, livraison manquée… La Direction est prévenue" className="full"><textarea className="textarea" rows={2} maxLength={4000} value={f.incidents} onChange={set('incidents')} /></Field>
        <Field label="Observations" className="full"><textarea className="textarea" rows={2} maxLength={4000} value={f.notes} onChange={set('notes')} /></Field>
        <Field label="Photos" hint="JPEG, PNG ou WebP ; 8 au plus, 20 Mo chacune. Internes : non visibles des acquéreurs" className="full"><PhotoInput files={files} setFiles={setFiles} /></Field>
      </form>
    </Modal>
  );
}

// ─── Points d'avancement pour les acquéreurs ────────────────────────────────

export function Progress({ w, refs }) {
  const res = useResource(`${CH}/${w.id}/avancement`);
  const [open, setOpen] = useState(false);
  return (
    <div className="stack">
      <div className="callout-erp"><Megaphone /><span className="small">
        Ces points s’affichent dans l’espace client des acquéreurs concernés (mêmes points que l’onglet Chantier du dashboard). <b>Ils n’émettent aucun appel de fonds</b> : seule la Direction déclare une étape atteinte (onglet « Étapes et appels de fonds »).
      </span></div>
      <Card title="Points d’avancement publiés" actions={w.can_manage && <button className="btn btn-primary" onClick={() => setOpen(true)}><Megaphone />Publier un point</button>} bodyClass="">
        <ErrorBox error={res.error} />
        {!res.data ? <div className="card-body"><Skeleton h={160} /></div> : !res.data.length ? <div className="card-body"><Empty icon={Megaphone}>Aucun point publié pour la zone de ce chantier.</Empty></div> : (
          <ul className="list">
            {res.data.map(u => (
              <li key={u.id} className="list-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 4 }}>
                <div className="row-between" style={{ width: '100%' }}><b>{u.title}</b><span className="small muted nowrap">{dateTime(u.published_at)}</span></div>
                <div className="row small" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <Badge>{u.stage_label} · {u.progress_pct} %</Badge><Badge>{u.scope_label}</Badge>{!u.visible_client && <Badge tone="warn">Masqué aux clients</Badge>}
                </div>
                {u.body && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{u.body}</div>}
                {u.photos.length > 0 && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{u.photos.map(p => <span key={p.id} className="journal-photo"><img src={p.url} alt="" loading="lazy" /></span>)}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open && <ProgressForm w={w} refs={refs} onClose={() => setOpen(false)} onSaved={d => { setOpen(false); res.setData(d.points); }} />}
    </div>
  );
}

function ProgressForm({ w, refs, onClose, onSaved }) {
  const saved = useSaved();
  const prog = useResource(`${CH}/programmes/${w.project_id}`);
  const zoneIlots = w.zone_kind === 'ilots' ? w.zone : null;
  const [f, setF] = useState({ scope: '', stage: w.phases.find(p => p.state === 'en_cours')?.stage || 'gros_oeuvre', progress_pct: String(w.progress_pct), title: '', body: '', visible_client: true, published_at: today() });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const lots = prog.data ? prog.data.lots.filter(l => w.lots.codes.includes(l.code)) : [];
  const ilots = zoneIlots || (w.zone_kind === 'programme' ? prog.data?.ilots || [] : []);
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    const [kind, value] = f.scope.split(':');
    try {
      const out = await api.post(`${CH}/${w.id}/avancement`, multipart({
        stage: f.stage, progress_pct: f.progress_pct, title: f.title.trim(), body: f.body.trim(), visible_client: f.visible_client, published_at: f.published_at,
        ...(kind === 'ilot' ? { ilot: value } : kind === 'lot' ? { lot_id: value } : {}),
      }, files));
      saved(`${out.published} point(s) publié(s)`);
      onSaved(out);
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title="Publier un point d’avancement" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="progress-form" disabled={busy}><Check />Publier</button></>}>
      <form id="progress-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Concerne" hint="Toute la zone : un point par îlot ou par lot de la zone" className="full">
          <select className="select" value={f.scope} onChange={set('scope')}>
            <option value="">Toute la zone du chantier ({w.zone_label})</option>
            {ilots.map(i => <option key={i} value={`ilot:${i}`}>Îlot {i}</option>)}
            {lots.map(l => <option key={l.id} value={`lot:${l.id}`}>Lot {l.code}</option>)}
          </select>
        </Field>
        <Field label="Étape en cours"><select className="select" value={f.stage} onChange={set('stage')}>{refs.stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></Field>
        <Field label="Avancement (%)"><input className="input" type="number" min="0" max="100" required value={f.progress_pct} onChange={set('progress_pct')} /></Field>
        <Field label="Titre" className="full"><input className="input" required minLength={3} maxLength={160} value={f.title} onChange={set('title')} placeholder="Élévation des murs de l’îlot A…" /></Field>
        <Field label="Message aux acquéreurs" className="full"><textarea className="textarea" rows={3} maxLength={4000} value={f.body} onChange={set('body')} /></Field>
        <Field label="Date"><input className="input" type="date" max={today()} value={f.published_at} onChange={set('published_at')} /></Field>
        <label className="row small" style={{ gap: 8, alignSelf: 'end' }}><input type="checkbox" checked={f.visible_client} onChange={set('visible_client')} />Visible des acquéreurs</label>
        <Field label="Photos" hint="Publiées dans l’espace client (médiathèque du site)" className="full"><PhotoInput files={files} setFiles={setFiles} /></Field>
      </form>
    </Modal>
  );
}

// ─── Étapes et appels de fonds ──────────────────────────────────────────────

export function Stages({ w, refs, onChange }) {
  const { can } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const res = useResource(`${CH}/${w.id}/etapes`);
  const [form, setForm] = useState(null);
  const direction = can('chantiers:direction');
  const reload = () => { res.reload(); onChange?.(); };
  const declare = async d => {
    if (!window.confirm(`Déclarer « ${d.stage_label} » atteinte le ${date(d.reached_on)} ? Les appels de fonds VEFA des lots de la zone seront émis et les acquéreurs prévenus.`)) return;
    try { const r = await api.post(`${CH}/etapes/${d.id}/declarer`, {}); saved(`Étape déclarée : ${r.calls} appel(s) de fonds émis (${fcfa(r.amount_fcfa)})`); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const refuse = async d => {
    const reason = window.prompt('Motif du refus (transmis au conducteur) :');
    if (!reason) return;
    try { await api.post(`${CH}/etapes/${d.id}/refuser`, { reason }); saved('Signalement refusé'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="stack">
      <div className="callout-erp"><Flag /><span className="small">
        Le conducteur <b>signale</b> une étape atteinte (avec le PV ou l’attestation) ; <b>seule la Direction la déclare</b>. La déclaration achève l’étape et les précédentes pour les lots de la zone, émet leurs appels de fonds VEFA (message dans l’espace client), termine la phase du planning et prévient les commerciaux et le comptable.
      </span></div>
      <Card title="Étapes signalées et déclarées" bodyClass=""
        actions={(w.can_manage || direction) && <button className="btn btn-primary" onClick={() => setForm({ declare: direction && !w.can_manage })}><Flag />{direction ? 'Signaler ou déclarer une étape' : 'Signaler une étape'}</button>}>
        <ErrorBox error={res.error} />
        {!res.data ? <div className="card-body"><Skeleton h={140} /></div> : !res.data.length ? <div className="card-body"><Empty icon={Flag}>Aucune étape signalée.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Étape</th><th>Atteinte le</th><th>État</th><th className="right">Appels émis</th><th /></tr></thead>
            <tbody>{res.data.map(d => (
              <tr key={d.id}>
                <td><b>{d.stage_label}</b>{d.note && <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{d.note}</div>}
                  <div className="small muted">{d.reported_by_name ? `Signalée par ${d.reported_by_name}` : ''}{d.declared_by_name ? ` · ${d.status === 'refusee' ? 'refusée' : 'déclarée'} par ${d.declared_by_name}` : ''}</div>
                  {d.refusal_reason && <div className="small" style={{ color: 'var(--danger)' }}>Motif : {d.refusal_reason}</div>}</td>
                <td className="small nowrap">{date(d.reached_on)}</td>
                <td><Badge tone={DECL_TONES[d.status]}>{d.status_label}</Badge></td>
                <td className="right small tabular">{d.status === 'declaree' ? <>{num(d.calls_count)}<div className="muted">{fcfa(d.calls_amount)}</div></> : '—'}</td>
                <td className="right nowrap">
                  {d.file_url && <a className="btn btn-ghost btn-icon" href={d.file_url} target="_blank" rel="noreferrer" aria-label="Ouvrir la pièce"><FileText /></a>}
                  {direction && d.status === 'signalee' && <><button className="btn btn-sm btn-primary" onClick={() => declare(d)}><CheckCircle2 />Déclarer</button> <button className="btn btn-sm btn-ghost" onClick={() => refuse(d)}><XCircle />Refuser</button></>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {form && <StageForm w={w} refs={refs} direction={direction} preset={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
    </div>
  );
}

function StageForm({ w, refs, direction, preset, onClose, onSaved }) {
  const saved = useSaved();
  const next = w.phases.find(p => p.stage && p.state !== 'termine')?.stage || 'fondations';
  const [f, setF] = useState({ stage: next, reached_on: today(), note: '', declare: !!preset.declare });
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async e => {
    e.preventDefault();
    if (f.declare && !window.confirm('Déclarer cette étape atteinte ? Les appels de fonds VEFA des lots de la zone seront émis aussitôt.')) return;
    setBusy(true); setError(null);
    try {
      const out = await api.post(`${CH}/${w.id}/etapes`, multipart({ stage: f.stage, reached_on: f.reached_on, note: f.note.trim(), declare: f.declare }, file ? [file] : [], 'file'));
      saved(f.declare ? `Étape déclarée : ${out.calls} appel(s) de fonds émis (${fcfa(out.amount_fcfa)})` : 'Étape signalée à la Direction');
      onSaved();
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title={f.declare ? 'Déclarer une étape atteinte' : 'Signaler une étape atteinte'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="stage-form" disabled={busy}><Check />{f.declare ? 'Déclarer et émettre les appels' : 'Signaler à la Direction'}</button></>}>
      <form id="stage-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Étape atteinte" hint="L’étape et les précédentes sont achevées"><select className="select" value={f.stage} onChange={set('stage')}>{refs.stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></Field>
        <Field label="Atteinte le"><input className="input" type="date" required max={today()} value={f.reached_on} onChange={set('reached_on')} /></Field>
        <Field label="Observations" className="full"><textarea className="textarea" rows={2} maxLength={2000} value={f.note} onChange={set('note')} placeholder="PV du bureau de contrôle, attestation du maître d’œuvre…" /></Field>
        <Field label="Pièce" hint="PDF ou photo, 20 Mo au plus" className="full">
          <label className="btn" style={{ alignSelf: 'start' }}><FileText />{file ? file.name : 'Joindre le PV ou l’attestation'}<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files[0] || null)} /></label>
        </Field>
        {direction && <label className="full row small" style={{ gap: 8 }}><input type="checkbox" checked={f.declare} onChange={set('declare')} />Déclarer directement (Direction) : émet les appels de fonds</label>}
      </form>
    </Modal>
  );
}

// ─── Livraisons promises et retards ─────────────────────────────────────────

export function Deliveries({ w }) {
  const { can } = useAuth();
  const toast = useToast();
  const res = useResource(`${CH}/${w.id}/livraisons`);
  const [edit, setEdit] = useState(null);
  const write = can('sales:write');
  const save = async (row, value) => {
    try { res.setData(await api.patch(`${CH}/${w.id}/livraisons/${row.sale_id}`, { promised_delivery_on: value || null })); setEdit(null); } catch (e) { toast(e.message, 'err'); }
  };
  const d = res.data;
  return (
    <Card title="Livraisons des lots vendus" bodyClass="">
      <ErrorBox error={res.error} />
      {!d ? <div className="card-body"><Skeleton h={140} /></div> : (
        <>
          <p className="small muted card-body" style={{ margin: 0 }}>
            Livraison prévue : <b>{d.forecast ? date(d.forecast) : 'non planifiée'}</b> (fin prévue de la phase « Livraison », sinon du chantier).
            Une date promise dépassée par la livraison prévue prévient le commercial de l’acquéreur, le SAV et la Direction. La date promise se règle aussi dans le dossier de vente du dashboard.
          </p>
          {!d.rows.length ? <div className="card-body"><Empty icon={Truck}>Aucun lot vendu dans la zone de ce chantier.</Empty></div> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Lot</th><th>Acquéreur</th><th>Promise le</th><th>Écart</th><th>Livré le</th></tr></thead>
              <tbody>{d.rows.map(r => (
                <tr key={r.sale_id}>
                  <td className="tabular"><b>{r.lot_code}</b>{r.vefa && <div className="small muted">VEFA</div>}</td>
                  <td>{r.client_name}<div className="small muted">{[r.client_code, r.commercial_name].filter(Boolean).join(' · ')}</div></td>
                  <td className="small nowrap">
                    {edit === r.sale_id
                      ? <input className="input" type="date" defaultValue={r.promised_delivery_on || ''} autoFocus onBlur={e => save(r, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(r, e.currentTarget.value); if (e.key === 'Escape') setEdit(null); }} aria-label={`Date promise du lot ${r.lot_code}`} />
                      : <>{r.promised_delivery_on ? date(r.promised_delivery_on) : '—'}{write && <button className="btn btn-ghost btn-icon" onClick={() => setEdit(r.sale_id)} aria-label={`Modifier la date promise du lot ${r.lot_code}`}><Pencil /></button>}</>}
                  </td>
                  <td>{r.delivered_at ? <Badge tone="ok">Livré</Badge> : r.delay_days > 0 ? <Badge tone="danger">{r.delay_days} j de retard prévu</Badge> : r.promised_delivery_on ? <Badge tone="ok">Dans les temps</Badge> : <span className="muted">—</span>}</td>
                  <td className="small">{r.delivered_at ? date(r.delivered_at) : '—'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
    </Card>
  );
}
