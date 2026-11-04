/**
 * En-tête des onglets (même esprit que l'application Détente & Loisirs) : fond blanc aux coins bas arrondis, bouton du menu
 * latéral « Infos SIIPAF », marque ou titre, boutons ronds à droite ; en dessous, le contenu propre à l'écran (recherche,
 * filtres…). Pas de bannière ni d'image de fond : l'écran commence par ce qui sert.
 */
import { Image } from 'expo-image';
import * as Haptics from '@/lib/haptics';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Menu, type LucideIcon } from 'lucide-react-native';
import { LOGO, LOGO_ON_DARK, LOGO_RATIO } from '@/lib/content';
import { useMenu } from '@/providers/menu';
import { useTheme } from '@/theme';
import { Txt } from './Text';

export function RoundButton({ icon: Icon, label, onPress, tone = 'light', badge }: { icon: LucideIcon; label: string; onPress: () => void; tone?: 'light' | 'dark' | 'primary'; badge?: boolean }) {
  const { c } = useTheme();
  const bg = { light: c.surfaceAlt, dark: c.dark, primary: c.primary }[tone];
  const fg = tone === 'light' ? c.ink : '#fff';
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 21, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.92 : 1 }] })}>
      <Icon size={20} color={fg} />
      {badge ? <View style={{ position: 'absolute', top: 6, right: 7, width: 9, height: 9, borderRadius: 5, backgroundColor: c.primary, borderWidth: 2, borderColor: bg }} /> : null}
    </Pressable>
  );
}

type Props = {
  /** Ligne de marque (logo, nom, agrément) à la place du titre court : accueil. */
  brand?: boolean;
  title?: string;
  subtitle?: string;
  /** Grand titre sous la barre (accueil). */
  headline?: string;
  /** Bloc posé entre la barre du haut et le grand titre (carte de marque de l'accueil). */
  beforeHeadline?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  /** Barre seule (menu, actions) : le contenu de l'écran défile dessous (accueil). */
  compact?: boolean;
  /** Bouton retour à la place du menu (écrans ouverts par-dessus les onglets). */
  left?: ReactNode;
};

export function AppHeader({ brand, title, subtitle, headline, beforeHeadline, right, children, left, compact }: Props) {
  const { c, space, fonts, shadow, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { open } = useMenu();
  return (
    <View style={{ backgroundColor: c.surface, paddingTop: insets.top + 8, paddingHorizontal: space.lg, paddingBottom: compact ? space.sm : space.lg, borderBottomLeftRadius: compact ? 0 : 26, borderBottomRightRadius: compact ? 0 : 26, zIndex: 2, ...(compact ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line } : shadow(1)) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46 }}>
        {left ?? <RoundButton icon={Menu} label="Menu : infos SIIPAF" onPress={open} />}
        {brand ? (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Image source={isDark ? LOGO_ON_DARK : LOGO} style={{ width: 110, height: 110 / LOGO_RATIO }} contentFit="contain" accessibilityLabel="SIIPAF" />
            <View style={{ flex: 1 }}>
              <Txt style={{ fontFamily: fonts.bold, fontSize: 15, color: c.ink }} numberOfLines={1}>SIIPAF SA</Txt>
              <Txt style={{ fontSize: 12, color: c.ink3 }} numberOfLines={1}>Promoteur agréé MCLU</Txt>
            </View>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <Txt variant="h1" numberOfLines={1} accessibilityRole="header">{title}</Txt>
          </View>
        )}
        {right}
      </View>
      {beforeHeadline ? <View style={{ marginTop: space.md }}>{beforeHeadline}</View> : null}
      {headline ? <Txt variant="h1" style={{ marginTop: space.lg }} accessibilityRole="header">{headline}</Txt> : null}
      {subtitle ? <Txt variant="small" style={{ marginTop: headline ? 4 : 2 }}>{subtitle}</Txt> : null}
      {children ? <View style={{ marginTop: space.md }}>{children}</View> : null}
    </View>
  );
}
