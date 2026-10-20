import { useEffect, useRef } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Pages rendues dans le navigateur, également utilisées pour l’impression. */
export default function PdfPreview({ url, onReady, onError }) {
  const container = useRef(null);
  useEffect(() => {
    let active = true;
    let rendering;
    const target = container.current;
    const task = getDocument({ url, withCredentials: true, isEvalSupported: false });
    (async () => {
      const pdf = await task.promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        if (!active) return;
        const page = await pdf.getPage(i);
        if (!active) return;
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 1600 / base.width, Math.sqrt(4000000 / (base.width * base.height)));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Page ${i} sur ${pdf.numPages}`);
        target.appendChild(canvas);
        rendering = page.render({ canvasContext: canvas.getContext('2d'), viewport });
        await rendering.promise;
        page.cleanup();
      }
      if (active) onReady();
    })().catch(() => { if (active) onError(); });
    return () => {
      active = false;
      rendering?.cancel();
      task.destroy().catch(() => {});
      target.replaceChildren();
    };
  }, [url, onReady, onError]);
  return <div ref={container} className="document-pages" role="group" aria-label="Pages du document" />;
}
