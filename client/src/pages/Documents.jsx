import { Download, FileCheck2, FileClock, FileText } from 'lucide-react';
import { useSession } from '../lib/session';
import { DOCUMENT_STATUS } from '../lib/domain';
import { Badge, Empty, ErrorState, PageHead, PageSkeleton } from '../components/ui';
import { useDossier } from './Paiements';
import { NoDossier } from './Home';

export default function Documents() {
  const { selected } = useSession();
  const { data: d, error, loading, reload } = useDossier(selected?.id);

  if (!selected) return <NoDossier />;
  if (loading) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const docs = d.documents;
  const ready = docs.filter(x => DOCUMENT_STATUS[x.status]?.step === 2).length;

  return (
    <>
      <PageHead eyebrow={`Lot ${d.property.lot_code} · ${d.property.project.name}`} title="Mes documents"
        sub="Votre dossier administratif et juridique, de la réservation à la livraison. Les documents disponibles se téléchargent ici." />

      {docs.length === 0 ? (
        <div className="card"><Empty icon={FileText} title="Aucun document pour le moment" text="Vos documents apparaîtront ici au fil de l’avancement de votre dossier." /></div>
      ) : (
        <>
          <div className="callout info reveal reveal-2" style={{ marginBottom: 14 }}>
            <span className="callout-icon"><FileCheck2 aria-hidden="true" /></span>
            <span className="callout-body">
              <span className="callout-title">{ready} sur {docs.length} document{docs.length > 1 ? 's' : ''} finalisé{ready > 1 ? 's' : ''}</span>
              <span className="callout-text" style={{ display: 'block' }}>Contrat, attestation, ACD, acte notarié et procès-verbal de livraison suivent les étapes de votre acquisition.</span>
            </span>
          </div>
          <div className="card reveal reveal-3">
            {docs.map(doc => {
              const st = DOCUMENT_STATUS[doc.status] || DOCUMENT_STATUS.a_fournir;
              const done = st.step === 2;
              return (
                <div key={doc.id} className={`doc${done ? ' ready' : ''}`}>
                  <span className="doc-icon">{done ? <FileCheck2 aria-hidden="true" /> : <FileClock aria-hidden="true" />}</span>
                  <div className="doc-main">
                    <div className="doc-title">{doc.label}</div>
                    <div className="doc-note">{doc.note || st.hint}</div>
                    <div className="doc-steps" aria-hidden="true">
                      {[0, 1, 2].map(i => <span key={i} className={i <= st.step ? 'on' : ''} />)}
                    </div>
                  </div>
                  <div className="doc-end">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {doc.download_url && (
                      <a className="btn btn-dark btn-sm" href={doc.download_url} download aria-label={`Télécharger ${doc.label}`}><Download aria-hidden="true" /><span className="hide-xs">Télécharger</span></a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
