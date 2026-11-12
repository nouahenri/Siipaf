/**
 * Sons de notification (cloche du dashboard et de l'ERP), synthétisés par le navigateur (Web Audio) : aucun
 * fichier à télécharger, aucune licence. La liste et les noms viennent du serveur (NOTIF_SOUNDS) ; chaque compte
 * choisit le sien. Le navigateur ne joue un son qu'après une première interaction avec la page.
 */
let ctx;
const audio = () => {
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};

// Une note : fréquence (Hz), départ et durée (s), volume, forme d'onde, glissé de fréquence éventuel (`to`, sur `ramp` s),
// `hold` : volume tenu sur 60 % de la durée avant l'extinction (sons d'alerte, plus francs)
function tone(a, t0, { freq, at = 0, dur = 0.45, vol = 0.22, type = 'sine', to = null, ramp = null, hold = false }) {
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0 + at);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + at + (ramp || Math.min(0.15, dur)));
  gain.gain.setValueAtTime(0.0001, t0 + at);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + at + (hold ? 0.01 : 0.012));
  if (hold) gain.gain.setValueAtTime(vol, t0 + at + Math.max(0.012, dur * 0.6));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t0 + at);
  osc.stop(t0 + at + dur + 0.05);
}

const SOUNDS = {
  // Sons classiques, volume porté au maximum le 12/11 (demande du client : même niveau que les alertes)
  carillon: [{ freq: 880, vol: 0.45 }, { freq: 1318.5, at: 0.14, vol: 0.45 }],
  // Partiels inharmoniques d'une cloche, longue résonance
  clochette: [{ freq: 1046.5, dur: 1.2, vol: 0.45 }, { freq: 2889, dur: 0.8, vol: 0.15 }, { freq: 5650, dur: 0.4, vol: 0.075 }],
  cristal: [{ freq: 1046.5, dur: 0.35, vol: 0.4, type: 'triangle' }, { freq: 1318.5, at: 0.08, dur: 0.35, vol: 0.4, type: 'triangle' }, { freq: 1568, at: 0.16, dur: 0.5, vol: 0.4, type: 'triangle' }],
  goutte: [{ freq: 1400, to: 520, dur: 0.22, vol: 0.5 }, { freq: 1700, to: 700, at: 0.16, dur: 0.18, vol: 0.24 }],
  marimba: [{ freq: 659.3, dur: 0.28, vol: 0.5 }, { freq: 2637, dur: 0.08, vol: 0.1 }, { freq: 987.8, at: 0.12, dur: 0.32, vol: 0.5 }, { freq: 3951, at: 0.12, dur: 0.08, vol: 0.1 }],
  double_bip: [{ freq: 1000, dur: 0.09, vol: 0.3, type: 'square' }, { freq: 1000, at: 0.16, dur: 0.09, vol: 0.3, type: 'square' }],
  // Sons d'alerte (choix du client du 12/11, volume maximal) : agressifs, percutants ou insistants
  alarme: [0, 0.2, 0.4, 0.8, 1, 1.2].map(at => ({ freq: 1650, at, dur: 0.13, vol: 0.375, type: 'square', hold: true })),
  pin_pon: [0, 0.36, 0.72, 1.08].map((at, i) => ({ freq: i % 2 ? 740 : 980, at, dur: 0.34, vol: 0.275, type: 'square', hold: true })),
  sirene: [{ freq: 500, to: 1500, ramp: 0.55, dur: 0.6, vol: 0.275, type: 'sawtooth', hold: true }, { freq: 1500, to: 500, ramp: 0.55, at: 0.6, dur: 0.6, vol: 0.275, type: 'sawtooth', hold: true }],
  sonnerie: [0, 0.9].flatMap(start => Array.from({ length: 14 }, (_, i) => ({ freq: i % 2 ? 1500 : 1300, at: start + i * 0.045, dur: 0.05, vol: 0.25, type: 'triangle', hold: true }))),
  urgence: [0, 0.17, 0.34, 0.51].map(at => ({ freq: 800, to: 1900, ramp: 0.13, at, dur: 0.14, vol: 0.325, type: 'square', hold: true })),
  klaxon: [0, 0.45].flatMap(at => [{ freq: 349, at, dur: 0.32, vol: 0.225, type: 'sawtooth', hold: true }, { freq: 440, at, dur: 0.32, vol: 0.225, type: 'sawtooth', hold: true }]),
  gong: [{ freq: 110, dur: 2.2, vol: 0.5, type: 'triangle', hold: true }, { freq: 220, dur: 1.6, vol: 0.275, hold: true }, { freq: 331, dur: 1, vol: 0.15, hold: true }, { freq: 587, dur: 0.5, vol: 0.1, hold: true }],
  aucun: [],
};

// « SIIIPAAAF » synthétisé (12/11) : souffle « s », voyelles « i » puis « a » (onde filtrée par les formants de la voix),
// explosion « p », souffle « f ». `mega` : saturation et bande étroite façon mégaphone.
let noiseBuffer;
function noise(a) {
  if (!noiseBuffer) {
    noiseBuffer = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = a.createBufferSource();
  s.buffer = noiseBuffer;
  return s;
}
function envelope(g, t, points) {
  g.gain.setValueAtTime(0.0001, t);
  points.forEach(([dt, v]) => g.gain.linearRampToValueAtTime(v, t + dt));
}
function siipaf(a, t0, { f0, src, t: T, mega, volume }) {
  let out = a.createGain();
  out.gain.value = volume;
  out.connect(a.destination);
  if (mega) {
    const shaper = a.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) curve[i] = Math.tanh((i / 512 - 1) * 6);
    shaper.curve = curve;
    const band = a.createBiquadFilter();
    band.type = 'bandpass'; band.frequency.value = 1600; band.Q.value = 0.7;
    const pre = a.createGain();
    pre.connect(shaper).connect(band).connect(out);
    out = pre;
  }
  const tI = t0 + T.s * 0.7, tA = tI + T.i + T.gap, tF = tA + T.a;
  const hiss = (start, dur, filter, points) => {
    const n = noise(a), g = a.createGain();
    envelope(g, start, points);
    (filter ? n.connect(filter).connect(g) : n.connect(g)).connect(out);
    n.start(start); n.stop(start + dur + 0.05);
  };
  const vowel = (start, dur, from, to, formants) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = src;
    o.frequency.setValueAtTime(from, start);
    o.frequency.linearRampToValueAtTime(to, start + dur);
    envelope(g, start, [[0.025, 0.9], [dur * 0.85, 0.8], [dur, 0.0001]]);
    o.connect(g);
    formants.forEach(([f, q, k]) => {
      const b = a.createBiquadFilter(), level = a.createGain();
      b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; level.gain.value = k;
      g.connect(b).connect(level).connect(out);
    });
    o.start(start); o.stop(start + dur + 0.05);
  };
  const filter = (type, freq, q) => { const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q; return f; };
  hiss(t0, T.s, filter('highpass', 4800), [[0.03, 0.5], [T.s * 0.8, 0.45], [T.s, 0.0001]]); // s
  vowel(tI, T.i, f0[0], f0[1], [[300, 6, 1.4], [2300, 9, 1.1], [3000, 10, 0.6]]); // iii
  hiss(tA - 0.005, 0.03, null, [[0.004, 1], [0.03, 0.0001]]); // p
  vowel(tA, T.a, f0[2], f0[3], [[800, 5, 1.6], [1250, 7, 1.1], [2600, 9, 0.4]]); // aaa
  hiss(tF - 0.04, T.f, filter('bandpass', 3200, 0.6), [[0.04, 0.7], [T.f * 0.7, 0.6], [T.f, 0.0001]]); // fff
}
const VOICES = {
  siipaf_robot: { f0: [230, 270, 270, 170], src: 'sawtooth', t: { s: 0.22, i: 0.5, gap: 0.06, a: 0.55, f: 0.5 }, mega: false, volume: 0.7 },
  siipaf_megaphone: { f0: [260, 300, 300, 200], src: 'sawtooth', t: { s: 0.2, i: 0.45, gap: 0.05, a: 0.5, f: 0.45 }, mega: true, volume: 0.77 * 1.1 },
};

/** Joue le son choisi (« carillon » si le nom est inconnu, rien pour « aucun »). */
export function playSound(name = 'carillon') {
  const voice = VOICES[name];
  const notes = voice ? null : SOUNDS[name] || SOUNDS.carillon;
  if (notes && !notes.length) return;
  try {
    const a = audio();
    const t0 = a.currentTime + 0.03;
    if (voice) siipaf(a, t0, voice);
    else notes.forEach(n => tone(a, t0, n));
  } catch { /* audio indisponible */ }
}

/** Son de la nouvelle notification : le son réglé pour son module (Réglages du module), sinon le son général. */
export function soundFor(prev, next) {
  if (!prev || !next) return null;
  const grown = Object.keys(next.by_module || {}).filter(m => (next.by_module[m] || 0) > ((prev.by_module || {})[m] || 0));
  if (!grown.length) return null;
  return next.prefs?.[grown[0]]?.sound || next.sound || 'carillon';
}
