const fs = require('fs');
const path = require('path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, login } = require('./helpers');
const { uploadsDir } = require('../src/config');

let db, app, admin;
const created = [];

before(async () => {
  ({ db, app } = await setup());
  admin = await login(app);
});
after(async () => {
  for (const f of created) fs.rmSync(path.join(uploadsDir, f), { force: true });
  await db.destroy();
});

test('vidéos de chantier : MOV (iPhone) et MP4 acceptées, filtre « vidéo » de la médiathèque', async () => {
  const res = await admin.post('/api/admin/media')
    .attach('files', Buffer.from('fausse video mov'), { filename: 'chantier.mov', contentType: 'video/quicktime' })
    .attach('files', Buffer.from('fausse video mp4'), { filename: 'chantier.mp4', contentType: 'video/mp4' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  created.push(...res.body.map(m => m.filename));
  assert.deepEqual(res.body.map(m => path.extname(m.filename)), ['.mov', '.mp4']);
  const videos = await admin.get('/api/admin/media?type=video');
  assert.equal(videos.body.length, 2);
  assert.ok(videos.body.every(m => m.mime.startsWith('video/')));
  const refused = await admin.post('/api/admin/media').attach('files', Buffer.from('x'), { filename: 'virus.exe', contentType: 'application/x-msdownload' });
  assert.equal(refused.status, 400);
});
