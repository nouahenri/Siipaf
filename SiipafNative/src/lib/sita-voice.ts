/**
 * Voix de Sita dans l'application (choix du client du 05/11/2026) : reconnaissance vocale DU TÉLÉPHONE ; lecture avec la voix
 * naturelle de Gemini depuis le 06/11 (serveur : services/sitaVoice.js), la synthèse du téléphone restant le secours. Le visiteur pose sa question au micro ; Sita lui répond alors à voix haute, avec une voix féminine ou
 * masculine selon le genre réglé dans le dashboard (Assistante du site), quand le téléphone en propose une.
 * Interrupteur général : réglage « voice » de Sita (dashboard), lu dans /api/public/sita/config.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { apiUrl } from '@/lib/api';

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

/** Ce que le serveur peut lire avec la voix de Gemini : une réponse de Sita (son identifiant) ou le message d'accueil. */
export type VoiceSource = { messageId: number } | { greeting: true };

/**
 * Audio de Gemini (06/11) : téléchargé depuis le serveur (qui le garde et le décompte du budget de Sita), puis enregistré
 * dans le cache du téléphone (adresse locale pour le lecteur) ; sur le web, adresse blob. Erreur (409 : voix coupée,
 * budget atteint, clé absente ; réseau) → la voix du téléphone prend le relais.
 */
async function naturalAudio(source: VoiceSource, visitor: string): Promise<string> {
  const path = 'greeting' in source ? `/api/public/sita/voix/accueil?v=${visitor}` : `/api/public/sita/voix/${source.messageId}?v=${visitor}`;
  const name = 'greeting' in source ? `sita-accueil-${visitor}` : `sita-${source.messageId}`;
  if (Platform.OS !== 'web') {
    const cached = new File(Paths.cache, `${name}.wav`);
    if ('messageId' in source && cached.exists) return cached.uri;
  }
  const res = await fetch(apiUrl(path)!);
  if (!res.ok) throw new Error(`voix ${res.status}`);
  if (Platform.OS === 'web') return URL.createObjectURL(await res.blob());
  const file = new File(Paths.cache, `${name}.wav`);
  if (file.exists) file.delete();
  file.create({ overwrite: true });
  await file.write(new Uint8Array(await res.arrayBuffer()));
  return file.uri;
}

/**
 * Lecture à voix haute des réponses : une seule à la fois, identifiée pour le bouton « Écouter / Arrêter ». Voix de Gemini
 * quand elle est disponible (réglage du dashboard et clé du serveur : `natural`), sinon voix du téléphone.
 */
export function useSitaSpeech(gender: 'femme' | 'homme', natural: { enabled: boolean; visitor: string | null }) {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  const player = useRef<AudioPlayer | null>(null);

  const release = () => { const p = player.current; player.current = null; if (p) { try { p.pause(); p.remove(); } catch { /* déjà libéré */ } } };
  const stop = useCallback(() => { current.current = null; setSpeakingId(null); setLoadingId(null); release(); Speech.stop().catch(() => {}); }, []);

  const speakWithPhone = useCallback(async (id: string, words: string) => {
    const voice = await pickVoice(gender);
    if (current.current !== id) return;
    const done = () => { if (current.current === id) { current.current = null; setSpeakingId(null); } };
    Speech.speak(words, {
      language: LANG, voice: voice?.identifier,
      // Sans voix masculine sur le téléphone, une voix un peu plus grave
      pitch: gender === 'homme' && !voice ? 0.85 : 1, rate: 1,
      onDone: done, onStopped: done, onError: done,
    });
  }, [gender]);

  const speak = useCallback(async (id: string, text: string, source?: VoiceSource) => {
    const words = speakable(text);
    if (!words) return;
    release();
    await Speech.stop().catch(() => {});
    current.current = id;
    setSpeakingId(id);
    if (natural.enabled && natural.visitor && source) {
      setLoadingId(id);
      try {
        const uri = await naturalAudio(source, natural.visitor);
        if (current.current !== id) return;
        setLoadingId(null);
        await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
        const p = createAudioPlayer({ uri });
        player.current = p;
        p.addListener('playbackStatusUpdate', s => { if (s.didJustFinish && current.current === id) { current.current = null; setSpeakingId(null); release(); } });
        p.play();
        return;
      } catch {
        if (current.current !== id) return;
        setLoadingId(null); // secours : voix du téléphone
      }
    }
    await speakWithPhone(id, words);
  }, [natural.enabled, natural.visitor, speakWithPhone]);

  useEffect(() => () => { release(); Speech.stop().catch(() => {}); }, []);
  return { speakingId, loadingId, speak, stop };
}

/**
 * Dictée d'une question : le texte reconnu s'affiche au fil de la parole (onPartial), puis la phrase finale est remise à
 * onFinal à la fin de l'écoute (silence ou bouton). Les erreurs sont traduites pour le visiteur.
 */
export function useDictation({ onPartial, onFinal, onError }: { onPartial: (t: string) => void; onFinal: (t: string) => void; onError: (msg: string) => void }) {
  const [listening, setListening] = useState(false);
  // Détection d'une voix active (06/11) : niveau du micro (0 à 1) et « voix entendue » pour l'indicateur de l'écran
  const [level, setLevel] = useState(0);
  const [hearing, setHearing] = useState(false);
  const last = useRef('');
  const available = (() => { try { return ExpoSpeechRecognitionModule.isRecognitionAvailable(); } catch { return false; } })();

  useSpeechRecognitionEvent('start', () => { last.current = ''; setLevel(0); setHearing(false); setListening(true); });
  useSpeechRecognitionEvent('speechstart', () => setHearing(true));
  useSpeechRecognitionEvent('speechend', () => setHearing(false));
  // Volume de -2 à 10 ; en dessous de 0, rien d'audible
  useSpeechRecognitionEvent('volumechange', e => { const v = Math.max(0, Math.min(1, e.value / 10)); setLevel(v); if (v > 0.15) setHearing(true); });
  useSpeechRecognitionEvent('result', e => {
    const said = e.results[0]?.transcript?.trim() || '';
    if (!said) return;
    last.current = said;
    onPartial(said);
  });
  useSpeechRecognitionEvent('end', () => {
    setListening(false); setLevel(0); setHearing(false);
    const said = last.current;
    last.current = '';
    if (said) onFinal(said);
  });
  useSpeechRecognitionEvent('error', e => {
    setListening(false); setLevel(0); setHearing(false);
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
      volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
    });
  }, [onError]);

  const stop = useCallback(() => { try { ExpoSpeechRecognitionModule.stop(); } catch { /* déjà arrêtée */ } }, []);
  const abort = useCallback(() => { last.current = ''; try { ExpoSpeechRecognitionModule.abort(); } catch { /* déjà arrêtée */ } }, []);

  useEffect(() => () => { try { ExpoSpeechRecognitionModule.abort(); } catch { /* rien à arrêter */ } }, []);
  return { available, listening, level, hearing, start, stop, abort };
}
