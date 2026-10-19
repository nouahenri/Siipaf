import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { useSession } from '../lib/session';
import { amount, date } from '../lib/format';
import { PAYMENT_METHODS } from '../lib/domain';
import { Empty, ErrorState, PageSkeleton } from '../components/ui';
import { useDossier } from './Paiements';
import { NoDossier } from './Home';

/** Reçu de versement, imprimable ou enregistrable en PDF depuis le navigateur. */
export default function Receipt() {
  const { paymentId } = useParams();
  const { client, selected } = useSession();
  const { data: d, error, loading, reload } = useDossier(selected?.id);

  if (!selected) return <NoDossier />;
  if (loading) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const p = d.payments.find(x => String(x.id) === paymentId);

  return (
    <>
      <div className="receipt-actions" style={{ paddingTop: 14 }}>
        <Link to="/paiements" className="btn btn-ghost btn-sm"><ArrowLeft aria-hidden="true" /> Mes paiements</Link>
        {p && <button type="button" className="btn btn-dark btn-sm" onClick={() => window.print()}><Printer aria-hidden="true" /> Imprimer ou enregistrer en PDF</button>}
      </div>
      {!p ? (
        <div className="card"><Empty title="Reçu introuvable" text="Ce versement n’existe pas dans votre dossier." /></div>
      ) : (
        <article className="receipt reveal" aria-label={`Reçu ${p.receipt_number}`}>
          <header className="receipt-head">
            <img src={`${import.meta.env.BASE_URL}logo-siipaf.png`} alt="SIIPAF" />
            <div className="receipt-company">
              <strong>SIIPAF SA</strong><br />
              Promoteur et aménageur immobilier agréé MCLU<br />
              Abidjan, Côte d’Ivoire<br />
              +225 27 22 20 50 20 · info@siipaf.com
            </div>
          </header>
          <h1 className="receipt-title">Reçu de versement</h1>
          <div className="receipt-number">N° {p.receipt_number}</div>

          <div className="receipt-amount">
            <span className="muted">Montant reçu</span>
            <strong className="num">{amount(p.amount_fcfa)} FCFA</strong>
          </div>

          <dl className="receipt-grid">
            <div><dt>Date du versement</dt><dd>{date(p.paid_at)}</dd></div>
            <div><dt>Mode de paiement</dt><dd>{PAYMENT_METHODS[p.method]}</dd></div>
            {p.reference && <div><dt>Référence</dt><dd>{p.reference}</dd></div>}
            <div><dt>Client</dt><dd>{client?.name}</dd></div>
            <div><dt>Code client</dt><dd>{client?.client_code}</dd></div>
            <div><dt>Bien</dt><dd>{d.property.project.name} — Lot {d.property.lot_code}{d.property.ilot ? `, îlot ${d.property.ilot}` : ''}</dd></div>
            <div><dt>Prix du bien</dt><dd className="num">{amount(d.price_fcfa)} FCFA</dd></div>
            <div><dt>Total versé à ce jour</dt><dd className="num">{amount(d.paid_fcfa)} FCFA</dd></div>
            <div><dt>Reste à payer à ce jour</dt><dd className="num">{amount(d.remaining_fcfa)} FCFA</dd></div>
          </dl>

          <p className="receipt-foot">
            Reçu édité depuis l’espace client SIIPAF le {date(new Date().toISOString())}. Il atteste de l’enregistrement du versement
            par le service comptable de SIIPAF SA. Les totaux indiqués sont ceux du jour d’édition.
          </p>
        </article>
      )}
    </>
  );
}
