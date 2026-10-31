/**
 * Marketing & Communication › Tableau de bord : ce que l'IA a préparé et attend d'être validé, le calendrier des deux
 * prochaines semaines, les prospects par campagne, canal et segment, la dépense de l'IA contre son plafond. La Direction
 * générale supervise ici (arrêt d'urgence compris) ; la responsable de la communication y trouve son travail du jour.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Hourglass, CalendarClock, Users, Wallet, Siren, Play, Megaphone } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved, useToast } from '@admin/lib/app-context';
import { Badge, Card, Empty, ErrorBox, Skeleton } from '@admin/components/ui';
import { dateTime, fcfa, num } from '@admin/lib/format';
import { Kpi } from '../commercial/CommercialDashboard';
import { MK, ModeBanner, CAMPAIGN_TONES, contentStatus, frDay, fr } from '../../lib/marketing';
import { ContentDrawer } from '../../components/MarketingContent';

const GEN_TONES = { ok: 'ok', invalide: 'warn', erreur: 'danger', refuse_plafond: 'danger', en_cours: '' };
const GEN_LABELS = { ok: 'Réussie', invalide: 'Sortie invalide', erreur: 'Erreur', refuse_plafond: 'Refusée (plafond)', en_cours: 'En cours' };

export default function MarketingDashboard() {
  const { can } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const res = useResource(`${MK}/dashboard`);
  const refs = useResource(`${MK}/refs`).data;
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const d = res.data;
  if (res.error) return <ErrorBox error={res.error} />;
  if (!d) return <div className="grid grid-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} h={110} />)}</div>;
  const u = d.usage;
  const tone = u.pct >= 100 ? 'danger' : u.pct >= u.alert_pct ? 'warn' : 'ok';

  const stop = async active => {
    setBusy(true);
    try { await api.post(`${MK}/settings/emergency-stop`, { active }); await res.reload(); saved(active ? 'Arrêt d’urgence activé : l’IA est suspendue' : 'Arrêt d’urgence levé'); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <ModeBanner mode={u.mode} reason={u.mode_reason} />
      {u.emergency_stop && (
        <div className="alert" role="alert"><b>Arrêt d’urgence actif.</b> L’IA ne prépare plus rien (ni à la demande ni chaque semaine) ; les tâches reprennent à la levée.
          {can('marketing:settings') && <> <button className="btn btn-sm" disabled={busy} onClick={() => stop(false)}><Play />Lever l’arrêt d’urgence</button></>}</div>
      )}

      <div className="grid grid-4">
        <Kpi to="/marketing/contenus?statut=a_valider" icon={Hourglass} label="Contenus à valider" count={d.contents.a_valider} tint={d.contents.a_valider ? 'amber' : undefined} foot={`${num(d.contents.brouillon)} brouillon(s) · ${num(d.contents.valide)} validé(s) à planifier`} />
        <Kpi to="/marketing/calendrier" icon={CalendarClock} label="Planifiés ou publiés" count={d.contents.planifie + d.contents.publie} foot={`${num(d.contents.planifie)} planifié(s) · ${num(d.contents.publie)} publié(s)`} />
        <Kpi icon={Users} label="Prospects venus d’une campagne" count={d.leads.tracked} foot={`sur ${num(d.leads.total)} prospects au total`} />
        <Kpi to={can('marketing:settings') ? '/marketing/reglages' : undefined} icon={Wallet} label="Dépense de l’IA ce mois" count={u.spent_fcfa} format={fcfa} tint={u.pct >= u.alert_pct ? 'amber' : undefined}
          foot={u.cap_fcfa ? `${u.pct} % du plafond de ${fcfa(u.cap_fcfa)}` : 'plafond à 0 : IA bloquée'} />
      </div>

      <Card title="Dépense de l’IA contre le plafond mensuel" actions={can('marketing:settings') && !u.emergency_stop ? <button className="btn btn-sm" disabled={busy} onClick={() => stop(true)}><Siren />Arrêt d’urgence</button> : null}>
        <div className="row" style={{ gap: 10 }}>
          <b className="tabular">{fcfa(u.spent_fcfa)}</b><span className="muted">sur {fcfa(u.cap_fcfa)}</span>
          <Badge tone={tone}>{u.pct} %</Badge>
          <span className="small muted">≈ {u.spent_usd.toLocaleString('fr-FR')} $ au taux de {u.usd_fcfa} FCFA · {u.calls} appel(s) de l’IA · modèle {u.model}</span>
        </div>
        <div className="progress" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={u.pct} aria-label="Dépense de l’IA"><div style={{ width: `${u.pct}%`, background: tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--danger)' }} /></div>
        <p className="small muted" style={{ margin: 0 }}>Clé de l’IA : {u.key.present ? `présente (…${u.key.last4})` : 'absente (mode démonstration)'} · aucune publication automatique : tout contenu est validé par une personne.</p>
      </Card>

      <div className="grid grid-2">
        <Card title="Calendrier des deux prochaines semaines" actions={<Link className="small" to="/marketing/calendrier">Calendrier éditorial</Link>} bodyClass="">
          {!d.upcoming.length ? <div className="card-body"><Empty icon={CalendarClock}>Rien de prévu. L’IA prépare la semaine suivante chaque semaine ; vous pouvez aussi lui demander des contenus depuis une campagne.</Empty></div> : (
            <ul className="list">
              {d.upcoming.map(c => (
                <li key={c.id}><button className="list-row" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(c.id)}>
                  <span style={{ minWidth: 0, flex: 1 }}><strong className="ellipsis">{c.title}</strong><span className="small muted ellipsis">{c.channel_label} · {c.campaign_name}</span></span>
                  <span className="small nowrap">{frDay(c.scheduled_for)} {contentStatus(c, refs)}</span>
                </button></li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Campagnes" actions={<Link className="small" to="/marketing/campagnes">Toutes les campagnes</Link>} bodyClass="">
          {!d.campaigns.length ? <div className="card-body"><Empty icon={Megaphone}>Aucune campagne.</Empty></div> : (
            <ul className="list">
              {d.campaigns.slice(0, 8).map(c => (
                <li key={c.id}><Link to={`/marketing/campagnes/${c.id}`} className="list-row">
                  <span style={{ minWidth: 0, flex: 1 }}><strong className="ellipsis">{c.name}</strong><span className="small muted ellipsis">{c.segment_label}{c.permanent ? ' · ligne permanente' : ''}</span></span>
                  <span className="small nowrap">{num(c.prospects)} prospect(s) <Badge tone={CAMPAIGN_TONES[c.status]}>{c.status_label}</Badge></span>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Prospects par canal (type de lien)" bodyClass="">
          {!d.by_medium.length ? <div className="card-body"><Empty icon={Users}>Aucun prospect ne vient encore d’un lien de campagne. Les liens suivis se copient depuis chaque contenu.</Empty></div> : (
            <ul className="list">{d.by_medium.map(m => <li key={m.medium} className="list-row"><span>{m.medium}</span><b className="tabular">{num(m.prospects)}</b></li>)}</ul>
          )}
        </Card>
        <Card title="Prospects par segment" bodyClass="">
          {!d.by_segment.length ? <div className="card-body"><p className="muted small">Pas encore de mesure.</p></div> : (
            <ul className="list">{d.by_segment.map(s => <li key={s.segment} className="list-row"><span>{s.label}</span><b className="tabular">{num(s.prospects)}</b></li>)}</ul>
          )}
        </Card>
      </div>

      <Card title="Dernières préparations de l’IA" actions={can('marketing:settings') ? <Link className="small" to="/marketing/reglages">Réglages</Link> : null} bodyClass="">
        {!d.last_generations.length ? <div className="card-body"><p className="muted small">L’IA n’a encore rien préparé.</p></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Date</th><th>Étape</th><th>Mode</th><th>Semaine</th><th>État</th><th className="right">Coût</th></tr></thead>
            <tbody>{d.last_generations.map(g => (
              <tr key={g.id}><td>{dateTime(g.created_at)}</td><td>{g.step_label}</td><td>{g.mode === 'ia' ? 'IA' : 'Démonstration'}</td><td>{g.week_of ? `du ${fr(g.week_of)}` : '—'}</td>
                <td><Badge tone={GEN_TONES[g.status]}>{GEN_LABELS[g.status] || g.status}</Badge></td><td className="right tabular">{g.mode === 'ia' ? `${(g.cost_micro_usd / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 4 })} $` : '0'}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {open && <ContentDrawer id={open} onClose={() => setOpen(null)} onChanged={res.reload} />}
    </div>
  );
}
