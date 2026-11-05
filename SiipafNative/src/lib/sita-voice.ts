/**
 * Voix de Sita dans l'application (choix du client du 05/11/2026) : reconnaissance et synthèse vocales DU TÉLÉPHONE (Google / Apple),
 * sans service payant. Le visiteur pose sa question au micro ; Sita lui répond alors à voix haute, avec une voix féminine ou
 * masculine selon le genre réglé dans le dashboard (Assistante du site), quand le téléphone en propose une.
 * Interrupteur général : réglage « voice » de Sita (dashboard), lu dans /api/public/sita/config.
 */
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';

const LANG = 'fr-FR';

// Les moteurs ne donnent pas le genre des voix : il se déduit de leur nom. Apple : prénoms (Thomas, Amélie…) ;
// Google : codes des voix françaises (fra, frc, vlf : féminines ; frb, frd : masculines).
// Prénoms des voix Apple, Microsoft (Paul, Julie, Hortense…) et Samsung les plus courantes.
const MALE = /thomas|daniel|nicolas|henri|jacques|mathieu|paul|claude|r[eé]my|guillaume|antoine|jerome|eddy|reed|rocko|grandpa|frb|frd|(?<!fe)male|homme/i;
const FEMALE = /am[eé]lie|audrey|aur[eé]lie|marie|virginie|julie|hortense|denise|[eé]lo[iï]se|c[eé]line|l[eé]a\b|flo|sandy|shelley|grandma|fra(?![a-z])|frc|vlf|female|femme/i;

let voices: Speech.Voice[] | null = null;
async function frenchVoices() {
  if (!voices) {
    try { voices = (await Speech.getAvailableVoicesAsync()).filter(v => /^fr[-_]/i.test(v.language)); } catch { voices = []; }
  }
  return voices;
}

/** Voix française du genre demandé, la meilleure qualité d'abord ; null si le téléphone n'en a pas (voix par défaut). */
async function pickVoice(gender: 'femme' | 'homme') {
  const list = await frenchVoices();
  const wanted = gender === 'homme' ? MALE : FEMALE;
  const other = gender === 'homme' ? FEMALE : MALE;
  const score = (v: Speech.Voice) => (v.quality === Speech.VoiceQuality.Enhanced ? 2 : 0) + (/fr[-_]FR/i.test(v.language) ? 1 : 0)
    + (/network/i.test(v.identifier) ? -1 : 0); // voix locales : pas de coupure sans réseau
  const match = list.filter(v => wanted.test(`${v.identifier} ${v.name}`) && !other.test(`${v.name}`)).sort((a, b) => score(b) - score(a));
  return match[0] || null;
}

/** Texte lisible à voix haute : sans liens, adresses, symboles de mise en forme ni émojis. */
export function speakable(text: string) {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`>|~]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\bFCFA\b/g, 'francs CFA')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lecture à voix haute des réponses : une seule à la fois, identifiée pour le bouton « Écouter / Arrêter ». */
export function useSitaSpeech(gender: 'femme' | 'homme') {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const current = useRef<string | null>(null);

  const stop = useCallback(() => { current.current = null; setSpeakingId(null); Speech.stop().catch(() => {}); }, []);

  const speak = useCallback(async (id: string, text: string) => {
    const words = speakable(text);
    if (!words) return;
    await Speech.stop().catch(() => {});
    const voice = await pickVoice(gender);
    current.current = id;
    setSpeakingId(id);
    const done = () => { if (current.current === id) { current.current = null; setSpeakingId(null); } };
    Speech.speak(words, {
      language: LANG, voice: voice?.identifier,
      // Sans voix masculine sur le téléphone, une voix un peu plus grave
      pitch: gender === 'homme' && !voice ? 0.85 : 1, rate: 1,
      onDone: done, onStopped: done, onError: done,
    });
  }, [gender]);

  useEffect(() => () => { Speech.stop().catch(() => {}); }, []);
  return { speakingId, speak, stop };
}

/**
 * Dictée d'une question : le texte reconnu s'affiche au fil de la parole (onPartial), puis la phrase finale est remise à
 * onFinal à la fin de l'écoute (silence ou bouton). Les erreurs sont traduites pour le visiteur.
 */
export function useDictation({ onPartial, onFinal, onError }: { onPartial: (t: string) => void; onFinal: (t: string) => void; onError: (msg: string) => void }) {
  const [listening, setListening] = useState(false);
  const last = useRef('');
  const available = (() => { try { return ExpoSpeechRecognitionModule.isRecognitionAvailable(); } catch { return false; } })();

  useSpeechRecognitionEvent('start', () => { last.current = ''; setListening(true); });
  useSpeechRecognitionEvent('result', e => {
    const said = e.results[0]?.transcript?.trim() || '';
    if (!said) return;
    last.current = said;
    onPartial(said);
  });
  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    const said = last.current;
    last.current = '';
    if (said) onFinal(said);
  });
  useSpeechRecognitionEvent('error', e => {
    setListening(false);
    last.current = '';
    if (e.error === 'aborted') return;
    onError(e.error === 'no-speech' || e.error === 'speech-timeout' ? 'Je n’ai rien entendu. Touchez le micro et parlez après le signal.'
      : e.error === 'not-allowed' ? 'Le micro n’est pas autorisé : activez-le dans les réglages du téléphone pour parler à Sita.'
      : e.error === 'network' ? 'La reconnaissance vocale a besoin d’Internet sur ce téléphone. Réessayez ou écrivez votre question.'
      : e.error === 'language-not-supported' || e.error === 'service-not-allowed' ? 'La reconnaissance vocale en français n’est pas disponible sur ce téléphone. Écrivez votre question.'
      : 'Je n’ai pas pu vous entendre. Réessayez ou écrivez votre question.');
  });

  const start = useCallback(async () => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync().catch(() => null);
    if (!perm?.granted) { onError('Le micro n’est pas autorisé : activez-le dans les réglages du téléphone pour parler à Sita.'); return; }
    await Speech.stop().catch(() => {}); // Sita se tait quand on lui parle
    ExpoSpeechRecognitionModule.start({
      lang: LANG, interimResults: true, continuous: false, addsPunctuation: true, maxAlternatives: 1,
      androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1500 },
    });
  }, [onError]);

  const stop = useCallback(() => { try { ExpoSpeechRecognitionModule.stop(); } catch { /* déjà arrêtée */ } }, []);
  const abort = useCallback(() => { last.current = ''; try { ExpoSpeechRecognitionModule.abort(); } catch { /* déjà arrêtée */ } }, []);

  useEffect(() => () => { try { ExpoSpeechRecognitionModule.abort(); } catch { /* rien à arrêter */ } }, []);
  return { available, listening, start, stop, abort };
}
