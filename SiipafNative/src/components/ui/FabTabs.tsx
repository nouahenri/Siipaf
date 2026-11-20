/**
 * Barre d'onglets de la vitrine, animée (modèle choisi par le client le 20/11) : un rond rouge flottant porte l'icône de
 * l'onglet actif, posé dans une encoche arrondie creusée dans la barre ; au toucher, rond et encoche glissent jusqu'au
 * nouvel onglet (ressort), l'icône du rond change en fondu, l'icône de l'onglet quitté réapparaît. Tous les libellés
 * restent affichés ; celui de l'onglet actif est à la couleur de la marque.
 * Dessinée par l'application (react-native-svg + Reanimated), identique sur Android, iOS et l'aperçu web : la barre
 * native du système ne permet ni encoche ni rond flottant. Le contenu s'arrête au-dessus du rond : rien n'est masqué.
 */
import { usePathname } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { forwardRef, useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolate, type SharedValue, useAnimatedProps, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import type { LucideIcon } from 'lucide-react-native';
import * as Haptics from '@/lib/haptics';
import { useTheme } from '@/theme';
import { Txt } from './Text';

const FAB = 54; // diamètre du rond flottant
const RISE = 24; // hauteur dont le rond dépasse au-dessus de la barre
const NOTCH = FAB / 2 + 8; // rayon de l'encoche
const DEPTH = 30; // profondeur de l'encoche
const CORNER = 22; // coins supérieurs de la barre
const SPRING = { damping: 17, stiffness: 170, mass: 0.9 };

type Tab = { name: string; href: string; icon: LucideIcon; label: string };
type Shared = { active: SharedValue<number>; width: SharedValue<number>; count: number };
type Props = TabTriggerSlotProps & { icon: LucideIcon; label: string; index: number; focused: boolean; shared: Shared };

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Contour de la barre avec l'encoche centrée en `cx` (largeur w, hauteur h). */
function barPath(w: number, h: number, cx: number) {
  'worklet';
  const l = cx - NOTCH;
  const r = cx + NOTCH;
  return `M0,${CORNER} Q0,0 ${CORNER},0 L${Math.max(CORNER, l - 14)},0 C${l + 2},0 ${l + 6},${DEPTH} ${cx},${DEPTH} C${r - 6},${DEPTH} ${r - 2},0 ${Math.min(w - CORNER, r + 14)},0 `
    + `L${w - CORNER},0 Q${w},0 ${w},${CORNER} L${w},${h} L0,${h} Z`;
}

// isFocused de TabTrigger n'est pas fiable ici (liste imbriquée dans la barre dessinée) : l'onglet actif vient de l'adresse
const TabButton = forwardRef<any, Props>(({ icon: Icon, label, index, focused, shared, isFocused: _ignored, onPress, ...props }, ref) => {
  const { c, fonts } = useTheme();
  const isFocused = focused;
  // L'icône de l'onglet s'efface quand le rond arrive au-dessus
  const iconStyle = useAnimatedStyle(() => {
    const near = Math.min(1, Math.abs(shared.active.value - index));
    return { opacity: near, transform: [{ scale: interpolate(near, [0, 1], [0.6, 1]) }] };
  });
  return (
    <Pressable ref={ref} {...props} onPress={e => { Haptics.selectionAsync().catch(() => {}); onPress?.(e); }}
      accessibilityRole="tab" accessibilityState={{ selected: isFocused }} accessibilityLabel={label} hitSlop={4}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4, minHeight: 50 }}>
      <Animated.View style={[{ height: 24, alignItems: 'center', justifyContent: 'center' }, iconStyle]}>
        <Icon size={22} color={c.ink3} strokeWidth={2} />
      </Animated.View>
      <Txt numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}
        style={{ fontFamily: isFocused ? fonts.bold : fonts.semibold, fontSize: 10.5, letterSpacing: -0.1, color: isFocused ? c.primary : c.ink3 }}>{label}</Txt>
    </Pressable>
  );
});
TabButton.displayName = 'TabButton';

/** Icône i dans le rond flottant : visible quand le rond est sur son onglet. */
function FabIcon({ icon: Icon, index, active }: { icon: LucideIcon; index: number; active: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const d = Math.min(1, Math.abs(active.value - index) * 1.6);
    return { opacity: 1 - d, transform: [{ scale: interpolate(d, [0, 1], [1, 0.4]) }, { rotate: `${(active.value - index) * -40}deg` }] };
  });
  return <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }, style]}><Icon size={24} color="#fff" strokeWidth={2.2} /></Animated.View>;
}

export function FabTabs({ tabs }: { tabs: Tab[] }) {
  const { c, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const active = useSharedValue(-1);
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const shared: Shared = { active, width, count: tabs.length };
  // Onglet actif d'après l'adresse (« / » pour l'accueil) ; le rond et l'encoche y glissent, sans animation au premier affichage
  const pathname = usePathname();
  const current = Math.max(0, tabs.findIndex(t => (t.href === '/' ? pathname === '/' : pathname === t.href || pathname.startsWith(`${t.href}/`))));
  useEffect(() => {
    active.set(active.get() < 0 ? current : withSpring(current, SPRING));
  }, [current, active]);
  const pathProps = useAnimatedProps(() => {
    const slot = width.value / tabs.length;
    return { d: width.value ? barPath(width.value, height.value, (Math.max(active.value, 0) + 0.5) * slot) : '' };
  });
  const fabStyle = useAnimatedStyle(() => {
    const slot = width.value / tabs.length;
    return { opacity: width.value && active.value >= 0 ? 1 : 0, transform: [{ translateX: (Math.max(active.value, 0) + 0.5) * slot - FAB / 2 }] };
  });
  // Petit rebond du rond à chaque changement d'onglet
  const bounce = useAnimatedStyle(() => {
    const frac = Math.abs(active.value - Math.round(active.value));
    return { transform: [{ translateY: interpolate(frac, [0, 0.5], [0, 6]) }] };
  });

  return (
    <Tabs>
      <TabSlot style={{ flex: 1 }} />
      {/* Déclaration des onglets pour le navigateur (expo-router/ui l'attend directement sous Tabs) ; la barre visible est dessinée dessous */}
      <TabList style={{ display: 'none' }}>
        {tabs.map(t => <TabTrigger key={t.name} name={t.name} href={t.href as never} />)}
      </TabList>
      {/* Bande de la couleur du fond : place du rond au-dessus de la barre, sans masquer le contenu */}
      <View style={{ backgroundColor: c.bg, paddingTop: RISE }}>
        <View onLayout={e => { width.set(e.nativeEvent.layout.width); height.set(e.nativeEvent.layout.height); }}>
          {/* Dimensions explicites : sans elles, le SVG garde 300 × 150 px (aperçu web) et la barre ne couvre pas toute la largeur */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Svg width="100%" height="100%">
              <AnimatedPath animatedProps={pathProps} fill={c.surface} stroke={c.line} strokeWidth={StyleSheet.hairlineWidth} />
            </Svg>
          </View>
          <View accessibilityRole="tablist" style={{ flexDirection: 'row', alignItems: 'stretch', paddingTop: 10, paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 10 : 8) }}>
            {tabs.map((t, i) => (
              <TabTrigger key={t.name} name={t.name} asChild>
                <TabButton icon={t.icon} label={t.label} index={i} focused={i === current} shared={shared} />
              </TabTrigger>
            ))}
          </View>
          {/* Rond flottant de l'onglet actif */}
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -RISE, left: 0, width: FAB, height: FAB }, fabStyle]}>
            <Animated.View style={[{ flex: 1, borderRadius: FAB / 2, backgroundColor: c.primary, overflow: 'hidden', ...shadow(2) }, bounce]}>
              {tabs.map((t, i) => <FabIcon key={t.name} icon={t.icon} index={i} active={active} />)}
            </Animated.View>
          </Animated.View>
        </View>
      </View>
    </Tabs>
  );
}
