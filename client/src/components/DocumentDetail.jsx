import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Download, ExternalLink, FileClock, FileText, Flag, MessageCircle, Phone, Printer } from 'lucide-react';
import { CONTACT, DOCUMENT_STATUS } from '../lib/domain';
import { shortDate } from '../lib/format';
import { Alert, Badge, Empty, Spinner } from './ui';

const PdfPreview = lazy(() => import('./PdfPreview'));

/** Aperçu via la même route privée que le téléchargement, avec les mêmes droits. */
export default function DocumentDetail({ doc, dossier }) {
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState('loading');
  const [loaded, setLoaded] = useState(false);
  const [mime, setMime] = useState('');
  const [printError, setPrintError] = useState('');
  const previewUrl = doc.download_url ? `${doc.download_url}?preview=1` : null;
  const st = DOCUMENT_STATUS[doc.status] || DOCUMENT_STATUS.a_fournir;
  const context = { id: doc.id, label: doc.label, saleId: dossier.id, lotCode: dossier.property.lot_code, projectName: dossier.property.project.name };

  useEffect(() => {
    if (!previewUrl) return;
    const controller = new AbortController();
    setPreview('loading'); setLoaded(false); setPrintError('');
    fetch(previewUrl, { method: 'HEAD', credentials: 'same-origin', signal: controller.signal }).then(res => {
      if (controller.signal.aborted) return;
      setMime((res.headers.get('content-type') || '').split(';')[0]);
      setPreview(res.ok ? 'ready' : res.status === 415 ? 'unsupported' : 'error');
    }).catch(() => { if (!controller.signal.aborted) setPreview('error'); });
    return () => controller.abort();
  }, [previewUrl, attempt]);

  const ready = useCallback(() => setLoaded(true), []);
  const failed = useCallback(() => { setLoaded(false); setPreview('error'); }, []);

  const print = () => {
    setPrintError('');
    try { window.print(); }
    catch { setPrintError('L’impression directe est indisponible dans ce navigateur. Ouvrez l’original pour utiliser sa commande d’impression.'); }
  };

  return <div className="document-detail">
    <Link to="/documents" className="btn btn-ghost btn-sm document-back"><ArrowLeft aria-hidden="true" />Mes documents</Link>
    <div className="document-console">
      <header className="document-banner">
        <span className="document-seal" aria-hidden="true"><FileText /></span>
        <div className="document-heading">
          <h1>{doc.label}</h1>
          <p className="document-property">Lot {context.lotCode} · {context.projectName}</p>
          <p className="document-description">{doc.note || st.hint}</p>
          <div className="document-meta">
            <Badge tone={st.tone}>{st.label}</Badge>
            {doc.updated_at && <span>Mis à jour le {shortDate(doc.updated_at)}</span>}
          </div>
        </div>
      </header>
    <nav className="document-actions" aria-label="Actions du document">
      <button type="button" className="btn btn-dark btn-sm" disabled={!previewUrl || !loaded || preview !== 'ready'} onClick={print}><Printer aria-hidden="true" />Imprimer</button>
      {doc.download_url
        ? <a className="btn btn-dark btn-sm" href={doc.download_url} download><Download aria-hidden="true" />Télécharger</a>
        : <button type="button" className="btn btn-dark btn-sm" disabled><Download aria-hidden="true" />Télécharger</button>}
      <a className="btn btn-ghost btn-sm" href={CONTACT.phoneHref}><Phone aria-hidden="true" />Appeler</a>
      <a className="btn btn-ghost btn-sm" href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle aria-hidden="true" />WhatsApp</a>
      <Link className="btn btn-ghost btn-sm" to="/messages" state={{ documentContext: context }}><MessageCircle aria-hidden="true" />Messages</Link>
      <Link className="btn btn-ghost btn-sm" to="/demandes" state={{ documentContext: context }}><Flag aria-hidden="true" />Signaler un problème</Link>
    </nav>
    </div>
    {printError && <Alert>{printError}</Alert>}
    <section className="card document-preview" aria-label={`Aperçu de ${doc.label}`}>
      <header className="document-preview-head">
        <h2 className="section-title">Aperçu du document</h2>
        {previewUrl && preview === 'ready' && <a className="document-original" href={previewUrl} target="_blank" rel="noopener noreferrer">Ouvrir l’original<ExternalLink size={15} aria-hidden="true" /></a>}
      </header>
      {!previewUrl ? <Empty icon={FileClock} title="Document en attente de mise à disposition" text="Aucun fichier n’est joint pour le moment. Vous pouvez contacter votre conseiller ou lui écrire au sujet de ce document." />
        : preview === 'loading' ? <div className="document-loading" role="status"><Spinner /><span>Chargement du document…</span></div>
          : preview !== 'ready' ? <Empty icon={FileText} title={preview === 'unsupported' ? 'Aperçu non disponible pour ce format' : 'Impossible de charger le document'} text={preview === 'unsupported' ? 'Téléchargez l’original pour le consulter avec une application adaptée.' : 'Réessayez ou contactez votre conseiller si le problème persiste.'}>
            {preview === 'error' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttempt(x => x + 1)}>Réessayer</button>}
          </Empty>
            : <div aria-busy={!loaded}>
              {!loaded && <div className="document-rendering" role="status"><Spinner />Préparation de l’aperçu…</div>}
              {mime === 'application/pdf'
                ? <Suspense fallback={null}><PdfPreview key={attempt} url={previewUrl} onReady={ready} onError={failed} /></Suspense>
                : <div className="document-pages"><img src={previewUrl} alt={doc.label} onLoad={ready} onError={failed} /></div>}
            </div>}
    </section>
  </div>;
}
