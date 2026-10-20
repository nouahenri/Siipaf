const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { computeIts, computePayslip, suggestedParts } = require('../src/lib/paie');

let db, app, admin, comptable, commercial, exploitation, run, awa, koffi;
const P = '/api/admin/erp/paie';
const year = new Date().getFullYear();
const period = `${year}-03`;

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  comptable = await login(app, await createUser(db, 'comptable'), 'motdepasse-test-123');
  commercial = await login(app, await createUser(db, 'commercial'), 'motdepasse-test-123');
  exploitation = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
});
after(() => db.destroy());

test('barème : ITS par tranches, réduction pour charges de famille, prorata, transport non imposable, plafonds CNPS', () => {
  assert.equal(computeIts(75000, 1).net, 0, 'exonéré jusqu’au SMIG');
  assert.equal(computeIts(400000, 1).gross, (240000 - 75000) * 0.16 + (400000 - 240000) * 0.21);
  assert.equal(computeIts(400000, 3).ricf, 22000, '4 demi-parts × 5 500');
  assert.equal(computeIts(100000, 5).net, 0, 'la réduction ne rend pas l’impôt négatif');
  assert.equal(suggestedParts({ marital_status: 'marie', children: 9 }), 5, 'plafond de 5 parts');

  const b = computePayslip({ base_salary: 400000, transport_allowance: 40000, marital_status: 'marie', children: 2 }, {});
  assert.equal(b.transport_exempt, 30000);
  assert.equal(b.taxable, 410000, 'transport imposable au-delà de 30 000');
  assert.equal(b.cnps_employee, Math.round(410000 * 0.063));
  assert.equal(b.employer.family, 3500, 'prestations familiales plafonnées à 70 000');
  assert.equal(b.cmu_employee, 2000, 'salarié, conjoint et deux enfants');
  assert.equal(b.net, b.gross - b.cnps_employee - b.cmu_employee - b.its);
  const half = computePayslip({ base_salary: 300000 }, { days_worked: 15 });
  assert.equal(half.base, 150000, 'prorata sur 30 jours');
  const high = computePayslip({ base_salary: 5000000 }, {});
  assert.equal(high.cnps_employee, Math.round(3375000 * 0.063), 'retraite plafonnée à 45 SMIG');
});

test('droits : la paie est réservée au comptable ; le responsable voit le personnel sans les salaires', async () => {
  assert.equal((await commercial.get(`${P}/employees`)).status, 403);
  assert.equal((await exploitation.get(`${P}/runs`)).status, 403);
  let res = await comptable.post(`${P}/employees`).send({ last_name: 'Koné', first_name: 'Awa', job_title: 'Assistante commerciale', department: 'commercial', hire_date: `${year}-01-01`, base_salary: 350000, transport_allowance: 30000, marital_status: 'marie', children: 1, pay_method: 'virement' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  awa = res.body;
  assert.equal(awa.matricule, 'EMP-0001');
  const seen = (await exploitation.get(`${P}/employees`)).body[0];
  assert.equal(seen.last_name, 'Koné');
  assert.equal(seen.base_salary, undefined, 'salaire masqué');
});

test('fiches reliées aux comptes du dashboard, sans doublon', async () => {
  const user = await db('users').where({ email: 'commercial@test.ci' }).first();
  let res = await comptable.post(`${P}/employees/from-users`).send({ user_ids: [user.id], hire_date: `${year}-02-01` });
  assert.equal(res.body.created, 1);
  assert.equal((await comptable.post(`${P}/employees/from-users`).send({ user_ids: [user.id], hire_date: `${year}-02-01` })).body.created, 0);
  koffi = (await db('employees').where({ user_id: user.id }).first());
  assert.equal(koffi.department, 'commercial');
  res = await comptable.patch(`${P}/employees/${awa.id}`).send({ user_id: user.id });
  assert.equal(res.status, 409, 'un compte = une fiche');
  await comptable.patch(`${P}/employees/${koffi.id}`).send({ base_salary: 250000, hire_date: `${year}-03-16`, pay_method: 'mobile_money', job_title: 'Commercial terrain' });
});

test('paie du mois : bulletins, éléments variables, écriture de paie, paiement des salaires', async () => {
  let res = await comptable.post(`${P}/runs`).send({ period });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  run = res.body;
  assert.equal(run.slips.length, 2);
  const k = run.slips.find(s => s.employee_id === koffi.id);
  assert.equal(k.inputs.days_worked, 15, 'embauché le 16 : 15 jours payés');
  assert.equal(k.result.base, 125000);
  assert.equal((await comptable.post(`${P}/runs`).send({ period })).status, 409);

  const a = run.slips.find(s => s.employee_id === awa.id);
  res = await comptable.patch(`${P}/payslips/${a.id}`).send({ bonus: 50000, advance: 20000 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.result.bonus, 50000);
  assert.equal(res.body.result.net, res.body.result.gross - res.body.result.cnps_employee - res.body.result.cmu_employee - res.body.result.its - 20000);
  assert.equal((await comptable.patch(`${P}/payslips/${a.id}`).send({ advance: 10000000 })).status, 400, 'net négatif refusé');

  assert.equal((await comptable.post(`${P}/runs/${run.id}/validate`)).status, 409, 'aucun exercice comptable');
  await comptable.post('/api/admin/erp/compta/fiscal-years').send({ label: String(year), start_date: `${year}-01-01`, end_date: `${year}-12-31` });
  res = await comptable.post(`${P}/runs/${run.id}/validate`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'valide');
  const t = res.body.totals;
  const entry = await db('acc_entries').where({ source_key: `payroll:${run.id}` }).first();
  assert.equal(entry.date, `${year}-03-31`);
  const lines = (await comptable.get(`/api/admin/erp/compta/entries/${entry.id}`)).body.lines;
  const sum = (code, k2) => lines.filter(l => l.account_code === code).reduce((x, l) => x + l[k2], 0);
  assert.equal(lines.reduce((x, l) => x + l.debit, 0), lines.reduce((x, l) => x + l.credit, 0), 'écriture équilibrée');
  assert.equal(sum('422', 'credit'), t.net);
  assert.equal(sum('421', 'credit'), 20000, 'avance retenue');
  assert.equal(sum('4471', 'credit'), t.its);
  assert.equal(sum('431', 'credit'), t.cnps_employee + t.cmu_employee + t.employer_social);
  assert.ok(lines.find(l => l.account_code === '422' && /Koné Awa/.test(l.partner_name)), 'net par salarié');
  assert.equal((await comptable.patch(`${P}/payslips/${a.id}`).send({ bonus: 1 })).status, 409, 'bulletins figés');

  res = await comptable.post(`${P}/runs/${run.id}/pay`).send({ date: `${year}-03-31` });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'paye');
  const pays = await db('acc_entries').where('source_key', 'like', `payroll_pay_%:${run.id}`).join('acc_journals as j', 'j.id', 'acc_entries.journal_id').pluck('j.code');
  assert.deepEqual(pays.sort(), ['BQ', 'MM'], 'virement et Mobile Money');
  const net422 = await db('acc_lines as l').join('acc_accounts as a', 'a.id', 'l.account_id').where('a.code', '422').select(db.raw('sum(l.debit) - sum(l.credit) as s')).first();
  assert.equal(Number(net422.s), 0, 'salaires soldés');
  assert.equal((await comptable.delete(`${P}/runs/${run.id}`)).status, 409);
});

test('barème modifiable et contrôlé ; recalcul d’une paie en brouillon', async () => {
  assert.equal((await comptable.put(`${P}/settings`).send({ its_brackets: [[100000, 0], [50000, 10], [null, 20]] })).status, 400);
  let res = await comptable.put(`${P}/settings`).send({ accident_rate: 5 });
  assert.equal(res.body.accident_rate, 5);
  res = await comptable.post(`${P}/runs`).send({ period: `${year}-04` });
  const slip = res.body.slips.find(s => s.employee_id === awa.id);
  assert.equal(slip.result.employer.accident, 3500, '5 % sur 70 000');
  await comptable.patch(`${P}/employees/${awa.id}`).send({ base_salary: 400000 });
  res = await comptable.post(`${P}/runs/${res.body.id}/refresh`);
  assert.equal(res.body.slips.find(s => s.employee_id === awa.id).result.base, 400000);
  const sage = await comptable.get(`/api/admin/erp/compta/export/sage?from=${year}-01-01&to=${year}-12-31`);
  assert.equal(sage.status, 200);
});
