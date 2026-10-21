/**
 * Données de démonstration du module RH (base de démo locale uniquement ; à lancer après demo-compta.js).
 *   DB_FILENAME=./data/demo.sqlite node scripts/demo-rh.js
 * Les tables RH de la démo sont vidées puis recréées. Hiérarchie, jours fériés de l'année, congés (pris, à approuver), pointages du mois au chantier, heures sup.,
 * notes de frais, un poste ouvert avec candidatures, compétences, formations, objectifs et entretiens.
 */
const { createDb } = require('../src/db');
const rh = require('../src/services/rh');

const ymd = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Script réservé à la base de démo.');
  const db = createDb();
  // Base de démo : les données RH sont recréées à chaque lancement (le référentiel des compétences est gardé)
  for (const t of ['hr_training_participants', 'hr_trainings', 'hr_resume_lines', 'hr_employee_skills', 'hr_applicant_logs', 'hr_applicants', 'hr_jobs', 'hr_expenses', 'hr_overtime', 'hr_attendances', 'hr_reviews', 'hr_objectives', 'hr_career_events', 'hr_leave_adjustments', 'hr_leaves', 'hr_documents', 'hr_holidays']) await db(t).del();
  await db('employees').update({ manager_id: null });
  const emp = await db('employees').orderBy('id');
  if (!emp.length) { console.log('Lancez d’abord demo-compta.js (employés).'); return db.destroy(); }
  const admin = await db('users').orderBy('id').first();
  const byDept = d => emp.filter(e => e.department === d);
  const [boss] = byDept('direction');
  const [tech] = byDept('technique');
  const now = new Date();
  const y = now.getUTCFullYear();
  const today = ymd(now);
  const project = await db('projects').whereIn('id', db('lots').select('project_id')).first('id');

  // Hiérarchie : direction → services ; conducteur de travaux → ouvriers. Le compte administrateur est le directeur.
  await db('employees').where({ id: boss.id }).update({ user_id: admin.id, gender: 'M', birth_date: '1978-11-02', children: 3, marital_status: 'marie' });
  for (const e of emp.filter(x => x.id !== boss.id && x.department !== 'chantier')) await db('employees').where({ id: e.id }).update({ manager_id: boss.id });
  for (const e of byDept('chantier')) await db('employees').where({ id: e.id }).update({ manager_id: tech.id, gender: 'M' });
  const genders = { DIABATÉ: 'F', TOURÉ: 'F', YAO: 'F', KOUADIO: 'M', BAMBA: 'M' };
  for (const e of emp) if (genders[e.last_name]) await db('employees').where({ id: e.id }).update({ gender: genders[e.last_name] });
  await db('employees').where({ id: byDept('chantier')[0].id }).update({ trial_end_date: addDays(today, 18) });

  await rh.seedHolidays(db, y);
  await db('hr_holidays').insert([{ date: `${y}-03-31`, label: 'Aïd el-Fitr (fin du Ramadan)' }, { date: `${y}-06-07`, label: 'Tabaski (Aïd el-Kébir)' }]).catch(() => {});

  // Congés
  const L = (e, type, start, end, status, days, extra = {}) => ({ employee_id: e.id, type, start_date: start, end_date: end, status, days, calendar_days: Math.round((new Date(end) - new Date(start)) / 86400000) + 1, requested_by: admin.id, decided_by: status === 'approuvee' ? admin.id : null, decided_at: status === 'approuvee' ? new Date() : null, ...extra });
  const [awa, serge] = byDept('commercial');
  const [mariam] = byDept('comptabilite');
  const [christelle] = byDept('administratif');
  const workers = byDept('chantier');
  await db('hr_leaves').insert([
    L(awa, 'conge_annuel', `${y}-08-03`, `${y}-08-22`, 'approuvee', 16),
    L(mariam, 'conge_annuel', `${y}-07-13`, `${y}-07-31`, 'approuvee', 15),
    L(serge, 'conge_annuel', addDays(today, 12), addDays(today, 25), 'en_attente', 12, { reason: 'Congés de fin d’année au village' }),
    L(christelle, 'permission', addDays(today, 5), addDays(today, 8), 'approuve_manager', 4, { event: 'mariage', manager_by: admin.id, manager_at: new Date() }),
    L(workers[1], 'maladie', addDays(today, -1), addDays(today, 2), 'approuvee', 4, { reason: 'Paludisme' }),
    L(workers[2], 'absence_injustifiee', addDays(today, -9), addDays(today, -9), 'approuvee', 1),
    L(tech, 'conge_annuel', addDays(today, 3), addDays(today, 7), 'en_attente', 5),
  ]);

  // Pointages du mois sur le chantier (feuilles du conducteur) : 7 h 30 – 12 h, 13 h – 17 h 30, samedi matin
  const monthStart = `${today.slice(0, 7)}-01`;
  for (let d = monthStart; d < today; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd === 0) continue;
    for (const [i, w] of workers.entries()) {
      if (i === 2 && d === addDays(today, -9)) continue;
      const ranges = wd === 6 ? [['07:30', '12:30']] : [['07:30', '12:00'], ['13:00', i === 0 ? '18:30' : '17:00']];
      for (const [a, b] of ranges) await db('hr_attendances').insert({ employee_id: w.id, check_in: new Date(`${d}T${a}:00Z`), check_out: new Date(`${d}T${b}:00Z`), source: 'feuille', project_id: project?.id || null, created_by: admin.id });
    }
    for (const e of [boss, awa, serge, mariam, christelle, tech]) {
      if (wd === 6) continue;
      await db('hr_attendances').insert({ employee_id: e.id, check_in: new Date(`${d}T08:0${e.id % 10}:00Z`), check_out: new Date(`${d}T17:3${e.id % 6}:00Z`), source: e.id === boss.id ? 'web' : 'borne', project_id: e.id === tech.id ? project?.id || null : null });
    }
  }
  await db('hr_attendances').insert({ employee_id: tech.id, check_in: new Date(`${today}T07:45:00Z`), source: 'web', project_id: project?.id || null });
  await db('hr_attendances').insert({ employee_id: workers[0].id, check_in: new Date(`${today}T07:30:00Z`), source: 'borne', project_id: project?.id || null });

  // Notes de frais
  const X = (e, i, date, category, label, amount, status, extra = {}) => ({ reference: `NDF-${y}-${String(i).padStart(4, '0')}`, employee_id: e.id, date, category, label, amount, status, vat_rate: 0, paid_by: 'employe', created_by: admin.id, ...extra });
  await db('hr_expenses').insert([
    X(awa, 1, addDays(today, -6), 'carburant', 'Visites clients Bingerville – Ahoutoué', 23600, 'soumise', { vat_rate: 18, project_id: project?.id || null }),
    X(serge, 2, addDays(today, -4), 'reception', 'Déjeuner avec un acquéreur de la diaspora', 35000, 'soumise'),
    X(tech, 3, addDays(today, -3), 'petit_materiel', 'Niveaux laser et cordeaux', 48500, 'approuvee', { vat_rate: 18, project_id: project?.id || null, approved_by: admin.id, approved_at: new Date() }),
    X(christelle, 4, addDays(today, -20), 'fournitures', 'Ramettes et classeurs', 12000, 'brouillon'),
  ]);

  // Recrutement
  const [jobId] = await db('hr_jobs').insert({ title: 'Chef de chantier gros œuvre', department: 'chantier', project_id: project?.id || null, contract_type: 'cdd', openings: 1, location: 'Ahoutoué', description: 'Encadrement des équipes de maçonnerie et de ferraillage, suivi de l’avancement, sécurité.', published: true, recruiter_id: admin.id });
  const job = typeof jobId === 'object' ? jobId.id : jobId;
  const apps = [['Yao Konan Serge', 'site_web', 'entretien_1', 2], ['Koné Ibrahim', 'linkedin', 'qualification', 1], ['Bakayoko Aminata', 'cooptation', 'proposition', 3], ['Traoré Moussa', 'site_web', 'nouveau', 0]];
  for (const [name, source, stage, rating] of apps) {
    const [id] = await db('hr_applicants').insert({ job_id: job, name, email: `${name.split(' ')[0].toLowerCase()}@exemple.ci`, phone: '07 00 00 00 00', source, stage, rating, expected_salary: 450000 });
    await db('hr_applicant_logs').insert({ applicant_id: typeof id === 'object' ? id.id : id, kind: 'etape', summary: 'Candidature enregistrée', user_id: admin.id });
  }

  // Compétences, formation, objectifs
  const skill = name => db('hr_skills').where({ name }).first();
  const set = async (e, name, level, expires_at = null) => { const s = await skill(name); if (s) await db('hr_employee_skills').insert({ employee_id: e.id, skill_id: s.id, level, expires_at }); };
  for (const w of workers) { await set(w, 'Maçonnerie', 2); await set(w, 'Travail en hauteur', 1, addDays(today, w.id % 2 ? 40 : -5)); }
  await set(tech, 'Conduite de travaux', 3); await set(tech, 'AutoCAD', 2);
  for (const c of [awa, serge]) { await set(c, 'Négociation commerciale', 2); await set(c, 'Droit foncier', 1); }
  await set(mariam, 'Comptabilité SYSCOHADA', 3); await set(mariam, 'Sage', 2);
  const height = await skill('Travail en hauteur');
  const [tid] = await db('hr_trainings').insert({ title: 'Recyclage travail en hauteur', provider: 'Organisme agréé', kind: 'externe', skill_id: height?.id || null, start_date: addDays(today, 14), end_date: addDays(today, 15), hours: 14, cost: 600000, fdfp: true, location: 'Abidjan, Plateau' });
  for (const w of workers) await db('hr_training_participants').insert({ training_id: typeof tid === 'object' ? tid.id : tid, employee_id: w.id });
  for (const c of [awa, serge]) {
    await db('hr_objectives').insert([
      { employee_id: c.id, year: y, title: 'Ventes signées dans l’année', metric: 'ventes', target_value: 12, weight: 3, progress: 0, created_by: admin.id },
      { employee_id: c.id, year: y, title: 'Relancer les prospects de la diaspora chaque mois', metric: 'manuel', target_value: null, progress: 60, weight: 1, created_by: admin.id },
    ]);
  }
  await db('hr_objectives').insert({ employee_id: tech.id, year: y, title: 'Livrer la tranche 1 sans réserve majeure', metric: 'manuel', progress: 70, weight: 2, created_by: admin.id });
  await db('hr_reviews').insert({ employee_id: awa.id, year: y, self_comment: 'Bonne année commerciale ; besoin d’une formation sur le droit foncier.' });
  // Indicateurs calculés pour les autres services : chantier, assiduité
  const O = (e, title, metric, target_value, weight, progress = 0) => ({ employee_id: e.id, year: y, title, metric, target_value, weight, progress, created_by: admin.id });
  if (tech.project_id) await db('hr_objectives').insert(O(tech, 'Avancement du programme suivi', 'chantier_avancement', 80, 3));
  for (const w of workers) await db('hr_objectives').insert([O(w, 'Assiduité sur le chantier', 'presence', 97, 2), O(w, 'Zéro absence injustifiée', 'absences', 1, 1)]);
  await db('hr_objectives').insert([O(mariam, 'Clôturer chaque mois avant le 10', 'manuel', null, 2, 80), O(mariam, 'Heures de formation Sage', 'formation_heures', 14, 1)]);
  await db('hr_objectives').insert(O(christelle, 'Taux de présence', 'presence', 98, 1));

  console.log('Données RH de démonstration créées.');
  await db.destroy();
})().catch(e => { console.error(e); process.exit(1); });
