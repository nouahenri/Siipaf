/**
 * Sita, conseillère virtuelle de SIIPAF (même assistante que la bulle du site : réglages du dashboard › Assistante du site,
 * conversations dans l'ERP › Service commercial › Conversations de Sita, canal « Application mobile »).
 * Le fil est gardé sur le téléphone ; Sita peut proposer de passer la main à un conseiller sur WhatsApp.
 * Voix (choix du client du 05/11/2026) : question posée au micro, réponse lue à voix haute ; bouton Écouter / Arrêter sous
 * chaque réponse. Réglage « Voix » du dashboard, moteurs vocaux du téléphone (src/lib/sita-voice.ts).
 */
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AccessibilityInfo, FlatList, Linking, Pressable, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Menu, MessageCircle, Mic, RotateCcw, SendHorizontal, Sparkles, Square, Volume2 } from 'lucide-react-native';
import { RoundButton } from '@/components/ui/AppHeader';
import { useMenu } from '@/providers/menu';
import { Button, ChipRow, Chip, Txt } from '@/components/ui';
import { apiUrl, publicApi } from '@/lib/api';
import { useSite } from '@/lib/content';
import { whatsapp } from '@/lib/links';
import { useDictation, useSitaSpeech } from '@/lib/sita-voice';
import { KEYS, prefs } from '@/lib/storage';
import { useT } from '@/providers/preferences';
import { useTheme } from '@/theme';

type Action = { type: string; url: string; label?: string };
type Msg = { id: string; role: 'me' | 'bot' | 'err'; text: string; actions?: Action[]; mid?: number }; // mid : identifiant de la réponse au serveur (voix de Gemini)
type SitaConfig = { enabled: boolean; name?: string; gender?: string; title?: string; photo?: string | null; greeting?: string; voice?: boolean; voice_natural?: boolean; whatsapp?: string; hours?: string; notice?: string; consent?: string; programmes?: { slug: string; name: string }[] };

const SUGGESTIONS = ['Quels programmes proposez-vous ?', 'Je vis à l’étranger : comment acheter ?', 'Combien coûte un terrain ?', 'Je veux visiter un site'];
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
function newVisitorId() {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return `app_${Array.from({ length: 28 }, () => abc[Math.floor(Math.random() * abc.length)]).join('')}`;
}

export default function Sita() {
  const t = useT();
  const { c, space, radius, fonts, shadow } = useTheme();
  const { open: openMenu } = useMenu();
  const insets = useSafeAreaInsets();
  const { contact } = useSite();
  const config = useQuery({ queryKey: ['sita-config'], queryFn: () => publicApi.get<SitaConfig>('/sita/config'), staleTime: 5 * 60 * 1000 });
  const cfg = config.data;
  const [visitor, setVisitor] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const list = useRef<FlatList<Msg>>(null);
  const name = cfg?.name || 'Sita';
  const voiceOn = cfg?.voice !== false;
  const speech = useSitaSpeech(cfg?.gender === 'homme' ? 'homme' : 'femme', { enabled: !!cfg?.voice_natural, visitor });
  const fail = useCallback((msg: string) => setMessages(m => [...m, { id: uid(), role: 'err', text: msg }]), []);
  const dictation = useDictation({ onPartial: setText, onFinal: said => send(said, true), onError: fail });
  const canTalk = voiceOn && dictation.available;
  // Sita se tait et cesse d'écouter quand on quitte l'écran
  const { stop: stopSpeech } = speech;
  const { abort: abortDictation } = dictation;
  useFocusEffect(useCallback(() => () => { stopSpeech(); abortDictation(); }, [stopSpeech, abortDictation]));
  const avatar = cfg?.photo ? { uri: apiUrl(cfg.photo)! } : cfg?.gender === 'homme' ? require('../../../assets/images/site/sita-homme.png') : require('../../../assets/images/site/sita-femme.png');

  // Identifiant du visiteur et fil de discussion gardés sur le téléphone
  useEffect(() => {
    (async () => {
      let id = await prefs.get(KEYS.visitor);
      if (!id) { id = newVisitorId(); await prefs.set(KEYS.visitor, id); }
      setVisitor(id);
      try { const saved = JSON.parse((await prefs.get(KEYS.sitaThread)) || '[]'); if (Array.isArray(saved)) setMessages(saved); } catch { /* fil illisible : on repart de zéro */ }
    })();
  }, []);
  useEffect(() => { prefs.set(KEYS.sitaThread, JSON.stringify(messages.filter(m => m.role !== 'err').slice(-60))); }, [messages]);

  /** spoken : question posée au micro, la réponse est alors lue à voix haute. */
  const send = async (raw?: string, spoken = false) => {
    const body = (raw ?? text).trim();
    if (!body || sending || !visitor) return;
    setText('');
    setSending(true);
    setMessages(m => [...m, { id: uid(), role: 'me', text: body }]);
    try {
      const r = await publicApi.post<{ reply: string; message_id?: number; actions?: Action[] }>('/sita/message', { visitor_id: visitor, message: body, page: { path: '/application' }, lang: 'fr', website: '' });
      AccessibilityInfo.announceForAccessibility(`${name} : ${r.reply}`);
      const id = uid();
      if (spoken && voiceOn) speech.speak(id, r.reply, r.message_id ? { messageId: r.message_id } : undefined);
      setMessages(m => [...m, { id, mid: r.message_id, role: 'bot', text: r.reply, actions: (r.actions || []).filter(a => a.type === 'whatsapp' && /^https:\/\/wa\.me\//.test(a.url)) }]);
    } catch (e: any) {
      setMessages(m => [...m, { id: uid(), role: 'err', text: e?.status === 429 ? 'Vous écrivez très vite : patientez quelques instants.' : e?.message || 'Je ne peux pas répondre pour le moment. Réessayez dans un instant.' }]);
    }
    setSending(false);
  };

  const restart = async () => {
    speech.stop();
    dictation.abort();
    const id = newVisitorId();
    await prefs.set(KEYS.visitor, id);
    setVisitor(id);
    setMessages([]);
  };

  const off = config.isFetched && !cfg?.enabled;
  const greeting: Msg = { id: 'hello', role: 'bot', text: cfg?.greeting || `Bonjour, je suis ${name}, conseillère virtuelle de SIIPAF. Comment puis-je vous aider ?` };
  const data = [greeting, ...messages, ...(sending ? [{ id: 'typing', role: 'bot' as const, text: '…' }] : [])];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior="padding">
      {/* En-tête */}
      <View style={{ paddingTop: insets.top + 8, paddingBottom: space.md, paddingHorizontal: space.lg, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, zIndex: 2, ...shadow(1) }}>
        <RoundButton icon={Menu} label="Menu : infos SIIPAF" onPress={openMenu} />
        <Image source={avatar} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceAlt }} accessibilityIgnoresInvertColors />
        <View style={{ flex: 1 }}>
          <Txt style={{ fontFamily: fonts.bold, fontSize: 17, color: c.ink }}>{name}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: off ? c.ink3 : '#3DDC84' }} />
            <Txt style={{ color: c.ink3, fontSize: 12 }} numberOfLines={1}>{off ? t('Indisponible pour le moment') : cfg?.title || 'Conseillère virtuelle · répond tout de suite'}</Txt>
          </View>
        </View>
        <RoundButton icon={RotateCcw} label={t('Nouvelle conversation')} onPress={restart} />
        <RoundButton icon={MessageCircle} label={t('Écrire à un conseiller sur WhatsApp')} tone="dark" onPress={() => whatsapp(cfg?.whatsapp || contact.whatsapp, 'Bonjour SIIPAF, je viens de l’application.')} />
      </View>

      {off ? (
        <View style={{ flex: 1, padding: space.xl, justifyContent: 'center', gap: space.md }}>
          <Txt variant="h2" center>{name} se repose</Txt>
          <Txt center>Nos conseillers vous répondent sur WhatsApp ou par téléphone.</Txt>
          <Button label={t('Écrire sur WhatsApp')} icon={MessageCircle} variant="whatsapp" block onPress={() => whatsapp(contact.whatsapp)} />
        </View>
      ) : (
        <>
          <FlatList
            ref={list}
            data={data}
            keyExtractor={m => m.id}
            contentContainerStyle={{ padding: space.lg, gap: space.sm }}
            onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
            ListHeaderComponent={<Txt variant="tiny" center style={{ marginBottom: space.md }}>{cfg?.notice || `${name} est une assistante virtuelle (IA) de SIIPAF. Un conseiller peut prendre le relais à tout moment.`}</Txt>}
            renderItem={({ item: m }) => {
              const mine = m.role === 'me';
              return (
                <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: 6 }}>
                  <View style={{ maxWidth: '84%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg, borderBottomRightRadius: mine ? 4 : radius.lg, borderBottomLeftRadius: mine ? radius.lg : 4,
                    backgroundColor: mine ? c.primary : m.role === 'err' ? c.dangerSoft : c.surface, borderWidth: mine ? 0 : 1, borderColor: c.line }}>
                    <Txt selectable style={{ color: mine ? '#fff' : m.role === 'err' ? c.danger : c.ink, fontSize: 15, lineHeight: 22 }}>{m.id === 'typing' ? `${name} écrit…` : m.text}</Txt>
                  </View>
                  {voiceOn && m.role === 'bot' && m.id !== 'typing' ? (() => {
                    const playing = speech.speakingId === m.id;
                    const preparing = speech.loadingId === m.id;
                    const source = m.id === 'hello' ? { greeting: true as const } : m.mid ? { messageId: m.mid } : undefined;
                    return (
                      <Pressable onPress={() => (playing ? speech.stop() : speech.speak(m.id, m.text, source))} accessibilityRole="button"
                        accessibilityLabel={playing ? t('Arrêter la lecture') : t('Écouter la réponse')} hitSlop={8}
                        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 6, minHeight: 28, opacity: pressed ? 0.6 : 1 })}>
                        {playing ? <Square size={13} color={c.primary} fill={c.primary} /> : <Volume2 size={15} color={c.ink3} />}
                        <Txt style={{ fontFamily: fonts.medium, fontSize: 12.5, color: playing ? c.primary : c.ink3 }}>{preparing ? t('Préparation de la voix…') : playing ? t('Arrêter') : t('Écouter')}</Txt>
                      </Pressable>
                    );
                  })() : null}
                  {m.actions?.map((a, i) => (
                    <Button key={i} label={a.label || 'Écrire sur WhatsApp'} icon={MessageCircle} variant="whatsapp" size="sm" onPress={() => Linking.openURL(a.url).catch(() => {})} />
                  ))}
                </View>
              );
            }}
            ListFooterComponent={messages.length === 0 ? (
              <View style={{ marginTop: space.lg, gap: space.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Sparkles size={14} color={c.accent} /><Txt variant="tiny">{t('Suggestions')}</Txt></View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {SUGGESTIONS.map(s => <Chip key={s} label={s} onPress={() => send(s)} />)}
                </View>
                {cfg?.consent ? <Txt variant="tiny" style={{ marginTop: space.sm }}>{cfg.consent}</Txt> : null}
              </View>
            ) : undefined}
          />
          {(cfg?.programmes?.length || 0) > 0 && messages.length > 0 && (
            <View style={{ paddingHorizontal: space.lg }}>
              <ChipRow>{cfg!.programmes!.map(p => <Chip key={p.slug} label={p.name} onPress={() => send(`Parlez-moi de ${p.name}`)} />)}</ChipRow>
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: space.md, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.line }}>
            <TextInput value={text} onChangeText={setText} placeholder={dictation.listening ? (dictation.hearing ? t('Je vous entends…') : t('Je vous écoute…')) : `Écrire à ${name}…`} placeholderTextColor={dictation.listening ? c.primary : c.ink3} multiline maxLength={600}
              editable={!dictation.listening}
              style={{ flex: 1, maxHeight: 120, minHeight: 46, backgroundColor: c.surfaceAlt, borderRadius: 23, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontFamily: fonts.regular, fontSize: 16, color: c.ink,
                borderWidth: 1.5, borderColor: dictation.listening ? c.primary : 'transparent' }}
              accessibilityLabel={t('Votre message')} />
            {/* Micro quand le champ est vide (ou pendant l'écoute, pour l'arrêter), sinon bouton d'envoi */}
            {canTalk && (dictation.listening || !text.trim()) ? (
              <View style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }}>
              {/* Voix détectée (06/11) : halo qui suit le volume du micro tant que la personne parle */}
              {dictation.listening ? (
                <View pointerEvents="none" style={{ position: 'absolute', width: 46 + Math.round(dictation.level * 30), height: 46 + Math.round(dictation.level * 30), borderRadius: 40,
                  backgroundColor: c.danger, opacity: dictation.hearing ? 0.18 + dictation.level * 0.25 : 0.1 }} />
              ) : null}
              <Pressable onPress={() => (dictation.listening ? dictation.stop() : dictation.start())} disabled={sending && !dictation.listening} accessibilityRole="button"
                accessibilityLabel={dictation.listening ? t('Arrêter l’écoute et envoyer') : t('Poser ma question à voix haute')} accessibilityState={{ busy: dictation.listening }}
                style={({ pressed }) => ({ width: 46, height: 46, borderRadius: 23, backgroundColor: dictation.listening ? c.danger : c.primary, alignItems: 'center', justifyContent: 'center', opacity: sending && !dictation.listening ? 0.45 : pressed ? 0.8 : 1 })}>
                {dictation.listening ? <Square size={16} color="#fff" fill="#fff" /> : <Mic size={21} color="#fff" />}
              </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => send()} disabled={!text.trim() || sending} accessibilityRole="button" accessibilityLabel={t('Envoyer')}
                style={({ pressed }) => ({ width: 46, height: 46, borderRadius: 23, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', opacity: !text.trim() || sending ? 0.45 : pressed ? 0.8 : 1 })}>
                <SendHorizontal size={20} color="#fff" />
              </Pressable>
            )}
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}
