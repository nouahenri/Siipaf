/**
 * Génère src/lib/liasse-postes.json à partir du modèle Excel de la liasse fiscale DGI (SYSCOHADA révisé, système normal)
 * que tenait la Comptabilité : feuilles Ctrl_Actif, Ctrl_Passif et Ctrl_Charges_ Produits (compte → poste du bilan ou du
 * compte de résultat, et solde retenu) et ordre des comptes de « Balance & Reporting ».
 *
 *   node scripts/liasse-extraire-postes.js "chemin/LIASSE_FISCALE BILAN SIIPAF VIDE.xlsm"
 *
 * Solde retenu : D = solde débiteur, C = solde créditeur, DC = débit − crédit, CD = crédit − débit.
 * Colonne « a » : brut (actif), charges ; colonne « b » : amortissements et dépréciations (actif), passif, produits.
 */
const path = require('path');
const fs = require('fs');
const X = require(path.join(__dirname, '../../admin/node_modules/xlsx'));

const file = process.argv[2];
if (!file) { console.error('Indiquez le fichier Excel de la liasse.'); process.exit(1); }
const wb = X.readFile(file);
const mode = terms => {
  const k = terms.map(([s, , c]) => `${s > 0 ? '+' : '-'}${c}`).join('');
  return { '+2': 'D', '+3': 'C', '+2-3': 'DC', '+3-2': 'CD', '-2+3': 'CD', '-3+2': 'DC' }[k];
};
const postes = {};
for (const sheet of ['Ctrl_Actif', 'Ctrl_Passif', 'Ctrl_Charges_ Produits']) {
  const ws = wb.Sheets[sheet];
  const rng = X.utils.decode_range(ws['!ref']);
  const cell = (r, c) => ws[X.utils.encode_cell({ r, c })];
  for (const [refCol, valCol, col] of [[2, 5, 'a'], [6, 9, 'b']]) {
    let cur = null;
    for (let r = 0; r <= rng.e.r; r++) {
      const h = cell(r, refCol);
      if (h && /^[A-Z]{2}$/.test(String(h.v).trim())) { cur = String(h.v).trim(); continue; }
      const f = cell(r, valCol);
      if (!cur || !f?.f) continue;
      const terms = [];
      const re = /([+-]?)\s*VLOOKUP\(([A-Z]+)(\d+),TABLEBAK,(\d+),0\)/g;
      let m;
      while ((m = re.exec(f.f))) terms.push([m[1] === '-' ? -1 : 1, String(ws[`${m[2]}${m[3]}`]?.v || ''), Number(m[4])]);
      if (!terms.length) continue;
      const md = mode(terms);
      if (!md || terms.some(t => t[1] !== terms[0][1])) throw new Error(`${sheet} ligne ${r + 1} : formule non reconnue ${f.f}`);
      postes[cur] = postes[cur] || { a: [], b: [] };
      postes[cur][col].push([terms[0][1], md]);
    }
  }
}
// Comptes de référence dans l'ordre du modèle : un compte saisi se range sous le premier de même racine (4 chiffres)
const br = wb.Sheets['Balance & Reporting '];
const accounts = [];
for (let r = 3; r <= 985; r++) { const v = br[`B${r}`]?.v; if (v != null && /^\d{6}$/.test(String(v))) accounts.push(String(v)); }
const out = path.join(__dirname, '../src/lib/liasse-postes.json');
fs.writeFileSync(out, `${JSON.stringify({ source: path.basename(file), accounts, postes })}\n`);
console.log(`${Object.keys(postes).length} postes, ${accounts.length} comptes de référence → ${out}`);
