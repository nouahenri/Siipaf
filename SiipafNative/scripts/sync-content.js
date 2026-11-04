/**
 * Copie le catalogue des textes et des images du site (server/src/lib) dans l'application : à relancer quand une section
 * est ajoutée au site. Les textes modifiés dans le dashboard arrivent, eux, par l'API sans nouvelle version de l'app.
 */
const fs = require('fs');
const path = require('path');

const from = path.join(__dirname, '..', '..', 'server', 'src', 'lib');
const to = path.join(__dirname, '..', 'src', 'content');
for (const f of ['site-text-slots.json', 'site-image-slots.json']) {
  fs.copyFileSync(path.join(from, f), path.join(to, f));
  console.log(`Copié : ${f}`);
}
