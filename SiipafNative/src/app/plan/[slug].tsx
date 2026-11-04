/**
 * Plan interactif d'un programme (plan-interactif.html) : plans publiés, légende des statuts (toucher pour masquer),
 * recherche d'un lot par son numéro, fiche du lot touché avec « Ce lot m'intéresse », « Pré-réserver » et « Visiter ».
 */
import * as Haptics from '@/lib/haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, Heart, Lock, Search, X } from 'lucide-react-native';
import { PlanView } from '@/components/site/PlanView';
import { Badge, Button, Chip, ChipRow, Empty, ErrorState, IconButton, PageSkeleton, Txt } from '@/components/ui';
import { LOT_COLORS } from '@/lib/domain';
import { amount, fcfa } from '@/lib/format';
import { useProject } from '@/lib/queries';
import type { PlanLot } from '@/lib/types';
import { useTheme } from '@/theme';

const ORDER = ['disponible', 'desistement', 'option', 'reserve', 'vendu', 'bloque'];

export default function PlanScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { c, space, radius, fonts, shadow } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { data: p, error, isLoading, refetch } = useProject(slug);
  const [planIdx, setPlanIdx] = useState(0);
  const [lot, setLot] = useState<PlanLot | null>(null);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [notFound, setNotFound] = useState(false);

  const plans = p?.plans || [];
  const plan = plans[Math.min(planIdx, plans.length - 1)];
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    (plan?.lots || []).forEach(l => { out[l.status] = (out[l.status] || 0) + 1; });
    return out;
  }, [plan]);

  if (isLoading) return <PageSkeleton />;
  if (error || !p) return <ErrorState error={error} onRetry={refetch} />;
  if (!plan) return <><Stack.Screen options={{ title: p.name }} /><Empty title="Plan bientôt disponible" text="Le plan interactif de ce programme sera publié prochainement." /></>;

  const pick = (l: PlanLot | null) => { if (l) Haptics.selectionAsync().catch(() => {}); setLot(l); };
  const search = () => {
    const code = query.trim().toLowerCase().replace(/^lot\s*/, '');
    if (!code) return;
    for (let i = 0; i < plans.length; i++) {
      const found = plans[i].lots.find(l => String(l.code).toLowerCase() === code);
      if (found) { setPlanIdx(i); pick(found); setNotFound(false); return; }
    }
    setNotFound(true);
  };
  const go = (type: 'interet' | 'option' | 'rdv') => lot && router.push({ pathname: '/demande', params: { type, projet: p.slug, lot: String(lot.id), lotCode: lot.code } });
  const mapH = height - insets.top - 56 - 150;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: p.name }} />
      <View style={{ padding: space.md, gap: space.sm, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: 14, height: 44 }}>
          <Search size={18} color={c.ink3} />
          <TextInput value={query} onChangeText={v => { setQuery(v); setNotFound(false); }} onSubmitEditing={search} returnKeyType="search" placeholder="Rechercher un lot (ex. A12)" placeholderTextColor={c.ink3} autoCapitalize="characters"
            style={{ flex: 1, fontFamily: fonts.regular, fontSize: 15, color: c.ink }} accessibilityLabel="Numéro du lot" />
          {notFound ? <Txt variant="tiny" style={{ color: c.danger }}>Introuvable</Txt> : null}
        </View>
        {plans.length > 1 && <ChipRow>{plans.map((pl, i) => <Chip key={pl.id} label={pl.name} selected={i === planIdx} onPress={() => { setPlanIdx(i); setLot(null); }} />)}</ChipRow>}
        <ChipRow>
          {ORDER.filter(s => counts[s]).map(s => (
            <Pressable key={s} onPress={() => setHidden(h => ({ ...h, [s]: !h[s] }))} accessibilityRole="button" accessibilityState={{ selected: !hidden[s] }} accessibilityLabel={`${p.statuses[s]} : ${counts[s]}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, opacity: hidden[s] ? 0.4 : 1 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: LOT_COLORS[s] }} />
              <Txt style={{ fontFamily: fonts.medium, fontSize: 12, color: c.ink }}>{(p.statuses[s] || s).replace(/ —.*$/, '').replace(/ \(.*\)$/, '')} {counts[s]}</Txt>
            </Pressable>
          ))}
        </ChipRow>
      </View>

      <PlanView plan={plan} width={width} height={Math.max(300, mapH)} selectedId={lot?.id} hidden={hidden} onSelect={pick} />
      <Txt variant="tiny" center style={{ paddingVertical: 6 }}>Pincez pour zoomer · double toucher · touchez un lot</Txt>

      {lot && (
        <View style={{ position: 'absolute', left: space.md, right: space.md, bottom: Math.max(insets.bottom, space.md), backgroundColor: c.surface, borderRadius: radius.xl, padding: space.lg, ...shadow(2) }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Txt variant="h2">Lot {lot.code}</Txt>
              <Txt variant="small">{[lot.ilot && `Îlot ${lot.ilot}`, lot.surface_m2 && `${amount(lot.surface_m2)} m²`].filter(Boolean).join(' · ') || p.name}</Txt>
            </View>
            <Badge label={(p.statuses[lot.status] || lot.status).replace(/ —.*$/, '')} tone={lot.sellable ? 'ok' : 'muted'} />
            <IconButton icon={X} label="Fermer la fiche du lot" size={34} onPress={() => setLot(null)} />
          </View>
          {lot.price_fcfa ? <Txt style={{ fontFamily: fonts.bold, fontSize: 20, color: c.primary, marginTop: space.sm }}>{fcfa(lot.price_fcfa)}</Txt> : null}
          {lot.sellable ? (
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
              <Button label="Intérêt" icon={Heart} variant="ghost" style={{ flex: 1 }} onPress={() => go('interet')} />
              <Button label="Pré-réserver" icon={Lock} style={{ flex: 1.2 }} haptic onPress={() => go('option')} />
            </View>
          ) : (
            <Txt variant="small" style={{ marginTop: space.sm }}>Ce lot n’est pas disponible. Un conseiller peut vous proposer un lot voisin.</Txt>
          )}
          <Button label="Visiter le site" icon={CalendarDays} variant="outline" size="sm" block style={{ marginTop: space.sm }} onPress={() => go('rdv')} />
        </View>
      )}
    </View>
  );
}
