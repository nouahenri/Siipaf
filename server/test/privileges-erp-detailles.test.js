/**
 * Privilèges détaillés action par action dans toute l'ERP et le dashboard (30/10) : Service commercial, Achats & stocks,
 * Comptabilité, Paie, RH, Administration générale, Juridique, Chantiers, SAV, paramètres et échéanciers.
 * - un rôle qui n'a qu'UNE action ne peut faire que cette action (403 sur les autres) ;
 * - les migrations accordent toutes les actions à qui avait l'ancien droit (rôle d'origine ou personnalisé, privilèges
 *   individuels accordés ou retirés), et se défont ;
 * - les rôles d'origine gardent leurs capacités ; l'écran des privilèges montre les nouvelles cases sous leur intitulé ;
 * - points de l'audit : pointages d'un conducteur (point 10), import de prospects (B15).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');
const { PERMISSIONS, PERMISSION_IDS, PERMISSION_CATALOG, PERMISSION_SPLITS, splitPermissions } = require('../src/lib/domain');
const { effectivePermissions, invalidate } = require('../src/services/permissions');
const m1 = require('../migrations/20261130800000_privileges_erp_commercial_achats');
const m2 = require('../migrations/20261130810000_privileges_erp_compta_paie');
const m3 = require('../migrations/20261130820000_privileges_erp_rh');
const m4 = require('../migrations/20261130830000_privileges_erp_admin_juridique_chantiers_sav');

const PWD = 'motdepasse-test-123';
const ERP = '/api/admin/erp';
let db, app, admin, seq = 0;
let employee, worksite, ticket;

/** Rôle personnalisé avec des droits précis, et le compte connecté qui le porte. */
async function agentWith(perms) {
  const key = `r_${++seq}`;
  await db('roles').insert({ id: key, label: key, description: '', system: false });
  if (perms.length) await db('role_permissions').insert(perms.map(permission => ({ role: key, permission })));
  invalidate(db);
  return login(app, await createUser(db, key, `${key}@test.ci`), PWD);
}
const call = (agent, [method, url, body]) => agent[method](`${ERP}${url}`).send(body ?? {});

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  const emp = { hire_date: '2024-01-01', job_title: 'Maçon', base_salary: 250000, department: 'technique' };
  employee = (await db('employees').insert({ ...emp, matricule: 'E-100', last_name: 'Traoré', first_name: 'Ali' }).returning('id'))[0];
  employee = typeof employee === 'object' ? employee.id : employee;
  const w = await admin.post(`${ERP}/chantiers`).send({ project_id: project.id, name: 'Chantier test', zone_kind: 'programme' });
  assert.equal(w.status, 201, JSON.stringify(w.body));
  worksite = w.body;
  const lead = (await admin.post('/api/admin/leads').send({ name: 'Client SAV', phone: '0700000001' })).body;
  ticket = (await admin.post(`${ERP}/sav/tickets`).send({ category: 'plomberie', title: 'Fuite', lead_id: lead.id })).body;
});
after(() => db.destroy());

// ─── Catalogue ──────────────────────────────────────────────────────────────
const NEW = {
  'Service commercial': ['leads:assign', 'leads:transfer_decide', 'property:buildings', 'property:lots', 'vefa:read', 'vefa:write'],
  'Achats & stocks': ['appro:locations', 'appro:needs', 'appro:quotes', 'appro:orders', 'appro:stock', 'appro:receive', 'appro:minimum'],
  Comptabilité: ['compta:entries', 'compta:sync', 'compta:import', 'compta:assets', 'compta:validate', 'compta:reverse', 'suppliers:write', 'achats:write', 'achats:validate', 'achats:pay', 'achats:advance',
    'frais:post', 'frais:reimburse', 'compta:years', 'compta:lock', 'compta:opening', 'compta:close', 'compta:plan', 'compta:settings'],
  Paie: ['paie:employees', 'paie:salary', 'paie:prepare', 'paie:inputs'],
  RH: ['rh:files', 'rh:documents_write', 'rh:career', 'rh:pin', 'conges:enter', 'conges:adjust', 'conges:cancel', 'presence:sheets', 'presence:kiosk', 'presence:correct',
    'recrutement:jobs', 'recrutement:applicants', 'recrutement:hire', 'recrutement:delete', 'formation:skills', 'formation:plan', 'formation:complete',
    'evaluation:objectives', 'evaluation:reviews', 'kpi:indicators', 'kpi:templates', 'kpi:department', 'rh:rules', 'rh:positions', 'rh:heads', 'rh:holidays'],
  Administration: ['contrats:write', 'contrats:close', 'contrats:documents', 'parc:write', 'parc:maintenance', 'parc:costs', 'parc:reservations', 'demandes:handle', 'demandes:view_all', 'demandes:invoice'],
  Juridique: ['juridique:deeds', 'juridique:litigation', 'juridique:guarantees', 'juridique:settings'],
  Chantiers: ['chantiers:create', 'chantiers:plan', 'chantiers:budget', 'chantiers:settings', 'chantiers:tma', 'chantiers:stages', 'chantiers:situations'],
  SAV: ['sav:edit', 'sav:status', 'sav:comment', 'sav:delivery', 'sav:reserves'],
  Dashboard: ['settings:refs', 'settings:general', 'schedule:generate', 'schedule:edit'],
};
const REMOVED = ['appro:write', 'conges:manage', 'presence:write', 'recrutement:write', 'formation:write', 'evaluation:write', 'kpi:write', 'rh:settings', 'juridique:write',
  'chantiers:write', 'chantiers:direction', 'sav:handle', 'property:write', 'settings:write', 'schedule:write'];

test('catalogue : chaque nouvelle action existe, les anciens droits disparus ne sont plus proposés, les droits par défaut sont au catalogue', () => {
  for (const [module, ids] of Object.entries(NEW)) for (const id of ids) assert.ok(PERMISSION_IDS.includes(id), `${module} : ${id}`);
  for (const id of REMOVED) assert.ok(!PERMISSION_IDS.includes(id), `${id} ne doit plus être proposé`);
  assert.equal(new Set(PERMISSION_IDS).size, PERMISSION_IDS.length, 'aucun doublon');
  for (const [role, perms] of Object.entries(PERMISSIONS)) {
    for (const p of perms.filter(x => x !== '*')) assert.ok(PERMISSION_IDS.includes(p), `${role} : ${p} hors catalogue`);
  }
  // Chaque droit découpé donne des actions qui existent
  for (const [from, to] of Object.entries(PERMISSION_SPLITS)) for (const p of to) assert.ok(PERMISSION_IDS.includes(p) || PERMISSION_SPLITS[p], `${from} → ${p}`);
});

test('écran des privilèges : les nouvelles cases sont regroupées sous leur intitulé (parent), contigu, dans le dashboard et l’ERP', async () => {
  const res = await admin.get('/api/admin/permissions');
  assert.equal(res.status, 200);
  const byId = Object.fromEntries(res.body.catalog.flatMap(g => g.items.map(i => [i.id, { ...i, group: g.group }])));
  const parents = {
    'leads:transfer_decide': 'Attribution et transferts', 'property:lots': 'Parc immobilier', 'vefa:read': 'Appels de fonds VEFA', 'appro:orders': 'Préparer les achats', 'appro:minimum': 'Stocks et réceptions',
    'compta:import': 'Écritures', 'compta:reverse': 'Validation', 'suppliers:write': 'Achats et fournisseurs', 'frais:reimburse': 'Notes de frais', 'compta:lock': 'Exercices et clôture', 'compta:plan': 'Paramétrage',
    'paie:salary': 'Fiches salariés', 'paie:inputs': 'Préparation de la paie', 'rh:pin': 'Dossiers du personnel', 'conges:cancel': 'Absences', 'presence:kiosk': 'Présences', 'recrutement:hire': 'Recrutement',
    'formation:complete': 'Compétences et formations', 'evaluation:reviews': 'Évaluations', 'kpi:templates': 'Référentiel KPI', 'rh:holidays': 'Réglages RH', 'contrats:documents': 'Contrats',
    'parc:reservations': 'Parc auto et matériel', 'demandes:invoice': 'Demandes internes', 'juridique:guarantees': 'Gérer le Juridique', 'chantiers:budget': 'Gérer les chantiers (conducteur de travaux)',
    'chantiers:situations': 'Valider en direction (chantiers)', 'sav:comment': 'Traiter les réclamations', 'sav:delivery': 'Livraison et réserves', 'settings:general': 'Paramètres', 'schedule:edit': 'Échéanciers',
  };
  for (const [id, parent] of Object.entries(parents)) assert.equal(byId[id]?.parent, parent, id);
  // Les actions d'un même intitulé se suivent (permRows : un seul intitulé par bloc) et restent dans leur groupe
  for (const g of res.body.catalog) {
    const seen = new Set();
    let last = null;
    for (const i of g.items) {
      if (i.parent && i.parent !== last) { assert.ok(!seen.has(i.parent), `${g.group} : « ${i.parent} » est coupé en deux`); seen.add(i.parent); }
      last = i.parent;
    }
  }
  // Les groupes que la page « Accès » de chaque module de l'ERP affiche contiennent les nouvelles cases
  const groups = { achats: ['ERP · Achats & stocks'], commercial: ['ERP · Service commercial', 'Ventes', 'Dossiers d’acquisition'], compta: ['ERP · Comptabilité', 'ERP · Paie'],
    rh: ['ERP · Ressources humaines', 'ERP · Espace employé'], sav: ['ERP · Client & SAV'], administration: ['ERP · Administration générale'], juridique: ['ERP · Juridique'], chantiers: ['ERP · Chantiers'] };
  const shown = Object.values(groups).flat();
  for (const id of [...NEW['Achats & stocks'], ...NEW.Comptabilité, ...NEW.Paie, ...NEW.RH, ...NEW.Administration, ...NEW.Juridique, ...NEW.Chantiers, ...NEW.SAV, 'leads:transfer_decide', 'property:lots', 'vefa:read']) {
    assert.ok(shown.includes(byId[id].group), `${id} dans « ${byId[id].group} » doit être affiché par la page Accès d’un module`);
  }
  assert.equal(byId['self:conges'].label, 'Mon espace RH : congés, justificatifs, auto-évaluation');
});

// ─── Un rôle qui n'a qu'une action ne fait que cette action ─────────────────
/** Pour chaque module : droits de base du rôle d'essai, et par action la route qu'elle ouvre (403 si le droit manque, autre statut sinon). */
const MATRIX = {
  commercial: { base: ['commercial:read'], probes: {
    'property:buildings': ['post', '/commercial/projects/999999/buildings'],
    'property:lots': ['patch', '/commercial/lots/999999'],
    'vefa:write': ['put', '/commercial/vefa/plans/999999'],
  } },
  achats: { base: ['appro:read'], probes: {
    'appro:locations': ['post', '/achats/locations'], 'appro:needs': ['post', '/achats/needs/999999/prepare'], 'appro:quotes': ['post', '/achats/quotes'], 'appro:orders': ['post', '/achats/orders'],
    'appro:stock': ['post', '/achats/movements'], 'appro:receive': ['post', '/achats/orders/999999/receive'], 'appro:minimum': ['put', '/achats/stock/minimum'],
    'achats:advance': ['post', '/achats/orders/999999/advances'],
  } },
  compta: { base: ['compta:read'], probes: {
    'compta:entries': ['post', '/compta/entries'], 'compta:sync': ['post', '/compta/sync'], 'compta:assets': ['post', '/parc/immobilisations/dotations'],
    'compta:validate': ['post', '/compta/entries/validate'], 'compta:reverse': ['post', '/compta/entries/999999/reverse'],
    'suppliers:write': ['post', '/compta/suppliers'], 'achats:write': ['post', '/compta/purchases'], 'achats:validate': ['post', '/compta/purchases/999999/validate'], 'achats:pay': ['post', '/compta/purchases/999999/payments'],
    'frais:reimburse': ['post', '/rh/expenses/reimburse'],
    'compta:years': ['post', '/compta/fiscal-years'], 'compta:lock': ['patch', '/compta/fiscal-years/999999'], 'compta:opening': ['post', '/compta/opening'], 'compta:close': ['post', '/compta/fiscal-years/999999/close'],
    'compta:plan': ['post', '/compta/accounts'], 'compta:settings': ['put', '/compta/settings', { vat_sales_rate: 'x' }],
  } },
  paie: { base: [], probes: {
    'paie:employees': ['post', '/paie/employees'], 'paie:prepare': ['post', '/paie/runs'], 'paie:inputs': ['patch', '/paie/payslips/999999'],
  } },
  rh: { base: ['rh:read'], probes: () => ({
    'rh:files': ['patch', '/rh/employees/999999'], 'rh:documents_write': ['post', `/rh/employees/${employee}/documents`], 'rh:career': ['post', `/rh/employees/${employee}/career`], 'rh:pin': ['put', `/rh/employees/${employee}/pin`, { pin: '1234' }],
    'conges:enter': ['post', '/rh/leaves'], 'conges:adjust': ['post', `/rh/employees/${employee}/adjustments`],
    'presence:sheets': ['post', '/rh/attendance/sheet'], 'presence:kiosk': ['post', '/rh/attendance/kiosk'], 'presence:correct': ['post', '/rh/attendance'],
    'recrutement:jobs': ['post', '/rh/jobs'], 'recrutement:applicants': ['post', '/rh/applicants'], 'recrutement:hire': ['post', '/rh/applicants/999999/hire'], 'recrutement:delete': ['delete', '/rh/applicants/999999'],
    'formation:skills': ['post', '/rh/skill-types'], 'formation:plan': ['post', '/rh/trainings'], 'formation:complete': ['post', '/rh/trainings/999999/complete'],
    'evaluation:objectives': ['post', `/rh/employees/${employee}/objectives`], 'evaluation:reviews': ['put', `/rh/employees/${employee}/reviews/2026`],
    'kpi:indicators': ['post', '/rh/kpis'], 'kpi:templates': ['put', '/rh/kpi-templates'], 'kpi:department': ['post', '/rh/department-objectives'],
    'rh:rules': ['put', '/rh/settings', { accrual_per_month: 'x' }], 'rh:positions': ['post', '/rh/positions'], 'rh:heads': ['put', '/rh/department-heads/direction', { employee_id: 'x' }], 'rh:holidays': ['post', '/rh/holidays'],
  }) },
  administration: { base: ['contrats:read', 'parc:read'], probes: {
    'contrats:write': ['post', '/contrats'], 'contrats:close': ['post', '/contrats/999999/close'], 'contrats:documents': ['post', '/contrats/999999/documents'],
    'parc:write': ['post', '/parc/assets'], 'parc:maintenance': ['post', '/parc/assets/999999/plans'], 'parc:costs': ['post', '/parc/assets/999999/costs'], 'parc:reservations': ['post', '/parc/reservations/999999/decide'],
  } },
  juridique: { base: ['juridique:read'], probes: {
    'juridique:deeds': ['post', '/juridique/actes/999999'], 'juridique:litigation': ['post', '/juridique/litiges'], 'juridique:guarantees': ['post', '/juridique/cautions'], 'juridique:settings': ['put', '/juridique/reglages'],
  } },
  chantiers: { base: ['chantiers:read'], probes: () => ({
    'chantiers:create': ['post', '/chantiers'], 'chantiers:settings': ['put', '/chantiers/reglages', { x: 1 }],
    'chantiers:plan': ['post', `/chantiers/${worksite.id}/phases`], 'chantiers:budget': ['post', `/chantiers/${worksite.id}/budget`],
    'chantiers:tma': ['post', '/chantiers/tma', { sale_id: 999999, title: 'Travaux modificatifs' }],
    'chantiers:stages': ['post', '/chantiers/etapes/999999/declarer'], 'chantiers:situations': ['get', '/chantiers/situations'],
  }) },
  sav: { base: ['sav:read', 'sav:all'], probes: () => ({
    'sav:status': ['post', `/sav/tickets/${ticket.id}/status`], 'sav:comment': ['post', `/sav/tickets/${ticket.id}/comments`],
    'sav:edit': ['patch', `/sav/tickets/${ticket.id}`, { priority: 'haute' }], 'sav:delivery': ['patch', '/sav/sales/999999/delivery'], 'sav:reserves': ['post', '/sav/sales/999999/reserves'],
  }) },
};

for (const [module, spec] of Object.entries(MATRIX)) {
  test(`${module} : un rôle qui n’a qu’une action ne fait que cette action (403 sur les autres)`, async () => {
    const probes = typeof spec.probes === 'function' ? spec.probes() : spec.probes;
    const actions = Object.keys(probes);
    for (const action of actions) {
      const agent = await agentWith([...spec.base, action]);
      for (const other of actions) {
        const res = await call(agent, probes[other]);
        if (other === action) assert.notEqual(res.status, 403, `${action} doit ouvrir ${probes[other][0]} ${probes[other][1]} : ${JSON.stringify(res.body)}`);
        else assert.equal(res.status, 403, `${action} ne doit pas ouvrir ${other} (${probes[other][1]}) : ${res.status} ${JSON.stringify(res.body)}`);
      }
    }
  });
}

test('commercial : transferts (valider ≠ attribuer), appels de fonds (lire ≠ établir), attribution en lot', async () => {
  const decide = await agentWith(['leads:read', 'leads:transfer_decide']);
  const assign = await agentWith(['leads:read', 'leads:assign']);
  assert.notEqual((await decide.post('/api/admin/lead-transfers/999999/valider').send({})).status, 403);
  assert.notEqual((await decide.post('/api/admin/lead-transfers/999999/refuser').send({ note: 'non' })).status, 403);
  assert.equal((await assign.post('/api/admin/lead-transfers/999999/valider').send({})).status, 403);
  assert.equal((await assign.post('/api/admin/lead-transfers/999999/refuser').send({ note: 'non' })).status, 403);
  assert.equal((await decide.post('/api/admin/leads/assign').send({ ids: [999999], user_id: null })).status, 403);
  assert.notEqual((await assign.post('/api/admin/leads/assign').send({ ids: [999999], user_id: null })).status, 403);
  // Appels de fonds VEFA : lire sans établir, établir sans que lire dépende d'un autre droit
  const read = await agentWith(['vefa:read']);
  const write = await agentWith(['vefa:write']);
  assert.notEqual((await read.get(`${ERP}/commercial/vefa/plans/999999`)).status, 403);
  assert.equal((await read.put(`${ERP}/commercial/vefa/plans/999999`).send({})).status, 403);
  assert.notEqual((await write.put(`${ERP}/commercial/vefa/plans/999999`).send({})).status, 403);
  assert.equal((await (await agentWith(['property:lots'])).get(`${ERP}/commercial/vefa/plans/999999`)).status, 403);
});

test('achats : une demande de prix devient une commande avec les deux droits seulement', async () => {
  const quotes = await agentWith(['appro:read', 'appro:quotes']);
  const orders = await agentWith(['appro:read', 'appro:orders']);
  const both = await agentWith(['appro:read', 'appro:quotes', 'appro:orders']);
  assert.equal((await quotes.post(`${ERP}/achats/quotes/999999/order`)).status, 403);
  assert.equal((await orders.post(`${ERP}/achats/quotes/999999/order`)).status, 403);
  assert.notEqual((await both.post(`${ERP}/achats/quotes/999999/order`)).status, 403);
  // Annuler : demande de prix et bon de commande ont chacun leur droit
  assert.equal((await quotes.post(`${ERP}/achats/orders/999999/cancel`)).status, 403);
  assert.notEqual((await quotes.post(`${ERP}/achats/quotes/999999/cancel`)).status, 403);
});

test('compta : l’import Sage suit le droit de chaque type (écritures, plan, soldes d’ouverture)', async () => {
  const rows = [{ line: 2, cells: ['52110000', 'Banque', '3000000', ''] }, { line: 3, cells: ['10100000', 'Capital', '', '3000000'] }];
  const MAPPING = { ecritures: { journal: 0, date: 1, piece: 0, account: 2, label: 3, debit: 4, credit: 5 }, plan: { account: 0, label: 1 }, balance: { account: 0, label: 1, debit: 2, credit: 3 } };
  const send = (agent, kind) => agent.post(`${ERP}/compta/import/sage`).send({ kind, dry_run: true, rows, mapping: MAPPING[kind], options: { fiscal_year_id: 1 } });
  const imp = await agentWith(['compta:read', 'compta:import']);
  const plan = await agentWith(['compta:read', 'compta:plan']);
  const opening = await agentWith(['compta:read', 'compta:opening']);
  const nothing = await agentWith(['compta:read', 'compta:sync']);
  assert.equal((await send(nothing, 'ecritures')).status, 403, 'le droit de synchroniser n’ouvre pas l’import');
  assert.notEqual((await send(imp, 'ecritures')).status, 403);
  assert.equal((await send(imp, 'plan')).status, 403);
  assert.equal((await send(imp, 'balance')).status, 403);
  assert.equal((await send(plan, 'ecritures')).status, 403);
  assert.equal((await send(opening, 'ecritures')).status, 403);
  assert.equal((await send(opening, 'plan')).status, 403);
  assert.equal((await send(plan, 'balance')).status, 403);
});

test('paie : le salaire se règle avec « Salaire et paiement », pas avec « Gérer les fiches salariés »', async () => {
  const fiches = await agentWith(['paie:employees']);
  const salaire = await agentWith(['paie:employees', 'paie:salary']);
  assert.equal((await fiches.patch(`${ERP}/paie/employees/${employee}`).send({ base_salary: 300000 })).status, 403);
  assert.equal((await fiches.patch(`${ERP}/paie/employees/${employee}`).send({ phone: '0102030405' })).status, 200);
  assert.equal((await salaire.patch(`${ERP}/paie/employees/${employee}`).send({ base_salary: 300000 })).status, 200);
  assert.equal((await db('employees').where({ id: employee }).first()).base_salary, 300000);
  // Création d'une fiche : sans salaire, elle part à 0 ; avec un salaire, il faut le droit
  const body = { last_name: 'Nouveau', first_name: 'Test', job_title: 'Aide', hire_date: '2026-01-01' };
  const created = await fiches.post(`${ERP}/paie/employees`).send({ matricule: 'T-237', ...body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await fiches.post(`${ERP}/paie/employees`).send({ matricule: 'T-24', ...body, last_name: 'Autre', base_salary: 200000 })).status, 403);
  assert.equal((await salaire.post(`${ERP}/paie/employees`).send({ matricule: 'T-25', ...body, last_name: 'Autre', base_salary: 200000 })).status, 201);
});

test('RH : annuler une absence commencée demande conges:cancel ; ajuster un solde demande conges:adjust', async () => {
  const id = (await db('hr_leaves').insert({ employee_id: employee, type: 'annuel', start_date: '2026-01-05', end_date: '2026-01-09', days: 5, calendar_days: 5, status: 'approuvee', requested_by: null }).returning('id'))[0];
  const leaveId = typeof id === 'object' ? id.id : id;
  const entrer = await agentWith(['rh:read', 'conges:enter', 'conges:adjust']);
  const annuler = await agentWith(['rh:read', 'conges:cancel']);
  const res1 = await entrer.post(`${ERP}/rh/leaves/${leaveId}/decide`).send({ action: 'cancel' });
  assert.equal(res1.status, 403, JSON.stringify(res1.body));
  const res2 = await annuler.post(`${ERP}/rh/leaves/${leaveId}/decide`).send({ action: 'cancel' });
  assert.equal(res2.status, 200, JSON.stringify(res2.body));
  const fiche = await agentWith(['rh:files']);
  assert.equal((await fiche.patch(`${ERP}/rh/employees/${employee}`).send({ leave_opening_days: 5 })).status, 403, 'le solde d’ouverture demande conges:adjust');
});

test('RH : objectifs et entretien sont deux droits ; le responsable direct garde ceux de son équipe', async () => {
  const objectifs = await agentWith(['rh:read', 'evaluation:objectives']);
  const entretiens = await agentWith(['rh:read', 'evaluation:reviews']);
  const obj = { year: 2026, title: 'Livrer le lot 3', weight: 1 };
  assert.equal((await entretiens.post(`${ERP}/rh/employees/${employee}/objectives`).send(obj)).status, 403);
  assert.equal((await objectifs.post(`${ERP}/rh/employees/${employee}/objectives`).send(obj)).status, 201);
  assert.equal((await objectifs.put(`${ERP}/rh/employees/${employee}/reviews/2026`).send({ rating: 3 })).status, 403);
  assert.notEqual((await entretiens.put(`${ERP}/rh/employees/${employee}/reviews/2026`).send({ rating: 3 })).status, 403);
});

test('administration : les demandes internes se traitent, se voient toutes, se facturent chacune avec son droit', async () => {
  const handle = await agentWith(['demandes:handle']);
  const viewAll = await agentWith(['demandes:view_all']);
  assert.equal((await handle.get(`${ERP}/demandes?scope=handle`)).status, 200);
  assert.equal((await viewAll.get(`${ERP}/demandes?scope=handle`)).status, 403);
  assert.equal((await viewAll.get(`${ERP}/demandes?scope=all`)).status, 200);
  const own = await agentWith(['self:demandes', 'demandes:handle']);
  const created = await own.post(`${ERP}/demandes`).send({ kind: 'intervention', title: 'Réparer la porte', description: 'La porte du bureau ne ferme plus' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  // Toutes les demandes : seulement avec demandes:view_all (traiter ne suffit plus)
  const all = await (await agentWith(['demandes:handle'])).get(`${ERP}/demandes?scope=all`);
  assert.equal(all.status, 200);
  assert.equal(all.body.length, 0, 'sans demandes:view_all, la liste « toutes » se limite à ses propres demandes');
  assert.ok((await viewAll.get(`${ERP}/demandes?scope=all`)).body.length >= 1);
  // Facture d'achat à la clôture : demandes:invoice ET achats:write
  const refs = await handle.get(`${ERP}/demandes/refs`);
  assert.deepEqual(refs.body.suppliers, [], 'sans demandes:invoice, pas de liste de fournisseurs');
  const invoicer = await agentWith(['demandes:handle', 'demandes:invoice', 'achats:write']);
  assert.ok(Array.isArray((await invoicer.get(`${ERP}/demandes/refs`)).body.suppliers));
});

test('SAV : modifier la fiche, changer le statut et commenter sont trois droits ; attribuer reste à part', async () => {
  const base = ['sav:read', 'sav:all'];
  const assign = await agentWith([...base, 'sav:assign']);
  const edit = await agentWith([...base, 'sav:edit']);
  assert.equal((await assign.patch(`${ERP}/sav/tickets/${ticket.id}`).send({ priority: 'urgente' })).status, 403, 'attribuer ne permet pas de changer la priorité');
  assert.equal((await edit.patch(`${ERP}/sav/tickets/${ticket.id}`).send({ priority: 'urgente' })).status, 200);
  assert.equal((await edit.patch(`${ERP}/sav/tickets/${ticket.id}`).send({ assigned_to: 1 })).status, 403, 'changer de responsable demande sav:assign');
  const comment = await agentWith([...base, 'sav:comment']);
  const res = await comment.post(`${ERP}/sav/tickets/${ticket.id}/comments`).send({ body: 'Technicien prévenu' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await comment.post(`${ERP}/sav/tickets/${ticket.id}/status`).send({ status: 'qualifie' })).status, 403);
  const status = await agentWith([...base, 'sav:status']);
  assert.equal((await status.post(`${ERP}/sav/tickets/${ticket.id}/status`).send({ status: 'qualifie' })).status, 200);
  assert.equal((await status.post(`${ERP}/sav/tickets/${ticket.id}/comments`).send({ body: 'x' })).status, 403);
});

test('juridique : dater un acte depuis le dossier de vente (dashboard) demande juridique:deeds', async () => {
  const reserve = await agentWith(['sales:edit', 'leads:all']);
  const juriste = await agentWith(['sales:edit', 'leads:all', 'juridique:deeds']);
  const autre = await agentWith(['sales:edit', 'leads:all', 'juridique:litigation']);
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  await admin.put(`/api/admin/projects/${project.id}/lots`).send([{ code: 'JU1', price_fcfa: 15000000 }]);
  const lot = await db('lots').where({ project_id: project.id, code: 'JU1' }).first();
  const lead = (await admin.post('/api/admin/leads').send({ name: 'Acquéreur acte', phone: '0700000077' })).body;
  const sale = (await admin.post(`/api/admin/lots/${lot.id}/sale`).send({ lead_id: lead.id })).body;
  assert.ok(sale.id, JSON.stringify(sale));
  assert.equal((await reserve.patch(`/api/admin/sales/${sale.id}`).send({ signed_at: '2026-02-01' })).status, 403);
  assert.equal((await autre.patch(`/api/admin/sales/${sale.id}`).send({ signed_at: '2026-02-01' })).status, 403);
  assert.equal((await juriste.patch(`/api/admin/sales/${sale.id}`).send({ signed_at: '2026-02-01' })).status, 200);
});

test('dashboard : listes de référence, réglages généraux, génération et modification des échéances sont quatre droits', async () => {
  const ref = await agentWith(['projects:read', 'settings:refs']);
  const general = await agentWith(['projects:read', 'settings:general']);
  assert.notEqual((await ref.post('/api/admin/refs').send({})).status, 403);
  assert.equal((await general.post('/api/admin/refs').send({})).status, 403);
  assert.equal((await ref.put('/api/admin/settings').send({})).status, 403);
  assert.notEqual((await general.put('/api/admin/settings').send({})).status, 403);
  const gen = await agentWith(['schedule:generate']);
  const edit = await agentWith(['schedule:edit']);
  assert.notEqual((await gen.post('/api/admin/sales/999999/schedule/generate').send({})).status, 403);
  assert.equal((await edit.post('/api/admin/sales/999999/schedule/generate').send({})).status, 403);
  assert.equal((await gen.put('/api/admin/sales/999999/schedule').send([])).status, 403);
  assert.notEqual((await edit.put('/api/admin/sales/999999/schedule').send([])).status, 403);
});

// ─── Migrations : qui avait l'ancien droit reçoit toutes ses actions ────────
const MIGRATIONS = [
  [m1, { 'leads:assign': ['leads:assign', 'leads:transfer_decide'], 'property:write': ['property:buildings', 'property:lots'], 'vefa:write': ['vefa:read', 'vefa:write'],
    'appro:write': ['appro:locations', 'appro:needs', 'appro:quotes', 'appro:orders'], 'appro:stock': ['appro:stock', 'appro:receive', 'appro:minimum'] }],
  [m2, { 'compta:entries': ['compta:entries', 'compta:sync', 'compta:import', 'compta:assets'], 'compta:validate': ['compta:validate', 'compta:reverse'], 'achats:write': ['suppliers:write', 'achats:write', 'achats:validate'],
    'achats:pay': ['achats:pay', 'achats:advance'], 'frais:post': ['frais:post', 'frais:reimburse'], 'compta:close': ['compta:years', 'compta:lock', 'compta:opening', 'compta:close'],
    'compta:settings': ['compta:plan', 'compta:settings'], 'paie:employees': ['paie:employees', 'paie:salary'], 'paie:prepare': ['paie:prepare', 'paie:inputs'] }],
  [m3, { 'rh:files': ['rh:files', 'rh:documents_write', 'rh:career', 'rh:pin'], 'conges:manage': ['conges:enter', 'conges:adjust', 'conges:cancel'], 'presence:write': ['presence:sheets', 'presence:kiosk', 'presence:correct'],
    'recrutement:write': ['recrutement:jobs', 'recrutement:applicants', 'recrutement:hire', 'recrutement:delete'], 'formation:write': ['formation:skills', 'formation:plan', 'formation:complete'],
    'evaluation:write': ['evaluation:objectives', 'evaluation:reviews'], 'kpi:write': ['kpi:indicators', 'kpi:templates', 'kpi:department'], 'rh:settings': ['rh:rules', 'rh:positions', 'rh:heads', 'rh:holidays'] }],
  [m4, { 'contrats:write': ['contrats:write', 'contrats:close', 'contrats:documents'], 'parc:write': ['parc:write', 'parc:maintenance', 'parc:costs', 'parc:reservations'],
    'demandes:handle': ['demandes:handle', 'demandes:view_all', 'demandes:invoice'], 'juridique:write': ['juridique:deeds', 'juridique:litigation', 'juridique:guarantees', 'juridique:settings'],
    'chantiers:write': ['chantiers:create', 'chantiers:plan', 'chantiers:budget', 'chantiers:settings', 'chantiers:tma'], 'chantiers:direction': ['chantiers:stages', 'chantiers:situations'],
    'sav:handle': ['sav:edit', 'sav:status', 'sav:comment'], 'sav:reserves': ['sav:delivery', 'sav:reserves'], 'settings:write': ['settings:refs', 'settings:general'], 'schedule:write': ['schedule:generate', 'schedule:edit'] }],
];

test('migrations : le catalogue et les migrations découpent de la même façon', () => {
  const all = Object.assign({}, ...MIGRATIONS.map(([, s]) => s));
  for (const [from, to] of Object.entries(all)) assert.deepEqual(PERMISSION_SPLITS[from], to, from);
});

for (const [index, [migration, splits]] of MIGRATIONS.entries()) {
  test(`migration ${index + 1} : rôle d’origine, rôle personnalisé et privilèges individuels (accordé / retiré) reçoivent toutes les actions, et la migration se défait`, async () => {
    const olds = Object.keys(splits);
    // La migration (et son down) touche tous les rôles et tous les comptes : on garde l'état de départ pour les tests suivants
    const savedRoles = await db('role_permissions');
    const savedUsers = await db('user_permissions');
    // Rôle d'origine : on lui remet les anciens droits à la place de ses actions (état d'une base d'avant la migration)
    const original = 'comptable';
    const allActions = [...new Set(Object.values(splits).flat())];
    await db('role_permissions').where({ role: original }).whereIn('permission', allActions).del();
    await db('role_permissions').insert(olds.map(permission => ({ role: original, permission })));
    // Rôle personnalisé : un seul ancien droit, plus un droit sans rapport
    const custom = `mig_${index}`;
    await db('roles').insert({ id: custom, label: custom, description: '', system: false });
    await db('role_permissions').insert([{ role: custom, permission: olds[0] }, { role: custom, permission: 'leads:read' }]);
    // Comptes : un droit accordé en plus du rôle, un droit retiré
    const [granted, denied] = [await createUser(db, 'editeur', `${custom}.a@test.ci`), await createUser(db, 'editeur', `${custom}.b@test.ci`)];
    const ids = { granted: (await db('users').where({ email: granted }).first()).id, denied: (await db('users').where({ email: denied }).first()).id };
    await db('user_permissions').insert([{ user_id: ids.granted, permission: olds[1], granted: true }, { user_id: ids.denied, permission: olds[2] || olds[0], granted: false }]);

    await migration.up(db);
    invalidate(db);

    const perms = async role => (await db('role_permissions').where({ role })).map(r => r.permission);
    const rolePerms = await perms(original);
    for (const action of allActions) assert.ok(rolePerms.includes(action), `rôle d’origine : ${action}`);
    for (const old of olds.filter(o => !allActions.includes(o))) assert.ok(!rolePerms.includes(old), `${old} disparaît`);
    const customPerms = await perms(custom);
    for (const action of splits[olds[0]]) assert.ok(customPerms.includes(action), `rôle personnalisé : ${action}`);
    assert.ok(customPerms.includes('leads:read'), 'les droits sans rapport restent');
    for (const action of Object.values(splits).flat().filter(a => !splits[olds[0]].includes(a))) assert.ok(!customPerms.includes(action) || action === 'leads:read', `${action} n’est pas donné à qui n’avait pas l’ancien droit`);
    // Le rôle personnalisé garde bien ces droits une fois filtrés par le catalogue
    const eff = await effectivePermissions(db, { id: 0, role: custom });
    for (const action of splits[olds[0]]) assert.ok(eff.includes(action), `effectivePermissions : ${action}`);

    const userRows = async id => (await db('user_permissions').where({ user_id: id })).map(r => `${r.permission}:${r.granted ? 1 : 0}`);
    const g = await userRows(ids.granted);
    for (const action of splits[olds[1]]) assert.ok(g.includes(`${action}:1`), `compte, accordé : ${action}`);
    const d = await userRows(ids.denied);
    for (const action of splits[olds[2] || olds[0]]) assert.ok(d.includes(`${action}:0`), `compte, retiré : ${action}`);
    assert.ok(!d.some(x => x.endsWith(':1')), 'un droit retiré ne devient jamais un droit accordé');

    // Rejouer la migration ne change rien
    const before = JSON.stringify((await db('role_permissions').orderBy(['role', 'permission'])));
    await migration.up(db);
    assert.equal(JSON.stringify(await db('role_permissions').orderBy(['role', 'permission'])), before, 'idempotente');

    // down : les anciens droits reviennent
    await migration.down(db);
    const back = await perms(original);
    for (const old of olds) assert.ok(back.includes(old), `down : ${old}`);
    // achats:validate existait avant ce découpage (migration 20261130700000) : le retour arrière le garde
    for (const action of allActions.filter(a => !olds.includes(a) && a !== 'achats:validate')) assert.ok(!back.includes(action), `down : ${action} retiré`);
    assert.ok((await userRows(ids.granted)).includes(`${olds[1]}:1`));

    // Remise en état pour les tests suivants
    await db('role_permissions').del();
    await db.batchInsert('role_permissions', savedRoles, 100);
    await db('user_permissions').del();
    if (savedUsers.length) await db.batchInsert('user_permissions', savedUsers, 100);
    invalidate(db);
  });
}

// ─── Les rôles d'origine gardent leurs capacités ────────────────────────────
test('rôles d’origine : aucune capacité perdue, jamais une moitié de découpage', () => {
  // Un rôle qui a une action d'un découpage les a toutes (sauf les groupes de l'ancien catalogue déjà partiels par choix du 29/10)
  const previous = new Set(['leads:write', 'appointments:write', 'lots:status', 'sales:write', 'sales:clients', 'sales:read', 'leads:edit', 'projects:write', 'plans:write', 'content:write', 'media:write',
    'newsletter:write', 'users:write', 'demandes:dg', 'payments:write', 'documents:write', 'client_access:write', 'client_messages']);
  for (const [role, perms] of Object.entries(PERMISSIONS)) {
    if (role === 'super_admin') continue;
    for (const [from, to] of Object.entries(PERMISSION_SPLITS)) {
      if (previous.has(from)) continue;
      const n = to.filter(p => perms.includes(p)).length;
      assert.ok(n === 0 || n === to.length, `${role} : ${from} → ${to.join(', ')} (${n}/${to.length})`);
    }
  }
  const has = (role, ids) => ids.every(p => PERMISSIONS[role].includes(p));
  const hasNone = (role, ids) => ids.every(p => !PERMISSIONS[role].includes(p));
  const RH = NEW.RH;
  assert.ok(has('resp_exploitation', [...NEW['Service commercial'], ...NEW['Achats & stocks'], ...NEW.Administration, ...NEW.Juridique, ...NEW.SAV, ...RH.filter(p => !p.startsWith('self'))]));
  assert.ok(has('resp_exploitation', ['chantiers:create', 'chantiers:plan', 'chantiers:budget', 'chantiers:settings', 'chantiers:tma', 'settings:refs', 'settings:general', 'schedule:generate', 'schedule:edit', 'compta:read']));
  assert.ok(hasNone('resp_exploitation', ['chantiers:stages', 'chantiers:situations']), 'la validation en direction reste hors des rôles d’origine');
  assert.ok(has('conducteur_travaux', [...NEW['Achats & stocks'], 'vefa:read', 'vefa:write', 'presence:sheets', 'presence:kiosk', 'presence:correct', 'contrats:write', 'contrats:close', 'contrats:documents',
    ...NEW.Juridique, 'chantiers:create', 'chantiers:plan', 'chantiers:budget', 'chantiers:settings', 'chantiers:tma', 'sav:edit', 'sav:status', 'sav:comment', 'sav:delivery', 'sav:reserves', 'leads:all']));
  assert.ok(hasNone('conducteur_travaux', ['leads:assign', 'leads:transfer_decide', 'compta:entries', 'rh:files']), 'garde juridique et prospects inchangée : rien de plus');
  assert.ok(has('comptable', [...NEW.Comptabilité, ...NEW.Paie, ...RH, 'schedule:generate', 'schedule:edit', 'appro:locations', 'appro:needs', 'appro:quotes', 'appro:orders', 'appro:stock', 'appro:receive', 'appro:minimum']));
  assert.ok(hasNone('comptable', ['contrats:write', 'parc:write', 'chantiers:plan', 'leads:assign']));
  assert.ok(has('editeur', ['property:buildings', 'property:lots', 'settings:refs', 'settings:general']));
  assert.ok(hasNone('commercial', ['leads:assign', 'leads:transfer_decide', 'property:buildings', 'property:lots', 'vefa:read', 'vefa:write', 'settings:refs', 'schedule:generate', 'sav:edit', 'sav:all']));
  assert.ok(has('resp_exploitation', ['leads:assign', 'leads:transfer_decide']));
  for (const role of Object.keys(PERMISSIONS).filter(r => r !== 'super_admin')) assert.ok(has(role, ['self:conges', 'self:pointage', 'self:frais', 'self:vehicule', 'self:demandes']), role);
  // splitPermissions est stable (aucune action ne se redécoupe)
  const list = splitPermissions(['appro:write', 'sav:handle', 'rh:files']);
  assert.deepEqual(splitPermissions(list).sort(), list.sort());
});

// ─── Point 10 : pointages d'un compte sans « Voir le personnel » ────────────
test('pointages : un compte qui pointe sans rh:read ne voit et ne corrige que ses chantiers et son équipe', async () => {
  const project = await db('projects').where({ slug: 'ahoutoue' }).first();
  const emailA = await createUser(db, 'conducteur_travaux', 'conduc.a@test.ci');
  const emailB = await createUser(db, 'conducteur_travaux', 'conduc.b@test.ci');
  const idA = (await db('users').where({ email: emailA }).first()).id, idB = (await db('users').where({ email: emailB }).first()).id;
  const mine = (await admin.post(`${ERP}/chantiers`).send({ project_id: project.id, name: 'Chantier A', zone_kind: 'programme', manager_id: idA })).body;
  const theirs = (await admin.post(`${ERP}/chantiers`).send({ project_id: project.id, name: 'Chantier B', zone_kind: 'programme', manager_id: idB })).body;
  const ins = async n => { const r = (await db('employees').insert({ hire_date: '2024-01-01', job_title: 'Manœuvre', base_salary: 100000, department: 'technique', matricule: `P-${n}`, last_name: `Ouvrier${n}`, first_name: 'Test' }).returning('id'))[0]; return typeof r === 'object' ? r.id : r; };
  const [e1, e2, e3] = [await ins(1), await ins(2), await ins(3)];
  const today = new Date().toISOString().slice(0, 10);
  const sheet = (worksite_id, employee_id) => ({ date: today, worksite_id, rows: [{ employee_id, periods: [['08:00', '12:00']] }] });
  assert.equal((await admin.post(`${ERP}/rh/attendance/sheet`).send(sheet(mine.id, e1))).status, 201);
  assert.equal((await admin.post(`${ERP}/rh/attendance/sheet`).send(sheet(theirs.id, e2))).status, 201);

  const a = await login(app, emailA, PWD);
  // Le conducteur A pointe sur son chantier, pas sur celui de B
  assert.equal((await a.post(`${ERP}/rh/attendance/sheet`).send(sheet(mine.id, e3))).status, 201);
  const refused = await a.post(`${ERP}/rh/attendance/sheet`).send(sheet(theirs.id, e3));
  assert.equal(refused.status, 403, JSON.stringify(refused.body));
  // Liste : seulement les pointages de son chantier
  const list = (await a.get(`${ERP}/rh/attendance`)).body;
  assert.deepEqual([...new Set(list.map(x => x.employee_id))].sort(), [e1, e3].sort());
  assert.ok(list.every(x => x.worksite_id === mine.id));
  // Corriger ou supprimer le pointage d'un chantier de B : refusé ; le sien : accepté
  const other = await db('hr_attendances').where({ employee_id: e2 }).first();
  assert.equal((await a.delete(`${ERP}/rh/attendance/${other.id}`)).status, 403);
  assert.equal((await a.patch(`${ERP}/rh/attendance/${other.id}`).send({ note: 'correction' })).status, 403);
  const own = await db('hr_attendances').where({ employee_id: e1 }).first();
  assert.equal((await a.patch(`${ERP}/rh/attendance/${own.id}`).send({ note: 'Départ oublié', check_out: `${today}T12:30:00` })).status, 200);
  // Heures supplémentaires et pointages du jour : même périmètre
  const today_ = (await a.get(`${ERP}/rh/attendance/today`)).body;
  assert.ok([...today_.present, ...today_.done].every(x => x.worksite_id === mine.id));
  const ot = (await a.get(`${ERP}/rh/overtime`)).body;
  assert.ok(ot.rows.every(r => [e1, e3].includes(r.employee_id)), 'heures supplémentaires limitées au périmètre');
  // Le personnel RH (rh:read) voit tout
  const all = (await admin.get(`${ERP}/rh/attendance`)).body;
  assert.ok(all.some(x => x.employee_id === e2));
  // Liste des employés du /rh/meta : pas d'identifiant de compte pour qui n'a pas rh:read
  const meta = (await a.get(`${ERP}/rh/meta`)).body;
  assert.ok(meta.employees.length >= 3 && meta.employees.every(e => e.user_id === undefined));
});

// ─── B15 : import de prospects ──────────────────────────────────────────────
test('import de prospects : confier la liste à un collègue demande leads:assign (sinon le choix est ignoré) ; l’import ne complète pas la fiche d’un collègue', async () => {
  const sellerA = await login(app, await createUser(db, 'commercial', 'imp.a@test.ci'), PWD);
  const sellerB = await login(app, await createUser(db, 'commercial', 'imp.b@test.ci'), PWD);
  const idB = (await db('users').where({ email: 'imp.b@test.ci' }).first()).id;
  const idA = (await db('users').where({ email: 'imp.a@test.ci' }).first()).id;
  const rows = [{ name: 'Prospect importé', phone: '0799000001' }];
  // Sans leads:assign, confier la liste à un autre commercial est sans effet : les nouveaux prospects sont les siens
  let res = await sellerA.post('/api/admin/import').send({ mode: 'prospects', rows, dry_run: false, list: { name: 'Liste A', assigned_to: idB } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await db('leads').where({ phone: '0799000001' }).first()).assigned_to, idA);
  assert.equal((await db('lead_imports').where({ id: res.body.import_id }).first()).assigned_to, idA);
  // Avec leads:assign (le responsable), on confie la liste à B
  const resp = await agentWith(['leads:import', 'leads:assign', 'leads:all']);
  res = await resp.post('/api/admin/import').send({ mode: 'prospects', rows: [{ name: 'Prospect de B', phone: '0799000002' }], dry_run: false, list: { name: 'Liste B', assigned_to: idB } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await db('leads').where({ phone: '0799000002' }).first()).assigned_to, idB);
  // A réimporte la personne de B avec un e-mail de plus : la fiche de B n'est pas complétée, la ligne est refusée
  res = await sellerA.post('/api/admin/import').send({ mode: 'prospects', rows: [{ name: 'Prospect de B', phone: '0799000002', email: 'fuite@example.com', project: 'Ahoutoué' }], dry_run: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.errors, 1);
  assert.match(res.body.report[0].error, /déjà suivie par un autre commercial/);
  const lead = await db('leads').where({ phone: '0799000002' }).first();
  assert.equal(lead.email, null);
  assert.equal(lead.assigned_to, idB);
  assert.equal(lead.project_id, null);
  void sellerB;
});
