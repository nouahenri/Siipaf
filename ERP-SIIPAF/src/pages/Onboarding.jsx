import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, ArrowRight, Info } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Skeleton, ErrorBox, Badge } from '@admin/components/ui';

// Le dashboard est sur admin.siipaf.com quand l'ERP est sur erp.siipaf.com (admin.localhost en local)
const dashboardUrl = path => `${window.location.protocol}//${window.location.host.replace(/^erp\./, 'admin.')}${path}`;

/**
 * Guide « Bien démarrer » (choix du client du 23/10) : l'ordre de mise en place du dashboard et de l'ERP pour la
 * formation, chaque étape cochée d'après la base (paramètres, postes, rôles, comptes, fiches, responsables, salaires,
 * droits particuliers).
 */
export default function Onboarding() {
  const { can } = useAuth();
  const toast = useToast();
  const r = useResource('/admin/erp/demarrage');
  const toggle = async (key, done) => {
    try { await api.post(`/admin/erp/demarrage/${key}`, { done }); r.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const steps = r.data?.steps || [];
  return (
    <div className="stack">
      <div>
        <h2 className="erp-hello">Bien démarrer</h2>
        <p className="muted">L’ordre à suivre pour mettre en place le dashboard et l’ERP. Chaque étape se coche d’elle-même quand la base est complète.</p>
      </div>

      <Card title="Quatre notions à ne pas confondre">
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div><b>Compte</b><p className="small muted" style={{ margin: '2px 0 0' }}>Ce qui permet de se connecter (e-mail et mot de passe). Le même compte ouvre le dashboard et l’ERP.</p></div>
          <div><b>Rôle et privilèges</b><p className="small muted" style={{ margin: '2px 0 0' }}>Ce que le compte peut voir et faire (Commercial, Comptable…). Réglé dans « Rôles et privilèges », complété au besoin compte par compte.</p></div>
          <div><b>Fiche employé</b><p className="small muted" style={{ margin: '2px 0 0' }}>La personne dans l’entreprise : identité, contrat, responsable direct, congés, salaire. Reliée à son compte, elle ouvre « Mon espace ».</p></div>
          <div><b>Poste</b><p className="small muted" style={{ margin: '2px 0 0' }}>L’intitulé de la fonction (Responsable commercial…), choisi dans la liste de RH › Réglages. Il peut proposer un rôle ; il change par « Changer de poste ».</p></div>
        </div>
      </Card>

      <ErrorBox error={r.error} />
      {!r.data ? <Skeleton h={320} /> : (
        <Card title={`Étapes de mise en place · ${r.data.done} / ${steps.length}`} bodyClass="">
          <div className="progress" style={{ margin: '0 20px 8px' }}><span style={{ width: `${Math.round((r.data.done / steps.length) * 100)}%` }} /></div>
          <ol className="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {steps.map((s, i) => (
              <li key={s.key} className="list-row" style={{ alignItems: 'flex-start', gap: 14 }}>
                <span style={{ color: s.done ? 'var(--ok)' : 'var(--ink-3)', paddingTop: 2 }}>{s.done ? <CheckCircle2 aria-label="Fait" /> : <Circle aria-label="À faire" />}</span>
                <div style={{ flex: 1 }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><b>{i + 1}. {s.title}</b><Badge tone={s.done ? 'ok' : 'warn'}>{s.done ? 'Fait' : 'À faire'}</Badge></div>
                  <p className="small" style={{ margin: '4px 0' }}>{s.why}</p>
                  <p className="small muted" style={{ margin: 0 }}><Info style={{ width: 13, height: 13, verticalAlign: -2 }} /> {s.where} · <b>{s.detail}</b></p>
                  {s.special && (
                    <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {Object.values(s.special).map(x => <li key={x.label}>{x.label} : {x.holders.length ? x.holders.join(', ') : <span style={{ color: 'var(--danger)' }}>personne</span>}</li>)}
                    </ul>
                  )}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {s.manual && can('users:write') && <button className="btn btn-sm" onClick={() => toggle(s.key, !s.done)}>{s.done ? 'Décocher' : 'Marquer vérifié'}</button>}
                  {s.link ? <Link className="btn btn-ghost btn-sm" to={s.link}>Ouvrir <ArrowRight /></Link>
                    : <a className="btn btn-ghost btn-sm" href={dashboardUrl(s.key === 'roles' ? '/roles' : '/utilisateurs')}>Dashboard <ArrowRight /></a>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
      <Card title="Ensuite, au quotidien">
        <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li><b>Nouvel arrivant</b> : Comptes utilisateurs › Nouveau compte (rôle + « Créer la fiche », poste dans la liste) → compléter la fiche (RH › Personnel) → salaire (Comptabilité › Employés).</li>
          <li><b>Promotion ou mutation</b> : fiche employé › carte Contrat › <b>Changer de poste</b> (date d’effet, motif, salaire, équipe, rôle du compte proposé).</li>
          <li><b>Nouveau métier dans l’entreprise</b> : RH › Réglages › Postes › Nouveau poste (service, rôle proposé).</li>
          <li><b>Départ</b> : fiche employé (date de sortie) puis Comptes utilisateurs › désactiver le compte.</li>
        </ul>
      </Card>
    </div>
  );
}
