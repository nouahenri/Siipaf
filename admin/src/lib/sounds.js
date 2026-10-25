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

// Une note : fréquence (Hz), départ et durée (s), volume, forme d'onde, glissé de fréquence éventuel
function tone(a, t0, { freq, at = 0, dur = 0.45, vol = 0.22, type = 'sine', to = null }) {
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0 + at);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + at + Math.min(0.15, dur));
  gain.gain.setValueAtTime(0.0001, t0 + at);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t0 + at);
  osc.stop(t0 + at + dur + 0.05);
}

const SOUNDS = {
  carillon: [{ freq: 880 }, { freq: 1318.5, at: 0.14 }],
  // Partiels inharmoniques d'une cloche, longue résonance
  clochette: [{ freq: 1046.5, dur: 1.2, vol: 0.18 }, { freq: 2889, dur: 0.8, vol: 0.06 }, { freq: 5650, dur: 0.4, vol: 0.03 }],
  cristal: [{ freq: 1046.5, dur: 0.35, vol: 0.14, type: 'triangle' }, { freq: 1318.5, at: 0.08, dur: 0.35, vol: 0.14, type: 'triangle' }, { freq: 1568, at: 0.16, dur: 0.5, vol: 0.14, type: 'triangle' }],
  goutte: [{ freq: 1400, to: 520, dur: 0.22, vol: 0.25 }, { freq: 1700, to: 700, at: 0.16, dur: 0.18, vol: 0.12 }],
  marimba: [{ freq: 659.3, dur: 0.28, vol: 0.25 }, { freq: 2637, dur: 0.08, vol: 0.05 }, { freq: 987.8, at: 0.12, dur: 0.32, vol: 0.25 }, { freq: 3951, at: 0.12, dur: 0.08, vol: 0.05 }],
  double_bip: [{ freq: 1000, dur: 0.09, vol: 0.06, type: 'square' }, { freq: 1000, at: 0.16, dur: 0.09, vol: 0.06, type: 'square' }],
  aucun: [],
};

/** Joue le son choisi (« carillon » si le nom est inconnu, rien pour « aucun »). */
export function playSound(name = 'carillon') {
  const notes = SOUNDS[name] || SOUNDS.carillon;
  if (!notes.length) return;
  try {
    const a = audio();
    const t0 = a.currentTime + 0.02;
    notes.forEach(n => tone(a, t0, n));
  } catch { /* audio indisponible */ }
}

/** Son de la nouvelle notification : le son réglé pour son module (Réglages du module), sinon le son général. */
export function soundFor(prev, next) {
  if (!prev || !next) return null;
  const grown = Object.keys(next.by_module || {}).filter(m => (next.by_module[m] || 0) > ((prev.by_module || {})[m] || 0));
  if (!grown.length) return null;
  return next.prefs?.[grown[0]]?.sound || next.sound || 'carillon';
}
