/**
 * Lecture d'un fichier tableur dans le navigateur (import Sage, et tout import de lignes) : CSV / TXT (séparateur
 * « ; », « , », tabulation ou « | » détecté, encodage UTF-8 ou Windows-1252 comme les exports Sage) et Excel (.xlsx, .xls).
 * Renvoie { rows: [[cellules]] } avec les cellules en texte (les nombres Excel restent des nombres).
 */
function decode(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, ''); } catch { return new TextDecoder('windows-1252').decode(buffer); }
}

/** Séparateur le plus régulier sur les premières lignes. */
function guessSeparator(text) {
  const sample = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 20);
  let best = ';', score = -1;
  for (const sep of [';', '\t', ',', '|']) {
    const counts = sample.map(l => l.split(sep).length - 1);
    const min = Math.min(...counts);
    const s = min > 0 && counts.every(c => c === counts[0]) ? 1000 + min : min;
    if (s > score) { score = s; best = sep; }
  }
  return best;
}

/** CSV avec guillemets (un champ peut contenir le séparateur ou un retour à la ligne). */
export function parseDelimited(text, sep = guessSeparator(text)) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

export async function readSheet(file) {
  const buffer = await file.arrayBuffer();
  if (/\.(csv|txt|prn)$/i.test(file.name)) return { rows: parseDelimited(decode(buffer)) };
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: false });
  return { rows: data.map(r => r.map(c => (c == null ? '' : typeof c === 'number' ? c : String(c)))).filter(r => r.some(c => String(c).trim() !== '')) };
}
