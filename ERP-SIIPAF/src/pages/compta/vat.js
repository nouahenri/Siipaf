/** TTC → HT + TVA, même arrondi que le serveur (lib/compta.js : splitVat). */
export function splitVatClient(ttc, rate) {
  const ht = rate ? Math.round(ttc / (1 + rate / 100)) : ttc;
  return { ht, vat: ttc - ht };
}
