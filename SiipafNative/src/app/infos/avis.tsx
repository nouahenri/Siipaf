/**
 * Avis clients, au format d'une app (note moyenne et liste d'avis comme dans un store) : pastille d'initiales, étoiles,
 * texte sur trois lignes dépliable. Dépôt d'un avis par le bouton de l'en-tête, validé par l'équipe dans le dashboard.
 */
import { Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { MessageSquareQuote, PenLine, Star } from 'lucide-react-native';
import { TestimonialSheet } from '@/components/site/TestimonialSheet';
import { Empty, ErrorState, IconButton, Skeleton, Txt } from '@/components/ui';
import { initials } from '@/lib/format';
import { useTestimonials } from '@/lib/queries';
import type { Testimonial } from '@/lib/types';
import { useTheme } from '@/theme';

function Stars({ n, size = 13 }: { n: number; size?: number }) {
  const { c } = useTheme();
  return <View style={{ flexDirection: 'row', gap: 1 }}>{[1, 2, 3, 4, 5].map(i => <Star key={i} size={size} color={c.goldLight} fill={i <= n ? c.goldLight : 'transparent'} />)}</View>;
}

function Review({ t }: { t: Testimonial }) {
  const { c, space, fonts } = useTheme();
  const [open, setOpen] = useState(false);
  const rating = t.rating || 5;
  return (
    <Pressable onPress={() => setOpen(o => !o)} accessibilityRole="button" accessibilityLabel={`${t.name}, ${rating} sur 5 : ${t.message}`} accessibilityHint={open ? 'Réduire' : 'Lire l’avis en entier'}
      style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: c.ink }}>{initials(t.name)}</Txt>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 14.5, color: c.ink }} numberOfLines={1}>{t.name}</Txt>
          <Stars n={rating} />
        </View>
        {(t.role_label || t.project_name) ? <Txt variant="tiny" numberOfLines={1}>{[t.role_label, t.project_name].filter(Boolean).join(' · ')}</Txt> : null}
        <Txt style={{ fontSize: 14, lineHeight: 20, color: c.ink2, marginTop: 2 }} numberOfLines={open ? undefined : 3}>{t.message}</Txt>
      </View>
    </Pressable>
  );
}

export default function Avis() {
  const { c, space, fonts, radius } = useTheme();
  const { data, error, isLoading, refetch, isRefetching } = useTestimonials();
  const [open, setOpen] = useState(false);
  const list = data || [];
  const avg = list.length ? list.reduce((s, x) => s + (x.rating || 5), 0) / list.length : 0;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ headerRight: () => <IconButton icon={PenLine} label="Donner mon avis" size={40} onPress={() => setOpen(true)} /> }} />
      {isLoading ? <View style={{ padding: space.lg, gap: space.sm }}>{[0, 1, 2, 3].map(i => <Skeleton key={i} h={72} r={12} />)}</View>
        : error && !data ? <ErrorState error={error} onRetry={refetch} /> : (
          <FlatList
            data={list}
            keyExtractor={x => String(x.id)}
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl }}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { refetch(); }} tintColor={c.primary} />}
            ListHeaderComponent={list.length ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, marginTop: space.sm, marginBottom: space.sm, borderRadius: radius.lg, backgroundColor: c.surfaceAlt }}
                accessible accessibilityLabel={`Note moyenne ${avg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} sur 5, ${list.length} avis`}>
                <Txt style={{ fontFamily: fonts.bold, fontSize: 34, color: c.ink }}>{avg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</Txt>
                <View style={{ gap: 4 }}>
                  <Stars n={Math.round(avg)} size={16} />
                  <Txt variant="small">{list.length} avis publiés après validation</Txt>
                </View>
              </View>
            ) : undefined}
            renderItem={({ item }) => <Review t={item} />}
            ListEmptyComponent={<Empty icon={MessageSquareQuote} title="Pas encore d’avis publié" text="Touchez le crayon en haut pour partager votre expérience avec SIIPAF." />}
          />
        )}
      <TestimonialSheet visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}
