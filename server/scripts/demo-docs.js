/**
 * Données de démonstration des Documents internes et des Demandes internes (base de démo locale uniquement).
 *   DB_FILENAME=./data/demo.sqlite node scripts/demo-docs.js
 * Écrit directement en base (sans notification ni e-mail) : une note de service, une procédure en version 2, un PV
 * avec actions, un modèle ; des demandes à chaque étape du circuit.
 */
const { createDb } = require('../src/db');

const DAY = 24 * 3600 * 1000;
const ymd = days => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

(async () => {
  const db = createDb();
  if (process.env.NODE_ENV === 'production') throw new Error('Script réservé à la base de démo.');
  if ((await db('internal_docs').count({ n: '*' }))[0].n > 0) { console.log('Documents déjà présents.'); return db.destroy(); }
  const admin = await db('users').orderBy('id').first();
  const staff = (await db('employees as e').join('users as u', 'u.id', 'e.user_id').where({ 'e.active': true, 'u.active': true }).select('u.id', 'e.manager_id')).map(x => x.id);
  const id = r => (typeof r === 'object' ? r.id : r);
  const year = new Date().getUTCFullYear();
  const doc = async (d, readers = []) => {
    const [i] = await db('internal_docs').insert({ status: 'publie', published_at: new Date(Date.now() - 3 * DAY), author_id: admin.id, audience: 'tous', ...d });
    const docId = id(i);
    for (let v = 1; v <= (d.version || 1); v++) await db('internal_doc_versions').insert({ doc_id: docId, version: v, change_note: v > 1 ? 'Mise à jour des consignes de sécurité' : null, body: d.body, published_by: admin.id });
    const to = d.audience === 'personnes' ? JSON.parse(d.audience_users) : staff;
    for (const u of to) await db('internal_doc_recipients').insert({ doc_id: docId, user_id: u });
    for (const u of readers) await db('internal_doc_reads').insert({ doc_id: docId, version: d.version || 1, user_id: u });
    return docId;
  };

  await doc({ reference: `NS-${year}-0001`, kind: 'note', title: 'Horaires du bureau pendant les fêtes', body: 'Le siège fermera à 13 h les 24 et 31 décembre.\nLes chantiers suivent le planning communiqué par les conducteurs de travaux.', ack_deadline: ymd(4) }, staff.slice(0, 2));
  await doc({ reference: `PR-${year}-0001`, kind: 'procedure', title: 'Consignes de sécurité sur les chantiers', version: 2, body: '1. Port du casque et des chaussures de sécurité obligatoire.\n2. Accès interdit aux visiteurs non accompagnés.\n3. Tout incident est signalé au conducteur de travaux le jour même.', ack_deadline: ymd(-2) }, staff.slice(0, 1));
  const pvUsers = staff.slice(0, 3);
  const pv = await doc({ reference: `PV-${year}-0001`, kind: 'pv', title: 'Réunion de chantier n°12 — îlot 4', meeting_date: ymd(-2), audience: 'personnes', audience_users: JSON.stringify(pvUsers), body: 'Avancement du gros œuvre : 65 %.\nDécisions : renfort d’une équipe de coffrage ; commande des fers avant la fin de semaine.', ack_deadline: ymd(5) });
  await db('internal_doc_actions').insert([
    { doc_id: pv, label: 'Commander les fers HA12', owner_id: pvUsers[1] || admin.id, due_date: ymd(2) },
    { doc_id: pv, label: 'Recruter une équipe de coffrage', owner_id: pvUsers[0] || admin.id, due_date: ymd(-1) },
  ]);
  await doc({ reference: `MO-${year}-0001`, kind: 'modele', title: 'Ordre de mission (modèle)', ack_required: false, body: 'Modèle à compléter et à faire signer par le responsable avant tout déplacement.' });
  await db('internal_docs').insert({ reference: `NS-${year}-0002`, kind: 'note', title: 'Nouvelle organisation du standard', body: 'Brouillon en cours de rédaction.', status: 'brouillon', author_id: admin.id, audience: 'tous' });

  const requesters = await db('employees as e').join('users as u', 'u.id', 'e.user_id').where({ 'e.active': true }).select('u.id', 'e.manager_id').limit(4);
  const managerOf = async r => (r.manager_id ? (await db('employees').where({ id: r.manager_id }).first('user_id'))?.user_id || null : null);
  const req = async (n, r, d) => db('internal_requests').insert({ reference: `DI-${year}-${String(n).padStart(4, '0')}`, requested_by: r.id, manager_user_id: await managerOf(r), urgency: 'normale', ...d });
  if (requesters[0]) await req(1, requesters[0], { kind: 'achat', title: 'Ramettes de papier A4', quantity: '20 cartons', estimated_amount: 180000, status: 'attente_sg', location: 'Siège' });
  if (requesters[1]) await req(2, requesters[1], { kind: 'equipement', title: 'Groupe électrogène 30 kVA pour le chantier', estimated_amount: 9500000, status: 'attente_dg', urgency: 'urgente' });
  if (requesters[2]) await req(3, requesters[2], { kind: 'intervention', title: 'Climatisation de la salle de réunion en panne', status: 'en_cours', handled_by: admin.id, handled_at: new Date(), location: 'Salle de réunion' });
  if (requesters[0]) await req(4, requesters[0], { kind: 'materiel', title: 'Prêt d’un vidéoprojecteur', status: 'traitee', handled_by: admin.id, closed_at: new Date(), decision_note: 'Remis au service commercial' });
  // Rien ne part de la démo : relances de lecture et d'actions marquées envoyées (clés du centre de notifications)
  const mark = async (userId, key) => {
    if (userId && !(await db('notifications').where({ user_id: userId, dedupe_key: key }).first())) {
      await db('notifications').insert({ user_id: userId, module: 'rh', event: 'demo', title: 'Relance (démo)', dedupe_key: key, read_at: new Date() });
    }
  };
  for (const d of await db('internal_docs').where({ status: 'publie' })) {
    for (const r of await db('internal_doc_recipients').where({ doc_id: d.id })) for (const k of ['veille', 'retard']) await mark(r.user_id, `doc:${d.id}:v${d.version}:${k}`);
    await mark(d.author_id, `doc:${d.id}:v${d.version}:auteur-retard`);
  }
  for (const a of await db('internal_doc_actions as a').join('internal_docs as d', 'd.id', 'a.doc_id').select('a.id', 'a.owner_id', 'd.author_id')) {
    for (const k of ['veille', 'retard']) { await mark(a.owner_id, `pvaction:${a.id}:${k}`); await mark(a.author_id, `pvaction:${a.id}:${k}`); }
  }
  console.log('Documents et demandes de démonstration enregistrés.');
  await db.destroy();
})().catch(e => { console.error(e); process.exit(1); });
