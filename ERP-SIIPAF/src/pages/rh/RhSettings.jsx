import { useState } from 'react';
import { Plus, Trash2, Save, CalendarDays, RotateCcw, Briefcase } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Card, Skeleton, ErrorBox, Field, Empty } from '@admin/components/ui';
import { date } from '@admin/lib/format';
import { RH, useRhMeta, WEEKDAYS } from '../../lib/rh';
import { NewRoleModal } from '../../components/Positions';

const thisYear = new Date().getFullYear();

/** Réglages RH : congés (Code du travail), heures supplémentaires, notes de frais, jours fériés. */
export default function RhSettings() {
  const { can } = useAuth();
  const { meta, reload } = useRhMeta();
  const toast = useToast();
  const saved = useSaved();
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);
  const write = can('rh:settings');
  const cur = s || meta?.settings;
  if (!cur) return <Skeleton h={300} />;
  const set = (k, v) => setS({ ...cur, [k]: v });
  const num = k => e => set(k, e.target.value === '' ? '' : Number(e.target.value));
  const save = async () => {
    setError(null);
    try { await api.put(`${RH}/settings`, cur); await reload(); setS(null); saved('Réglages RH enregistrés'); } catch (e) { setError(e); }
  };
  const reset = () => { if (window.confirm('Revenir aux valeurs par défaut (Code du travail ivoirien) ?')) setS({ ...meta.defaults }); };
  // Appelé comme une fonction (et non comme un composant) pour que le champ garde le focus pendant la saisie
  const N = ({ k, label, hint, step = 1 }) => <Field key={k} label={label} hint={hint}><input className="input" type="number" step={step} disabled={!write} value={cur[k]} onChange={num(k)} /></Field>;

  return (
    <div className="stack">
      <ErrorBox error={error} />
      <div className="callout-erp"><CalendarDays /><span className="small">Valeurs par défaut tirées du Code du travail (loi 2015-532 modifiée en 2021 : art. 25.1 à 25.12) et des usages de paie ivoiriens. <b>À confirmer avec la convention collective applicable et le comptable</b> avant usage réel ; chaque modification s’applique aux calculs suivants.</span></div>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Congés payés">
          <div className="form-grid">
            {N({ k: "accrual_per_month", label: "Jours acquis par mois de service", hint: "Art. 25.1 : 2,2 jours ouvrables", step: 0.1 })}
            {N({ k: "min_months_before_leave", label: "Premier congé après (mois)", hint: "Art. 25.4 : un an de service" })}
            {N({ k: "child_bonus_days", label: "Jours par enfant à charge", hint: "Art. 25.2", step: 0.5 })}
            {N({ k: "child_bonus_young_age", label: "… si le salarié a moins de (ans)" })}
            {N({ k: "child_bonus_from_child", label: "… sinon à partir du n-ième enfant" })}
            {N({ k: "min_continuous_days", label: "Fraction principale (jours)", hint: "Art. 25.6 : 14 jours consécutifs" })}
            <Field label="Majorations d’ancienneté" className="full" hint="Années de service → jours en plus par an (art. 25.2)">
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {cur.seniority_bonus.map(([y, dd], i) => (
                  <span key={i} className="chip">
                    <input className="input mini" type="number" disabled={!write} value={y} onChange={e => set('seniority_bonus', cur.seniority_bonus.map((x, j) => (j === i ? [Number(e.target.value), x[1]] : x)))} aria-label="Années" /> ans →
                    <input className="input mini" type="number" disabled={!write} value={dd} onChange={e => set('seniority_bonus', cur.seniority_bonus.map((x, j) => (j === i ? [x[0], Number(e.target.value)] : x)))} aria-label="Jours" /> j
                    {write && <button onClick={() => set('seniority_bonus', cur.seniority_bonus.filter((_, j) => j !== i))} aria-label="Retirer"><Trash2 /></button>}
                  </span>
                ))}
                {write && <button className="btn btn-sm" onClick={() => set('seniority_bonus', [...cur.seniority_bonus, [(cur.seniority_bonus.at(-1)?.[0] || 0) + 5, (cur.seniority_bonus.at(-1)?.[1] || 0) + 1]])}><Plus />Palier</button>}
              </div>
            </Field>
            <Field label="Jours ouvrables" className="full">
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                {[1, 2, 3, 4, 5, 6, 0].map(d => <label key={d} className="checkbox small"><input type="checkbox" disabled={!write} checked={cur.working_days.includes(d)} onChange={e => set('working_days', e.target.checked ? [...cur.working_days, d] : cur.working_days.filter(x => x !== d))} />{WEEKDAYS[d]}</label>)}
              </div>
            </Field>
            <label className="checkbox small full"><input type="checkbox" disabled={!write} checked={cur.round_up} onChange={e => set('round_up', e.target.checked)} />Arrondir le droit annuel à l’entier supérieur</label>
            <label className="checkbox small full"><input type="checkbox" disabled={!write} checked={cur.allow_negative} onChange={e => set('allow_negative', e.target.checked)} />Autoriser les congés par anticipation (au-delà du solde, saisis par le service RH)</label>
          </div>
        </Card>
        <Card title="Autres absences et approbation">
          <div className="form-grid">
            {N({ k: "permission_min_months", label: "Permissions : ancienneté minimale (mois)", hint: "Art. 25.12 : 6 mois" })}
            {N({ k: "permission_max_days", label: "Permissions : plafond annuel (jours)", hint: "Art. 25.12 : 10 jours" })}
            {N({ k: "maternity_days", label: "Congé de maternité (jours)", hint: "14 semaines" })}
            {N({ k: "paternity_days", label: "Congé de paternité (jours)", hint: "À confirmer" })}
            <Field label="Circuit d’approbation" className="full">
              <select className="select" disabled={!write} value={cur.approval} onChange={e => set('approval', e.target.value)}>
                <option value="manager_then_rh">Responsable direct, puis service RH</option>
                <option value="rh">Service RH seul</option>
              </select>
            </Field>
          </div>
          <h3 className="erp-h3" style={{ marginTop: 16 }}>Permissions par événement (art. 25.12)</h3>
          <ul className="small" style={{ columns: 2, listStyle: 'none' }}>{meta && Object.values(meta.events).map(e => <li key={e.label}>{e.label} : <b>{e.days} j</b></li>)}</ul>
        </Card>
        <Card title="Présences et heures supplémentaires">
          <div className="form-grid">
            {N({ k: "weekly_hours", label: "Durée légale (heures / semaine)" })}
            {N({ k: "hourly_divisor", label: "Diviseur du taux horaire", hint: "40 h × 52 / 12 = 173,33", step: 0.01 })}
            {cur.overtime_tiers.map(([size, rate], i) => (
              <Field key={i} label={size == null ? 'Au-delà : majoration (%)' : `${i === 0 ? `De la ${cur.weekly_hours + 1}e à la ${cur.weekly_hours + size}e heure` : 'Tranche suivante'} : majoration (%)`}>
                <input className="input" type="number" disabled={!write} value={rate} onChange={e => set('overtime_tiers', cur.overtime_tiers.map((x, j) => (j === i ? [x[0], Number(e.target.value)] : x)))} />
              </Field>
            ))}
            {N({ k: "night_rate", label: "Heures de nuit (%)" })}
            {N({ k: "sunday_rate", label: "Dimanche et jour férié (%)" })}
            {N({ k: "sunday_night_rate", label: "Nuit du dimanche / férié (%)" })}
            {N({ k: "night_start", label: "Nuit à partir de (heure)" })}
            {N({ k: "night_end", label: "Nuit jusqu’à (heure)" })}
            {N({ k: "overtime_year_cap", label: "Plafond annuel (heures)" })}
            {N({ k: "break_minutes", label: "Pause déjeuner retirée (minutes)", hint: "Pointage continu, prise à 12 h ; 0 = aucune" })}
            {N({ k: "break_after_hours", label: "… si le pointage dépasse (heures)", step: 0.5 })}
            <Field label="Services sans heures supplémentaires payées" className="full" hint="Cadres au forfait : leurs heures restent suivies">
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                {meta && Object.entries(meta.departments).map(([k, v]) => <label key={k} className="checkbox small"><input type="checkbox" disabled={!write} checked={(cur.overtime_exempt_departments || []).includes(k)} onChange={e => set('overtime_exempt_departments', e.target.checked ? [...(cur.overtime_exempt_departments || []), k] : cur.overtime_exempt_departments.filter(x => x !== k))} />{v}</label>)}
              </div>
            </Field>
            <label className="checkbox small full"><input type="checkbox" disabled={!write} checked={cur.geolocation} onChange={e => set('geolocation', e.target.checked)} />Enregistrer la position lors du pointage en ligne (si l’appareil l’autorise)</label>
          </div>
        </Card>
        <Card title="Notes de frais">
          <div className="form-grid">
            {Object.entries(cur.expense_categories).map(([k, c]) => (
              <Field key={k} label={c.label}>
                <input className="input" disabled={!write} value={c.account} onChange={e => set('expense_categories', { ...cur.expense_categories, [k]: { ...c, account: e.target.value.trim() } })} aria-label={`Compte ${c.label}`} />
              </Field>
            ))}
            <Field label="Compte des frais à rembourser" hint="Dette envers l’employé, suivie par tiers"><input className="input" disabled={!write} value={cur.expense_payable_account} onChange={e => set('expense_payable_account', e.target.value.trim())} /></Field>
          </div>
        </Card>
      </div>
      {write && <div className="row" style={{ gap: 8 }}><button className="btn btn-primary" disabled={!s} onClick={save}><Save />Enregistrer les réglages</button><button className="btn btn-ghost" onClick={reset}><RotateCcw />Valeurs par défaut</button></div>}
      <Positions />
      <Holidays />
    </div>
  );
}

/**
 * Postes de l'entreprise (choix du client du 23/10) : proposés en liste dans la fiche employé, la création d'un compte
 * et le changement de poste ; chacun rattaché à un service, avec la catégorie et le rôle du compte proposés.
 */
function Positions() {
  const { can } = useAuth();
  const { meta } = useRhMeta();
  const toast = useToast();
  const list = useResource(`${RH}/positions?all=1`);
  const blank = { title: '', department: 'administratif', category: '', default_role: '' };
  const [f, setF] = useState(blank);
  const [open, setOpen] = useState(null); // null : formulaire replié ; 'new' : nouveau poste ; id : poste modifié
  const [newRole, setNewRole] = useState(false);
  const write = can('rh:settings');
  const roles = list.data?.roles || [];
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const close = () => { setOpen(null); setF(blank); };
  const edit = p => { setOpen(p.id); setF({ title: p.title, department: p.department, category: p.category || '', default_role: p.default_role || '' }); };
  // « Créer un rôle… » dans la liste : ouvre la fenêtre du rôle, puis le sélectionne
  const pickRole = e => (e.target.value === '__new' ? setNewRole(true) : set('default_role')(e));
  const save = async e => {
    e.preventDefault();
    const body = { title: f.title.trim(), department: f.department, category: f.category.trim() || null, default_role: f.default_role || null };
    try {
      if (open !== 'new') await api.patch(`${RH}/positions/${open}`, body); else await api.post(`${RH}/positions`, body);
      toast(open !== 'new' ? 'Poste modifié' : 'Poste ajouté'); close(); list.reload();
    } catch (err) { toast(err.message, 'err'); }
  };
  const toggle = async p => { try { await api.patch(`${RH}/positions/${p.id}`, { active: !p.active }); list.reload(); } catch (err) { toast(err.message, 'err'); } };
  const [merging, setMerging] = useState(null); // poste à fusionner dans un autre
  const merge = async into => {
    const target = list.data.positions.find(x => x.id === Number(into));
    if (!target || !window.confirm(`Fusionner « ${merging.title} » dans « ${target.title} » ? Ses ${merging.employees} fiche(s) prendront l’intitulé « ${target.title} ».`)) return;
    try { await api.post(`${RH}/positions/${merging.id}/merge`, { into: target.id }); toast('Postes fusionnés'); setMerging(null); list.reload(); } catch (err) { toast(err.message, 'err'); }
  };
  return (
    <Card title="Postes" bodyClass="">
      <div className="card-body" style={{ borderBottom: '1px solid var(--border)' }}>
        <p className="small muted" style={{ margin: 0 }}>
          Liste proposée dans la fiche employé, la création d’un compte et « Changer de poste ». Le rôle indiqué est proposé pour le compte de la personne au changement de poste (ses droits dans le dashboard et l’ERP). Renommer un poste renomme les fiches qui l’occupent.
        </p>
        {write && !open && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn btn-primary btn-sm" onClick={() => setOpen('new')}><Plus />Ajouter un poste</button></div>}
      </div>
      {write && open && (
        <form id="position-form" className="card-body form-grid" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }} onSubmit={save}>
          <Field label={open === 'new' ? 'Nouveau poste' : 'Intitulé du poste'}><input className="input" required minLength={2} maxLength={120} value={f.title} onChange={set('title')} placeholder="Responsable commercial, conducteur de travaux…" autoFocus /></Field>
          <Field label="Service"><select className="select" value={f.department} onChange={set('department')}>{meta && Object.entries(meta.departments).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Catégorie habituelle"><input className="input" maxLength={40} value={f.category} onChange={set('category')} placeholder="Cadre, agent de maîtrise…" /></Field>
          <Field label="Rôle du compte proposé" hint={can('roles:write') ? 'Absent de la liste : « + Créer un nouveau rôle »' : 'Rôle absent : à créer par le super administrateur ou la personne qui en a le droit'}>
            <select className="select" value={f.default_role} onChange={pickRole}>
              <option value="">— Aucun —</option>{roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              {can('roles:write') && <option value="__new">+ Créer un nouveau rôle…</option>}
            </select>
          </Field>
          <div className="full row" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-sm"><Save />Enregistrer</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={close}>Annuler</button>
          </div>
        </form>
      )}
      {newRole && <NewRoleModal onClose={() => setNewRole(false)} onCreated={role => { setNewRole(false); setF(x => ({ ...x, default_role: role.id })); list.reload(); }} />}
      {!list.data ? <div className="card-body"><Skeleton h={120} /></div> : !list.data.positions.length ? <div className="card-body"><Empty icon={Briefcase}>Aucun poste : ajoutez-en ci-dessous.</Empty></div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Poste</th><th>Service</th><th>Catégorie</th><th>Rôle proposé</th><th className="right">Employés</th><th /></tr></thead>
          <tbody>{list.data.positions.map(p => (
            <tr key={p.id} style={p.active ? undefined : { opacity: 0.55 }}>
              <td><b>{p.title}</b>{!p.active && <span className="small muted"> · archivé</span>}</td>
              <td className="small">{p.department_label}</td>
              <td className="small">{p.category || '—'}</td>
              <td className="small">{roles.find(r => r.id === p.default_role)?.label || '—'}</td>
              <td className="right tabular">{p.employees}</td>
              <td className="right nowrap">{write && <>
                <button className="btn btn-ghost btn-sm" onClick={() => { edit(p); setTimeout(() => document.getElementById('position-form')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50); }}>Modifier</button>
                <button className="btn btn-ghost btn-sm" onClick={() => toggle(p)}>{p.active ? 'Archiver' : 'Réactiver'}</button>
                {merging?.id === p.id
                  ? <select className="select" style={{ width: 'auto', display: 'inline-block' }} autoFocus value="" onChange={e => merge(e.target.value)} onBlur={() => setMerging(null)} aria-label="Fusionner dans">
                      <option value="">Fusionner dans…</option>{list.data.positions.filter(x => x.id !== p.id).map(x => <option key={x.id} value={x.id}>{x.title}</option>)}
                    </select>
                  : <button className="btn btn-ghost btn-sm" onClick={() => setMerging(p)} title="Pour un poste en double (orthographe différente)">Fusionner</button>}
              </>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

function Holidays() {
  const { can } = useAuth();
  const toast = useToast();
  const [year, setYear] = useState(thisYear);
  const list = useResource(`${RH}/holidays?year=${year}`);
  const [f, setF] = useState({ date: '', label: '' });
  const write = can('rh:settings');
  const seed = async () => { try { const r = await api.post(`${RH}/holidays/seed`, { year }); toast(`${r.created} jour(s) férié(s) ajouté(s)`); list.reload(); } catch (e) { toast(e.message, 'err'); } };
  const add = async e => { e.preventDefault(); try { await api.post(`${RH}/holidays`, f); setF({ date: '', label: '' }); list.reload(); } catch (err) { toast(err.message, 'err'); } };
  const del = async h => { try { await api.del(`${RH}/holidays/${h.id}`); list.reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title="Jours fériés" actions={<div className="row" style={{ gap: 8 }}>
      <select className="select" style={{ width: 'auto' }} value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Année">{[thisYear - 1, thisYear, thisYear + 1].map(y => <option key={y} value={y}>{y}</option>)}</select>
      {write && <button className="btn btn-sm" onClick={seed}><Plus />Fêtes fixes et chrétiennes {year}</button>}
    </div>} bodyClass="">
      <p className="card-body small muted" style={{ borderBottom: '1px solid var(--border)' }}>Décret 2001-22. Les fêtes musulmanes (Aïd el-Fitr, Tabaski, Maouloud, Nuit du destin et lendemains) dépendent de la lune : ajoutez-les chaque année dès leur annonce officielle. Les jours fériés ne sont pas décomptés des congés.</p>
      {!list.data ? <div className="card-body"><Skeleton h={120} /></div> : !list.data.length ? <div className="card-body"><Empty icon={CalendarDays}>Aucun jour férié saisi pour {year}.</Empty></div> : (
        <ul className="list">{list.data.map(h => <li key={h.id} className="list-row"><span><b>{h.label}</b><div className="small muted" style={{ textTransform: 'capitalize' }}>{new Date(`${h.date}T00:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'UTC' })} {date(h.date)}</div></span>{write && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => del(h)} aria-label="Supprimer"><Trash2 /></button>}</li>)}</ul>
      )}
      {write && (
        <form className="card-body row" style={{ gap: 8, borderTop: '1px solid var(--border)' }} onSubmit={add}>
          <input className="input" type="date" required style={{ width: 'auto' }} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} aria-label="Date" />
          <input className="input" required minLength={2} placeholder="Aïd el-Fitr, Tabaski…" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} aria-label="Libellé" style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm"><Plus />Ajouter</button>
        </form>
      )}
    </Card>
  );
}
