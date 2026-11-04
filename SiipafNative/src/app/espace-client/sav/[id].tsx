/**
 * Suivi d'une demande SAV : statut et étapes, intervention prévue, fil des échanges avec photos, réponse avec photos,
 * avis de satisfaction une fois le problème résolu.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { CalendarClock, SendHorizontal, Star } from 'lucide-react-native';
import { PhotoField, PhotoStrip } from '@/components/client/Photos';
import { Alert, Badge, Button, Callout, Card, ErrorState, Field, PageSkeleton, Screen, Steps, Txt } from '@/components/ui';
import { clientApi } from '@/lib/api';
import { savStatus } from '@/lib/domain';
import { dayLabel, shortDate, time } from '@/lib/format';
import { useSavTicket } from '@/lib/queries';
import type { SavFile, SavTicket } from '@/lib/types';
import { useToast } from '@/providers/toast';
import { useTheme } from '@/theme';

export default function SavDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, space, radius, fonts } = useTheme();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: t, error, isLoading, refetch, isRefetching } = useSavTicket(Number(id));
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<SavFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');

  if (isLoading) return <PageSkeleton />;
  if (error || !t) return <ErrorState error={error} onRetry={refetch} />;
  const st = savStatus(t.status);
  const done = (out: SavTicket) => { qc.setQueryData(['client', 'sav', Number(id)], out); qc.invalidateQueries({ queryKey: ['client', 'sav'], exact: true }); };
  const upcoming = t.interventions.filter(i => i.status === 'planifiee');
  const canReply = !['clos', 'rejete'].includes(t.status);

  const reply = async () => {
    setBusy(true); setSendError(null);
    try { done(await clientApi.post<SavTicket>(`/sav/${t.id}/comments`, { body: text.trim(), media_ids: photos.map(p => p.id) })); setText(''); setPhotos([]); } catch (e: any) { setSendError(e.message); }
    setBusy(false);
  };
  const rate = async () => {
    setBusy(true); setSendError(null);
    try { done(await clientApi.post<SavTicket>(`/sav/${t.id}/rating`, { satisfaction: score, comment: comment.trim() || undefined })); toast('Merci pour votre avis'); } catch (e: any) { setSendError(e.message); }
    setBusy(false);
  };

  const bubble = (mine: boolean, children: ReactNode, key: string) => (
    <View key={key} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '86%', padding: 12, borderRadius: radius.lg, backgroundColor: mine ? c.dark : c.surface, borderWidth: mine ? 0 : 1, borderColor: c.line }}>{children}</View>
  );

  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}>
      <Stack.Screen options={{ title: t.ref }} />
      <Txt variant="h2">{t.title}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <Badge label={st.label} tone={st.tone} />
        <Txt variant="small">{t.ref}{t.lot_code ? ` · lot ${t.lot_code}` : ''}</Txt>
      </View>
      <Steps step={st.step} />
      <Txt variant="small" style={{ marginTop: space.sm }}>{st.hint}</Txt>

      {upcoming.map(i => (
        <View key={i.id} style={{ marginTop: space.md }}>
          <Callout icon={CalendarClock} title={`Intervention le ${dayLabel(i.scheduled_at).toLowerCase()} à ${time(i.scheduled_at)}`} text={`Durée prévue : environ ${i.duration_min || 60} minutes. Merci d’être présent ou de nous prévenir ici.`} />
        </View>
      ))}

      {['resolu', 'clos'].includes(t.status) && !t.satisfaction && (
        <Card style={{ marginTop: space.lg }}>
          <Txt variant="bodyStrong">Le problème est-il bien réglé ?</Txt>
          <Txt variant="small">Notez l’intervention. Si ce n’est pas réglé, répondez plutôt dans le fil ci-dessous.</Txt>
          <View style={{ flexDirection: 'row', gap: 8, marginVertical: space.md }} accessibilityRole="radiogroup">
            {[1, 2, 3, 4, 5].map(n => (
              <Pressable key={n} onPress={() => setScore(n)} accessibilityRole="radio" accessibilityState={{ checked: score === n }} accessibilityLabel={`${n} sur 5`} hitSlop={6}>
                <Star size={34} color={c.goldLight} fill={n <= score ? c.goldLight : 'transparent'} />
              </Pressable>
            ))}
          </View>
          {score > 0 && <>
            <Field label="Un commentaire ? (facultatif)" value={comment} onChangeText={setComment} multiline maxLength={500} />
            <Button label="Envoyer mon avis" size="sm" loading={busy} onPress={rate} />
          </>}
        </Card>
      )}
      {t.satisfaction ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.md }}>
          <Txt variant="small">Votre avis :</Txt>
          {[1, 2, 3, 4, 5].map(n => <Star key={n} size={16} color={c.goldLight} fill={n <= (t.satisfaction || 0) ? c.goldLight : 'transparent'} />)}
        </View>
      ) : null}

      <View style={{ gap: space.sm, marginTop: space.xl }}>
        {(t.description || t.media.length > 0) && bubble(true, <>
          {t.description ? <Txt style={{ color: '#fff', fontSize: 15 }}>{t.description}</Txt> : null}
          <PhotoStrip files={t.media} />
          <Txt style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 4 }}>{shortDate(t.created_at)}</Txt>
        </>, 'desc')}
        {t.events.map((e, idx, all) => {
          const day = dayLabel(e.created_at);
          const showDay = idx === 0 || dayLabel(all[idx - 1].created_at) !== day;
          const dayRow = showDay ? <Txt key={`d${e.id}`} variant="tiny" center style={{ marginTop: space.sm }}>{day}</Txt> : null;
          if (e.kind !== 'comment') return <View key={e.id}>{dayRow}<Txt variant="tiny" center style={{ fontFamily: fonts.medium, color: c.ink2 }}>{e.body}</Txt></View>;
          const mine = e.author === 'client';
          return (
            <View key={e.id}>
              {dayRow}
              {bubble(mine, <>
                {!mine ? <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: c.primary }}>{e.user_name || 'Équipe SIIPAF'}</Txt> : null}
                <Txt style={{ color: mine ? '#fff' : c.ink, fontSize: 15 }}>{e.body}</Txt>
                <PhotoStrip files={e.media} />
                <Txt style={{ color: mine ? 'rgba(255,255,255,0.6)' : c.ink3, fontSize: 11, marginTop: 4, textAlign: 'right' }}>{time(e.created_at)}</Txt>
              </>, `b${e.id}`)}
            </View>
          );
        })}
        {t.interventions.filter(i => i.status === 'realisee' && i.media_after.length).map(i => bubble(false, <>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: c.primary }}>Après intervention</Txt>
          <PhotoStrip files={i.media_after} />
        </>, `i${i.id}`))}
      </View>

      {canReply && (
        <Card style={{ marginTop: space.xl }}>
          <Alert>{sendError}</Alert>
          <Field label="Ajouter une précision" value={text} onChangeText={setText} multiline maxLength={4000} placeholder="Votre message…" />
          <PhotoField value={photos} onChange={setPhotos} />
          <Button label="Envoyer" icon={SendHorizontal} variant="dark" size="sm" loading={busy} disabled={!text.trim()} onPress={reply} />
        </Card>
      )}
    </Screen>
  );
}
