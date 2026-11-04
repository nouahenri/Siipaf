/**
 * Fiche d'un programme (projets.html / lotissements.html du site), en vues compactes : photo, en-tête et adresse
 * (« Localiser » ouvre la carte OpenStreetMap), bande des chiffres clés, grille de prix en liste, simulateur de mensualité,
 * carte interactive des lots (plan de masse), « Sur place » (aperçu de carte), caractéristiques, commodités, avancement (viabilisation et
 * documents du bien), partage et contact.
 */
import { router, useLocalSearchParams, type Href } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, ChevronLeft, ChevronRight, Map as MapIcon, MapPin, Navigation, Phone, Share2 } from 'lucide-react-native';
import { amenityIcon, figureIcon } from '@/components/ui/icons';
import { RoundButton } from '@/components/ui/AppHeader';
import { MapPreview } from '@/components/site/MapPreview';
import { ProjectGallery } from '@/components/site/ProjectGallery';
import { usePrefs } from '@/providers/preferences';
import { Badge, Button, Card, Chip, ErrorState, IconButton, PageSkeleton, SectionHead, Segmented, Txt } from '@/components/ui';
import { SITE_URL } from '@/config';
import { useSite } from '@/lib/content';
import { isLotissement, projectKind } from '@/lib/domain';
import { fcfa, money } from '@/lib/format';
import { call } from '@/lib/links';
import { projectImage, useProject } from '@/lib/queries';
import type { DocState, Offer } from '@/lib/types';
import { useTheme } from '@/theme';

const offerName = (o: Offer) => [o.label, o.designation].filter(Boolean).join(' ') || 'Bien';
const surface = (s?: string | null) => { const v = String(s || '').trim(); return /^\d+(?:[.,]\d+)?$/.test(v) ? `${v} m²` : v; };
const OFFERS_SHOWN = 5;
const AMENITIES_SHOWN = 6;

export default function ProjectScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { c, space, radius, fonts, shadow } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { contact } = useSite();
  const { data: p, error, isLoading, refetch } = useProject(slug);
  const [offerIdx, setOfferIdx] = useState(0);
  const [months, setMonths] = useState<number | null>(null);
  const [allOffers, setAllOffers] = useState(false);
  const [allAmenities, setAllAmenities] = useState(false);
  const [fullText, setFullText] = useState(false);
  const [progressTab, setProgressTab] = useState<'viabilisation' | 'documents'>('viabilisation');
  const { prefs, t } = usePrefs();
  const [formula, setFormula] = useState<'echelonne' | 'diaspora' | 'comptant'>(prefs.simulator);
  const cur = (n?: number | null) => money(n, prefs.currency);

  const offers = useMemo(() => (p?.offers || []).filter(o => Number(o.price_fcfa) > 0), [p]);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/programmes'));
  const topBar = (extra?: React.ReactNode) => (
    <View style={{ position: 'absolute', top: insets.top + 6, left: space.md, right: space.md, flexDirection: 'row', justifyContent: 'space-between', zIndex: 5 }}>
      <RoundButton icon={ChevronLeft} label={t('Retour')} onPress={back} />
      {extra}
    </View>
  );
  if (isLoading) return <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 56 }}>{topBar()}<PageSkeleton /></View>;
  if (error || !p) return <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 56 }}>{topBar()}<ErrorState error={error} onRetry={refetch} /></View>;

  const lots = Object.values(p.lots || {}).reduce((a, b) => a + b, 0);
  const free = (p.lots?.disponible || 0) + (p.lots?.desistement || 0);
  const choices = (p.balance_months_choices?.length ? p.balance_months_choices : [p.balance_months]).filter(Boolean);
  const m = months || p.balance_months || 36;
  const selected = offers[Math.min(offerIdx, offers.length - 1)];
  // Formules : échelonné (prix − acompte) ÷ mois ; Diaspora (prix Diaspora − acompte) ÷ mois, comme le site ; comptant : prix total
  const basePrice = selected ? Number(formula === 'diaspora' && selected.diaspora_price_fcfa ? selected.diaspora_price_fcfa : selected.price_fcfa) : 0;
  const monthly = Math.max(0, basePrice - (p.deposit_fcfa || 0)) / m;
  const ask = (o?: Offer) => router.push({ pathname: '/demande', params: { projet: p.slug, ...(o ? { bien: offerName(o), budget: fcfa(o.price_fcfa) } : {}) } });
  const share = () => Share.share({ message: `${p.name} — ${p.tagline || 'SIIPAF SA'}\n${SITE_URL}/${isLotissement(p) ? 'lotissements' : 'projets'}.html#${p.slug}`, title: p.name }).catch(() => {});
  const place = [p.location, p.city].filter(Boolean).join(' · ');
  // Plans de masse publiés (la fiche détaillée les donne ; la liste des programmes donne has_plan)
  const hasPlan = !!(p.plans?.length || p.has_plan);
  // Localiser : vue carte de l'application (position GPS du dashboard, ou position approchée de l'adresse), d'où part l'itinéraire
  const locate = () => router.push(`/carte/${p.slug}` as Href);

  const figures = [...p.key_figures, ...(lots ? [{ icon: 'fa-th-large', value: String(lots), label: isLotissement(p) ? 'Lots' : 'Biens' }] : []),
    ...(p.deposit_fcfa ? [{ icon: 'fa-hand-holding-usd', value: fcfa(p.deposit_fcfa), label: 'Acompte' }] : []),
    { icon: 'fa-calendar-alt', value: `${p.balance_months} mois`, label: 'Délai de solde' },
    ...(p.delivery ? [{ icon: 'fa-clock', value: p.delivery, label: 'Livraison' }] : [])];
  const shownOffers = allOffers ? offers : offers.slice(0, OFFERS_SHOWN);
  const shownAmenities = allAmenities ? p.amenities : p.amenities.slice(0, AMENITIES_SHOWN);
  const progress = { viabilisation: p.viabilisation || [], documents: p.documents || [] };
  const tab = progress[progressTab].length ? progressTab : progress.viabilisation.length ? 'viabilisation' : 'documents';
  const states = progress[tab];
  const done = states.filter(s => s.state === 'fait').length;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {topBar(<RoundButton icon={Share2} label={t('Partager ce programme')} onPress={share} />)}
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <ProjectGallery photos={p.gallery || []} fallback={projectImage(p)} height={Math.min(300, width * 0.72)} name={p.name} bottomInset={22} />

        {/* Feuille posée sur la photo */}
        <View style={{ marginTop: -22, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, backgroundColor: c.bg, padding: space.lg, paddingTop: 18, gap: space.md }}>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Badge label={projectKind(p)} tone="primary" />
            {free > 0 ? <Badge label={t('{n} disponible(s)', { n: free })} tone="ok" /> : null}
          </View>
          <View style={{ gap: 4 }}>
            <Txt style={{ fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, color: c.ink, letterSpacing: -0.3 }} numberOfLines={2} accessibilityRole="header">{p.name}</Txt>
            {p.tagline ? <Txt variant="small" style={{ color: c.ink2 }} numberOfLines={2}>{p.tagline}</Txt> : null}
          </View>

          {/* Adresse : Localiser le site */}
          {place ? (
            <Pressable onPress={locate} accessibilityRole="button" accessibilityLabel={`${place} : ${t('Localiser le site')}`}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: pressed ? c.line : c.surfaceAlt })}>
              <MapPin size={16} color={c.primary} />
              <Txt style={{ flex: 1, minWidth: 0, fontFamily: fonts.semibold, fontSize: 13.5, color: c.ink }} numberOfLines={1}>{place}</Txt>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.primary }}>{t('Localiser')}</Txt>
              <ChevronRight size={16} color={c.primary} />
            </Pressable>
          ) : null}

          {/* Carte interactive (plan de masse publié dans le dashboard, comme plan-interactif.html du site) */}
          {hasPlan ? (
            <Pressable onPress={() => router.push(`/plan/${p.slug}`)} accessibilityRole="button" accessibilityLabel={`${t('Carte interactive')} : ${t('Lots disponibles en temps réel')}`}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: c.dark, opacity: pressed ? 0.88 : 1 })}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}><MapIcon size={18} color={c.goldLight} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 14.5, color: c.onDark }}>{t('Carte interactive')}</Txt>
                <Txt style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }} numberOfLines={1}>{free > 0 ? t('{n} lot(s) disponible(s) en temps réel', { n: free }) : t('Lots disponibles en temps réel')}</Txt>
              </View>
              <ChevronRight size={18} color={c.onDark} />
            </Pressable>
          ) : null}

          {/* Chiffres clés : bande défilante */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.lg }} contentContainerStyle={{ paddingHorizontal: space.lg, gap: 8 }}>
            {figures.map((f, i) => {
              const Icon = figureIcon(f.icon);
              return (
                <View key={i} accessible accessibilityLabel={`${f.label} : ${f.value}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, minWidth: 96, maxWidth: 180, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, backgroundColor: c.surfaceAlt }}>
                  <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}><Icon size={15} color={c.primary} /></View>
                  <View style={{ flexShrink: 1 }}>
                    <Txt style={{ fontFamily: fonts.bold, fontSize: 14, color: c.ink }} numberOfLines={1}>{f.value}</Txt>
                    <Txt variant="tiny" style={{ color: c.ink3 }} numberOfLines={1}>{f.label}</Txt>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {p.description ? (
            <View>
              <Txt style={{ color: c.ink2, fontSize: 14.5, lineHeight: 22 }} numberOfLines={fullText ? undefined : 3}>{p.description}</Txt>
              {p.description.length > 140 ? (
                <Pressable onPress={() => setFullText(v => !v)} hitSlop={10} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.ink }}>{fullText ? t('Réduire') : t('Lire plus')}</Txt>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {/* Grille de prix : liste compacte */}
          <SectionHead title={t('Grille de prix')} action={offers.length ? <Txt variant="tiny" style={{ color: c.ink3 }}>{t('{n} offre(s)', { n: offers.length })}</Txt> : undefined} />
          {offers.length ? (
            <Card padded={false} style={{ overflow: 'hidden' }}>
              {shownOffers.map((o, i) => {
                const sub = [surface(o.surface), ...String(o.highlights || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean)].filter(Boolean).join(' · ');
                return (
                  <Pressable key={i} onPress={() => ask(o)} accessibilityRole="button" accessibilityLabel={`${offerName(o)}${o.surface ? ` ${surface(o.surface)}` : ''}, ${cur(o.price_fcfa)} : ${t('infos et réservation')}`}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, paddingVertical: 10, paddingHorizontal: space.lg, borderBottomWidth: i < shownOffers.length - 1 ? 1 : 0, borderBottomColor: c.line, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Txt style={{ flexShrink: 1, fontFamily: fonts.semibold, fontSize: 14.5, color: c.ink }} numberOfLines={1}>{offerName(o)}</Txt>
                        {o.badge ? <Badge label={o.badge} tone="gold" /> : null}
                      </View>
                      {sub ? <Txt variant="tiny" style={{ color: c.ink3 }} numberOfLines={1}>{sub}</Txt> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Txt style={{ fontFamily: fonts.bold, fontSize: 15, color: c.primary }}>{cur(o.price_fcfa)}</Txt>
                      {o.diaspora_price_fcfa ? <Txt variant="tiny" style={{ color: c.accent }}>{t('Diaspora')} {cur(o.diaspora_price_fcfa)}</Txt> : null}
                    </View>
                    <ChevronRight size={16} color={c.ink3} />
                  </Pressable>
                );
              })}
              {offers.length > OFFERS_SHOWN ? (
                <Pressable onPress={() => setAllOffers(v => !v)} accessibilityRole="button" style={({ pressed }) => ({ minHeight: 48, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderTopColor: c.line, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 13.5, color: c.ink }}>{allOffers ? t('Réduire') : t('Voir les {n} offres', { n: offers.length })}</Txt>
                </Pressable>
              ) : null}
            </Card>
          ) : (
            <Card padded={false}>
              <Pressable onPress={() => ask()} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.lg }}>
                <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 14.5, color: c.ink }}>{t('Prix sur demande')}</Txt>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.primary }}>{t('Être rappelé')}</Txt>
                <ChevronRight size={16} color={c.primary} />
              </Pressable>
            </Card>
          )}

          {/* Simulateur de mensualité */}
          {offers.length > 0 && (
            <View style={{ marginTop: space.sm, backgroundColor: c.surfaceAlt, borderRadius: radius.lg, padding: space.md, gap: space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
                <Txt style={{ fontFamily: fonts.bold, fontSize: 16, color: c.ink }} accessibilityRole="header">{t('Simulateur')}</Txt>
                <Txt variant="tiny" style={{ color: c.ink3 }}>{formula === 'comptant' ? t('Prix comptant') : t('Votre mensualité')}</Txt>
              </View>
              <Segmented value={formula} onChange={setFormula} options={[['echelonne', t('Échelonné')], ['diaspora', t('Diaspora')], ['comptant', t('Comptant')]]} />
              {(offers.length > 1 || (formula !== 'comptant' && choices.length > 1)) && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2, alignItems: 'center' }}>
                  {offers.length > 1 && offers.map((o, i) => <Chip key={`o${i}`} label={offerName(o) + (o.surface ? ` ${surface(o.surface)}` : '')} selected={i === offerIdx} onPress={() => setOfferIdx(i)} />)}
                  {offers.length > 1 && formula !== 'comptant' && choices.length > 1 ? <View style={{ width: 1, height: 24, backgroundColor: c.line, marginHorizontal: 4 }} /> : null}
                  {formula !== 'comptant' && choices.length > 1 && choices.map(n => <Chip key={`m${n}`} label={`${n} ${t('mois')}`} selected={n === m} onPress={() => setMonths(n)} />)}
                </ScrollView>
              )}
              <View style={{ backgroundColor: c.surface, borderRadius: radius.md, padding: space.md, gap: 2 }}>
                <Txt style={{ fontFamily: fonts.bold, fontSize: 24, color: c.primary }}>
                  {formula === 'comptant' ? cur(selected?.price_fcfa) : cur(monthly)}
                  {formula !== 'comptant' ? <Txt style={{ color: c.ink3, fontSize: 13 }}> {t('/ mois')}</Txt> : null}
                </Txt>
                <Txt variant="tiny" style={{ color: c.ink3 }} numberOfLines={2}>
                  {formula === 'comptant'
                    ? t('Paiement en une fois. Simulation indicative : votre conseiller établit l’échéancier définitif.')
                    : `${p.deposit_fcfa ? t('Après un acompte de {montant},', { montant: cur(p.deposit_fcfa) }) : t('Sans acompte,')} ${t('{n} mensualités · prix {prix}.', { n: m, prix: cur(basePrice) })} ${t('Simulation indicative.')}`}
                </Txt>
              </View>
              <Pressable onPress={() => ask(selected)} hitSlop={6} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, minHeight: 36, paddingHorizontal: 4 }}>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: c.ink }}>{t('Recevoir une offre personnalisée')}</Txt>
                <ChevronRight size={16} color={c.ink} />
              </Pressable>
            </View>
          )}

          {/* Sur place : aperçu de la carte du site (la carte interactive des lots est sous l'adresse) */}
          {p.geo && (
            <>
              <SectionHead title={t('Sur place')} />
              <Card padded={false} style={{ overflow: 'hidden' }}>
                <Pressable onPress={locate} accessibilityRole="button" accessibilityLabel={t('Localiser le site')}>
                  <MapPreview lat={p.geo.lat} lng={p.geo.lng} />
                  <View style={{ position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.surface, borderRadius: radius.pill, paddingHorizontal: 12, height: 36, ...shadow(1) }}>
                    <Navigation size={14} color={c.primary} />
                    <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.ink }}>{t('Localiser le site')}</Txt>
                  </View>
                </Pressable>
              </Card>
            </>
          )}

          {/* Caractéristiques : types de biens et équipements */}
          {(p.property_types.length > 0 || p.amenities.length > 0) && (
            <>
              <SectionHead title={t('Caractéristiques')} />
              {p.property_types.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.lg }} contentContainerStyle={{ paddingHorizontal: space.lg, gap: 6 }}>
                  {p.property_types.map(tp => <Badge key={tp} label={tp} tone="dark" />)}
                </ScrollView>
              )}
              {p.amenities.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md }}>
                  {shownAmenities.map(a => {
                    const Icon = amenityIcon(a);
                    return (
                      <View key={a} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, width: '47%', flexGrow: 1, minHeight: 36 }}>
                        <Icon size={16} color={c.primary} /><Txt style={{ flex: 1, fontSize: 13.5, color: c.ink }} numberOfLines={2}>{a}</Txt>
                      </View>
                    );
                  })}
                </View>
              )}
              {p.amenities.length > AMENITIES_SHOWN ? (
                <Pressable onPress={() => setAllAmenities(v => !v)} hitSlop={10} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.ink }}>{allAmenities ? t('Réduire') : t('Tout voir ({n})', { n: p.amenities.length })}</Txt>
                </Pressable>
              ) : null}
            </>
          )}

          {p.commodites?.length > 0 && (
            <>
              <SectionHead title={t('À proximité')} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.lg }} contentContainerStyle={{ paddingHorizontal: space.lg, gap: 6 }}>
                {p.commodites.map(x => <Badge key={x} label={x} tone="info" icon={MapPin} />)}
              </ScrollView>
            </>
          )}

          {/* Avancement : viabilisation et documents du bien */}
          {states.length > 0 && (
            <>
              <SectionHead title={t('Avancement')} action={<Txt variant="tiny" style={{ color: c.ink3 }}>{t('{a}/{b} réalisés', { a: done, b: states.length })}</Txt>} />
              <Card padded={false} style={{ overflow: 'hidden' }}>
                {progress.viabilisation.length > 0 && progress.documents.length > 0 ? (
                  <View style={{ padding: space.sm }}>
                    <Segmented value={tab} onChange={setProgressTab} options={[['viabilisation', t('Viabilisation')], ['documents', t('Documents')]]} />
                  </View>
                ) : null}
                {states.map((v, i) => <StateRow key={v.label} item={v} divider={i > 0 || (progress.viabilisation.length > 0 && progress.documents.length > 0)} />)}
              </Card>
            </>
          )}
        </View>
      </ScrollView>

      {/* Actions principales à portée du pouce */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: Math.max(insets.bottom, space.md), backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.line, flexDirection: 'row', gap: space.sm, ...shadow(2) }}>
        <IconButton icon={Phone} label={`${t('Appeler')} ${contact.phone}`} onPress={() => call(contact.phone)} size={52} />
        <Button label={t('Visiter')} icon={CalendarDays} variant="dark" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/demande', params: { projet: p.slug, type: 'rdv' } })} />
        <Button label={t('Être rappelé')} style={{ flex: 1.3 }} haptic onPress={() => ask()} />
      </View>
    </View>
  );
}

function StateRow({ item, divider }: { item: DocState; divider?: boolean }) {
  const { c, space, fonts } = useTheme();
  const t = usePrefs().t;
  const done = item.state === 'fait';
  const color = done ? c.ok : item.state === 'en_cours' ? c.warn : c.ink3;
  const shown = item.state_label || (done ? t('Réalisé') : item.state === 'en_cours' ? t('En cours') : t('Prévu'));
  return (
    <View accessible accessibilityLabel={`${item.label} : ${shown}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingHorizontal: space.lg, borderTopWidth: divider ? 1 : 0, borderTopColor: c.line }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Txt style={{ flex: 1, minWidth: 0, fontSize: 14, color: c.ink }} numberOfLines={2}>{item.label}</Txt>
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color }}>{shown}</Txt>
    </View>
  );
}
