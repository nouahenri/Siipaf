/**
 * Carte du site d'un programme : OpenStreetMap plein écran dans l'application (déplacement, zoom), repère sur la position
 * saisie dans le dashboard ou, à défaut, sur la position approchée de l'adresse (mention « Position approximative »),
 * et itinéraire Google Maps depuis la position du téléphone.
 */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Info, LocateFixed, MapPin, Navigation, Phone } from 'lucide-react-native';
import { RoundButton } from '@/components/ui/AppHeader';
import { Button, Empty, IconButton, PageSkeleton, Txt } from '@/components/ui';
import { OsmMap } from '@/components/site/OsmMap';
import { useSite } from '@/lib/content';
import { call, directions } from '@/lib/links';
import { useProject, useSitePosition } from '@/lib/queries';
import { useT } from '@/providers/preferences';
import { useTheme } from '@/theme';

export default function MapScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { c, space, radius, fonts, isDark, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { contact } = useSite();
  const { data: p } = useProject(slug);
  const pos = useSitePosition(slug);
  // Recentrer : la carte est recréée sur la position du site
  const [round, setRound] = useState(0);
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/projet/${slug}`));
  const place = p ? [p.location, p.city].filter(Boolean).join(' · ') : '';
  const at = pos.data;
  // Position approchée : l'itinéraire vise l'adresse plutôt qu'un point imprécis
  const destination = at ? (at.approx && p ? `${[p.location?.split(/[—–,(]| - /)[0].trim(), p.city].filter(Boolean).join(', ')}, Côte d'Ivoire` : `${at.lat},${at.lng}`) : '';

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {pos.isLoading ? <View style={{ paddingTop: insets.top + 56 }}><PageSkeleton /></View>
        : !at ? (
          <View style={{ flex: 1, justifyContent: 'center', padding: space.lg }}>
            <Empty icon={MapPin} title={t('Position du site non renseignée')} text={t('Un conseiller peut vous indiquer l’accès au site.')}>
              <Button label={`${t('Appeler')} ${contact.phone}`} icon={Phone} variant="dark" onPress={() => call(contact.phone)} />
            </Empty>
          </View>
        )
        : <OsmMap key={round} lat={at.lat} lng={at.lng} zoom={at.precision === 'ville' ? 13 : at.approx ? 15 : 16} color={c.primary} dark={isDark} />}

      <View style={{ position: 'absolute', top: insets.top + 6, left: space.md }}>
        <RoundButton icon={ChevronLeft} label={t('Retour')} onPress={back} />
      </View>

      {at ? (
        <View style={{ position: 'absolute', left: space.md, right: space.md, bottom: Math.max(insets.bottom, space.md), backgroundColor: c.surface, borderRadius: radius.xl, padding: space.lg, gap: space.md, ...shadow(2) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.dangerSoft, alignItems: 'center', justifyContent: 'center' }}><MapPin size={20} color={c.primary} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontFamily: fonts.bold, fontSize: 16, color: c.ink }} numberOfLines={1}>{p?.name}</Txt>
              {place ? <Txt variant="small" numberOfLines={2}>{place}</Txt> : null}
            </View>
            <IconButton icon={LocateFixed} label={t('Recentrer la carte')} onPress={() => setRound(r => r + 1)} size={44} />
          </View>
          {at.approx ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.warnSoft, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 }}>
              <Info size={15} color={c.warn} />
              <Txt style={{ flex: 1, fontSize: 12.5, color: c.warn }}>{at.precision === 'ville' ? t('Position approximative : centre de la ville') : t('Position approximative du quartier')}</Txt>
            </View>
          ) : null}
          <Button label={t('Itinéraire avec Google Maps')} icon={Navigation} variant="dark" block haptic onPress={() => directions(destination)} />
        </View>
      ) : null}
    </View>
  );
}
