/**
 * Messagerie avec l'équipe SIIPAF (client/src/pages/Messages.jsx) : fil par jour, « Lu », actualisation toutes les 30 s et à
 * chaque retour sur l'écran ; un message ouvert depuis un document arrive prérempli (paramètres context et sale).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { MessageCircle, SendHorizontal } from 'lucide-react-native';
import { ClientHeader } from '@/components/client/common';
import { Alert, Empty, ErrorState, Skeleton, Txt } from '@/components/ui';
import { clientApi } from '@/lib/api';
import { dayLabel, time } from '@/lib/format';
import { useMessages } from '@/lib/queries';
import type { Message } from '@/lib/types';
import { useSession } from '@/providers/session';
import { useTheme } from '@/theme';

export default function Messages() {
  const params = useLocalSearchParams<{ context?: string; sale?: string }>();
  const { c, space, radius, fonts } = useTheme();
  const qc = useQueryClient();
  const { selected, refreshMe } = useSession();
  const { data, error, isLoading, refetch } = useMessages();
  const [text, setText] = useState('');
  const [saleId, setSaleId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const list = useRef<FlatList<{ m: Message; day: string | null }>>(null);

  // Message ouvert depuis un document : texte prérempli (une fois par contexte reçu)
  const [appliedContext, setAppliedContext] = useState<string | undefined>(undefined);
  if (params.context && params.context !== appliedContext) {
    setAppliedContext(params.context);
    setText(params.context);
    setSaleId(Number(params.sale) || null);
  }
  // Lu dès l'ouverture : la pastille de l'onglet se met à jour
  useFocusEffect(useCallback(() => { refetch().then(() => refreshMe()); }, [refetch, refreshMe]));

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setSendError(null);
    try {
      const sale = saleId || selected?.id;
      const m = await clientApi.post<Message>('/messages', { body, ...(sale ? { sale_id: sale } : {}) });
      qc.setQueryData<Message[]>(['client', 'messages'], old => [...(old || []), m]);
      setText(''); setSaleId(null);
    } catch (e: any) { setSendError(e.message); }
    setSending(false);
  };

  const rows = (data || []).map((m, i, all) => { const day = dayLabel(m.created_at); return { m, day: i === 0 || dayLabel(all[i - 1].created_at) !== day ? day : null }; });

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior="padding">
      <ClientHeader eyebrow="Votre conseiller vous répond ici" title="Messages" />
      {isLoading ? (
        <View style={{ padding: space.lg, gap: space.md }}><Skeleton h={44} w="62%" r={20} /><Skeleton h={60} w="70%" r={20} style={{ alignSelf: 'flex-end' }} /><Skeleton h={44} w="50%" r={20} /></View>
      ) : error && !data ? <ErrorState error={error} onRetry={refetch} /> : (
        <FlatList
          ref={list}
          data={rows}
          keyExtractor={r => String(r.m.id)}
          contentContainerStyle={{ padding: space.lg, gap: 6, flexGrow: 1 }}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<Empty icon={MessageCircle} title="Une question ?" text="Posez-la ici : avancement, documents, paiements, rendez-vous de visite… Nos équipes vous répondent dans ce fil et vous préviennent par notification." />}
          renderItem={({ item: { m, day } }) => {
            const mine = m.sender === 'client';
            return (
              <View>
                {day ? <Txt variant="tiny" center style={{ marginVertical: space.sm }}>{day}</Txt> : null}
                <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '84%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg,
                  borderBottomRightRadius: mine ? 4 : radius.lg, borderBottomLeftRadius: mine ? radius.lg : 4, backgroundColor: mine ? c.dark : c.surface, borderWidth: mine ? 0 : 1, borderColor: c.line }}>
                  {!mine ? <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: c.primary, marginBottom: 2 }}>{m.author || 'Équipe SIIPAF'}</Txt> : null}
                  <Txt selectable style={{ color: mine ? '#fff' : c.ink, fontSize: 15, lineHeight: 22 }}>{m.body}</Txt>
                  <Txt style={{ fontSize: 11, color: mine ? 'rgba(255,255,255,0.6)' : c.ink3, marginTop: 4, textAlign: 'right' }}>{time(m.created_at)}{mine && m.read ? ' · Lu' : ''}</Txt>
                </View>
              </View>
            );
          }}
        />
      )}
      <View style={{ padding: space.md, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.line }}>
        <Alert>{sendError}</Alert>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <TextInput value={text} onChangeText={setText} placeholder="Écrire à SIIPAF…" placeholderTextColor={c.ink3} multiline maxLength={4000}
            style={{ flex: 1, maxHeight: 140, minHeight: 46, backgroundColor: c.surfaceAlt, borderRadius: 23, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontFamily: fonts.regular, fontSize: 16, color: c.ink }}
            accessibilityLabel="Votre message" />
          <Pressable onPress={send} disabled={!text.trim() || sending} accessibilityRole="button" accessibilityLabel="Envoyer"
            style={({ pressed }) => ({ width: 46, height: 46, borderRadius: 23, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', opacity: !text.trim() || sending ? 0.45 : pressed ? 0.8 : 1 })}>
            <SendHorizontal size={20} color="#fff" />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
