import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CalendarClock, Camera, FileText, FolderOpen, MapPin, MessageCircle, Ruler, Home as HomeIcon, Wallet,
} from 'lucide-react';
import { useSession, useResource } from '../lib/session';
import { api } from '../lib/api';
import { amount, dayLabel, daysUntil, fcfa, firstName, plural, shortDate } from '../lib/format';
import { projectImage } from '../lib/domain';
import { Badge, Empty, PayBar, Ring, SectionHead, Skeleton } from '../components/ui';

function greeting() {
  const h = new Date().getHours();
  return h < 5 || h >= 18 ? 'Bonsoir' : 'Bonjour';
}

export function NoDossier() {
  const { client } = useSession();
  // Client repris de l'ancienne plateforme : on connaît déjà le type de bien, pas encore le lot
  const bien = client?.property_type && [client.property_type, client.project_name].filter(Boolean).join(' · ');
  return (
    <div className="card" style={{ marginTop: 8 }}>
      <Empty icon={FolderOpen} title={bien || 'Aucun dossier actif'}
        text={bien ? 'Le détail de votre dossier (lot, échéancier, documents) apparaîtra ici dès sa mise à jour par nos équipes. Une question ? Écrivez-nous.'
          : 'Votre dossier d’acquisition apparaîtra ici dès son ouverture par nos équipes. Une question ? Écrivez-nous.'}>
        {bien && client.progress && (
          <div style={{ display: 'grid', justifyItems: 'center', gap: 4, marginBottom: 12 }}>
            <Ring value={client.progress.progress_pct} label="chantier" size={84} />
            <span className="muted" style={{ fontSize: 13 }}>Avancement{client.progress.stage_label ? ` · ${client.progress.stage_label}` : ''}</span>
          </div>
        )}
        <Link className="btn btn-dark btn-sm" to="/messages"><MessageCircle aria-hidden="true" /> Nous écrire</Link>
      </Empty>
    </div>
  );
}

function PropertyCard({ d }) {
  const p = d.property;
  return (
    <article className="property reveal" aria-label={`Votre bien : lot ${p.lot_code}`}>
      <img src={projectImage(p.project)} alt="" />
      <div className="property-top">
        <Badge tone="dark" plain>{d.status === 'solde' ? 'Soldé' : 'En cours d’acquisition'}</Badge>
      </div>
      <div className="property-body">
        <div className="property-info">
          <div className="property-project">{p.project.name}</div>
          <div className="property-lot">Lot {p.lot_code}{p.ilot ? <span style={{ opacity: .7, fontSize: '.7em' }}> · Îlot {p.ilot}</span> : null}</div>
          <div className="property-meta">
            {p.type && <span><HomeIcon aria-hidden="true" />{p.type}</span>}
            {p.surface_m2 && <span><Ruler aria-hidden="true" />{amount(p.surface_m2)} m²</span>}
            {p.project.city && <span><MapPin aria-hidden="true" />{p.project.city}</span>}
          </div>
        </div>
        <Ring value={d.progress?.progress_pct ?? 0} label="chantier" size={84} />
      </div>
    </article>
  );
}

function FinanceCard({ d }) {
  return (
    <section className="card card-pad reveal reveal-2" aria-labelledby="fin-title">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <h2 id="fin-title" className="money-label">Déjà versé</h2>
        <Badge tone={d.percent_paid >= 100 ? 'ok' : 'gold'} plain>{d.percent_paid} %</Badge>
      </div>
      <div className="money-big num" style={{ marginTop: 4 }}>{amount(d.paid_fcfa)}<small>FCFA</small></div>
      <PayBar percent={d.percent_paid} />
      <div className="money-split">
        <div><div className="money-label">Reste à payer</div><strong className="num">{fcfa(d.remaining_fcfa)}</strong></div>
        <div><div className="money-label">Prix du bien</div><strong className="num">{fcfa(d.price_fcfa)}</strong></div>
      </div>
      <Link to="/paiements" className="link" style={{ marginTop: 16 }}>Voir l’échéancier <ArrowRight aria-hidden="true" /></Link>
    </section>
  );
}

function DueCard({ d }) {
  if (d.overdue_count > 0) {
    return (
      <Link to="/paiements" className="callout danger reveal reveal-3">
        <span className="callout-icon"><AlertTriangle aria-hidden="true" /></span>
        <span className="callout-body">
          <span className="callout-title">{plural(d.overdue_count, 'échéance en retard', 'échéances en retard')}</span>
          <span className="callout-text" style={{ display: 'block' }}>{fcfa(d.overdue_fcfa)} à régulariser. Contactez votre conseiller si besoin.</span>
        </span>
        <ArrowRight aria-hidden="true" width={18} />
      </Link>
    );
  }
  if (!d.next_due) return null;
  const n = d.next_due;
  const days = daysUntil(n.due_date);
  const [dd, mm] = shortDate(n.due_date).split(' ');
  return (
    <section className="card card-pad reveal reveal-3" aria-label="Prochaine échéance">
      <div className="due">
        <div className="due-date" aria-hidden="true"><small>{mm}</small><strong>{dd}</strong></div>
        <div className="due-body">
          <div className="money-label">Prochaine échéance · {n.label}</div>
          <div className="due-amount num">{fcfa(n.remaining_fcfa)}</div>
          <div className="muted" style={{ fontSize: 13 }}>{days === 0 ? 'Aujourd’hui' : days > 0 ? `Dans ${plural(days, 'jour', 'jours')}` : ''}</div>
        </div>
      </div>
    </section>
  );
}

function LatestUpdate({ saleId }) {
  const { data, loading } = useResource(`chantier:${saleId}`, () => api.get(`/dossiers/${saleId}/chantier`));
  if (loading) return <Skeleton h={110} r={16} />;
  const u = data?.updates?.[0];
  if (!u) {
    return <div className="callout info"><span className="callout-icon"><Camera aria-hidden="true" /></span><span className="callout-body"><span className="callout-title">Bientôt les premières photos</span><span className="callout-text" style={{ display: 'block' }}>Les points d’avancement de votre chantier apparaîtront ici.</span></span></div>;
  }
  const photo = u.media.find(m => m.kind === 'image');
  return (
    <Link to="/chantier" className="card" style={{ display: 'flex', overflow: 'hidden' }}>
      {photo && <img src={photo.url} alt="" style={{ width: 120, minHeight: 112, objectFit: 'cover', flexShrink: 0 }} />}
      <div style={{ padding: '14px 16px', minWidth: 0 }}>
        <div className="update-meta" style={{ marginBottom: 4 }}><Badge tone="gold" plain>{u.stage_label}</Badge><span>{dayLabel(u.published_at)}</span></div>
        <div style={{ fontWeight: 600, lineHeight: 1.35 }}>{u.title}</div>
        <div className="link" style={{ marginTop: 6 }}>Tout le chantier <ArrowRight aria-hidden="true" /></div>
      </div>
    </Link>
  );
}

export default function Home() {
  const { client, selected: d, loadDossiers } = useSession();
  // Situation financière à jour à chaque retour sur l'accueil
  useEffect(() => { loadDossiers().catch(() => {}); }, [loadDossiers]);
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <header className="hello reveal">
        <div className="hello-date">{today}</div>
        <h1>{greeting()} {firstName(client?.name)}</h1>
      </header>

      {!d ? <NoDossier /> : (
        <>
          <div className="grid grid-home">
            <PropertyCard d={d} />
            <div className="grid">
              <FinanceCard d={d} />
              <DueCard d={d} />
            </div>
          </div>

          {client?.unread_messages > 0 && (
            <Link to="/messages" className="callout info" style={{ marginTop: 14 }}>
              <span className="callout-icon"><MessageCircle aria-hidden="true" /></span>
              <span className="callout-body">
                <span className="callout-title">{plural(client.unread_messages, 'nouveau message', 'nouveaux messages')}</span>
                <span className="callout-text" style={{ display: 'block' }}>L’équipe SIIPAF vous a répondu.</span>
              </span>
              <ArrowRight aria-hidden="true" width={18} />
            </Link>
          )}

          <section className="section">
            <SectionHead title="Sur le chantier"><Link to="/chantier" className="link">Voir tout <ArrowRight aria-hidden="true" /></Link></SectionHead>
            <LatestUpdate saleId={d.id} />
          </section>

          <section className="section" aria-label="Accès rapides">
            <div className="quick">
              <Link to="/paiements"><span className="quick-icon"><Wallet aria-hidden="true" /></span><strong>Paiements</strong><span>Échéancier et reçus</span></Link>
              <Link to="/documents"><span className="quick-icon"><FileText aria-hidden="true" /></span><strong>Documents</strong><span>Contrats, ACD, actes</span></Link>
              <Link to="/chantier"><span className="quick-icon"><CalendarClock aria-hidden="true" /></span><strong>Avancement</strong><span>{d.progress ? d.progress.stage_label : 'Étapes du chantier'}</span></Link>
              <Link to="/messages"><span className="quick-icon"><MessageCircle aria-hidden="true" /></span><strong>Messages</strong><span>Écrire à SIIPAF</span></Link>
            </div>
          </section>
        </>
      )}
    </>
  );
}
