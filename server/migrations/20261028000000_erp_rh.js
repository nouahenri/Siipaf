/**
 * ERP · RH (applications de référence d'Odoo : Employés, Congés, Présences, Notes de frais, Recrutement,
 * Évaluations, Compétences et formations) : dossiers du personnel (documents, carrière), congés et absences
 * (demandes, approbations, soldes, jours fériés), pointage et heures supplémentaires, notes de frais passées en
 * comptabilité, recrutement, objectifs et entretiens annuels, compétences et formations.
 * Réutilise la table `employees` de la paie.
 */
const { PERMISSIONS, RH_ACTIONS, SELF_SERVICE } = require('../src/lib/domain');

// Droits par action du module RH (rôles d'origine, selon leurs droits par défaut)
const NEW_PERMISSIONS = [...RH_ACTIONS, 'presence:write'];
const NEW_ACCOUNTS = [
  ['422100', 'Personnel, frais à rembourser', 'employe'], ['6053', 'Fournitures non stockables — carburant et autres énergies'],
  ['6056', 'Achats de petit matériel et outillage'], ['6181', 'Voyages et déplacements'], ['638', 'Autres charges externes'],
  ['6381', 'Frais de recrutement du personnel'], ['6383', 'Réceptions'], ['6384', 'Missions'],
];
// Référentiel de départ des compétences : [niveaux du plus faible au plus élevé, compétences]
const SKILLS = {
  'Langues': [['Débutant', 'Intermédiaire', 'Courant', 'Bilingue'], ['Français', 'Anglais']],
  'Logiciels': [['Notions', 'Utilisateur', 'Avancé', 'Expert'], ['Excel', 'Word', 'AutoCAD', 'Sage', 'MS Project']],
  'Métiers du bâtiment': [['Apprenti', 'Ouvrier', 'Qualifié', 'Chef d’équipe'], ['Maçonnerie', 'Ferraillage', 'Coffrage', 'Électricité', 'Plomberie', 'Carrelage', 'Peinture', 'Menuiserie', 'Topographie', 'Conduite de travaux']],
  'Commercial et gestion': [['Notions', 'Pratique', 'Maîtrise', 'Expert'], ['Négociation commerciale', 'Relation client', 'Droit foncier', 'Comptabilité SYSCOHADA', 'Paie']],
  'Habilitations et permis': [['Formé', 'Habilité', 'Formateur', 'Référent'], ['Habilitation électrique', 'Travail en hauteur', 'Conduite d’engins', 'Permis B', 'Permis C', 'Secourisme du travail']],
};

exports.up = async function (knex) {
  await knex.schema.alterTable('employees', t => {
    t.integer('manager_id').unsigned(); // responsable direct (employé) : premier niveau d'approbation des congés
    t.date('trial_end_date');
    t.decimal('leave_opening_days', 6, 2); // solde de congés repris à la mise en service
    t.date('leave_opening_date');
    t.string('birth_place', 80);
    t.string('emergency_contact', 160);
    t.string('attendance_pin_hash', 120); // code personnel pour la borne de pointage
  });

  await knex.schema.createTable('hr_holidays', t => {
    t.increments('id');
    t.date('date').notNullable().unique();
    t.string('label', 80).notNullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('hr_documents', t => {
    t.increments('id');
    t.integer('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.string('kind', 20).notNullable().defaultTo('autre');
    t.string('label', 160).notNullable();
    t.string('filename', 120).notNullable();
    t.string('original_name', 255);
    t.string('mime', 100);
    t.integer('size').unsigned();
    t.date('expires_at'); // pièce d'identité, titre de séjour, CDD…
    t.integer('uploaded_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('hr_leaves', t => {
    t.increments('id');
    t.integer('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.string('type', 24).notNullable();
    t.string('event', 30); // permission exceptionnelle : événement familial
    t.date('start_date').notNullable();
    t.date('end_date').notNullable();
    t.boolean('start_half').notNullable().defaultTo(false); // commence l'après-midi
    t.boolean('end_half').notNullable().defaultTo(false); // finit à midi
    t.decimal('days', 6, 2).notNullable(); // jours décomptés (ouvrables ou calendaires selon le type)
    t.integer('calendar_days').unsigned().notNullable();
    t.string('status', 20).notNullable().defaultTo('en_attente');
    t.string('reason', 500);
    t.integer('document_id').unsigned().references('hr_documents.id').onDelete('SET NULL'); // justificatif
    t.integer('requested_by').unsigned().references('users.id').onDelete('SET NULL');
    t.integer('manager_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('manager_at');
    t.integer('decided_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('decided_at');
    t.string('decision_note', 500);
    t.timestamps(true, true);
    t.index(['employee_id', 'start_date']);
  });

  await knex.schema.createTable('hr_leave_adjustments', t => {
    t.increments('id');
    t.integer('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.date('date').notNullable();
    t.decimal('days', 6, 2).notNullable(); // + jours accordés, − jours retirés
    t.string('label', 200).notNullable();
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('hr_career_events', t => {
    t.increments('id');
    t.integer('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.date('date').notNullable();
    t.string('kind', 20).notNullable();
    t.string('label', 255).notNullable();
    t.json('details'); // valeurs avant / après (poste, salaire, service, contrat)
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('hr_objectives', t => {
    t.increments('id');
    t.integer('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.integer('year').unsigned().notNullable();
    t.string('title', 200).notNullable();
    t.string('description', 1000);
    t.string('metric', 20).notNullable().defaultTo('manuel');
    t.bigInteger('target_value'); // indicateur chiffré (FCFA, nombre)
    t.tinyint('weight').unsigned().notNullable().defaultTo(1);
    t.tinyint('progress').unsigned().notNullable().defaultTo(0); // % (suivi manuel)
    t.string('status', 14).notNullable().defaultTo('en_cours');
    t.date('due_date');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  // Historique de l'avancement des objectifs suivis à la main (courbes de performance)
  await knex.schema.createTable('hr_objective_checkins', t => {
    t.increments('id');
    t.integer('objective_id').unsigned().notNullable().references('hr_objectives.id').onDelete('CASCADE');
    t.date('date').notNullable();
    t.tinyint('progress').unsigned().notNullable();
    t.integer('user_id').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['objective_id', 'date']);
  });

  await knex.schema.createTable('hr_reviews', t => {
    t.increments('id');
    t.integer('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.integer('year').unsigned().notNullable();
    t.string('status', 12).notNullable().defaultTo('brouillon'); // brouillon, finalise
    t.tinyint('rating').unsigned();
    t.text('self_comment');
    t.text('manager_comment');
    t.string('strengths', 1000);
    t.string('improvements', 1000);
    t.string('training_needs', 1000);
    t.integer('reviewer_id').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('finalized_at');
    t.timestamps(true, true);
    t.unique(['employee_id', 'year']);
  });

  // ─── Présences ────────────────────────────────────────────
  await knex.schema.createTable('hr_attendances', t => {
    t.increments('id');
    t.integer('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.timestamp('check_in').notNullable();
    t.timestamp('check_out');
    t.string('source', 12).notNullable().defaultTo('web'); // web, borne, feuille (chantier), manuel
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL'); // lieu : chantier ou siège
    t.decimal('latitude', 9, 6);
    t.decimal('longitude', 9, 6);
    t.string('note', 255);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['employee_id', 'check_in']);
  });
  // Heures supplémentaires d'un mois arrêtées par le service RH et reprises dans la paie
  await knex.schema.createTable('hr_overtime', t => {
    t.increments('id');
    t.integer('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.string('period', 7).notNullable();
    t.json('hours'); // heures par tranche de majoration
    t.bigInteger('amount').notNullable().defaultTo(0);
    t.integer('approved_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('approved_at');
    t.timestamps(true, true);
    t.unique(['employee_id', 'period']);
  });

  // ─── Notes de frais ───────────────────────────────────────
  await knex.schema.createTable('hr_expenses', t => {
    t.increments('id');
    t.string('reference', 20).unique(); // NDF-2026-0001
    t.integer('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.date('date').notNullable();
    t.string('category', 20).notNullable();
    t.string('label', 200).notNullable();
    t.bigInteger('amount').notNullable(); // TTC
    t.decimal('vat_rate', 4, 2).notNullable().defaultTo(0);
    t.string('paid_by', 10).notNullable().defaultTo('employe'); // employe (à rembourser), societe (caisse, carte)
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL'); // analytique
    t.string('receipt_filename', 120);
    t.string('receipt_name', 255);
    t.string('receipt_mime', 100);
    t.string('status', 14).notNullable().defaultTo('brouillon'); // brouillon, soumise, approuvee, comptabilisee, remboursee, refusee
    t.integer('approved_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('approved_at');
    t.string('refusal_reason', 500);
    t.integer('entry_id').unsigned().references('acc_entries.id').onDelete('SET NULL');
    t.date('paid_at');
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['employee_id', 'status']);
  });

  // ─── Recrutement ──────────────────────────────────────────
  await knex.schema.createTable('hr_jobs', t => {
    t.increments('id');
    t.string('title', 160).notNullable();
    t.string('department', 20).notNullable().defaultTo('administratif');
    t.integer('project_id').unsigned().references('projects.id').onDelete('SET NULL');
    t.string('contract_type', 12).notNullable().defaultTo('cdi');
    t.tinyint('openings').unsigned().notNullable().defaultTo(1);
    t.string('location', 120);
    t.text('description');
    t.string('status', 10).notNullable().defaultTo('ouvert'); // ouvert, pourvu, ferme
    t.boolean('published').notNullable().defaultTo(false); // visible sur le site (page carrières)
    t.integer('recruiter_id').unsigned().references('users.id').onDelete('SET NULL');
    t.date('closing_date');
    t.timestamps(true, true);
  });
  await knex.schema.createTable('hr_applicants', t => {
    t.increments('id');
    t.integer('job_id').unsigned().references('hr_jobs.id').onDelete('SET NULL'); // nul : candidature spontanée
    t.string('name', 160).notNullable();
    t.string('email', 190);
    t.string('phone', 40);
    t.string('source', 20).notNullable().defaultTo('autre');
    t.string('stage', 20).notNullable().defaultTo('nouveau');
    t.tinyint('rating').unsigned().notNullable().defaultTo(0); // 0 à 3 étoiles
    t.bigInteger('expected_salary');
    t.bigInteger('proposed_salary');
    t.date('available_from');
    t.string('cv_filename', 120);
    t.string('cv_name', 255);
    t.string('cv_mime', 100);
    t.text('message'); // lettre ou message reçu du site
    t.integer('interviewer_id').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('interview_at');
    t.string('refuse_reason', 20);
    t.integer('employee_id').unsigned().references('employees.id').onDelete('SET NULL'); // fiche créée à l'embauche
    t.timestamps(true, true);
    t.index(['job_id', 'stage']);
  });
  await knex.schema.createTable('hr_applicant_logs', t => {
    t.increments('id');
    t.integer('applicant_id').unsigned().notNullable().references('hr_applicants.id').onDelete('CASCADE');
    t.string('kind', 12).notNullable(); // etape, note, entretien
    t.string('summary', 255).notNullable();
    t.text('note');
    t.integer('user_id').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ─── Compétences et formations ────────────────────────────
  await knex.schema.createTable('hr_skill_types', t => {
    t.increments('id');
    t.string('name', 80).notNullable().unique();
    t.json('levels').notNullable(); // libellés des niveaux, du plus faible au plus élevé
  });
  await knex.schema.createTable('hr_skills', t => {
    t.increments('id');
    t.integer('type_id').unsigned().notNullable().references('hr_skill_types.id').onDelete('CASCADE');
    t.string('name', 80).notNullable();
    t.unique(['type_id', 'name']);
  });
  await knex.schema.createTable('hr_employee_skills', t => {
    t.increments('id');
    t.integer('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.integer('skill_id').unsigned().notNullable().references('hr_skills.id').onDelete('CASCADE');
    t.tinyint('level').unsigned().notNullable().defaultTo(0); // index dans hr_skill_types.levels
    t.date('expires_at'); // habilitation à renouveler
    t.timestamps(true, true);
    t.unique(['employee_id', 'skill_id']);
  });
  await knex.schema.createTable('hr_resume_lines', t => {
    t.increments('id');
    t.integer('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.string('kind', 14).notNullable().defaultTo('experience'); // experience, formation, certification, interne
    t.string('title', 200).notNullable();
    t.string('organisation', 160);
    t.date('start_date');
    t.date('end_date');
    t.string('description', 1000);
    t.timestamps(true, true);
  });
  await knex.schema.createTable('hr_trainings', t => {
    t.increments('id');
    t.string('title', 200).notNullable();
    t.string('provider', 160); // organisme de formation
    t.string('kind', 10).notNullable().defaultTo('externe'); // interne, externe
    t.integer('skill_id').unsigned().references('hr_skills.id').onDelete('SET NULL'); // compétence visée
    t.date('start_date').notNullable();
    t.date('end_date').notNullable();
    t.decimal('hours', 6, 1);
    t.string('location', 160);
    t.bigInteger('cost').notNullable().defaultTo(0);
    t.boolean('fdfp').notNullable().defaultTo(false); // financement demandé au FDFP
    t.string('status', 10).notNullable().defaultTo('planifiee'); // planifiee, realisee, annulee
    t.timestamps(true, true);
  });
  await knex.schema.createTable('hr_training_participants', t => {
    t.increments('id');
    t.integer('training_id').unsigned().notNullable().references('hr_trainings.id').onDelete('CASCADE');
    t.integer('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.string('status', 10).notNullable().defaultTo('inscrit'); // inscrit, present, absent
    t.string('evaluation', 500);
    t.timestamps(true, true);
    t.unique(['training_id', 'employee_id']);
  });

  for (const [name, [levels, skills]] of Object.entries(SKILLS)) {
    const [id] = await knex('hr_skill_types').insert({ name, levels: JSON.stringify(levels) });
    const typeId = typeof id === 'object' ? id.id : id;
    await knex('hr_skills').insert(skills.map(s => ({ type_id: typeId, name: s })));
  }
  if (await knex.schema.hasTable('acc_accounts')) {
    for (const [code, label, partner] of NEW_ACCOUNTS) {
      if (!(await knex('acc_accounts').where({ code }).first())) await knex('acc_accounts').insert({ code, label, class: Number(code[0]), system: true, ...(partner ? { partner_kind: partner } : {}) });
    }
  }

  if (await knex.schema.hasTable('role_permissions')) {
    const existing = await knex('roles').select('id').catch(() => null);
    const roles = new Set(existing ? existing.map(r => r.id) : Object.keys(PERMISSIONS));
    const rows = Object.entries(PERMISSIONS)
      .filter(([role]) => role !== 'super_admin' && roles.has(role))
      .flatMap(([role, perms]) => perms.filter(p => NEW_PERMISSIONS.includes(p)).map(permission => ({ role, permission })));
    // Espace employé (Mon espace) : ouvert à tous les rôles, y compris ceux créés dans le dashboard
    for (const role of [...roles].filter(r => r !== 'super_admin')) rows.push(...SELF_SERVICE.map(permission => ({ role, permission })));
    for (const row of rows) {
      if (!(await knex('role_permissions').where(row).first())) await knex('role_permissions').insert(row);
    }
  }
};

exports.down = async function (knex) {
  for (const t of ['hr_training_participants', 'hr_trainings', 'hr_resume_lines', 'hr_employee_skills', 'hr_skills', 'hr_skill_types', 'hr_applicant_logs', 'hr_applicants', 'hr_jobs', 'hr_expenses', 'hr_overtime', 'hr_attendances', 'hr_reviews', 'hr_objective_checkins', 'hr_objectives', 'hr_career_events', 'hr_leave_adjustments', 'hr_leaves', 'hr_documents', 'hr_holidays']) await knex.schema.dropTableIfExists(t);
  if (!String(knex.client.config.client).includes('sqlite')) {
    await knex.schema.alterTable('employees', t => {
      for (const c of ['manager_id', 'trial_end_date', 'leave_opening_days', 'leave_opening_date', 'birth_place', 'emergency_contact', 'attendance_pin_hash']) t.dropColumn(c);
    });
  }
  await knex('app_settings').where({ key: 'rh' }).del().catch(() => {});
  if (await knex.schema.hasTable('role_permissions')) await knex('role_permissions').whereIn('permission', [...NEW_PERMISSIONS, ...SELF_SERVICE]).del();
};
