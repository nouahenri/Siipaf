/**
 * Textes de l'application (Poppins ; titres en gras serré). `Title` lit la mise en valeur des textes du dashboard :
 * « Nos *Domaines d'Activité* » → partie entre astérisques en rouge SIIPAF.
 */
import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '@/theme';

type Variant = 'hero' | 'h1' | 'h2' | 'h3' | 'body' | 'bodyStrong' | 'small' | 'tiny' | 'eyebrow' | 'label' | 'number';
type Props = TextProps & { variant?: Variant; color?: string; center?: boolean; muted?: boolean };

export function Txt({ variant = 'body', color, center, muted, style, ...rest }: Props) {
  const { c, fonts, type } = useTheme();
  const v: Record<Variant, TextStyle> = {
    hero: { fontFamily: fonts.bold, fontSize: type.hero, lineHeight: type.hero * 1.18, letterSpacing: -0.6, color: c.ink },
    h1: { fontFamily: fonts.bold, fontSize: type.h1, lineHeight: type.h1 * 1.22, letterSpacing: -0.4, color: c.ink },
    h2: { fontFamily: fonts.bold, fontSize: type.h2, lineHeight: type.h2 * 1.25, letterSpacing: -0.3, color: c.ink },
    h3: { fontFamily: fonts.semibold, fontSize: type.h3, lineHeight: type.h3 * 1.35, color: c.ink },
    body: { fontFamily: fonts.regular, fontSize: type.body, lineHeight: type.body * 1.55, color: c.ink2 },
    bodyStrong: { fontFamily: fonts.semibold, fontSize: type.body, lineHeight: type.body * 1.45, color: c.ink },
    small: { fontFamily: fonts.regular, fontSize: type.small, lineHeight: type.small * 1.5, color: c.ink3 },
    tiny: { fontFamily: fonts.medium, fontSize: type.tiny, lineHeight: type.tiny * 1.4, color: c.ink3 },
    eyebrow: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: c.ink3 },
    label: { fontFamily: fonts.medium, fontSize: type.small, color: c.ink2 },
    number: { fontFamily: fonts.bold, fontSize: type.h2, color: c.ink, fontVariant: ['tabular-nums'] },
  };
  return (
    <RNText
      maxFontSizeMultiplier={2}
      style={[v[variant], muted && { color: c.ink3 }, color ? { color } : null, center && { textAlign: 'center' }, style]}
      {...rest}
    />
  );
}

/** Titre avec mise en valeur « *…* » (textes éditoriaux du dashboard). */
export function Title({ children, variant = 'h1', emColor, ...rest }: Omit<Props, 'children'> & { children?: string | null; emColor?: string }) {
  const { c, fonts } = useTheme();
  const parts = String(children || '').replace(/<br\s*\/?>/gi, ' ').split(/\*([^*]+)\*/g);
  return (
    <Txt variant={variant} accessibilityRole="header" {...rest}>
      {parts.map((p, i) => (i % 2 ? <RNText key={i} style={{ fontFamily: fonts.bold, color: emColor || c.primary }}>{p}</RNText> : p))}
    </Txt>
  );
}

/** Texte éditorial sans ses marques de mise en valeur. */
export const plain = (s?: string | null) => String(s || '').replace(/\*([^*]+)\*/g, '$1').replace(/<br\s*\/?>/gi, ' ');
