/**
 * Déboursé sec (ERP › Chantiers, cadrage docs/cadrage-debourse-sec.md, choix du client du 02/11/2026).
 * Règles de calcul pures (sans base) : bases de métré tirées des paramètres du bâtiment, coût unitaire sec d'un ouvrage
 * (sous-détail : matériaux avec perte, main-d'œuvre, matériel), totaux par lot et par nature, matériaux à approvisionner,
 * coût au m² et coût de revient estimatif (frais de chantier et aléas).
 */

// Natures des ressources ; chacune alimente un poste du budget du chantier (worksite_ref_items, kind = poste)
const NATURES = {
  materiau: { label: 'Matériau', poste: 'materiaux' },
  main_oeuvre: { label: 'Main-d’œuvre', poste: 'main_oeuvre' },
  materiel: { label: 'Matériel', poste: 'engins' },
};

// Lots du gros œuvre, dans l'ordre d'exécution ; la toiture est facultative (choix du client : cochée selon le modèle ou l'estimation)
const LOTS = {
  installation: { label: 'Installation et implantation', sort: 1 },
  terrassement: { label: 'Terrassements', sort: 2 },
  fondations: { label: 'Fondations', sort: 3 },
  soubassement: { label: 'Soubassement et dallage', sort: 4 },
  elevation: { label: 'Élévation (murs, poteaux, chaînages)', sort: 5 },
  planchers: { label: 'Planchers, escaliers et acrotères', sort: 6 },
  toiture: { label: 'Toiture (charpente-couverture, étanchéité)', sort: 7, optional: true },
};

// Paramètres d'un bâtiment, saisis dans l'estimation (valeurs par défaut portées par le modèle)
const PARAMS = {
  surface: { label: 'Surface de plancher totale', unit: 'm²', min: 10, max: 20000 },
  emprise: { label: 'Emprise au sol (surface du rez-de-chaussée, terrasses couvertes comprises)', unit: 'm²', min: 10, max: 10000 },
  perimetre: { label: 'Périmètre des murs extérieurs', unit: 'ml', min: 10, max: 2000 },
  murs_interieurs: { label: 'Longueur des murs intérieurs (par niveau)', unit: 'ml', min: 0, max: 2000 },
  hauteur: { label: 'Hauteur d’étage (sol à plafond)', unit: 'm', min: 2.2, max: 6 },
  niveaux: { label: 'Nombre de niveaux (rez-de-chaussée compris)', unit: '', min: 1, max: 20, integer: true },
  ouvertures: { label: 'Part des ouvertures dans les murs (portes, fenêtres)', unit: '%', min: 0, max: 60 },
  logements: { label: 'Logements dans le bâtiment (coût par logement)', unit: '', min: 1, max: 500, integer: true },
};

// Bases de métré : chaque ligne d'un modèle donne une quantité = ratio × base
const BASES = {
  forfait: { label: 'Forfait (1)', unit: 'u' },
  surface: { label: 'Surface de plancher', unit: 'm²' },
  emprise: { label: 'Emprise au sol', unit: 'm²' },
  lineaire_fondations: { label: 'Linéaire de fondations (murs extérieurs + intérieurs)', unit: 'ml' },
  lineaire_murs: { label: 'Linéaire de murs sur tous les niveaux', unit: 'ml' },
  surface_murs: { label: 'Surface de murs (ouvertures déduites)', unit: 'm²' },
  planchers_intermediaires: { label: 'Planchers entre niveaux (emprise × (niveaux − 1))', unit: 'm²' },
  toit: { label: 'Surface de toiture (emprise)', unit: 'm²' },
  perimetre_toit: { label: 'Périmètre de la toiture (acrotères)', unit: 'ml' },
  niveaux_sup: { label: 'Niveaux au-dessus du rez-de-chaussée (escaliers)', unit: 'u' },
};

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Bases de métré d'un bâtiment à partir de ses paramètres. */
function bases(p) {
  const n = Math.max(1, Number(p.niveaux) || 1);
  const lin = (Number(p.perimetre) || 0) + (Number(p.murs_interieurs) || 0);
  const openings = Math.min(0.6, Math.max(0, (Number(p.ouvertures) || 0) / 100));
  return {
    forfait: 1,
    surface: Number(p.surface) || 0,
    emprise: Number(p.emprise) || 0,
    lineaire_fondations: lin,
    lineaire_murs: lin * n,
    surface_murs: round(lin * (Number(p.hauteur) || 0) * n * (1 - openings)),
    planchers_intermediaires: (Number(p.emprise) || 0) * (n - 1),
    toit: Number(p.emprise) || 0,
    perimetre_toit: Number(p.perimetre) || 0,
    niveaux_sup: n - 1,
  };
}

/**
 * Coût unitaire sec d'un ouvrage. `composition` : [{ nature, quantity (par unité d'ouvrage), unit_price, loss_pct }].
 * Matériaux : quantité × (1 + perte) × prix ; main-d'œuvre et matériel : quantité × prix. Montants en FCFA (décimaux gardés).
 */
function unitCost(composition) {
  const out = { materiau: 0, main_oeuvre: 0, materiel: 0 };
  for (const c of composition) {
    const loss = c.nature === 'materiau' ? 1 + (Number(c.loss_pct) || 0) / 100 : 1;
    out[c.nature] += (Number(c.quantity) || 0) * loss * (Number(c.unit_price) || 0);
  }
  return { ...out, total: out.materiau + out.main_oeuvre + out.materiel };
}

/**
 * Estimation complète. `lines` : [{ work_code, lot, label, unit, quantity, composition }] (quantité d'un bâtiment) ;
 * `units` : bâtiments identiques ; `withRoof` : lot toiture compté ; `rates` : { site_pct, contingency_pct }.
 * Renvoie les lignes chiffrées, les totaux par lot et par nature, les matériaux à approvisionner, le coût au m² et par logement,
 * le coût de revient estimatif. Montants arrondis au franc.
 */
function estimate({ lines, units = 1, withRoof = false, rates = {}, params = {} }) {
  const k = Math.max(1, Number(units) || 1);
  const kept = lines.filter(l => withRoof || !LOTS[l.lot]?.optional);
  const byLot = {}, byNature = { materiau: 0, main_oeuvre: 0, materiel: 0 }, resources = {};
  const rows = kept.map(l => {
    const u = unitCost(l.composition);
    const q = Number(l.quantity) || 0;
    const amount = { materiau: u.materiau * q * k, main_oeuvre: u.main_oeuvre * q * k, materiel: u.materiel * q * k };
    const total = amount.materiau + amount.main_oeuvre + amount.materiel;
    (byLot[l.lot] ||= { lot: l.lot, label: LOTS[l.lot]?.label || l.lot, total: 0 }).total += total;
    for (const n of Object.keys(byNature)) byNature[n] += amount[n];
    // Ressources à approvisionner (pertes comprises pour les matériaux)
    for (const c of l.composition) {
      const loss = c.nature === 'materiau' ? 1 + (Number(c.loss_pct) || 0) / 100 : 1;
      const r = (resources[c.code] ||= { code: c.code, label: c.label, nature: c.nature, unit: c.unit, unit_price: Number(c.unit_price) || 0, quantity: 0, amount: 0 });
      r.quantity += (Number(c.quantity) || 0) * loss * q * k;
      r.amount += (Number(c.quantity) || 0) * loss * q * k * (Number(c.unit_price) || 0);
    }
    return { ...l, quantity: q, unit_cost: Math.round(u.total), unit_cost_detail: { materiau: Math.round(u.materiau), main_oeuvre: Math.round(u.main_oeuvre), materiel: Math.round(u.materiel) }, total: Math.round(total) };
  });
  // Montants au franc, et totaux tirés des montants arrondis : le budget reporté tombe juste sur le coût de revient affiché
  const natures = Object.fromEntries(Object.entries(byNature).map(([n, v]) => [n, Math.round(v)]));
  const dry = natures.materiau + natures.main_oeuvre + natures.materiel;
  const site = Math.round(dry * (Number(rates.site_pct) || 0) / 100), contingency = Math.round(dry * (Number(rates.contingency_pct) || 0) / 100);
  const cost = dry + site + contingency;
  const surface = (Number(params.surface) || 0) * k, housing = (Number(params.logements) || 1) * k;
  return {
    lines: rows,
    lots: Object.values(byLot).sort((a, b) => (LOTS[a.lot]?.sort || 99) - (LOTS[b.lot]?.sort || 99)).map(x => ({ ...x, total: Math.round(x.total) })),
    natures,
    resources: Object.values(resources).map(r => ({ ...r, quantity: round(r.quantity), amount: Math.round(r.amount) }))
      .sort((a, b) => Object.keys(NATURES).indexOf(a.nature) - Object.keys(NATURES).indexOf(b.nature) || b.amount - a.amount),
    dry_cost: dry, site_costs: site, contingency, cost_price: cost,
    per_m2: surface ? Math.round(dry / surface) : null, cost_price_per_m2: surface ? Math.round(cost / surface) : null,
    per_housing: Math.round(cost / housing), units: k, housing,
  };
}

/** Contrôle des paramètres saisis (bornes du tableau PARAMS). */
function checkParams(p) {
  const errors = [];
  for (const [k, d] of Object.entries(PARAMS)) {
    const v = p[k];
    if (v == null || v === '') { if (k !== 'logements') errors.push(`${d.label} : valeur attendue.`); continue; }
    if (!Number.isFinite(Number(v)) || Number(v) < d.min || Number(v) > d.max) errors.push(`${d.label} : entre ${d.min} et ${d.max}${d.unit && d.unit !== '%' ? ` ${d.unit}` : d.unit}.`);
    else if (d.integer && !Number.isInteger(Number(v))) errors.push(`${d.label} : nombre entier.`);
  }
  return errors;
}

module.exports = { NATURES, LOTS, PARAMS, BASES, bases, unitCost, estimate, checkParams };
