/**
 * Accueil de l'application SIIPAF : barre fixe avec le menu latéral et l'espace client ; dessous, tout défile : carte de
 * marque (logo, agrément), titre « Trouvez votre bien », recherche, choix Logements / Terrains, programmes à la une en carrousel, puis tous les
 * programmes en cartes. Pas de héros, de bannière ni de bloc de fin de page. Données lues dans le dashboard.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { BadgeCheck, Building, ChevronRight, CircleUserRound, LandPlot, SlidersHorizontal, type LucideIcon } from 'lucide-react-native';
import { FeaturedCard, ResultCard, SectionTitle } from '@/components/site/Blocks';
import { SearchBox } from '@/components/site/SearchBox';
import { AppHeader, RoundButton } from '@/components/ui/AppHeader';
import { Empty, ErrorState, Skeleton, Txt } from '@/components/ui';
import { LOGO_ON_DARK, LOGO_RATIO } from '@/lib/content';
import { isLotissement } from '@/lib/domain';
import * as Haptics from '@/lib/haptics';
import { useProjects } from '@/lib/queries';
import { useT } from '@/providers/preferences';
import { useSession } from '@/providers/session';
import { useTheme } from '@/theme';

function KindCard({ icon: Icon, label, sub, onPress }: { icon: LucideIcon; label: string; sub: string; onPress: () => void }) {
  const { c, fonts, radius, space, shadow } = useTheme();
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} accessibilityRole="button" accessibilityLabel={`${label}, ${sub}`}
      style={({ pressed }) => ({ flex: 1, padding: space.md, borderRadius: radius.lg, backgroundColor: c.surface, gap: space.sm, ...shadow(1), transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.dangerSoft, alignItems: 'center', justifyContent: 'center' }}><Icon size={22} color={c.primary} /></View>
        <ChevronRight size={18} color={c.ink3} />
      </View>
      <View>
        <Txt style={{ fontFamily: fonts.bold, fontSize: 16, color: c.ink }}>{label}</Txt>
        <Txt style={{ fontSize: 13, color: c.ink3 }}>{sub}</Txt>
      </View>
    </Pressable>
  );
}

/** Carte de marque (noire, coins arrondis) : logo, agrément, villes et nombre de programmes. */
function BrandCard({ count, cities }: { count: number; cities: string[] }) {
  const { c, fonts, space } = useTheme();
  const t = useT();
  return (
    <View style={{ minHeight: 140, borderRadius: 30, backgroundColor: '#0A0A0A', padding: space.lg, overflow: 'hidden', justifyContent: 'space-between' }}
      accessible accessibilityLabel={`SIIPAF SA, ${t('Promoteur agréé MCLU')}${cities.length ? `, ${cities.join(', ')}` : ''}`}>
      {/* Décor : formes aux couleurs SIIPAF */}
      <View style={{ position: 'absolute', right: -34, top: -30, width: 150, height: 150, borderRadius: 75, backgroundColor: c.red, opacity: 0.9 }} />
      <View style={{ position: 'absolute', right: 54, bottom: -46, width: 104, height: 104, borderRadius: 52, borderWidth: 18, borderColor: c.goldLight, opacity: 0.85 }} />
      <View style={{ position: 'absolute', right: 18, top: 62, width: 46, height: 46, borderRadius: 14, backgroundColor: '#fff', opacity: 0.12, transform: [{ rotate: '18deg' }] }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Image source={LOGO_ON_DARK} style={{ width: 165, height: 165 / LOGO_RATIO }} contentFit="contain" accessibilityElementsHidden />
      </View>
      {/* Agrément : en haut à droite, sur le disque rouge */}
      <View style={{ position: 'absolute', top: space.lg, right: space.md, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }}>
        <BadgeCheck size={13} color="#fff" />
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 11, color: '#fff' }} numberOfLines={1}>{t('Promoteur agréé MCLU')}</Txt>
      </View>
      {cities.length ? <Txt style={{ marginTop: space.sm, maxWidth: '62%', fontSize: 12.5, color: 'rgba(255,255,255,0.7)' }} numberOfLines={1}>{cities.join(' · ')}</Txt> : null}
      {count ? (
        <View style={{ position: 'absolute', right: space.lg, bottom: space.lg, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 12.5, color: '#0A0A0A' }}>{t('{n} programme(s)', { n: count })}</Txt>
        </View>
      ) : null}
    </View>
  );
}

export default function Home() {
  const { c, space } = useTheme();
  const t = useT();
  const { status } = useSession();
  const projects = useProjects();
  const [refreshing, setRefreshing] = useState(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const searchY = useRef(0);
  const all = useMemo(() => projects.data || [], [projects.data]);
  const connected = status === 'ready' || status === 'locked';
  const refresh = async () => { setRefreshing(true); await projects.refetch(); setRefreshing(false); };
  const explore = (type: 'tous' | 'promotion' | 'lotissement') => router.navigate({ pathname: '/programmes', params: { type } });
  const homes = all.filter(p => !isLotissement(p)).length;
  const cities = [...new Set(all.map(p => p.city).filter(Boolean) as string[])];
  const lands = all.filter(isLotissement).length;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <AppHeader compact
        right={<RoundButton icon={CircleUserRound} label={connected ? t('Ouvrir mon espace client') : t('Espace client : se connecter')} badge={connected} onPress={() => router.push(connected ? '/espace-client' : '/espace')} />} />

      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'} contentContainerStyle={{ paddingTop: space.md, paddingBottom: space.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} colors={[c.primary]} />}>
        <View style={{ paddingHorizontal: space.lg }}>
          <BrandCard count={all.length} cities={cities} />
          <Txt variant="h1" style={{ marginTop: space.lg, marginBottom: space.md }} accessibilityRole="header">{t('Trouvez votre bien')}</Txt>
          {/* Au toucher, la recherche remonte en haut de l'écran pour laisser la place aux suggestions au-dessus du clavier */}
          <View onLayout={e => { searchY.current = e.nativeEvent.layout.y; }}>
            <SearchBox onFocus={() => scroll.current?.scrollTo({ y: Math.max(0, searchY.current + space.md - 8), animated: true })} />
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, marginTop: space.lg }}>
          <KindCard icon={Building} label={t('Logements')} sub={t('{n} programme(s)', { n: homes })} onPress={() => explore('promotion')} />
          <KindCard icon={LandPlot} label={t('Terrains')} sub={t('{n} programme(s)', { n: lands })} onPress={() => explore('lotissement')} />
        </View>

        {projects.isLoading ? (
          <View style={{ padding: space.lg, gap: space.md }}><Skeleton h={210} r={16} /><Skeleton h={280} r={22} /></View>
        ) : projects.error && !projects.data ? <ErrorState error={projects.error} onRetry={projects.refetch} />
          : !all.length ? <Empty icon={Building} title={t('Programmes bientôt en ligne')} text={t('Nos prochains lancements apparaîtront ici.')} /> : (
            <>
              <View style={{ paddingHorizontal: space.lg }}><SectionTitle title={t('À la une')} /></View>
              <FlatList
                data={all.slice(0, 6)}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={p => p.slug}
                contentContainerStyle={{ gap: space.md, paddingHorizontal: space.lg }}
                renderItem={({ item }) => <FeaturedCard p={item} />}
              />
              <View style={{ paddingHorizontal: space.lg }}>
                <SectionTitle title={t('Tous les programmes')} action={t('Rechercher')} actionIcon={SlidersHorizontal} onAction={() => explore('tous')} />
                {all.map((p, i) => <ResultCard key={p.slug} p={p} rank={i} />)}
              </View>
            </>
          )}
      </ScrollView>
    </View>
  );
}
