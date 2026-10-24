import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LogIn, LogOut, CalendarPlus, Receipt, Plus, Palmtree, Hourglass, CalendarCheck, KeyRound, GraduationCap, Target, FolderOpen, UserX, MapPin } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Field, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { RH, days, hours, hm, useRhMeta, metricValue } from '../../lib/rh';
import { LeaveForm, LeaveBadge, TypeDot, ExpenseForm, ExpenseBadge } from '../../components/RhForms';
import { Indicators } from './Reviews';
import PerformanceCurves from './PerformanceCurves';
import VehicleRequests from '../../components/VehicleRequests';
import MyDocuments from '../../components/MyDocuments';
import MyRequests from '../../components/MyRequests';
import PlacePicker, { placeLabel, NO_PLACE } from '../../components/PlacePicker';

/** Libre-service de l'employé (référence : espace « Mon profil » d'Odoo) : pointage, congés, frais, formations, entretien. */
export default function MySpace() {
  const { can } = useAuth();
  const { meta } = useRhMeta();
  const me = useResource(`${RH}/me`);
  const att = useResource(`${RH}/me/attendance`);
  const expenses = useResource(`${RH}/me/expenses`);
  const trainings = useResource(`${RH}/trainings`);
  const [leaveForm, setLeaveForm] = useState(false);
  const [expense, setExpense] = useState(null);
  const [pin, setPin] = useState(false);

  if (me.error?.status === 404) return <Card><Empty icon={UserX}><b>Aucune fiche employé n’est reliée à votre compte.</b><p className="small muted" style={{ marginTop: 6 }}>Le service RH crée votre fiche (ERP › Comptabilité › Employés ou RH › Personnel) et la relie à votre compte du dashboard.</p></Empty></Card>;
  if (!me.data) return <div className="stack"><ErrorBox error={me.error} /><Skeleton h={140} /><Skeleton h={240} /></div>;
  const { employee: e, balance: b, leaves, objectives, review, year, manager } = me.data;

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h2 className="erp-hello">{e.first_name} {e.last_name}</h2>
          <p className="muted small">{e.matricule} · {e.job_title}{manager ? ` · responsable : ${manager}` : ''} · entré(e) le {date(e.hire_date)}</p>
        </div>
        <div className="row">
          <Link className="btn" to={`/rh/personnel/${e.id}`}><FolderOpen />Mon dossier et mes compétences</Link>
          {can('self:pointage') && <button className="btn" onClick={() => setPin(true)}><KeyRound />{e.has_pin ? 'Changer mon code de pointage' : 'Choisir mon code de pointage'}</button>}
        </div>
      </div>

      <MyDocuments />

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        {can('self:pointage') ? <Clock att={att} meta={meta} /> : <Card title="Pointage"><p className="small muted">Votre rôle ne prévoit pas le pointage en ligne (borne ou feuille de présence du chantier).</p></Card>}
        <Card title="Mes congés payés" actions={can('self:conges') && <button className="btn btn-primary btn-sm" onClick={() => setLeaveForm(true)}><CalendarPlus />Demander</button>}>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="mini-stat"><Palmtree /><span>Disponibles</span><b>{b.available.toLocaleString('fr-FR')}</b></div>
            <div className="mini-stat"><Hourglass /><span>En attente d’accord</span><b>{b.pending.toLocaleString('fr-FR')}</b></div>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            Acquis : {b.accrued.toLocaleString('fr-FR')} j ({b.months} mois × {meta?.settings.accrual_per_month ?? 2.2}){b.bonus ? ` + ${b.bonus} j de majorations` : ''}{b.opening ? ` + reprise ${b.opening} j` : ''}{b.adjustments ? ` + ajustements ${b.adjustments} j` : ''} − pris {b.taken} j.
            {' '}Droit annuel actuel : {days(b.entitlement.total)}{b.entitlement.seniority ? ` (dont ${b.entitlement.seniority} d’ancienneté)` : ''}{b.entitlement.children ? ` (dont ${b.entitlement.children} pour enfants)` : ''}.
            {!b.eligible && <><br /><span style={{ color: 'var(--warn)' }}>Premier congé annuel ouvert après {meta?.settings.min_months_before_leave} mois de service.</span></>}
          </p>
        </Card>
      </div>

      <Card title="Mes demandes" bodyClass="">
        {!leaves.length ? <div className="card-body"><Empty icon={CalendarCheck}>Aucune demande pour l’instant.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Type</th><th>Période</th><th className="right">Jours</th><th>Statut</th><th /></tr></thead>
            <tbody>
              {leaves.map(l => (
                <tr key={l.id}>
                  <td><TypeDot type={l.type} meta={meta} />{l.label}{l.event_label && <div className="small muted">{l.event_label}</div>}</td>
                  <td className="small nowrap">{date(l.start_date)} → {date(l.end_date)}</td>
                  <td className="right tabular">{l.days}</td>
                  <td><LeaveBadge leave={l} meta={meta} />{l.decision_note && <div className="small muted">{l.decision_note}</div>}</td>
                  <td className="right">{(['en_attente', 'approuve_manager'].includes(l.status) || (l.status === 'approuvee' && l.start_date > new Date().toISOString().slice(0, 10))) && <CancelLeave leave={l} onDone={me.reload} />}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      <Card title="Mes notes de frais" actions={can('self:frais') && <button className="btn btn-sm" onClick={() => setExpense({})}><Plus />Note de frais</button>} bodyClass="">
        {!expenses.data ? <div className="card-body"><Skeleton h={80} /></div> : !expenses.data.length ? <div className="card-body"><Empty icon={Receipt}>Photographiez vos reçus (carburant, missions, petit matériel…) : ils sont approuvés par votre responsable puis remboursés.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Référence</th><th>Date</th><th>Dépense</th><th className="right">Montant</th><th>Statut</th></tr></thead>
            <tbody>
              {expenses.data.map(x => (
                <tr key={x.id} className={['brouillon', 'refusee'].includes(x.status) ? 'clickable' : ''} onClick={() => ['brouillon', 'refusee'].includes(x.status) && setExpense(x)}>
                  <td className="small tabular">{x.reference}</td><td className="small nowrap">{date(x.date)}</td>
                  <td>{x.label}<div className="small muted">{x.category_label}{` · ${placeLabel(x)}`}</div></td>
                  <td className="right tabular">{fcfa(x.amount)}</td>
                  <td><ExpenseBadge x={x} />{x.refusal_reason && <div className="small" style={{ color: 'var(--danger)' }}>{x.refusal_reason}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      {can('self:demandes') && <MyRequests />}
      {can('self:vehicule') && <VehicleRequests />}

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Mes formations" bodyClass="">
          {!trainings.data?.length ? <div className="card-body"><Empty icon={GraduationCap}>Aucune formation prévue.</Empty></div> : (
            <ul className="list">{trainings.data.map(t => (
              <li key={t.id} className="list-row"><span><b>{t.title}</b><div className="small muted">{date(t.start_date)} → {date(t.end_date)}{t.location ? ` · ${t.location}` : ''}</div></span><Badge tone={t.status === 'realisee' ? 'ok' : t.status === 'annulee' ? '' : 'brand'}>{t.status_label}</Badge></li>
            ))}</ul>
          )}
        </Card>
        <SelfReview year={year} objectives={objectives} review={review} onSaved={me.reload} />
      </div>

      <Indicators employeeId={e.id} year={year} />
      <PerformanceCurves employeeId={e.id} />

      {leaveForm && <LeaveForm onClose={() => setLeaveForm(false)} onSaved={() => { setLeaveForm(false); me.reload(); }} />}
      {expense && <ExpenseForm expense={expense.id ? expense : null} onClose={() => setExpense(null)} onSaved={() => { setExpense(null); expenses.reload(); }} />}
      {pin && <PinForm onClose={() => setPin(false)} onSaved={() => { setPin(false); me.reload(); }} />}
    </div>
  );
}

/** Pointage d'arrivée et de départ, avec la position si le réglage l'autorise. */
function Clock({ att, meta }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [site, setSite] = useState(NO_PLACE);
  const open = att.data?.open;
  const position = () => new Promise(resolve => {
    if (!meta?.settings.geolocation || !navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }), () => resolve({}), { timeout: 5000, maximumAge: 60000 });
  });
  const toggle = async () => {
    setBusy(true);
    try {
      const r = await api.post(`${RH}/me/attendance`, { ...site, ...(await position()) });
      toast(r.action === 'arrivee' ? `Arrivée pointée à ${hm(r.attendance.check_in)}` : `Départ pointé à ${hm(r.attendance.check_out)} · ${hours(r.attendance.hours)}`);
      att.reload();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Card title="Pointage">
      {!att.data ? <Skeleton h={90} /> : (
        <div className="stack" style={{ gap: 12 }}>
          <p className="muted small">{open ? <>Arrivé(e) à <b>{hm(open.check_in)}</b>{` · ${placeLabel(open)}`}</> : 'Vous n’avez pas pointé votre arrivée.'} · ce mois-ci : <b>{hours(att.data.hours)}</b></p>
          {!open && (
            <PlacePicker value={site} onChange={setSite} empty="Siège social" ariaLabel="Lieu de travail" />
          )}
          <button className={`btn ${open ? '' : 'btn-primary'} clock-btn`} disabled={busy} onClick={toggle}>{open ? <><LogOut />Pointer mon départ</> : <><LogIn />Pointer mon arrivée</>}</button>
          {meta?.settings.geolocation && <p className="small muted"><MapPin className="ico" />La position est enregistrée avec le pointage si votre appareil l’autorise.</p>}
        </div>
      )}
    </Card>
  );
}

function CancelLeave({ leave, onDone }) {
  const toast = useToast();
  const cancel = async () => {
    if (!window.confirm('Annuler cette demande ?')) return;
    try { await api.post(`${RH}/leaves/${leave.id}/decide`, { action: 'cancel' }); toast('Demande annulée'); onDone(); } catch (e) { toast(e.message, 'err'); }
  };
  return <button className="btn btn-ghost btn-sm" onClick={cancel}>Annuler</button>;
}

function PinForm({ onClose, onSaved }) {
  const toast = useToast();
  const saved = useSaved();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const save = async e => {
    e.preventDefault();
    try { await api.put(`${RH}/me/pin`, { pin }); saved('Code de pointage enregistré'); onSaved(); } catch (err) { setError(err); }
  };
  return (
    <Modal title="Code de pointage" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="pin-form">Enregistrer</button></>}>
      <form id="pin-form" className="stack" style={{ gap: 12 }} onSubmit={save}>
        <ErrorBox error={error} />
        <p className="small">Sur la borne de pointage du chantier, saisissez votre matricule puis ce code. Ne le communiquez à personne.</p>
        <Field label="Code (4 à 6 chiffres)"><input className="input" inputMode="numeric" autoComplete="new-password" type="password" pattern="\d{4,6}" required value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus /></Field>
      </form>
    </Modal>
  );
}

function SelfReview({ year, objectives, review, onSaved }) {
  const toast = useToast();
  const [text, setText] = useState(review?.self_comment || '');
  const locked = review?.status === 'finalise';
  const save = async () => {
    try { await api.put(`${RH}/me/review/${year}`, { self_comment: text }); toast('Auto-évaluation enregistrée'); onSaved(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Card title={`Mes objectifs ${year}`}>
      {!objectives.length ? <Empty icon={Target}>Vos objectifs seront fixés par votre responsable.</Empty> : (
        <ul className="stack" style={{ gap: 10, listStyle: 'none' }}>
          {objectives.map(o => (
            <li key={o.id}>
              <div className="row-between"><b className="small">{o.title}</b><span className="small muted">{o.auto ? `${metricValue(o.unit, o.actual)} / ${metricValue(o.unit, o.target_value)}` : ''}</span></div>
              <div className="pct-bar"><div className="pct-track"><div style={{ '--p': Math.min(100, o.progress) / 100, background: o.progress >= 100 ? 'var(--ok)' : 'var(--series-1)' }} /></div><span className="small tabular">{o.progress} %</span></div>
            </li>
          ))}
        </ul>
      )}
      <h3 className="erp-h3" style={{ marginTop: 16 }}>Mon auto-évaluation</h3>
      {locked ? <p className="small prewrap">{review.self_comment || '—'}<br /><Badge tone="ok">Entretien finalisé</Badge></p> : (
        <>
          <textarea className="textarea" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="Réussites de l’année, difficultés, besoins de formation…" />
          <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={save} disabled={text === (review?.self_comment || '')}>Enregistrer</button>
        </>
      )}
    </Card>
  );
}
