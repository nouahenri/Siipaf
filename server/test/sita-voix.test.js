/**
 * Voix de Sita (Gemini 3.8 Flash TTS, choix du client du 06/11/2026) : seules les réponses de Sita du visiteur sont lues, audio
 * gardé (pas de seconde facture), coût ajouté au message et au plafond, refus 409 pour le secours du téléphone, essai du dashboard.
 * Aucun appel réseau : fausse réponse de Google (setHttp).
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setup, login, request } = require('./helpers');
const sita = require('../src/services/sita');
const voice = require('../src/services/sitaVoice');
const S = require('../src/lib/sita');

let db, app, admin, cache;
const KEY = 'AIzaSyTESTVOIXsecret-0123456789abcd';
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };
const vid = n => `visiteur-voix-${String(n).padStart(8, '0')}`;
const say = (n, message) => request(app).post('/api/public/sita/message').send({ visitor_id: vid(n), message, page: { path: '/projets.html' } });
const listen = (id, n) => request(app).get(`/api/public/sita/voix/${id}?v=${vid(n)}`).buffer(true).parse((res, cb) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
const settings = patch => admin.put('/api/admin/assistant').send(patch);

/** Fausse réponse de Google : PCM brut 24 kHz (forme « audio/L16 »), jetons consommés. */
let calls = [];
const fakeGoogle = (status = 200) => async (url, init) => {
  calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
  const pcm = Buffer.alloc(4800, 1);
  const json = status === 200
    ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 200 } }
    : { error: { message: `Refus avec la clé ${KEY}` } };
  return { ok: status === 200, status, json: async () => json };
};

before(async () => {
  delete process.env.GEMINI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  ({ db, app } = await setup());
  delete process.env.GEMINI_API_KEY; delete process.env.ANTHROPIC_API_KEY; // le .env du poste ne sert jamais aux tests
  admin = await login(app);
  cache = fs.mkdtempSync(path.join(os.tmpdir(), 'sita-voix-'));
  voice.setCacheDir(cache);
  ok(await settings({ enabled: true, voice: true, cap_fcfa: 20000 }));
});
beforeEach(() => { calls = []; delete process.env.GEMINI_API_KEY; voice.setHttp(fakeGoogle()); S.setLimits(); sita.limiter.reset(); });
after(() => { voice.setHttp(null); delete process.env.GEMINI_API_KEY; fs.rmSync(cache, { recursive: true, force: true }); return db.destroy(); });

test('réponse de Sita lue par Gemini : WAV, voix et style réglés, coût ajouté une seule fois (audio gardé)', async () => {
  const out = ok(await say(1, 'Quels programmes proposez-vous ?')); // démonstration (sans clé) : la conversation ne coûte rien
  assert.ok(Number.isInteger(out.message_id), 'identifiant de la réponse renvoyé');
  assert.equal(out.conversation_id, undefined);
  process.env.GEMINI_API_KEY = KEY;
  const cfg = ok(await request(app).get('/api/public/sita/config'));
  assert.equal(cfg.voice_natural, true);
  assert.ok(!JSON.stringify(cfg).includes(KEY));

  const r = await listen(out.message_id, 1);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /audio\/wav/);
  assert.equal(r.body.slice(0, 4).toString(), 'RIFF', 'PCM de Google enveloppé en WAV');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers['x-goog-api-key'], KEY, 'clé dans l’en-tête');
  assert.ok(!calls[0].url.includes(KEY), 'jamais dans l’adresse');
  assert.match(calls[0].url, /gemini-3\.8-flash-tts:generateContent/);
  assert.equal(calls[0].body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Sulafat');
  const prompt = calls[0].body.contents[0].parts[0].text;
  assert.match(prompt, /^## Style : Conseillère immobilière ivoirienne/);
  assert.match(prompt, /## Transcript:\n/);
  assert.ok(!/https?:\/\//.test(prompt.split('## Transcript:')[1]), 'liens retirés du texte lu');

  const cost = S.ttsCostMicroUsd(50, 200);
  const m = await db('sita_messages').where({ id: out.message_id }).first();
  assert.equal(Number(m.cost_micro_usd), cost, 'coût au tarif Google (relevé 2027)');
  // Réécoute : audio gardé, aucun nouvel appel ni coût
  assert.equal((await listen(out.message_id, 1)).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(Number((await db('sita_messages').where({ id: out.message_id }).first()).cost_micro_usd), cost);
});

test('seules les réponses de Sita de ce visiteur : autre visiteur, message du visiteur ou identifiant invalide refusés', async () => {
  const out = ok(await say(2, 'Combien coûte un terrain ?'));
  process.env.GEMINI_API_KEY = KEY;
  assert.equal((await listen(out.message_id, 3)).status, 404, 'autre visiteur');
  const mine = await db('sita_messages').where({ role: 'visiteur' }).orderBy('id', 'desc').first('id');
  assert.equal((await listen(mine.id, 2)).status, 404, 'message du visiteur : pas de synthèse de texte libre');
  assert.equal((await request(app).get(`/api/public/sita/voix/${out.message_id}?v=court`)).status, 400);
  assert.equal(calls.length, 0);
});

test('voix indisponible → 409 (secours du téléphone) : sans clé, voix coupée, arrêt d’urgence, plafond, panne de Google', async () => {
  const out = ok(await say(4, 'Je veux visiter un site'));
  const code = async () => { const r = await listen(out.message_id, 4); return r.status; };
  assert.equal(await code(), 409, 'sans clé');
  process.env.GEMINI_API_KEY = KEY;
  ok(await settings({ voice: false }));
  assert.equal(await code(), 409, 'voix coupée au dashboard');
  ok(await settings({ voice: true, emergency_stop: true }));
  assert.equal(await code(), 409, 'arrêt d’urgence');
  ok(await settings({ emergency_stop: false, cap_fcfa: 0 }));
  assert.equal(await code(), 409, 'plafond nul');
  ok(await settings({ cap_fcfa: 20000 }));
  voice.setHttp(fakeGoogle(500));
  const r = await request(app).get(`/api/public/sita/voix/${out.message_id}?v=${vid(4)}`);
  assert.equal(r.status, 409);
  assert.ok(!JSON.stringify(r.body).includes(KEY), 'clé masquée dans l’erreur');
  assert.equal(calls.length, 2, 'aucun appel avant la panne simulée ; panne du modèle principal → essai du modèle lite');
  assert.match(calls[0].url, /gemini-3\.8-flash-tts:/);
  assert.match(calls[1].url, /gemini-3\.8-flash-lite-tts:/);
  assert.equal(Number((await db('sita_messages').where({ id: out.message_id }).first()).cost_micro_usd), 0, 'rien de facturé');
});

test('message d’accueil lu une seule fois (gardé) ; réglages de voix validés ; essai du dashboard réservé', async () => {
  process.env.GEMINI_API_KEY = KEY;
  const g = await request(app).get(`/api/public/sita/voix/accueil?v=${vid(5)}`);
  assert.equal(g.status, 200);
  await request(app).get(`/api/public/sita/voix/accueil?v=${vid(6)}`);
  assert.equal(calls.length, 1, 'accueil gardé');

  assert.equal((await settings({ tts_voice_femme: 'Achird' })).status, 400, 'voix masculine refusée pour la voix féminine');
  assert.equal((await settings({ tts_voice_homme: 'Inconnue' })).status, 400);
  const view = ok(await settings({ tts_voice_femme: 'Achernar', tts_style: 'Voix douce et rassurante.' }));
  assert.equal(view.settings.tts_voice_femme, 'Achernar');
  assert.ok(view.meta.tts_voices.Sulafat);
  const out = ok(await say(7, 'Bonjour'));
  await listen(out.message_id, 7);
  const last = calls.at(-1).body;
  assert.equal(last.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Achernar');
  assert.match(last.contents[0].parts[0].text, /^## Style : Voix douce et rassurante\./);

  const sample = await admin.post('/api/admin/assistant/voix-essai').send({ gender: 'homme', voice: 'Achird' });
  assert.equal(sample.status, 200);
  assert.equal((await admin.post('/api/admin/assistant/voix-essai').send({ gender: 'homme', voice: 'Sulafat' })).status, 400, 'voix d’un autre genre');
  assert.equal((await request(app).post('/api/admin/assistant/voix-essai').send({ gender: 'homme', voice: 'Achird' })).status, 401, 'réservé au dashboard');
  ok(await settings({ tts_voice_femme: 'Sulafat', tts_style: '' }));
});
