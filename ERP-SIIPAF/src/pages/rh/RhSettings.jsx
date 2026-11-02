import { useState } from 'react';
import { Plus, Trash2, Save, CalendarDays, RotateCcw, Briefcase, MapPinned, Check, X } from 'lucide-react';
import { parseGps, gpsText, mapsLink } from '@admin/lib/gps';
import GpsInput from '../../components/GpsInput';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Card, Skeleton, ErrorBox, Field, Empty, Badge } from '@admin/components/ui';
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
  const write = can('rh:rules');
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
            <label className="checkbox small full"><input type="checkbox" disabled={!write} checked={cur.geolocation} onChange={e => set('geolocation', e.target.checked)} />Enregistrer la position lors du pointage en ligne et à la borne, et la comparer au lieu choisi (si l’appareil l’autorise)</label>
            {cur.geolocation && <>
              {N({ k: "geofence_radius", label: "Rayon par défaut autour du lieu (mètres)", hint: "Au-delà : « hors zone » ; précision du téléphone prise en compte. Rayon propre à un lieu : section Positions de pointage" })}
              <label className="checkbox small full"><input type="checkbox" disabled={!write} checked={cur.geofence_notify} onChange={e => set('geofence_notify', e.target.checked)} />Prévenir le service RH, le responsable direct et le conducteur du chantier d’un pointage hors zone</label>
            </>}
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
      <PointageZones key={`${meta.settings.geolocation}:${meta.settings.geofence_radius}`} />
      <DepartmentHeads />
      <Positions />
      <Holidays />
    </div>
  );
}

/**
 * Positions de pointage (demande du client du 02/11) : position GPS et rayon du siège, des autres lieux et des chantiers en
 * cours, comparés à la position du téléphone ou de la borne à chaque pointage. Les lieux se règlent aussi dans Administration
 * générale › Lieux (mêmes données) ; un programme garde la position de sa fiche dans le dashboard, reprise par ses chantiers
 * qui n'ont pas la leur.
 */
function PointageZones() {
  const { can, user } = useAuth();
  const toast = useToast();
  const visible = can('rh:read') || can('rh:rules') || can('presence:zones');
  const write = can('presence:zones'); // responsable RH, responsable des exploitations, super administrateur (choix du client du 02/11)
  const superAdmin = user?.role === 'super_admin';
  const z = useResource(visible ? `${RH}/attendance/zones` : null);
  const [edits, setEdits] = useState({});
  if (!visible) return null;
  const key = (kind, x) => `${kind}:${x.id}`;
  const row = (kind, x) => edits[key(kind, x)] || { gps: gpsText(x), radius: x.radius_m || '' };
  const change = (kind, x, patch) => setEdits(m => ({ ...m, [key(kind, x)]: { ...row(kind, x), ...patch } }));
  const dirty = (kind, x) => { const r = edits[key(kind, x)]; return !!r && (r.gps !== gpsText(x) || String(r.radius) !== String(x.radius_m || '')); };
  const save = async (kind, x) => {
    const r = row(kind, x), gps = parseGps(r.gps);
    if (gps === false) return toast('Position illisible : « latitude, longitude » ou lien Google Maps.', 'err');
    try {
      const data = await api.put(`${RH}/attendance/zones/${kind}/${x.id}`, { latitude: gps ? gps.lat : null, longitude: gps ? gps.lng : null, radius_m: Number(r.radius) || null });
      z.setData(data); setEdits(m => { const { [key(kind, x)]: _, ...rest } = m; return rest; });
      toast(data.request_id ? `Modification envoyée au super administrateur pour validation : ${x.reference || x.name}` : `Position enregistrée : ${x.reference || x.name}`);
    } catch (e) { toast(e.message, 'err'); }
  };
  const decide = async (p, action) => {
    const note = action === 'refuser' ? window.prompt('Motif du refus (facultatif) :') : null;
    if (action === 'refuser' && note === null) return;
    try { z.setData(await api.post(`${RH}/attendance/zones/requests/${p.id}/decide`, { action, note: note || null })); toast({ valider: 'Position validée', refuser: 'Modification refusée', annuler: 'Demande annulée' }[action]); } catch (e) { toast(e.message, 'err'); }
  };
  const d = z.data;
  const pendingRow = (kind, x) => {
    const p = x.pending;
    if (!p) return null;
    return (
      <tr key={`${key(kind, x)}:pending`}>
        <td />
        <td colSpan={2} className="small" style={{ color: 'var(--warn)' }}>
          En attente du super administrateur : {p.latitude != null ? <>{p.latitude}, {p.longitude} <a className="link" href={mapsLink(p.latitude, p.longitude)} target="_blank" rel="noreferrer">carte</a></> : 'effacer la position'}
          {p.radius_m ? ` · rayon ${p.radius_m} m` : ''} — proposé par {p.requested_by_name || '—'}. La position actuelle sert d’ici la décision.
        </td>
        <td className="right nowrap">
          {superAdmin && <><button className="btn btn-sm btn-primary" onClick={() => decide(p, 'valider')}><Check />Valider</button> <button className="btn btn-sm btn-ghost" onClick={() => decide(p, 'refuser')}><X />Refuser</button></>}
          {!superAdmin && p.requested_by === user?.id && <button className="btn btn-sm btn-ghost" onClick={() => decide(p, 'annuler')}>Annuler ma demande</button>}
        </td>
      </tr>
    );
  };
  const editRow = (kind, x, label, fallback) => [
    <tr key={key(kind, x)}>
      <td className="small" style={kind === 'chantier' ? { paddingLeft: 28 } : undefined}>{label}{fallback && !row(kind, x).gps && <div className="muted">{fallback}</div>}</td>
      <td style={{ minWidth: 260 }}><GpsInput value={row(kind, x).gps} disabled={!write} onChange={v => change(kind, x, { gps: v })} ariaLabel={`Position de ${x.reference || x.name}`} /></td>
      <td style={{ width: 120 }}><input className="input" type="number" min={5} max={5000} disabled={!write} value={row(kind, x).radius} placeholder={`${d.default_radius} (défaut)`} onChange={e => change(kind, x, { radius: e.target.value })} aria-label={`Rayon de ${x.reference || x.name} en mètres`} /></td>
      <td className="right">{write && <button className="btn btn-sm btn-primary" disabled={!dirty(kind, x)} onClick={() => save(kind, x)}><Save />{x.latitude != null && !superAdmin ? 'Proposer' : 'Enregistrer'}</button>}</td>
    </tr>,
    pendingRow(kind, x),
  ];
  const pendingCount = d ? d.places.filter(p => p.pending).length + d.programmes.reduce((n, p) => n + p.worksites.filter(w => w.pending).length, 0) : 0;
  return (
    <div id="positions-pointage"><Card title={<span className="row" style={{ gap: 8 }}><MapPinned className="ico" />Positions de pointage{pendingCount > 0 && <Badge tone="warn">{pendingCount} à valider</Badge>}</span>} bodyClass="">
      <div className="card-body" style={{ borderBottom: '1px solid var(--border)' }}>
        <p className="small muted" style={{ margin: 0 }}>
          À chaque pointage en ligne ou à la borne, la position de l’appareil est comparée à celle du lieu choisi : <b>sur place</b>, <b>hors zone</b>, <b>position imprécise</b> (la marge d’erreur du téléphone déborde du rayon) ou <b>position non fournie</b>. Le pointage est toujours enregistré ; les écarts sont signalés dans Présences › Pointages.
          {' '}Collez la position depuis Google Maps (clic droit sur le bâtiment) ou utilisez « Ma position » sur place. Les lieux se règlent aussi dans Administration générale › Lieux.
          {' '}Saisie par le responsable RH, le responsable des exploitations ou le super administrateur ; une fois une position saisie, <b>la changer ou l’effacer attend la validation du super administrateur</b> (sauf s’il le fait lui-même).
        </p>
        {d && !d.geolocation && <p className="small" style={{ margin: '8px 0 0', color: 'var(--warn)' }}>La géolocalisation du pointage est désactivée ci-dessus : aucun contrôle n’est fait tant qu’elle reste coupée.</p>}
      </div>
      <ErrorBox error={z.error} />
      {!d ? <div className="card-body"><Skeleton h={160} /></div> : (
        <div className="table-wrap"><table className="table table-compact">
          <thead><tr><th>Lieu ou chantier</th><th>Position (latitude, longitude)</th><th>Rayon (m)</th><th /></tr></thead>
          <tbody>
            <tr><td colSpan={4} className="small"><b>Lieux</b></td></tr>
            {d.places.map(p => editRow('lieu', p, <b>{p.name}</b>))}
            <tr><td colSpan={4} className="small"><b>Programmes et chantiers en cours</b></td></tr>
            {d.programmes.map(p => [
              <tr key={`p:${p.id}`}>
                <td className="small"><b>{p.name}</b></td>
                <td className="small" colSpan={3}>{p.latitude != null
                  ? <>{p.latitude}, {p.longitude} <a className="link" href={mapsLink(p.latitude, p.longitude)} target="_blank" rel="noreferrer">carte</a> <span className="muted">· fiche du programme (dashboard), rayon par défaut</span></>
                  : <span className="muted">Sans position : à saisir sur la fiche du programme dans le dashboard (Position GPS du projet).</span>}</td>
              </tr>,
              ...p.worksites.map(w => editRow('chantier', w, <>{w.reference} — {w.name}</>, p.latitude != null ? 'Vide : position du programme' : 'Vide : chantier non situé')),
            ])}
          </tbody>
        </table></div>
      )}
    </Card></div>
  );
}

/**
 * Chef de chaque service (choix du client du 29/10) : lui seul fait les demandes au nom du service (achat, équipement,
 * véhicule…) depuis le tableau de bord du module ; il est prévenu de sa désignation. Employés ayant un compte.
 */
function DepartmentHeads() {
  const { can } = useAuth();
  const { meta } = useRhMeta();
  const toast = useToast();
  const heads = useResource(`${RH}/department-heads`);
  const staff = useResource(`${RH}/employees`);
  const write = can('rh:heads');
  const change = async (department, value) => {
    try { await api.put(`${RH}/department-heads/${department}`, { employee_id: value ? Number(value) : null }); toast(value ? 'Chef de service désigné : il est prévenu' : 'Chef de service retiré'); heads.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  if (!meta || !heads.data || !staff.data) return <Card title="Chefs de service"><Skeleton h={160} /></Card>;
  const people = staff.data.filter(e => e.user_id);
  return (
    <Card title="Chefs de service" bodyClass="">
      <div className="card-body" style={{ borderBottom: '1px solid var(--border)' }}>
        <p className="small muted" style={{ margin: 0 }}>Le chef fait les demandes au nom de tout son service (fournitures, équipement, dépannage, prêt de matériel, véhicule) depuis le tableau de bord du module ; même circuit que les demandes personnelles. Les membres du service les suivent. Seuls les employés ayant un compte sont proposés.</p>
      </div>
      <div className="table-wrap"><table className="table table-compact"><tbody>{Object.entries(meta.departments).map(([k, label]) => {
        const mates = people.filter(e => e.department === k), others = people.filter(e => e.department !== k);
        const opt = e => <option key={e.id} value={e.id}>{e.last_name} {e.first_name}{e.job_title ? ` — ${e.job_title}` : ''}</option>;
        return (
          <tr key={k}>
            <td className="small"><b>{label}</b></td>
            <td style={{ width: '60%' }}>
              <select className="select" disabled={!write} value={heads.data[k]?.employee_id || ''} onChange={e => change(k, e.target.value)} aria-label={`Chef du service ${label}`}>
                <option value="">— Aucun chef désigné —</option>
                {mates.length > 0 && <optgroup label={`Service ${label}`}>{mates.map(opt)}</optgroup>}
                {others.length > 0 && <optgroup label="Autres services">{others.map(opt)}</optgroup>}
              </select>
            </td>
          </tr>
        );
      })}</tbody></table></div>
    </Card>
  );
}

/**
 * Postes de l'entreprise (choix du client du 23/10) : proposés en liste dans la fiche employé, la création d'un compte
 * et le changement de poste ; chacun rattaché à un service, avec la catégorie et le rôle du compte proposés.
 */
function Positions() {
  const { can, user } = useAuth();
  const { meta } = useRhMeta();
  const toast = useToast();
  const list = useResource(`${RH}/positions?all=1`);
  const blank = { title: '', department: 'administratif', category: '', default_role: '' };
  const [f, setF] = useState(blank);
  const [open, setOpen] = useState(null); // null : formulaire replié ; 'new' : nouveau poste ; id : poste modifié
  const [newRole, setNewRole] = useState(false);
  const write = can('rh:positions');
  const roles = list.data?.roles || [];
  // Super administrateur : proposé ou retiré par un super administrateur seulement (le serveur le contrôle aussi)
  const superAdmin = user?.role === 'super_admin', lockedRole = roles.find(r => r.id === f.default_role)?.reserved && !superAdmin;
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
          <Field label="Rôle du compte proposé" hint={lockedRole ? 'Rôle réservé : seul un super administrateur le modifie' : can('roles:write') ? 'Absent de la liste : « + Créer un nouveau rôle ». Super administrateur : droits fixes, réservé au super administrateur' : 'Rôle absent : à créer par le super administrateur ou la personne qui en a le droit'}>
            <select className="select" value={f.default_role} onChange={pickRole} disabled={lockedRole}>
              <option value="">— Aucun —</option>{roles.filter(r => !r.reserved || superAdmin || r.id === f.default_role).map(r => <option key={r.id} value={r.id}>{r.label}{r.reserved ? ' (droits fixes)' : ''}</option>)}
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
  const write = can('rh:holidays');
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
