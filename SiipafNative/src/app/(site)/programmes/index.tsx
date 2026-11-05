/**
 * Recherche des programmes : champ de recherche, Logements / Terrains, menus déroulants tirés de la base (ville,
 * localisation rattachée à la ville, budget par paliers réglés dans le dashboard, type de bien), tri, cartes de résultat.
 * La recherche lancée depuis l'accueil arrive par les paramètres (type, q) ; la ville préférée de Paramètres est
 * présélectionnée.
 */
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { Building, RotateCcw, Search, X } from 'lucide-react-native';
import { ResultCard, minPrice } from '@/components/site/Blocks';
import { AppHeader } from '@/components/ui/AppHeader';
import { Select, type SelectOption } from '@/components/ui/Select';
import { Empty, ErrorState, Segmented, Skeleton, Txt } from '@/components/ui';
import { isLotissement } from '@/lib/domain';
import { useFilters, useProjects } from '@/lib/queries';
import type { Project } from '@/lib/types';
import { usePrefs } from '@/providers/preferences';
import { useTheme } from '@/theme';

type Kind = 'tous' | 'promotion' | 'lotissement';
type Sort = 'defaut' | 'prix_asc' | 'prix_desc';
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const prices = (p: Project) => (p.offers || []).map(o => Number(o.price_fcfa)).filter(n => n > 0);

export default function Programmes() {
  const params = useLocalSearchParams<{ type?: string; q?: string; ville?: string; lieu?: string; bien?: string }>();
  const { c, space, radius, fonts } = useTheme();
  const { prefs, t } = usePrefs();
  const { data, error, isLoading, refetch } = useProjects();
  const filters = useFilters();
  // Roue affichée seulement pour un geste de l'utilisateur, jusqu'à la fin des deux rechargements
  // (pas lors des rechargements automatiques, au retour dans l'application par exemple)
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try { await Promise.all([refetch(), filters.refetch()]); } finally { setRefreshing(false); }
  };
  const [kind, setKind] = useState<Kind>('tous');
  const [city, setCity] = useState<number | null>(prefs.preferredCity);
  const [place, setPlace] = useState<number | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  const [propType, setPropType] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('defaut');

  // Recherche lancée depuis l'accueil : appliquée à chaque nouvelle demande
  const paramsKey = `${params.type ?? ''}|${params.q ?? ''}|${params.ville ?? ''}|${params.lieu ?? ''}|${params.bien ?? ''}`;
  const [appliedKey, setAppliedKey] = useState('||||');
  if (paramsKey !== appliedKey) {
    setAppliedKey(paramsKey);
    if (params.type) setKind((['promotion', 'lotissement'].includes(params.type) ? params.type : 'tous') as Kind);
    if (params.q !== undefined) setQ(params.q);
    if (params.ville) setCity(Number(params.ville) || null);
    if (params.lieu) setPlace(Number(params.lieu) || null);
    if (params.bien) setPropType(Number(params.bien) || null);
    // Une suggestion précise remplace le texte et les autres filtres de la recherche précédente
    if (params.ville || params.lieu || params.bien) { if (params.q === undefined) setQ(''); if (!params.lieu) setPlace(null); if (!params.bien) setPropType(null); setBudget(null); }
  }

  const all = useMemo(() => data || [], [data]);
  const f = filters.data;
  const tier = f?.budgets.find(b => b.key === budget);
  const shown = all.filter(p => {
    if (kind !== 'tous' && (kind === 'lotissement') !== isLotissement(p)) return false;
    if (city && p.city_id !== city) return false;
    if (place && p.location_id !== place) return false;
    if (propType && !(p.property_type_ids || []).includes(propType)) return false;
    if (tier && !prices(p).some(n => n >= tier.min && (tier.max == null || n < tier.max))) return false;
    if (q.trim() && !norm([p.name, p.city, p.location, p.tagline, ...p.property_types].filter(Boolean).join(' ')).includes(norm(q.trim()))) return false;
    return true;
  });
  const list = sort === 'defaut' ? shown : [...shown].sort((a, b) => ((minPrice(a) ?? Infinity) - (minPrice(b) ?? Infinity)) * (sort === 'prix_asc' ? 1 : -1));
  const active = [city, place, budget, propType].filter(Boolean).length + (q.trim() ? 1 : 0) + (kind !== 'tous' ? 1 : 0);
  const reset = () => { setKind('tous'); setCity(null); setPlace(null); setBudget(null); setPropType(null); setQ(''); };

  const villes: SelectOption<number | null>[] = (f?.villes || []).map(v => ({ value: v.id, label: v.label, count: v.count }));
  const places: SelectOption<number | null>[] = (f?.localisations || []).filter(l => !city || l.ville_id === city)
    .map(l => ({ value: l.id, label: l.label, count: l.count, hint: city ? undefined : f?.villes.find(v => v.id === l.ville_id)?.label }));
  const budgets: SelectOption<string | null>[] = (f?.budgets || []).map(b => ({ value: b.key, label: b.label, count: b.count }));
  const types: SelectOption<number | null>[] = (f?.types_bien || []).map(x => ({ value: x.id, label: x.label, count: x.count }));
  const sorts: SelectOption<Sort>[] = [{ value: 'defaut', label: t('Recommandés') }, { value: 'prix_asc', label: t('Prix croissant') }, { value: 'prix_desc', label: t('Prix décroissant') }];

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <AppHeader title={t('Rechercher')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surfaceAlt, borderRadius: radius.pill, paddingLeft: 16, paddingRight: 4, height: 50 }}>
          <Search size={19} color={c.ink3} />
          <TextInput value={q} onChangeText={setQ} placeholder={t('Programme, ville, type de bien…')} placeholderTextColor={c.ink3} returnKeyType="search"
            style={{ flex: 1, fontFamily: fonts.regular, fontSize: 15.5, color: c.ink }} accessibilityLabel={t('Rechercher un programme')} />
          {q ? (
            <Pressable onPress={() => setQ('')} accessibilityRole="button" accessibilityLabel={t('Effacer la recherche')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <X size={18} color={c.ink3} />
            </Pressable>
          ) : null}
        </View>
        <View style={{ marginTop: space.md }}>
          <Segmented value={kind} onChange={setKind} options={[
            ['tous', t('Tout')],
            ['promotion', `${t('Logements')}${f ? ` · ${f.categories.logement}` : ''}`],
            ['lotissement', `${t('Terrains')}${f ? ` · ${f.categories.lotissement}` : ''}`],
          ]} />
        </View>
      </AppHeader>

      {/* Menus déroulants */}
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm }}>
          <Select label={t('Ville')} allLabel={t('Toutes les villes')} value={city} options={villes} onChange={v => { setCity(v); setPlace(null); }} />
          <Select label={t('Localisation')} allLabel={t('Toutes les localisations')} value={place} options={places} onChange={setPlace} />
          <Select label={t('Budget')} allLabel={t('Tous les budgets')} value={budget} options={budgets} onChange={setBudget} />
          <Select label={t('Type de bien')} allLabel={t('Tous les types')} value={propType} options={types} onChange={setPropType} />
        </ScrollView>
      </View>

      {isLoading ? (
        <View style={{ padding: space.lg, gap: space.md }}>{[0, 1].map(i => <Skeleton key={i} h={300} r={22} />)}</View>
      ) : error && !data ? <ErrorState error={error} onRetry={refetch} /> : (
        <FlatList
          data={list}
          keyExtractor={p => p.slug}
          renderItem={({ item, index }) => <ResultCard p={item} rank={index} />}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} colors={[c.primary]} />}
          ListHeaderComponent={(
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: space.sm }}>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: c.ink }}>{t('{n} résultat(s)', { n: list.length })}</Txt>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {active > 0 ? (
                  <Pressable onPress={reset} accessibilityRole="button" accessibilityLabel={t('Réinitialiser les filtres')} hitSlop={6}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 8 }}>
                    <RotateCcw size={15} color={c.primary} /><Txt style={{ fontFamily: fonts.semibold, fontSize: 13.5, color: c.primary }}>{t('Réinitialiser')}</Txt>
                  </Pressable>
                ) : null}
                <Select label={t('Trier')} allLabel={t('Recommandés')} value={sort === 'defaut' ? null as unknown as Sort : sort} options={sorts.slice(1)} onChange={v => setSort((v as Sort) || 'defaut')} />
              </View>
            </View>
          )}
          ListEmptyComponent={<Empty icon={Building} title={t('Aucun programme pour cette recherche')} text={t('Élargissez vos filtres, ou demandez à un conseiller les prochains lancements.')} />}
        />
      )}
    </View>
  );
}
