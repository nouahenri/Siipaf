/**
 * Blocs de la vitrine, en format d'application (pas de bannière ni de section « site ») : carte de résultat (recherche,
 * accueil), carte « À la une » (carrousel), cartes éditoriales en liste (textes réglés
 * dans le dashboard).
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Check, ChevronRight, MapPin, type LucideIcon } from 'lucide-react-native';
import { Card, Title, Txt, plain } from '@/components/ui';
import { cardsOf, useSite } from '@/lib/content';
import { isLotissement, projectKind } from '@/lib/domain';
import { fcfa, money } from '@/lib/format';
import { openLink } from '@/lib/links';
import { projectImage } from '@/lib/queries';
import type { Project } from '@/lib/types';
import { usePrefs } from '@/providers/preferences';
import { useTheme } from '@/theme';

export function minPrice(p: Project) {
  const prices = (p.offers || []).map(o => Number(o.price_fcfa)).filter(n => n > 0);
  return prices.length ? Math.min(...prices) : null;
}
export const available = (p: Project) => (p.lots?.disponible || 0) + (p.lots?.desistement || 0);

/* ─── Carte de résultat (recherche et liste de l'accueil) ─── */
function ResultCardBase({ p, rank = 0 }: { p: Project; rank?: number }) {
  const { c, fonts, radius, space, shadow } = useTheme();
  const { prefs, t } = usePrefs();
  const from = minPrice(p);
  const free = available(p);
  const place = [p.location?.split(/[—,–]/)[0]?.trim(), p.city].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ');
  const content = (
    <Pressable onPress={() => router.push(`/projet/${p.slug}`)} accessibilityRole="button"
      accessibilityLabel={[p.name, projectKind(p), place, free ? t('{n} disponible(s)', { n: free }) : null, from ? t('dès {prix}', { prix: money(from, prefs.currency) }) : t('Prix sur demande')].filter(Boolean).join(', ')}
      style={({ pressed }) => ({ borderRadius: radius.xl, backgroundColor: c.surface, marginBottom: space.md, ...shadow(1), transform: [{ scale: pressed ? 0.985 : 1 }] })}>
      <View style={{ padding: 8, paddingBottom: 0 }}>
        <Image source={projectImage(p)} style={{ height: 176, borderRadius: radius.lg, backgroundColor: c.surfaceAlt }} contentFit="cover" transition={prefs.reduceMotion ? 0 : 200} recyclingKey={`r-${p.slug}`} />
        <View style={{ position: 'absolute', top: 18, left: 18, right: 18, flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: '#141414' }}>{isLotissement(p) ? t('Terrain') : t('Logement')}</Txt>
          </View>
          {free > 0 ? (
            <View style={{ backgroundColor: c.available, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: '#fff' }}>{t('{n} disponible(s)', { n: free })}</Txt>
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ padding: space.md, paddingTop: 10, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <Txt style={{ flex: 1, fontFamily: fonts.bold, fontSize: 16.5, color: c.ink }} numberOfLines={2}>{p.name}</Txt>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><ChevronRight size={18} color={c.ink} /></View>
        </View>
        {place ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MapPin size={14} color={c.ink3} /><Txt style={{ flex: 1, fontSize: 13, color: c.ink3 }} numberOfLines={1}>{place}</Txt>
          </View>
        ) : null}
        {p.property_types.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {p.property_types.slice(0, 3).map(tp => (
              <View key={tp} style={{ backgroundColor: c.surfaceAlt, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}><Txt style={{ fontSize: 12, color: c.ink2 }}>{tp}</Txt></View>
            ))}
            {p.property_types.length > 3 ? <Txt style={{ fontSize: 12, color: c.ink3, alignSelf: 'center' }}>+{p.property_types.length - 3}</Txt> : null}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
          {from ? <>
            <Txt style={{ fontSize: 12.5, color: c.ink3 }}>{t('À partir de')}</Txt>
            <Txt style={{ fontFamily: fonts.bold, fontSize: 17, color: c.primary }}>{money(from, prefs.currency)}</Txt>
          </> : <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: c.ink2 }}>{t('Prix sur demande')}</Txt>}
        </View>
      </View>
    </Pressable>
  );
  return prefs.reduceMotion ? content : <Animated.View entering={FadeInDown.duration(260).delay(Math.min(rank, 6) * 40)}>{content}</Animated.View>;
}
export const ResultCard = memo(ResultCardBase);

/* ─── Carte « À la une » (carrousel de l'accueil) ─── */
export function FeaturedCard({ p }: { p: Project }) {
  const { c, fonts, radius, space } = useTheme();
  const { prefs, t } = usePrefs();
  const from = minPrice(p);
  const free = available(p);
  return (
    <Pressable onPress={() => router.push(`/projet/${p.slug}`)} accessibilityRole="button"
      accessibilityLabel={[p.name, p.city, free ? `${free} disponible${free > 1 ? 's' : ''}` : null, from ? `dès ${fcfa(from)}` : null].filter(Boolean).join(', ')}
      style={({ pressed }) => ({ width: 232, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <View>
        <Image source={projectImage(p)} style={{ height: 150, borderRadius: radius.lg, backgroundColor: c.surfaceAlt }} contentFit="cover" transition={200} recyclingKey={`f-${p.slug}`} />
        {free > 0 ? <View style={{ position: 'absolute', top: space.sm, left: space.sm, backgroundColor: c.surface, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}><Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: c.ok }}>{t('{n} disponible(s)', { n: free })}</Txt></View> : null}
      </View>
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.ink, marginTop: 8 }} numberOfLines={1}>{p.name}</Txt>
      <Txt style={{ fontSize: 13, color: c.ink3 }} numberOfLines={1}>{[projectKind(p), p.city].filter(Boolean).join(' · ')}</Txt>
      <Txt style={{ fontFamily: fonts.bold, fontSize: 14.5, color: c.primary, marginTop: 2 }}>{from ? t('dès {prix}', { prix: money(from, prefs.currency) }) : t('Prix sur demande')}</Txt>
    </Pressable>
  );
}

/* ─── Titre de section avec « Tout voir » ─── */
/** Titre de section ; `actionIcon` : pastille d'action avec icône (ex. filtres de la recherche). */
export function SectionTitle({ title, action, onAction, actionIcon: Icon }: { title: string; action?: string; onAction?: () => void; actionIcon?: LucideIcon }) {
  const { c, fonts, space, radius } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.md }}>
      <Txt variant="h2" accessibilityRole="header">{title}</Txt>
      {action ? (
        <Pressable onPress={onAction} hitSlop={6} accessibilityRole="button" accessibilityLabel={action}
          style={({ pressed }) => (Icon ? { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: pressed ? c.line : c.dangerSoft } : null)}>
          {Icon ? <Icon size={16} color={c.primary} /> : null}
          <Txt style={{ fontFamily: fonts.semibold, color: c.primary, fontSize: 14 }}>{action}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ─── Section éditoriale : titre et sous-titre réglés dans le dashboard ─── */
export function EditorialHead({ section }: { section: string }) {
  const { t } = useSite();
  const { c, space } = useTheme();
  const title = t(`${section}.titre`);
  const sub = t(`${section}.sous-titre`) || t(`${section}.introduction`);
  return (
    <View style={{ marginTop: space.xl, marginBottom: space.md }}>
      {title ? <Title variant="h2">{title}</Title> : null}
      {sub ? <Txt variant="small" style={{ marginTop: 4, color: c.ink2 }}>{plain(sub)}</Txt> : null}
    </View>
  );
}

/** Cartes éditoriales d'une section, en liste : pastille (numéro ou coche), titre, texte, points et lien. */
export function EditorialCards({ section, numbered, icon: Icon = Check }: { section: string; numbered?: boolean; icon?: LucideIcon }) {
  const { t, list, link, isHidden } = useSite();
  const { c, space, radius, fonts } = useTheme();
  const cards = cardsOf(section).filter(k => !isHidden(k));
  return (
    <View style={{ gap: space.sm }}>
      {cards.map((k, i) => {
        const title = t(`${k}.titre`) || t(`${k}.nom`);
        const text = t(`${k}.texte`) || t(`${k}.description`);
        if (!title && !text) return null;
        const points = list(`${k}.liste`);
        const btn = link(`${k}.bouton`);
        const num = t(`${k}.numero`) || (numbered ? String(i + 1).padStart(2, '0') : '');
        return (
          <Card key={k} style={{ flexDirection: 'row', gap: space.md, padding: space.md }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: c.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
              {num ? <Txt style={{ fontFamily: fonts.bold, fontSize: 14, color: c.primary }}>{num}</Txt> : <Icon size={18} color={c.primary} />}
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              {title ? <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.ink }}>{plain(title)}</Txt> : null}
              {text ? <Txt style={{ fontSize: 13.5, lineHeight: 20, color: c.ink2 }}>{plain(text)}</Txt> : null}
              {points.length ? <Txt style={{ fontSize: 12.5, color: c.ink3, marginTop: 2 }}>{points.join(' · ')}</Txt> : null}
              {btn && btn.href && !/^#|a-propos\.html/.test(btn.href) ? (
                <Pressable onPress={() => openLink(btn.href)} accessibilityRole="link" hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4 }}>
                  <Txt style={{ fontFamily: fonts.semibold, color: c.primary, fontSize: 13 }}>{btn.label}</Txt><ChevronRight size={14} color={c.primary} />
                </Pressable>
              ) : null}
            </View>
          </Card>
        );
      })}
    </View>
  );
}

/** Contenu d'une page d'information (écrans ouverts depuis le menu latéral). */
export function InfoScreenBody({ children }: { children: ReactNode }) {
  const { space } = useTheme();
  return <View style={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl }}>{children}</View>;
}

export { isLotissement };
