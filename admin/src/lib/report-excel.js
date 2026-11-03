/**
 * Classeur Excel d'un rapport (Exporter des tableaux de bord de l'ERP, demande du client du 03/11) : une feuille « Synthèse »
 * (titre, période, indicateurs) puis une feuille par tableau de détail. Nombres et dates en vraies cellules Excel (triables,
 * calculables). Rapport : { title, period: { from, to, label }, generated_at, generated_by, summary, sections } (serveur : services/rapports).
 */
const NUMBER_FORMATS = { fcfa: '#,##0 "FCFA"', number: '#,##0', decimal: '#,##0.00', percent: '0.0 "%"', date: 'dd/mm/yyyy' };
const WIDTHS = { fcfa: 16, number: 10, decimal: 10, percent: 10, date: 12 };

/** Cellule typée selon le format de la colonne. */
function cell(value, format) {
  if (value == null || value === '') return { t: 's', v: '' };
  if (format === 'date') {
    const d = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? { t: 's', v: String(value) } : { t: 'd', v: d, z: NUMBER_FORMATS.date };
  }
  if (NUMBER_FORMATS[format] && Number.isFinite(Number(value))) return { t: 'n', v: Number(value), z: NUMBER_FORMATS[format] };
  return { t: 's', v: String(value) };
}

/** Nom de feuille valable (31 caractères, sans [ ] : * ? / \) et unique dans le classeur. */
function sheetName(title, used) {
  const base = String(title).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Feuille';
  let name = base, n = 2;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 27)} (${n++})`;
  used.add(name.toLowerCase());
  return name;
}

function fromRows(XLSX, rows, widths) {
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  rows.forEach((r, i) => r.forEach((c, j) => { ws[XLSX.utils.encode_cell({ r: i, c: j })] = typeof c === 'object' && c && 't' in c ? c : cell(c, 'text'); }));
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: Math.max(0, ...rows.map(r => r.length - 1)) } });
  ws['!cols'] = widths.map(w => ({ wch: w }));
  return ws;
}

/** Télécharge le classeur du rapport (nom : `report.filename`, sinon rapport-<module>-<du>-<au>.xlsx). */
export async function downloadReportExcel(report) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const used = new Set();
  const head = [
    [cell(`Rapport — ${report.title}`)], [cell(`Période : ${report.period.label}`)],
    [cell(`Édité le ${new Date(report.generated_at).toLocaleString('fr-FR')} par ${report.generated_by || '—'} — SIIPAF ERP`)], [],
    [cell('Indicateur'), cell('Valeur')],
    ...report.summary.map(s => [cell(s.label), cell(s.value, s.format)]),
  ];
  XLSX.utils.book_append_sheet(wb, fromRows(XLSX, head, [48, 20]), sheetName('Synthèse', used));
  for (const s of report.sections) {
    const rows = [s.columns.map(c => cell(c.label)), ...s.rows.map(r => s.columns.map(c => cell(r[c.key], c.format)))];
    if (!s.rows.length) rows.push([cell('Aucune donnée sur la période')]);
    const widths = s.columns.map(c => Math.min(48, Math.max(WIDTHS[c.format] || 12, String(c.label).length + 2, ...s.rows.slice(0, 200).map(r => String(r[c.key] ?? '').length + 2))));
    XLSX.utils.book_append_sheet(wb, fromRows(XLSX, rows, widths), sheetName(s.title, used));
  }
  XLSX.writeFile(wb, report.filename || `rapport-${report.module}-${report.period.from}-${report.period.to}.xlsx`, { cellDates: true });
}
