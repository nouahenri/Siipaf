const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, createUser } = require('./helpers');

// Pièce d'identité recto et verso dans la fiche employé (demande du client du 02/11) : PDF, PNG ou JPG, une pièce par face
let db, app, expl, editeur, employee;
const R = '/api/admin/erp/rh';
const pdf = Buffer.from('%PDF-1.4 pièce');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

before(async () => {
  ({ db, app } = await setup());
  expl = await login(app, await createUser(db, 'resp_exploitation'), 'motdepasse-test-123');
  editeur = await login(app, await createUser(db, 'editeur'), 'motdepasse-test-123');
  employee = (await expl.post(`${R}/employees`).send({ last_name: 'Kouadio', first_name: 'Ama', job_title: 'Assistante', department: 'administratif', hire_date: '2026-11-03' })).body;
});
after(() => db.destroy());

test('recto et verso : formats PDF, PNG, JPG, une pièce par face, remplacée au nouvel envoi', async () => {
  const put = (side, buf, name, type) => expl.put(`${R}/employees/${employee.id}/identity/${side}`).attach('file', buf, { filename: name, contentType: type });
  assert.equal((await put('recto', Buffer.from('texte'), 'cni.txt', 'text/plain')).status, 400, 'format refusé');
  assert.equal((await put('recto', Buffer.from('PK'), 'cni.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).status, 400, 'Word refusé pour la pièce d’identité');
  let res = await put('recto', pdf, 'cni-recto.pdf', 'application/pdf');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.recto.original_name, 'cni-recto.pdf');
  assert.equal(res.body.verso, null);
  res = await put('verso', png, 'cni-verso.png', 'image/png');
  assert.equal(res.body.verso.mime, 'image/png');
  res = await put('recto', png, 'cni-recto-net.png', 'image/png');
  assert.equal(res.body.recto.original_name, 'cni-recto-net.png', 'recto remplacé');
  assert.equal((await db('hr_documents').where({ employee_id: employee.id, kind: 'cni_recto' })).length, 1, 'une seule pièce par face');
  // Consultation par la route privée des documents ; aperçu dans le dossier (onglet Documents)
  const file = await expl.get(res.body.recto.url);
  assert.equal(file.status, 200);
  const identity = (await expl.get(`${R}/employees/${employee.id}/identity`)).body;
  assert.equal(identity.can_write, true);
  assert.equal(identity.can_view, true);
  assert.ok((await expl.get(`${R}/employees/${employee.id}`)).body.documents.some(d => d.kind === 'cni_verso' && d.label === 'Pièce d’identité (verso)'));
});

test('droits : dépôt réservé à « Joindre et supprimer des pièces » ; retrait d’une face', async () => {
  assert.equal((await editeur.put(`${R}/employees/${employee.id}/identity/recto`).attach('file', pdf, { filename: 'x.pdf', contentType: 'application/pdf' })).status, 403);
  assert.equal((await editeur.get(`${R}/employees/${employee.id}/identity`)).status, 403);
  assert.equal((await expl.put(`${R}/employees/${employee.id}/identity/dos`).attach('file', pdf, { filename: 'x.pdf', contentType: 'application/pdf' })).status, 404, 'face inconnue');
  const res = await expl.delete(`${R}/employees/${employee.id}/identity/verso`);
  assert.equal(res.status, 200);
  assert.equal(res.body.verso, null);
  assert.ok(res.body.recto, 'le recto reste');
});

test('type de pièce et fichier unique : un seul fichier remplace recto et verso, et inversement', async () => {
  let res = await expl.patch(`${R}/employees/${employee.id}`).send({ id_type: 'passeport', id_number: 'P1234567' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await db('employees').where({ id: employee.id }).first()).id_type, 'passeport');
  assert.equal((await expl.patch(`${R}/employees/${employee.id}`).send({ id_type: 'carte_bancaire' })).status, 400, 'type inconnu');
  assert.equal((await expl.get('/api/admin/erp/paie/meta')).body.id_types.passeport.single, true);
  const put = (side, buf, name, type) => expl.put(`${R}/employees/${employee.id}/identity/${side}`).attach('file', buf, { filename: name, contentType: type });
  res = await put('complet', pdf, 'passeport.pdf', 'application/pdf');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.complet.original_name, 'passeport.pdf');
  assert.equal(res.body.recto, null, 'le fichier unique remplace le recto');
  res = await put('verso', png, 'verso.png', 'image/png');
  assert.equal(res.body.complet, null, 'une face séparée remplace le fichier unique');
  assert.equal(res.body.verso.original_name, 'verso.png');
  assert.equal((await db('hr_documents').where({ employee_id: employee.id }).whereIn('kind', ['cni_complet', 'cni_recto', 'cni_verso'])).length, 1);
});
