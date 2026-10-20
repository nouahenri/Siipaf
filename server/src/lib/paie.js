/**
 * ERP · Paie (Côte d'Ivoire) — barème par défaut et calcul d'un bulletin. Tous les taux sont réglables
 * (« Barèmes » dans l'ERP) et doivent être validés par le comptable de SIIPAF avant la première paie réelle.
 * Sources (oct. 2026) : CNPS / CLEISS (taux au 1er janvier 2025), réforme de l'ITS (ordonnance 2023-719, en
 * vigueur le 1er janvier 2024 : ITS unique, barème progressif, réduction pour charges de famille), FDFP.
 */

const DEFAULT_PAYROLL = {
  smig: 75000,
  // CNPS
  cnps_pension_employee: 6.3, cnps_pension_employer: 7.7, cnps_pension_ceiling: 3375000, // 45 × SMIG
  family_rate: 5, maternity_rate: 0.75, accident_rate: 2, small_ceiling: 70000, // employeur seul
  cmu_employee: 500, cmu_employer: 500, cmu_family: true, // par personne couverte (salarié, conjoint, 6 enfants)
  // ITS : tranches mensuelles [plafond de la tranche, taux %] ; null = au-delà
  its_brackets: [[75000, 0], [240000, 16], [800000, 21], [2400000, 24], [8000000, 28], [null, 32]],
  ricf_per_half_part: 5500, max_parts: 5, cnps_deductible_from_its: false,
  // Charges fiscales patronales sur salaires (base : brut imposable)
  employer_tax_local: 1.2, employer_tax_expat: 10.4, apprenticeship_tax: 0.4, training_tax: 1.2,
  transport_exempt_ceiling: 30000, // indemnité de transport non imposable dans cette limite
  accounts: {
    salaries: '661', allowances: '663', social_charges: '6641', payroll_taxes: '6413',
    net_payable: '422', advances: '421', cnps: '431', its: '4471', employer_taxes: '4472',
  },
};

const CONTRACT_TYPES = { cdi: 'CDI', cdd: 'CDD', chantier: 'Contrat de chantier', stage: 'Stage', interim: 'Intérim', journalier: 'Journalier' };
const DEPARTMENTS = { direction: 'Direction', commercial: 'Commercial', technique: 'Technique / bureau d’études', chantier: 'Chantier', administratif: 'Administratif', comptabilite: 'Comptabilité', juridique: 'Juridique' };
const MARITAL = { celibataire: 'Célibataire', marie: 'Marié(e)', divorce: 'Divorcé(e)', veuf: 'Veuf / veuve' };
const PAY_METHODS = { virement: 'Virement', especes: 'Espèces', mobile_money: 'Mobile Money', cheque: 'Chèque' };

const round = n => Math.round(n);

/** Parts fiscales proposées : 1, + 1 pour un couple marié, + ½ par enfant à charge, plafonnées (modifiable par salarié). */
function suggestedParts(e, max = DEFAULT_PAYROLL.max_parts) {
  const parts = 1 + (e.marital_status === 'marie' ? 1 : 0) + 0.5 * (Number(e.children) || 0);
  return Math.min(parts, max);
}

/** ITS brut par tranches, puis réduction pour charges de famille (RICF). */
function computeIts(base, parts, s = DEFAULT_PAYROLL) {
  let tax = 0, prev = 0;
  for (const [ceiling, rate] of s.its_brackets) {
    const top = ceiling == null ? Infinity : ceiling;
    if (base > prev) tax += (Math.min(base, top) - prev) * (rate / 100);
    prev = top;
    if (base <= top) break;
  }
  const p = Math.min(Math.max(Number(parts) || 1, 1), s.max_parts);
  const ricf = (p - 1) * 2 * s.ricf_per_half_part;
  return { gross: round(tax), ricf: Math.min(round(tax), ricf), net: Math.max(0, round(tax) - ricf) };
}

/**
 * Bulletin de paie d'un mois. `e` : fiche employé (salaire de base, primes fixes, situation de famille…),
 * `v` : éléments variables du mois (jours travaillés sur 30, heures supplémentaires, primes, avance à retenir).
 */
function computePayslip(e, v = {}, s = DEFAULT_PAYROLL) {
  const days = Math.min(Math.max(v.days_worked ?? 30, 0), 30);
  const prorata = x => round((Number(x) || 0) * days / 30);
  const base = prorata(e.base_salary);
  const housing = prorata(e.housing_allowance);
  const fixedBonus = prorata(e.other_allowance);
  const transport = prorata(e.transport_allowance);
  const overtime = round(Number(v.overtime) || 0);
  const bonus = round(Number(v.bonus) || 0);
  const nonTaxable = round(Number(v.non_taxable) || 0);
  const advance = round(Number(v.advance) || 0);

  const transportExempt = Math.min(transport, s.transport_exempt_ceiling);
  const gross = base + housing + fixedBonus + transport + overtime + bonus + nonTaxable;
  const taxable = gross - transportExempt - nonTaxable; // brut imposable et cotisable
  const pensionBase = Math.min(taxable, s.cnps_pension_ceiling);
  const smallBase = Math.min(taxable, s.small_ceiling);
  const cmuPersons = s.cmu_family ? 1 + (e.marital_status === 'marie' ? 1 : 0) + Math.min(Number(e.children) || 0, 6) : 1;

  const cnpsEmployee = round(pensionBase * s.cnps_pension_employee / 100);
  const cmuEmployee = cmuPersons * s.cmu_employee;
  const parts = e.tax_parts != null ? Number(e.tax_parts) : suggestedParts(e, s.max_parts);
  const itsBase = Math.max(0, taxable - (s.cnps_deductible_from_its ? cnpsEmployee : 0));
  const its = computeIts(itsBase, parts, s);
  const net = gross - cnpsEmployee - cmuEmployee - its.net - advance;

  const atRate = e.accident_rate != null ? Number(e.accident_rate) : s.accident_rate;
  const employer = {
    pension: round(pensionBase * s.cnps_pension_employer / 100),
    family: round(smallBase * s.family_rate / 100),
    maternity: round(smallBase * s.maternity_rate / 100),
    accident: round(smallBase * atRate / 100),
    cmu: cmuPersons * s.cmu_employer,
    salary_tax: round(taxable * (e.expatriate ? s.employer_tax_expat : s.employer_tax_local) / 100),
    apprenticeship: round(taxable * s.apprenticeship_tax / 100),
    training: round(taxable * s.training_tax / 100),
  };
  const employerSocial = employer.pension + employer.family + employer.maternity + employer.accident + employer.cmu;
  const employerTaxes = employer.salary_tax + employer.apprenticeship + employer.training;

  const lines = [
    ['Salaire de base', base, 'gain'], ['Indemnité de logement', housing, 'gain'], ['Autres primes fixes', fixedBonus, 'gain'],
    ['Heures supplémentaires', overtime, 'gain'], ['Primes du mois', bonus, 'gain'],
    ['Indemnité de transport', transport, 'gain'], ['Autres éléments non imposables', nonTaxable, 'gain'],
    ['CNPS retraite (salarié)', -cnpsEmployee, 'retenue'], ['CMU (salarié)', -cmuEmployee, 'retenue'],
    ['ITS', -its.net, 'retenue'], ['Avance sur salaire', -advance, 'retenue'],
  ].filter(([, amount]) => amount).map(([label, amount, kind]) => ({ label, amount, kind }));

  return {
    days_worked: days, base, housing, fixed_bonus: fixedBonus, transport, overtime, bonus, non_taxable: nonTaxable, advance,
    transport_exempt: transportExempt, gross, taxable, pension_base: pensionBase, small_base: smallBase, cmu_persons: cmuPersons,
    cnps_employee: cnpsEmployee, cmu_employee: cmuEmployee, parts, its_base: itsBase, its_gross: its.gross, ricf: its.ricf, its: its.net,
    net, employer, employer_social: employerSocial, employer_taxes: employerTaxes, employer_cost: gross + employerSocial + employerTaxes,
    lines, rates: { accident_rate: atRate, expatriate: !!e.expatriate },
  };
}

/** Contrôle d'un barème saisi : tranches ITS croissantes, taux entre 0 et 100. */
function checkPayroll(s) {
  const errors = [];
  let prev = 0;
  s.its_brackets.forEach(([ceiling, rate], i) => {
    if (rate < 0 || rate > 100) errors.push('Taux d’ITS entre 0 et 100 %.');
    if (ceiling == null && i !== s.its_brackets.length - 1) errors.push('Seule la dernière tranche d’ITS est sans plafond.');
    if (ceiling != null && ceiling <= prev) errors.push('Les tranches d’ITS doivent être croissantes.');
    if (ceiling != null) prev = ceiling;
  });
  if (s.its_brackets[s.its_brackets.length - 1]?.[0] != null) errors.push('La dernière tranche d’ITS doit être sans plafond.');
  return [...new Set(errors)];
}

module.exports = { DEFAULT_PAYROLL, CONTRACT_TYPES, DEPARTMENTS, MARITAL, PAY_METHODS, suggestedParts, computeIts, computePayslip, checkPayroll };
