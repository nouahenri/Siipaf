/**
 * ERP · QHSE (Qualité, Hygiène, Sécurité, Environnement) : contrôles journaliers et hebdomadaires par chantier, inspections et
 * audits avec constats, plan d'actions correctives, grilles de points de contrôle réglables, photos, ouvriers ne respectant pas
 * les consignes (remarque sécurité de la fiche employé). Pilotes : Direction générale, RH, directeur des exploitations, conducteur.
 * Attribution des droits : conducteur de travaux = consulter + saisir ; directeur des exploitations et rôle « Responsable QHSE »
 * = tout sauf les réglages ; rôles qui règlent les Ressources humaines = consulter + tous les chantiers + valider.
 * Sans clé étrangère vers les tables des autres modules pour les liens « souples » (réclamation SAV, fichiers).
 */
const ROLE = { id: 'resp_qhse', label: 'Responsable QHSE', description: 'Suit la qualité, l’hygiène, la sécurité et l’environnement de tous les chantiers : contrôles, audits, actions correctives, validations' };
const FULL = ['qhse:read', 'qhse:control', 'qhse:all', 'qhse:audit', 'qhse:actions', 'qhse:validate']; // tout sauf les réglages (Direction générale)
const PERMISSIONS = [...FULL, 'qhse:settings'];

const DEFAULT_CHECKPOINTS = {
  qualite: [
    'Qualité des matériaux livrés et stockés (conformité aux commandes, stockage à l’abri)',
    'Conformité des ouvrages aux plans et aux prescriptions',
    'Qualité d’exécution : alignements, aplombs, niveaux',
    'Ferraillage, coffrage et mise en œuvre du béton',
    'Maçonnerie, enduits et finitions',
    'Qualité et état du matériel et des outils',
  ],
  hygiene: [
    'Propreté générale du chantier et des voies de circulation',
    'Rangement des matériaux et des outils',
    'Sanitaires et vestiaires des ouvriers (propreté, eau)',
    'Zone de repas et eau potable',
    'Évacuation régulière des gravats et des emballages',
  ],
  securite: [
    'Balisage et signalisation des zones dangereuses',
    'Clôture du chantier et accès contrôlés',
    'Échafaudages montés, stables et vérifiés',
    'Garde-corps et protections contre les chutes',
    'Extincteurs présents, accessibles et vérifiés',
    'Trousse de premiers secours disponible',
    'Installations électriques provisoires protégées',
    'Engins et machines conformes, conducteurs habilités',
    'Produits dangereux stockés correctement',
  ],
  environnement: [
    'Déchets triés et évacués',
    'Poussière maîtrisée (arrosage, bâchage)',
    'Bruit limité (horaires, matériel)',
    'Eaux usées et eaux de lavage non rejetées dans le milieu',
    'Hydrocarbures et huiles : bacs de rétention, aucune fuite',
    'Produits chimiques stockés et éliminés correctement',
    'Arbres, sols et cours d’eau protégés',
    'Aucun brûlage de déchets',
  ],
};

exports.up = async function (knex) {
  // Grilles de points de contrôle de chaque volet (réglables), communes aux contrôles et aux audits
  await knex.schema.createTable('qhse_checkpoints', t => {
    t.increments('id');
    t.string('pillar', 14).notNullable(); // qualite, hygiene, securite, environnement
    t.string('label', 200).notNullable();
    t.integer('sort').notNullable().defaultTo(0);
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index(['pillar', 'sort']);
  });

  // Contrôle d'un chantier : un par jour (journalier) ou par semaine (hebdomadaire, daté du lundi)
  await knex.schema.createTable('qhse_controls', t => {
    t.increments('id');
    t.integer('worksite_id').unsigned().notNullable().references('worksites.id').onDelete('CASCADE');
    t.string('kind', 14).notNullable(); // journalier, hebdomadaire
    t.date('period_start').notNullable(); // le jour, ou le lundi de la semaine
    t.string('status', 12).notNullable().defaultTo('saisi'); // saisi | brouillon, a_valider, valide
    t.tinyint('rating_qualite').unsigned(); // 1 Mauvais … 4 Très bon
    t.tinyint('rating_hygiene').unsigned();
    t.integer('workers_present').unsigned(); // sécurité : ouvriers présents (proposés depuis les pointages)
    t.integer('workers_compliant').unsigned(); // ouvriers respectant les consignes (EPI, consignes)
    t.integer('safety_pct'); // workers_compliant / workers_present, en %
    t.integer('site_safety_pct'); // conformité des points de contrôle de la sécurité du chantier
    t.integer('env_rate'); // conformité des points de contrôle de l'environnement
    t.text('remark_qualite');
    t.text('remark_hygiene');
    t.text('remark_securite');
    t.text('remark_environnement');
    t.text('observations'); // hebdomadaire : observations de la semaine
    t.json('summary'); // hebdomadaire : moyennes et tendances au moment de la dernière mise à jour
    t.string('reject_reason', 500);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.integer('updated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('submitted_at');
    t.integer('validated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('validated_at');
    t.timestamps(true, true);
    t.unique(['worksite_id', 'kind', 'period_start']);
    t.index(['period_start']);
    t.index(['status']);
  });

  // Points de contrôle renseignés (contrôles et audits) : intitulé conservé tel qu'il était à la saisie
  await knex.schema.createTable('qhse_items', t => {
    t.increments('id');
    t.string('owner_kind', 10).notNullable(); // controle, audit
    t.integer('owner_id').unsigned().notNullable();
    t.string('pillar', 14).notNullable();
    t.integer('checkpoint_id').unsigned();
    t.string('label', 200).notNullable();
    t.tinyint('rating').unsigned(); // qualité, hygiène : 1 à 4
    t.string('answer', 14); // sécurité, environnement : conforme, non_conforme, sans_objet
    t.string('remark', 300);
    t.integer('sort').notNullable().defaultTo(0);
    t.index(['owner_kind', 'owner_id']);
  });

  // Ouvriers ne respectant pas les consignes de sécurité (remarque visible sur la fiche employé)
  await knex.schema.createTable('qhse_workers', t => {
    t.increments('id');
    t.integer('control_id').unsigned().notNullable().references('qhse_controls.id').onDelete('CASCADE');
    t.integer('employee_id').unsigned().references('employees.id').onDelete('SET NULL');
    t.string('name', 160).notNullable();
    t.string('issue', 300);
    t.index(['control_id']);
    t.index(['employee_id']);
  });

  // Photos des contrôles, audits, constats et preuves de levée (privées : servies après contrôle des droits)
  await knex.schema.createTable('qhse_files', t => {
    t.increments('id');
    t.string('owner_kind', 10).notNullable(); // controle, audit, constat, action
    t.integer('owner_id').unsigned().notNullable();
    t.string('purpose', 10).notNullable().defaultTo('photo'); // photo, preuve
    t.string('filename', 255).notNullable();
    t.string('original_name', 255);
    t.string('mime', 60);
    t.integer('size').unsigned();
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['owner_kind', 'owner_id']);
  });

  await knex.schema.createTable('qhse_audits', t => {
    t.increments('id');
    t.string('reference', 20).notNullable().unique(); // AUD-2026-0001
    t.string('kind', 10).notNullable().defaultTo('planifie'); // planifie, inopine
    t.string('status', 10).notNullable().defaultTo('planifie'); // planifie, en_cours, a_valider, valide, annule
    t.string('place_kind', 10).notNullable().defaultTo('chantier'); // chantier, siege
    t.integer('worksite_id').unsigned().references('worksites.id').onDelete('SET NULL');
    t.string('place_label', 160);
    t.integer('auditor_id').unsigned().references('users.id').onDelete('SET NULL');
    t.string('auditor_name', 120); // auditeur extérieur
    t.date('planned_on');
    t.date('done_on');
    t.string('objective', 300);
    t.text('summary');
    t.tinyint('rating_qualite').unsigned();
    t.tinyint('rating_hygiene').unsigned();
    t.integer('safety_rate'); // conformité des points de sécurité
    t.integer('env_rate');
    t.integer('score_pct');
    t.string('reject_reason', 500);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('submitted_at');
    t.integer('validated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('validated_at');
    t.timestamps(true, true);
    t.index(['status']);
    t.index(['worksite_id']);
  });

  await knex.schema.createTable('qhse_findings', t => {
    t.increments('id');
    t.integer('audit_id').unsigned().notNullable().references('qhse_audits.id').onDelete('CASCADE');
    t.string('pillar', 14).notNullable();
    t.string('description', 500).notNullable();
    t.string('gravity', 10).notNullable().defaultTo('mineure'); // mineure, majeure, critique
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['audit_id']);
  });

  await knex.schema.createTable('qhse_actions', t => {
    t.increments('id');
    t.string('reference', 20).notNullable().unique(); // QHSE-2026-0001
    t.string('title', 200).notNullable();
    t.text('description');
    t.string('pillar', 14);
    t.string('gravity', 10).notNullable().defaultTo('mineure');
    t.string('source_kind', 10).notNullable().defaultTo('manuelle'); // controle, audit, sav, manuelle
    t.integer('control_id').unsigned();
    t.integer('audit_id').unsigned();
    t.integer('finding_id').unsigned();
    t.integer('worksite_id').unsigned();
    t.integer('sav_ticket_id').unsigned(); // réclamation qualité liée
    t.integer('owner_id').unsigned().references('users.id').onDelete('SET NULL');
    t.date('due_on');
    t.string('status', 10).notNullable().defaultTo('ouverte'); // ouverte, en_cours, levee, annulee
    t.date('lifted_on');
    t.string('lifted_note', 1000); // preuve de levée (texte ; photos dans qhse_files)
    t.integer('lifted_by').unsigned().references('users.id').onDelete('SET NULL');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['status', 'due_on']);
    t.index(['worksite_id']);
    t.index(['owner_id']);
    t.index(['sav_ticket_id']);
  });

  // Grilles par défaut
  const rows = [];
  for (const [pillar, labels] of Object.entries(DEFAULT_CHECKPOINTS)) labels.forEach((label, i) => rows.push({ pillar, label, sort: i + 1, active: true }));
  await knex.batchInsert('qhse_checkpoints', rows, 50);

  // Rôle « Responsable QHSE » et droits
  if (!(await knex.schema.hasTable('role_permissions'))) return;
  if (!(await knex('roles').where({ id: ROLE.id }).first())) {
    const last = await knex('roles').max({ s: 'sort' }).first();
    await knex('roles').insert({ ...ROLE, system: false, sort: Number(last?.s || 0) + 1 });
  }
  const grant = async (role, perms) => {
    if (!(await knex('roles').where({ id: role }).first())) return;
    for (const permission of perms) {
      if (!(await knex('role_permissions').where({ role, permission }).first())) await knex('role_permissions').insert({ role, permission });
    }
  };
  await grant('conducteur_travaux', ['qhse:read', 'qhse:control']);
  await grant('resp_exploitation', FULL);
  await grant(ROLE.id, FULL);
  // Rôles qui règlent les Ressources humaines : consulter, tous les chantiers, valider
  const hr = await knex('role_permissions').whereIn('permission', ['rh:settings', 'rh:rules']).distinct('role');
  for (const { role } of hr) if (role !== 'super_admin') await grant(role, ['qhse:read', 'qhse:all', 'qhse:validate']);
};

exports.down = async function (knex) {
  for (const table of ['qhse_actions', 'qhse_findings', 'qhse_audits', 'qhse_files', 'qhse_workers', 'qhse_items', 'qhse_controls', 'qhse_checkpoints']) {
    await knex.schema.dropTableIfExists(table);
  }
  for (const table of ['role_permissions', 'user_permissions']) {
    if (await knex.schema.hasTable(table)) await knex(table).whereIn('permission', PERMISSIONS).del();
  }
  await knex('app_settings').where('key', 'like', 'qhse_%').del().catch(() => {});
  // Le rôle créé pour le client disparaît s'il n'est plus attribué ; sinon il reste (sans les droits du module)
  if (await knex.schema.hasTable('roles')) {
    if (!(await knex('users').where({ role: ROLE.id }).first())) {
      await knex('role_permissions').where({ role: ROLE.id }).del();
      await knex('roles').where({ id: ROLE.id }).del();
    }
  }
};
