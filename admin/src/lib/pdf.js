/** Convertit la 1re page d'un PDF (plan de masse) en image PNG, côté navigateur. */
export async function pdfToImage(file, targetWidth = 3200) {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(6, targetWidth / base.width) });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const name = file.name.replace(/\.pdf$/i, '') + '.png';
  return { file: new File([blob], name, { type: 'image/png' }), width: canvas.width, height: canvas.height };
}
