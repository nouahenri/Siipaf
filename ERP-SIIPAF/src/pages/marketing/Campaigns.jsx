/**
 * Marketing & Communication › Campagnes : liste (avec prospects mesurés) et création d'une campagne par un court brief
 * (objectif, segment, programme, offre, appel à l'action, page du site). L'IA propose ensuite le concept, le calendrier et les
 * contenus depuis la fiche de la campagne ; la Direction générale valide la campagne.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Megaphone } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource } from '@admin/lib/app-context';
import { Badge, Card, Empty, ErrorBox, Field, Skeleton } from '@admin/components/ui';
import { num } from '@admin/lib/format';
import { MK, CAMPAIGN_TONES, ModeBanner, fr } from '../../lib/marketing';

const EMPTY = { name: '', objective: '', segment: 'residence_principale', project_id: '', offer_id: '', cta_label: 'Réserver une visite', landing_path: 'contact.html', starts_on: '', ends_on: '' };

export default function Campaigns() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const list = useResource(`${MK}/campaigns`);
  const refs = useResource(`${MK}/refs`).data;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (list.error) return <ErrorBox error={list.error} />;
  if (!list.data || !refs) return <Skeleton h={300} />;
  const project = refs.projects.find(p => String(p.id) === String(f.project_id));
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value, ...(k === 'project_id' ? { offer_id: '' } : {}) }));

  const create = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const c = await api.post(`${MK}/campaigns`, {
        name: f.name, objective: f.objective || null, segment: f.segment, project_id: f.project_id ? Number(f.project_id) : null, offer_id: f.offer_id ? Number(f.offer_id) : null,
        cta_label: f.cta_label || null, landing_path: f.landing_path || 'contact.html', starts_on: f.starts_on || null, ends_on: f.ends_on || null,
      });
      navigate(`/marketing/campagnes/${c.id}`);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <ModeBanner mode={refs.mode} reason={refs.mode_reason} />
      <div className="row-between">
        <p className="muted" style={{ margin: 0 }}>Une campagne = un objectif, un segment, un programme, une offre, un appel à l’action et un lien suivi. Chaque contenu porte le code de sa campagne pour mesurer les prospects.</p>
        {can('marketing:generate') && <button className="btn btn-primary" onClick={() => setOpen(o => !o)}><Plus />Nouvelle campagne</button>}
      </div>

      {open && (
        <Card title="Nouvelle campagne">
          <form className="form-grid" onSubmit={create}>
            <ErrorBox error={error} />
            <Field label="Nom de la campagne" className="full"><input className="input" required minLength={3} maxLength={160} value={f.name} onChange={set('name')} placeholder="Rentrée 2026 — SIIPAF CITY Ahoutoué" /></Field>
            <Field label="Objectif" className="full" hint="Ce que la campagne doit produire (demandes de visite, rendez-vous, abonnés…) — sans promesse chiffrée de résultat"><textarea className="textarea" rows={2} maxLength={500} value={f.objective} onChange={set('objective')} /></Field>
            <Field label="Segment visé"><select className="select" value={f.segment} onChange={set('segment')}>{Object.entries(refs.segments).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Programme" hint="Vide : tous les programmes publiés"><select className="select" value={f.project_id} onChange={set('project_id')}><option value="">Tous les programmes</option>{refs.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Offre mise en avant"><select className="select" value={f.offer_id} onChange={set('offer_id')} disabled={!project}><option value="">{project ? 'Aucune en particulier' : 'Choisissez d’abord un programme'}</option>{project?.offers.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
            <Field label="Appel à l’action"><input className="input" maxLength={60} value={f.cta_label} onChange={set('cta_label')} /></Field>
            <Field label="Page du site visée" hint="Page de siipaf.com où mène le lien suivi (contact.html, projets.html, plan-interactif.html…)"><input className="input" maxLength={150} value={f.landing_path} onChange={set('landing_path')} /></Field>
            <Field label="Début"><input className="input" type="date" value={f.starts_on} onChange={set('starts_on')} /></Field>
            <Field label="Fin"><input className="input" type="date" value={f.ends_on} onChange={set('ends_on')} min={f.starts_on || undefined} /></Field>
            <div className="full row"><button className="btn btn-primary" disabled={busy}>Créer la campagne</button><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Annuler</button></div>
          </form>
        </Card>
      )}

      <Card title="Campagnes" bodyClass="">
        {!list.data.length ? <div className="card-body"><Empty icon={Megaphone}>Aucune campagne.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Campagne</th><th>Segment</th><th>Période</th><th>État</th><th className="right">Contenus à valider</th><th className="right">Prospects</th></tr></thead>
            <tbody>{list.data.map(c => (
              <tr key={c.id}>
                <td><Link className="link" to={`/marketing/campagnes/${c.id}`}><b>{c.name}</b></Link><div className="small muted">{c.code}{c.permanent ? ' · ligne éditoriale permanente' : ''}</div></td>
                <td className="small">{c.segment_label}</td>
                <td className="small nowrap">{c.starts_on || c.ends_on ? `${fr(c.starts_on)} → ${fr(c.ends_on)}` : 'Sans limite'}</td>
                <td><Badge tone={CAMPAIGN_TONES[c.status]}>{c.status_label}</Badge></td>
                <td className="right tabular">{num(c.contents.a_valider || 0)}</td>
                <td className="right tabular">{num(c.prospects)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
