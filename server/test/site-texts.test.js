const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setup, login, createUser, request } = require('./helpers');
const { scanSite, PAGES, SITE_DIR } = require('../src/lib/site-texts');
const { editorialIndex } = require('../src/services/editorial');
const stored = require('../src/lib/site-text-slots.json');

let db, app, admin;
before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
});
after(() => db.destroy());

test('les pages portent toutes leurs clés et le catalogue est à jour (sinon : node scripts/site-texts.js)', () => {
  const { catalog, changed } = scanSite();
  assert.deepEqual(changed.map(c => path.basename(c.file)), [], 'pages sans leurs clés data-edit');
  assert.deepEqual(catalog, stored, 'site-text-slots.json n’est pas à jour');
});

test('chaque clé posée dans une page est connue du catalogue, menu et pied de page compris', () => {
  const known = new Set([...editorialIndex.fields.keys(), ...editorialIndex.hideable]);
  for (const p of PAGES) {
    const html = fs.readFileSync(path.join(SITE_DIR, p.file), 'utf8');
    for (const [, attr, key] of html.matchAll(/data-edit(|-list|-card|-section)="([^"]+)"/g)) {
      assert.ok(known.has(key), `${p.file} : data-edit${attr}="${key}" absent du catalogue`);
    }
    assert.match(html, new RegExp(`<body data-edit-page="${p.id}"`));
  }
  // Rien d'éditable dans les blocs remplis par les données (fiches projet, témoignages, formulaires)
  for (const [file, marker] of [['index.html', 'temoignages-grid'], ['contact.html', 'contactForm'], ['projets.html', 'proj-main']]) {
    const html = fs.readFileSync(path.join(SITE_DIR, file), 'utf8');
    const at = html.indexOf(marker);
    assert.ok(at > 0, marker);
    const block = html.slice(at, html.indexOf('</section>', at));
    assert.doesNotMatch(block.split('</form>')[0], /data-edit="/, `${file} › ${marker}`);
  }
});

test('éditorial : enregistrement, texte d’origine non stocké, listes, sections masquées, aller-retour sans perte', async () => {
  const title = 'home.expertises.titre';
  const list = 'home.a-propos-de-siipaf.liste';
  const button = 'home.a-propos-de-siipaf.bouton';
  const sub = 'home.expertises.sous-titre';
  const def = editorialIndex.fields.get(sub).default;
  const body = {
    texts: {
      [title]: 'Nos *métiers*\nde A à Z',
      [sub]: def, // identique à l'origine : non gardé
      [list]: ['Agrément MCLU', '  ', 'Comptes séquestres'],
      [button]: { label: 'Découvrir SIIPAF', href: '' }, // lien vide : celui d'origine
      'home.meta.title': 'Accueil — SIIPAF',
      'inconnu.cle': 'ignoré',
      'about.notre-identite.titre': '', // vide : texte d'origine
    },
    hidden: ['home.temoignages', 'home.expertises.carte-2', 'home.hero', 'inconnue'],
  };
  let res = await admin.put('/api/admin/content/editorial').send(body);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, {
    texts: {
      [title]: 'Nos *métiers*\nde A à Z',
      [list]: ['Agrément MCLU', 'Comptes séquestres'],
      [button]: { label: 'Découvrir SIIPAF', href: 'a-propos.html' },
      'home.meta.title': 'Accueil — SIIPAF',
    },
    hidden: ['home.temoignages', 'home.expertises.carte-2'],
  });
  const first = res.body;

  // Réenregistrer ce qui a été relu ne change rien
  res = await admin.put('/api/admin/content/editorial').send(first);
  assert.deepEqual(res.body, first);
  const back = await admin.get('/api/admin/content');
  assert.deepEqual(back.body.editorial, first);

  // Le site le reçoit avec le reste du contenu
  const pub = await request(app).get('/api/public/content');
  assert.deepEqual(pub.body.editorial, first);

  // Catalogue lisible par qui modifie le contenu
  const cat = await admin.get('/api/admin/content/editorial-catalog');
  assert.equal(cat.status, 200);
  assert.ok(cat.body.pages.some(p => p.id === 'shared'));
});

test('éditorial : liens dangereux et textes trop longs refusés, droits contrôlés', async () => {
  const bad = await admin.put('/api/admin/content/editorial').send({ texts: { 'home.a-propos-de-siipaf.bouton': { label: 'Voir', href: 'javascript:alert(1)' } } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /lien non accepté/);
  const listBad = await admin.put('/api/admin/content/editorial').send({ texts: { 'shared.pied-de-page.carte-2.liste': [{ label: 'X', href: 'data:text/html,x' }] } });
  assert.equal(listBad.status, 400);
  const long = await admin.put('/api/admin/content/editorial').send({ texts: { 'home.expertises.titre': 'x'.repeat(401) } });
  assert.equal(long.status, 400);
  const reader = await login(app, await createUser(db, 'comptable', 'editorial-reader@test.ci'), 'motdepasse-test-123');
  assert.equal((await reader.put('/api/admin/content/editorial').send({ texts: {} })).status, 403);
  assert.equal((await reader.get('/api/admin/content/editorial-catalog')).status, 403);
});
