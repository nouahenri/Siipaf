/**
 * Barre d'onglets de la vitrine, modèle « bouton central » : quatre onglets autour d'un bouton rond surélevé (Sita).
 * Dessinée par l'application (même rendu sur Android, iOS et l'aperçu web) : la barre native du système ne permet pas
 * de bouton central. Onglet actif : pastille et couleur de la marque. Le contenu s'arrête au-dessus de la barre,
 * bouton compris : rien n'est masqué (champ de saisie de Sita notamment).
 */
import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { forwardRef } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LucideIcon } from 'lucide-react-native';
import * as Haptics from '@/lib/haptics';
import { useTheme } from '@/theme';
import { Txt } from './Text';

const FAB = 58;
const RISE = 22; // hauteur dont le bouton central dépasse de la barre

type Tab = { name: string; href: string; icon: LucideIcon; label: string; center?: boolean };
type Props = TabTriggerSlotProps & { icon: LucideIcon; label: string };

const TabButton = forwardRef<any, Props>(({ icon: Icon, label, isFocused, onPress, ...props }, ref) => {
  const { c, fonts } = useTheme();
  return (
    <Pressable ref={ref} {...props} onPress={e => { Haptics.selectionAsync().catch(() => {}); onPress?.(e); }}
      accessibilityRole="tab" accessibilityState={{ selected: isFocused }} accessibilityLabel={label} hitSlop={4}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 52 }}>
      <View style={{ width: 52, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: isFocused ? c.dangerSoft : 'transparent' }}>
        <Icon size={21} color={isFocused ? c.primary : c.ink3} strokeWidth={isFocused ? 2.3 : 2} />
      </View>
      <Txt numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={{ fontFamily: fonts.semibold, fontSize: 10.5, letterSpacing: -0.1, color: isFocused ? c.primary : c.ink3 }}>{label}</Txt>
    </Pressable>
  );
});
TabButton.displayName = 'TabButton';

/** Bouton central rond, surélevé, à la couleur de la marque. */
const CenterButton = forwardRef<any, Props>(({ icon: Icon, label, isFocused, onPress, ...props }, ref) => {
  const { c, fonts, shadow } = useTheme();
  return (
    <Pressable ref={ref} {...props} onPress={e => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress?.(e); }}
      accessibilityRole="tab" accessibilityState={{ selected: isFocused }} accessibilityLabel={label}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 3, minHeight: 52 }}>
      {({ pressed }) => (
        <>
          <View style={{ position: 'absolute', top: -RISE - 4, width: FAB + 8, height: FAB + 8, borderRadius: (FAB + 8) / 2, backgroundColor: c.surface }} />
          <View style={{ position: 'absolute', top: -RISE, width: FAB, height: FAB, borderRadius: FAB / 2, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center',
            transform: [{ scale: pressed ? 0.94 : 1 }], ...shadow(2) }}>
            <Icon size={26} color="#fff" strokeWidth={2.2} />
          </View>
          <Txt numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={{ fontFamily: fonts.semibold, fontSize: 10.5, letterSpacing: -0.1, color: isFocused ? c.primary : c.ink3 }}>{label}</Txt>
        </>
      )}
    </Pressable>
  );
});
CenterButton.displayName = 'CenterButton';

export function FabTabs({ tabs }: { tabs: Tab[] }) {
  const { c, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tabs>
      <TabSlot style={{ flex: 1 }} />
      {/* Bande de la couleur du fond : laisse la place au bouton central sans masquer le contenu */}
      <View style={{ backgroundColor: c.bg, paddingTop: RISE + 4 }}>
        <TabList style={{ flexDirection: 'row', alignItems: 'stretch', backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          paddingTop: 8, paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 10 : 8), paddingHorizontal: 2, ...shadow(2) }}>
          {tabs.map(t => (
            <TabTrigger key={t.name} name={t.name} href={t.href as never} asChild>
              {t.center ? <CenterButton icon={t.icon} label={t.label} /> : <TabButton icon={t.icon} label={t.label} />}
            </TabTrigger>
          ))}
        </TabList>
      </View>
    </Tabs>
  );
}
