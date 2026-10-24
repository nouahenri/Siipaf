/**
 * Textes éditables du site (Contenu du site › Éditorial) : pose les clés `data-edit*` manquantes dans les pages
 * et refait le catalogue `src/lib/site-text-slots.json`. À lancer après toute modification d'une page du site :
 *   node scripts/site-texts.js          (écrit les pages et le catalogue)
 *   node scripts/site-texts.js --dry    (affiche le résumé sans rien écrire)
 */
const fs = require('fs');
const path = require('path');
const { scanSite } = require('../src/lib/site-texts');

const CATALOG = path.join(__dirname, '../src/lib/site-text-slots.json');
const dry = process.argv.includes('--dry');

let { catalog, changed } = scanSite();
if (!dry) {
  for (const c of changed) fs.writeFileSync(c.file, c.html, 'utf8');
  if (changed.length) ({ catalog } = scanSite());
  fs.writeFileSync(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}

const count = blocks => blocks.reduce((n, b) => n + (b.type === 'card' ? count(b.blocks) : 1), 0);
for (const p of catalog.pages) {
  console.log(`\n# ${p.label} (${p.id})`);
  for (const s of p.sections) {
    console.log(`  - ${s.label} [${s.key}]${s.managed ? ` → onglet ${s.managed}` : ''} : ${count(s.blocks)} champ(s), ${s.blocks.filter(b => b.type === 'card').length} carte(s), ${s.images.length} image(s)`);
  }
}
console.log(`\n${dry ? '(essai) ' : ''}${changed.length} page(s) annotée(s)${dry ? '' : ` ; catalogue : ${path.relative(process.cwd(), CATALOG)}`}`);
