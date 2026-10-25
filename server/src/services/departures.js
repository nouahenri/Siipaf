/**
 * Départ d'un employé (case « En poste » décochée) — docs/analyse-liaisons-inter-services.md §3 M : son compte du
 * dashboard, le matériel du parc qu'il détient, les dossiers qu'il suit dans chaque module, son équipe. Rien n'est
 * désactivé ni réaffecté d'office (le compte sert aussi au dashboard : décision humaine) ; le bilan liste ce qui reste
 * à régler avec un lien vers chaque écran, et prévient ceux qui le règlent.
 */
const { isoDay } = require('../lib/http');
const { SAV_OPEN_STATUSES } = require('../lib/domain');
const { notify, usersWith, inform } = require('./notifications');

const n = async q => Number((await q.count({ n: '*' }).first()).n || 0);

async function departureReport(db, e) {
  const userId = e.user_id;
  const account = userId ? await db('users').where({ id: userId }).first('id', 'name', 'email', 'role', 'active') : null;
  const [assets, team] = await Promise.all([
    db('assets').where({ employee_id: e.id }).whereNot('status', 'reforme').orderBy('code').select('id', 'code', 'name', 'plate'),
    db('employees').where({ manager_id: e.id, active: true }).orderBy('last_name').select('id', 'last_name', 'first_name'),
  ]);
  // Dossiers suivis par son compte, module par module (seulement ce qui est encore ouvert)
  const items = [];
  if (userId) {
    const now = new Date();
    const counts = await Promise.all([
      n(db('leads').where({ assigned_to: userId }).whereNot('stage', 'perdu')),
      n(db('appointments').where({ assigned_to: userId }).whereIn('status', ['demande', 'confirme']).where('starts_at', '>=', now)),
      n(db('lead_activities').where({ assigned_to: userId }).whereNull('done_at')),
      n(db('sav_tickets').where({ assigned_to: userId }).whereIn('status', SAV_OPEN_STATUSES)),
      n(db('mail_items').where({ assigned_to: userId, status: 'affecte' })),
      n(db('contracts').where({ owner_id: userId, status: 'actif' })),
      n(db('assets').where({ manager_id: userId }).whereNot('status', 'reforme')),
      n(db('internal_doc_actions').where({ owner_id: userId, status: 'a_faire' })),
      n(db('internal_requests').where({ manager_user_id: userId, status: 'attente_responsable' })),
    ]);
    const defs = [
      ['leads', 'Prospects et clients suivis', '/commercial/pipeline'],
      ['appointments', 'Rendez-vous à venir', '/commercial/rendez-vous'],
      ['activities', 'Activités commerciales à faire', '/commercial/activites'],
      ['sav', 'Réclamations SAV confiées', '/sav/reclamations'],
      ['courrier', 'Courriers à traiter', '/administration/courrier'],
      ['contrats', 'Contrats dont il ou elle est responsable', '/administration/contrats'],
      ['parc', 'Biens du parc dont il ou elle reçoit les alertes', '/administration/parc'],
      ['actions', 'Actions de réunion à faire', '/administration/documents'],
      ['demandes', 'Demandes internes à valider', '/administration/demandes'],
    ];
    defs.forEach(([key, label, link], i) => { if (counts[i]) items.push({ key, label, count: counts[i], link }); });
  }
  if (team.length) items.push({ key: 'equipe', label: 'Employés dont il ou elle est le responsable direct', count: team.length, link: '/rh/personnel', names: team.map(t => `${t.last_name} ${t.first_name}`) });
  const accountOpen = !!account?.active;
  return {
    employee: { id: e.id, name: `${e.last_name} ${e.first_name}`, active: !!e.active, end_date: isoDay(e.end_date) },
    account: account && { ...account, active: !!account.active },
    assets, items,
    pending: (accountOpen ? 1 : 0) + assets.length + items.reduce((t, x) => t + x.count, 0),
  };
}

/** Sortie enregistrée : chacun est prévenu de ce qu'il a à régler (compte, matériel, dossiers à réaffecter). */
async function notifyDeparture(db, e, { user }) {
  const r = await departureReport(db, e);
  const who = r.employee.name;
  const key = `depart:${e.id}:${r.employee.end_date || isoDay(new Date())}`;
  const link = `/rh/personnel/${e.id}`;
  // Circuit d'information : Comptabilité (solde de tout compte) par défaut ; la Direction, les services généraux et
  // l'administrateur des comptes reçoivent ci-dessous ce qu'ils ont à régler
  await inform(db, 'rh.depart', {
    except: user.id, key: `${key}:info`, link,
    title: `Départ de ${who}${r.employee.end_date ? ` le ${new Date(r.employee.end_date).toLocaleDateString('fr-FR')}` : ''}`,
    body: [r.assets.length ? `${r.assets.length} bien(s) du parc à récupérer` : null, r.items.length ? 'dossiers à réaffecter' : null].filter(Boolean).join(' · ') || null,
  });
  if (r.account?.active) {
    await notify(db, {
      to: await usersWith(db, 'users:write'), except: user.id, module: 'rh', event: 'depart.compte', priority: 'action',
      title: `Départ de ${who} : compte encore actif`, body: `${r.account.email} — à désactiver dans Comptes utilisateurs une fois ses dossiers repris`, link, key: `${key}:compte`,
    });
  }
  if (r.assets.length) {
    await notify(db, {
      to: await usersWith(db, 'parc:write'), except: user.id, module: 'administration', event: 'depart.materiel', priority: 'action',
      title: `Départ de ${who} : matériel à récupérer`, body: r.assets.map(a => `${a.code} ${a.name}`).join(', '), link, key: `${key}:materiel`,
    });
  }
  if (r.items.length) {
    await notify(db, {
      to: await usersWith(db, ['direction:read', 'rh:files']), except: user.id, module: 'rh', event: 'depart.dossiers', priority: 'action',
      title: `Départ de ${who} : dossiers à réaffecter`, body: r.items.map(x => `${x.count} ${x.label.toLowerCase()}`).join(' · '), link, key: `${key}:dossiers`,
    });
  }
  return r;
}

module.exports = { departureReport, notifyDeparture };
