import { Link, useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { useResource } from '@admin/lib/app-context';
import { Skeleton, ErrorBox } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';

const METHODS = { virement: 'Virement', mobile_money: 'Mobile Money', especes: 'Espèces', cheque: 'Chèque', autre: 'Autre' };

/**
 * Reçu de versement (preuve du versement effectué), imprimable ou enregistrable en PDF : même numéro que le reçu de
 * l'espace client ; totaux arrêtés à ce versement ; coordonnées réglées dans Contenu du site › Coordonnées.
 */
export default function Receipt() {
  const { id } = useParams();
  const res = useResource(`/admin/payments/${id}/receipt`);
  const r = res.data;
  if (!r) return res.error ? <ErrorBox error={res.error} /> : <Skeleton h={400} />;
  return (
    <article className="appro-print receipt-print stack" aria-label={`Reçu ${r.receipt_number}`}>
      <div className="row appro-print-actions">
        <Link className="btn btn-ghost" to={`/compta/ventes?d=${r.sale_id}`}>Dossier de vente</Link>
        <button className="btn btn-primary" onClick={() => window.print()}><Printer />Imprimer / PDF</button>
      </div>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <img src="/logo-siipaf.png" alt="SIIPAF SA" style={{ width: 150 }} />
        <div className="right small">
          <strong>SIIPAF SA</strong><br />
          Promoteur et aménageur immobilier agréé MCLU<br />
          {r.company.address && <>{r.company.address}<br /></>}
          {[r.company.phone, r.company.email].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="right">
        <h2 style={{ margin: 0 }}>Reçu de versement</h2>
        <strong className="tabular">N° {r.receipt_number}</strong>
      </div>
      <div className="receipt-print-amount">
        <span className="small muted">Montant reçu</span>
        <strong className="tabular">{fcfa(r.amount_fcfa)}</strong>
      </div>
      <dl className="dl">
        <dt>Date du versement</dt><dd>{date(r.paid_at)}</dd>
        <dt>Mode de paiement</dt><dd>{METHODS[r.method] || r.method}</dd>
        {r.reference && <><dt>Référence</dt><dd>{r.reference}</dd></>}
        <dt>Client</dt><dd>{r.client.name}{r.client.client_code ? ` · ${r.client.client_code}` : ''}</dd>
        <dt>Bien</dt><dd>{r.lot.project_name} — lot {r.lot.code}{r.lot.ilot ? `, îlot ${r.lot.ilot}` : ''}</dd>
        <dt>Montant dû</dt><dd className="tabular">{fcfa(r.due_fcfa)}</dd>
        <dt>Total versé à cette date</dt><dd className="tabular">{fcfa(r.paid_to_date_fcfa)}</dd>
        <dt>Reste à payer après ce versement</dt><dd className="tabular">{fcfa(r.remaining_after_fcfa)}</dd>
      </dl>
      <div className="appro-signatures">
        <div><b className="small">Enregistré par la Comptabilité</b><p>{r.recorded_by_name || '—'}</p></div>
        <div><b className="small">Cachet et signature</b><p>&nbsp;</p></div>
      </div>
      <p className="small muted">Reçu édité le {date(new Date().toISOString())}. Il atteste de la réception des fonds par le service comptable de SIIPAF SA.</p>
    </article>
  );
}
