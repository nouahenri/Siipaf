/**
 * Briques d'interface communes : écran défilant (tirer pour actualiser), cartes, boutons, pastilles, champs, feuille modale,
 * squelettes de chargement, états vide et erreur, anneau et barre d'avancement. Tout vient du thème (src/theme).
 */
import * as Haptics from '@/lib/haptics';
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch,
  TextInput, View, useWindowDimensions, type PressableProps, type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { CircleAlert, Eye, EyeOff, Inbox, RefreshCw, X, type LucideIcon } from 'lucide-react-native';
import { useTheme, type Tone } from '@/theme';
import { Txt } from './Text';

export { Txt, Title, plain } from './Text';

/* ─── Écran ─────────────────────────────────────────────── */

type ScreenProps = {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  scroll?: boolean;
  /** Pied fixe (bouton d'action principal à portée du pouce). */
  footer?: ReactNode;
};

export function Screen({ children, refreshing = false, onRefresh, padded = true, contentStyle, scroll = true, footer }: ScreenProps) {
  const { c, space } = useTheme();
  const body = scroll ? (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={[padded && { padding: space.lg }, { paddingBottom: space.xxxl }, contentStyle]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : <View style={[{ flex: 1, backgroundColor: c.bg }, padded && { padding: space.lg }, contentStyle]}>{children}</View>;
  if (!footer) return body;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {body}
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: c.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }}>
        <View style={{ padding: space.md, paddingHorizontal: space.lg }}>{footer}</View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

/* ─── Carte ─────────────────────────────────────────────── */

export function Card({ children, style, padded = true, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean; onPress?: () => void; accessibilityLabel?: string }) {
  const { c, radius, space, shadow } = useTheme();
  const base: ViewStyle = { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, ...(padded ? { padding: space.lg } : null), ...shadow(1) };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [base, { overflow: 'hidden' }, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }, style]}>
      {children}
    </Pressable>
  );
}

/* ─── Boutons ───────────────────────────────────────────── */

type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  variant?: 'primary' | 'dark' | 'ghost' | 'outline' | 'light' | 'whatsapp';
  size?: 'md' | 'sm';
  loading?: boolean;
  block?: boolean;
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, icon: Icon, iconRight: IconRight, variant = 'primary', size = 'md', loading, block, haptic, disabled, onPress, style, ...rest }: ButtonProps) {
  const { c, radius, fonts } = useTheme();
  const palette = {
    primary: { bg: c.primary, fg: c.onPrimary, border: c.primary },
    dark: { bg: c.dark, fg: c.onDark, border: c.dark },
    ghost: { bg: c.surfaceAlt, fg: c.ink, border: c.surfaceAlt },
    outline: { bg: 'transparent', fg: c.ink, border: c.line },
    light: { bg: 'rgba(255,255,255,0.14)', fg: '#FFFFFF', border: 'rgba(255,255,255,0.45)' },
    whatsapp: { bg: c.whatsapp, fg: '#FFFFFF', border: c.whatsapp },
  }[variant];
  const h = size === 'sm' ? 44 : 52;
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={e => { if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress?.(e); }}
      style={({ pressed }) => [{
        minHeight: h, paddingHorizontal: size === 'sm' ? 14 : 20, borderRadius: radius.pill, backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: block ? 'stretch' : 'flex-start',
        opacity: off ? 0.5 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }],
      }, style]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={palette.fg} /> : Icon ? <Icon size={size === 'sm' ? 16 : 18} color={palette.fg} /> : null}
      <Txt style={{ fontFamily: fonts.semibold, fontSize: size === 'sm' ? 14 : 15, color: palette.fg }} numberOfLines={1}>{label}</Txt>
      {IconRight && !loading ? <IconRight size={size === 'sm' ? 16 : 18} color={palette.fg} /> : null}
    </Pressable>
  );
}

export function IconButton({ icon: Icon, label, onPress, tone = 'ghost', size = 44, badge }: { icon: LucideIcon; label: string; onPress?: () => void; tone?: 'ghost' | 'dark' | 'light' | 'primary'; size?: number; badge?: number }) {
  const { c } = useTheme();
  const bg = { ghost: c.surfaceAlt, dark: c.dark, light: 'rgba(255,255,255,0.9)', primary: c.primary }[tone];
  const fg = { ghost: c.ink, dark: c.onDark, light: '#111', primary: c.onPrimary }[tone];
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.75 : 1 })}>
      <Icon size={Math.round(size * 0.45)} color={fg} />
      {!!badge && badge > 0 && (
        <View style={{ position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Txt variant="tiny" style={{ color: '#fff', fontSize: 10 }}>{badge > 9 ? '9+' : badge}</Txt>
        </View>
      )}
    </Pressable>
  );
}

/* ─── Pastilles et filtres ──────────────────────────────── */

export function Badge({ label, tone = 'muted', icon: Icon }: { label: string; tone?: Tone; icon?: LucideIcon }) {
  const { tone: t, radius, fonts } = useTheme();
  const { fg, bg } = t(tone);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
      {Icon ? <Icon size={12} color={fg} /> : null}
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: fg }}>{label}</Txt>
    </View>
  );
}

export function Chip({ label, selected, onPress, count }: { label: string; selected?: boolean; onPress?: () => void; count?: number }) {
  const { c, radius, fonts } = useTheme();
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress?.(); }} accessibilityRole="button" accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 15, borderRadius: radius.pill, borderWidth: 1, borderColor: selected ? c.ink : c.line, backgroundColor: selected ? c.ink : c.surface, opacity: pressed ? 0.8 : 1 })}>
      <Txt style={{ fontFamily: fonts.medium, fontSize: 14, color: selected ? c.bg : c.ink }}>{label}</Txt>
      {count != null && <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: selected ? c.bg : c.ink3 }}>{count}</Txt>}
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>{children}</ScrollView>;
}

/** Choix exclusif en deux ou trois segments (Échéancier / Versements). */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const { c, radius, fonts } = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.surfaceAlt, borderRadius: radius.pill, padding: 4 }} accessibilityRole="tablist">
      {options.map(([k, l]) => {
        const on = k === value;
        return (
          <Pressable key={k} onPress={() => { Haptics.selectionAsync().catch(() => {}); onChange(k); }} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.surface : 'transparent' }}>
            <Txt style={{ fontFamily: on ? fonts.semibold : fonts.medium, fontSize: 14, color: on ? c.ink : c.ink3 }}>{l}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── Champs ────────────────────────────────────────────── */

type FieldProps = TextInputProps & { label: string; hint?: string; error?: string | null; secure?: boolean };

export function Field({ label, hint, error, secure, style, multiline, ...rest }: FieldProps) {
  const { c, radius, fonts, space } = useTheme();
  const [hidden, setHidden] = useState(true);
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ marginBottom: space.lg }}>
      <Txt variant="label" style={{ marginBottom: 6 }}>{label}</Txt>
      <View style={{ flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center', backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: error ? c.danger : focus ? c.ink : c.line }}>
        <TextInput
          placeholderTextColor={c.ink3}
          secureTextEntry={secure && hidden}
          multiline={multiline}
          onFocus={e => { setFocus(true); rest.onFocus?.(e); }}
          onBlur={e => { setFocus(false); rest.onBlur?.(e); }}
          style={[{ flex: 1, minHeight: multiline ? 110 : 52, paddingHorizontal: 14, paddingVertical: multiline ? 12 : 0, fontFamily: fonts.regular, fontSize: 16, color: c.ink, textAlignVertical: multiline ? 'top' : 'center' }, style]}
          accessibilityLabel={label}
          accessibilityHint={error || hint}
          {...rest}
        />
        {secure && (
          <Pressable onPress={() => setHidden(h => !h)} accessibilityRole="button" accessibilityLabel={hidden ? 'Afficher le mot de passe' : 'Masquer le mot de passe'} hitSlop={8} style={{ paddingHorizontal: 14, height: 52, justifyContent: 'center' }}>
            {hidden ? <Eye size={20} color={c.ink3} /> : <EyeOff size={20} color={c.ink3} />}
          </Pressable>
        )}
      </View>
      {error ? <Txt variant="small" accessibilityLiveRegion="polite" style={{ color: c.danger, marginTop: 4 }}>{error}</Txt> : hint ? <Txt variant="small" style={{ marginTop: 4 }}>{hint}</Txt> : null}
    </View>
  );
}

/** Message d'alerte en tête de formulaire. */
export function Alert({ children, tone = 'danger' }: { children?: ReactNode; tone?: Tone }) {
  const { tone: t, radius, space } = useTheme();
  if (!children) return null;
  const { fg, bg } = t(tone);
  return (
    <View style={{ flexDirection: 'row', gap: 10, backgroundColor: bg, borderRadius: radius.md, padding: space.md, marginBottom: space.lg }} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <CircleAlert size={18} color={fg} />
      <Txt variant="small" style={{ color: fg, flex: 1 }}>{children}</Txt>
    </View>
  );
}

/** Encadré d'information avec icône, éventuellement cliquable. */
export function Callout({ icon: Icon, title, text, tone = 'info', onPress, right }: { icon: LucideIcon; title: string; text?: string; tone?: Tone; onPress?: () => void; right?: ReactNode }) {
  const { tone: t, radius, space, c } = useTheme();
  const { fg, bg } = t(tone);
  const inner = (
    <>
      <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}><Icon size={18} color={fg} /></View>
      <View style={{ flex: 1 }}>
        <Txt variant="bodyStrong" style={{ color: fg, fontSize: 15 }}>{title}</Txt>
        {text ? <Txt variant="small" style={{ color: c.ink2, marginTop: 2 }}>{text}</Txt> : null}
      </View>
      {right}
    </>
  );
  const style: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: bg, borderRadius: radius.lg, padding: space.md };
  return onPress
    ? <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [style, pressed && { opacity: 0.85 }]}>{inner}</Pressable>
    : <View style={style}>{inner}</View>;
}

/* ─── Feuille modale ────────────────────────────────────── */

/**
 * Feuille modale coulissante : monte du bas avec un ressort, fond assombri en fondu, poignée et titre à faire glisser
 * vers le bas pour fermer (au-delà d'un seuil ou d'un geste rapide ; sinon elle revient). Le fond et la croix ferment
 * aussi en glissant. Coins arrondis, hauteur selon le contenu (92 % de l'écran au plus), actions en bas.
 */
export function Sheet({ visible, title, onClose, children, footer, beforeClose }: {
  visible: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
  /** Appelée avant de fermer (glissement, fond, croix) : false garde la feuille ouverte (ex. paiement non déclaré). */
  beforeClose?: () => Promise<boolean> | boolean;
}) {
  const { c, space, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [y] = useState(() => new Animated.Value(height));
  useEffect(() => {
    if (!visible) return;
    y.setValue(height);
    Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 24, stiffness: 240, mass: 0.9 }).start();
  }, [visible, y, height]);
  const back = () => Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 260 }).start();
  const close = async () => {
    if (beforeClose && !(await beforeClose())) { back(); return; }
    Animated.timing(y, { toValue: height, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => onClose());
  };
  // Fermeture lue au moment du geste (elle dépend des propriétés du dernier rendu)
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  // Les rappels du geste ne lisent la fermeture qu'au relâchement, jamais pendant le rendu
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => y.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_, g) => {
      if (g.dy > 110 || g.vy > 0.9) closeRef.current();
      else Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 260 }).start();
    },
    onPanResponderTerminate: () => Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 260 }).start(),
  }));
  const backdrop = y.interpolate({ inputRange: [0, height * 0.6], outputRange: [1, 0], extrapolate: 'clamp' });
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay, opacity: backdrop }]}>
            <Pressable style={{ flex: 1 }} onPress={close} accessibilityRole="button" accessibilityLabel="Fermer" />
          </Animated.View>
          <Animated.View accessibilityViewIsModal
            style={{ maxHeight: '92%', backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden', transform: [{ translateY: y }],
              shadowColor: '#000', shadowOpacity: isDark ? 0 : 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: -6 }, elevation: 16 }}>
            {/* Poignée et titre : zone de glissement (le contenu reste libre de défiler) */}
            <View {...pan.panHandlers}>
                <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }} accessibilityElementsHidden>
                  <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: c.line }} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: 6, paddingBottom: space.md }}>
                  <Txt variant="h3" style={{ flex: 1 }} numberOfLines={2} accessibilityRole="header">{title}</Txt>
                  <IconButton icon={X} label="Fermer" onPress={close} size={38} />
                </View>
            </View>
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: footer ? space.lg : Math.max(insets.bottom, space.lg) + space.md }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
            {footer ? <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: Math.max(insets.bottom, space.lg), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line, backgroundColor: c.surface }}>{footer}</View> : null}
          </Animated.View>
        </KeyboardAvoidingView>
    </Modal>
  );
}

/* ─── Chargement, vide, erreur ──────────────────────────── */

export function Skeleton({ h = 16, w = '100%', r = 8, style }: { h?: number; w?: number | `${number}%`; r?: number; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const [pulse] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[{ height: h, width: w, borderRadius: r, backgroundColor: c.surfaceAlt, opacity: pulse }, style]} accessibilityLabel="Chargement" />;
}

export function PageSkeleton() {
  const { space } = useTheme();
  return (
    <View style={{ padding: space.lg, gap: space.md }} accessibilityLabel="Chargement" accessibilityRole="progressbar">
      <Skeleton h={14} w="40%" />
      <Skeleton h={30} w="75%" />
      <Skeleton h={160} r={16} style={{ marginTop: space.md }} />
      <Skeleton h={90} r={16} />
      <Skeleton h={90} r={16} />
    </View>
  );
}

export function Empty({ icon: Icon = Inbox, title, text, children }: { icon?: LucideIcon; title: string; text?: string; children?: ReactNode }) {
  const { c, space } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.lg, gap: space.sm }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm }}>
        <Icon size={28} color={c.ink3} />
      </View>
      <Txt variant="h3" center>{title}</Txt>
      {text ? <Txt variant="small" center style={{ maxWidth: 320 }}>{text}</Txt> : null}
      {children ? <View style={{ marginTop: space.md, alignItems: 'center' }}>{children}</View> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Une erreur est survenue.';
  return (
    <Empty icon={CircleAlert} title="Impossible d’afficher cette page" text={message}>
      {onRetry ? <Button label="Réessayer" icon={RefreshCw} variant="ghost" size="sm" onPress={onRetry} /> : null}
    </Empty>
  );
}

export function Spinner({ color }: { color?: string }) {
  const { c } = useTheme();
  return <ActivityIndicator color={color || c.primary} />;
}

/* ─── Mise en page ──────────────────────────────────────── */

export function SectionHead({ title, eyebrow, action }: { title: string; eyebrow?: string; action?: ReactNode }) {
  const { space } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md, marginTop: space.xl, marginBottom: space.md }}>
      <View style={{ flex: 1 }}>
        {eyebrow ? <Txt variant="eyebrow" style={{ marginBottom: 4 }}>{eyebrow}</Txt> : null}
        <Txt variant="h3" accessibilityRole="header">{title}</Txt>
      </View>
      {action}
    </View>
  );
}

/** Ligne de liste : icône, titre, sous-titre, fin (montant, pastille), chevron. */
export function Row({ icon: Icon, iconTone = 'muted', title, sub, end, onPress, last, accessibilityLabel }: { icon?: LucideIcon; iconTone?: Tone; title: string; sub?: string; end?: ReactNode; onPress?: () => void; last?: boolean; accessibilityLabel?: string }) {
  const { c, tone, space } = useTheme();
  const t = tone(iconTone);
  const inner = (
    <>
      {Icon ? <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}><Icon size={18} color={t.fg} /></View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="bodyStrong" style={{ fontSize: 15 }} numberOfLines={2}>{title}</Txt>
        {sub ? <Txt variant="small" numberOfLines={3}>{sub}</Txt> : null}
      </View>
      {end}
    </>
  );
  const style: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, minHeight: 64, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: c.line };
  return onPress
    ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => [style, pressed && { backgroundColor: c.surfaceAlt }]}>{inner}</Pressable>
    : <View style={style}>{inner}</View>;
}

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.line }} />;
}

/* ─── Avancement ────────────────────────────────────────── */

export function Ring({ value, size = 84, label, light }: { value: number; size?: number; label?: string; light?: boolean }) {
  const { c, fonts } = useTheme();
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const stroke = 8;
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="progressbar" accessibilityLabel={`${v} % ${label || ''}`} accessibilityValue={{ min: 0, max: 100, now: v }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={light ? 'rgba(255,255,255,0.25)' : c.surfaceAlt} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.primary} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${(len * v) / 100} ${len}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      <Txt style={{ fontFamily: fonts.bold, fontSize: size * 0.24, color: light ? '#fff' : c.ink }}>{Math.round(v)}<Txt style={{ fontSize: size * 0.13, color: light ? '#fff' : c.ink3 }}> %</Txt></Txt>
      {label ? <Txt style={{ fontFamily: fonts.medium, fontSize: Math.max(10, size * 0.12), color: light ? 'rgba(255,255,255,0.75)' : c.ink3 }}>{label}</Txt> : null}
    </View>
  );
}

export function ProgressBar({ percent, color, track }: { percent: number; color?: string; track?: string }) {
  const { c } = useTheme();
  const v = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: track || c.surfaceAlt, overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: v }}>
      <View style={{ width: `${v}%`, height: '100%', borderRadius: 4, backgroundColor: color || c.primary }} />
    </View>
  );
}

/** Trois étapes (document, SAV) : barres allumées jusqu'à l'étape. */
export function Steps({ step }: { step: number }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 4, marginTop: 8 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map(i => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? c.ok : c.surfaceAlt }} />)}
    </View>
  );
}

export type IconProps = ComponentProps<LucideIcon>;

/* ─── Interrupteur aux couleurs SIIPAF : piste rouge et curseur noir quand il est activé ─── */
export function AppSwitch({ value, onValueChange, label }: { value: boolean; onValueChange: (v: boolean) => void; label: string }) {
  const { c, isDark } = useTheme();
  const thumb = value ? '#0A0A0A' : isDark ? '#D4D4D8' : '#FFFFFF';
  return (
    <Switch value={value} onValueChange={onValueChange} accessibilityLabel={label}
      trackColor={{ true: c.red, false: isDark ? '#3A3A40' : '#D9DAE0' }} thumbColor={thumb} ios_backgroundColor={isDark ? '#3A3A40' : '#D9DAE0'}
      {...({ activeThumbColor: '#0A0A0A', activeTrackColor: c.red } as object)} />
  );
}
