/**
 * Menu déroulant mobile : un bouton-pastille (« Ville ▾ ») ouvre une feuille qui monte du bas avec les choix, leur nombre
 * de programmes et une coche sur le choix actif. Fermeture : choix, toucher hors de la feuille ou retour Android.
 */
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronDown, X, type LucideIcon } from 'lucide-react-native';
import * as Haptics from '@/lib/haptics';
import { useT } from '@/providers/preferences';
import { useTheme } from '@/theme';
import { Txt } from './Text';

export type SelectOption<V> = { value: V; label: string; count?: number; hint?: string };

export function BottomSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const { c, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay }]} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('Fermer')} />
        <View style={{ maxHeight: '75%', backgroundColor: c.surface, borderTopLeftRadius: radius.xl + 4, borderTopRightRadius: radius.xl + 4, paddingBottom: Math.max(insets.bottom, space.md) }} accessibilityViewIsModal>
          <View style={{ alignItems: 'center', paddingTop: 8 }}><View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: c.line }} /></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm }}>
            <Txt variant="h3" style={{ flex: 1 }} accessibilityRole="header">{title}</Txt>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('Fermer')} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
              <X size={18} color={c.ink} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: space.md, paddingBottom: space.md }}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Liste de choix d'une feuille (bouton radio par ligne). */
export function OptionList<V extends string | number | null>({ options, value, onPick }: { options: SelectOption<V>[]; value: V; onPick: (v: V) => void }) {
  const { c, radius, fonts } = useTheme();
  const t = useT();
  return (
    <View accessibilityRole="radiogroup">
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable key={String(o.value)} onPress={() => { Haptics.selectionAsync().catch(() => {}); onPick(o.value); }} accessibilityRole="radio" accessibilityState={{ checked: on }}
            accessibilityLabel={`${o.label}${o.count != null ? `, ${t('{n} programme(s)', { n: o.count })}` : ''}`}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: on ? c.dangerSoft : pressed ? c.surfaceAlt : 'transparent' })}>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontFamily: on ? fonts.semibold : fonts.medium, fontSize: 15.5, color: c.ink }}>{o.label}</Txt>
              {o.hint ? <Txt variant="tiny">{o.hint}</Txt> : null}
            </View>
            {o.count != null ? <Txt style={{ fontSize: 13, color: c.ink3 }}>{o.count}</Txt> : null}
            <View style={{ width: 24, alignItems: 'center' }}>{on ? <Check size={20} color={c.primary} /> : null}</View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Pastille de filtre qui ouvre son menu déroulant, dans l'esprit des pastilles Chip (06/11) : douce au repos (fond or très clair,
 * bordure or, texte et chevron or foncé), rouge SIIPAF quand un choix est actif. Pas de noir plein, pour ne pas alourdir
 * les rangées de filtres. Cible tactile de 44 px, contrastes AA (texte 14 px) en thème clair comme en thème sombre.
 * neutral : pastille grise (bouton « Trier », demande du client du 06/11), qui n'est pas un filtre.
 */
export function Select<V extends string | number | null>({ label, value, options, onChange, allLabel, neutral, field }: {
  label: string; value: V; options: SelectOption<V>[]; onChange: (v: V) => void; allLabel: string; neutral?: boolean;
  /** Présentation « champ de formulaire » (carte de filtres de la recherche, 09/11) : icône et libellé en petites capitales,
   * valeur dessous (« Toutes », « Tous » sans choix), chevron, filet bas ; la valeur passe en rouge quand un choix est actif. */
  field?: { icon?: LucideIcon; empty: string };
}) {
  const { c, radius, fonts } = useTheme();
  const [open, setOpen] = useState(false);
  const chosen = options.find(o => o.value === value && value !== null);
  const all: SelectOption<V> = { value: null as V, label: allLabel };
  const tone = neutral ? { bg: c.surfaceAlt, border: c.line, fg: c.ink, icon: c.ink2 }
    : chosen ? { bg: c.primary, border: c.primary, fg: c.onPrimary, icon: c.onPrimary } : { bg: c.accentSoft, border: c.goldLight, fg: c.accent, icon: c.accent };
  const sheet = (
    <BottomSheet visible={open} title={label} onClose={() => setOpen(false)}>
      <OptionList options={[all, ...options]} value={(chosen ? value : null) as V} onPick={v => { onChange(v); setOpen(false); }} />
    </BottomSheet>
  );
  if (field) {
    const Icon = field.icon;
    return (
      <>
        <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setOpen(true); }} accessibilityRole="button" accessibilityLabel={`${label} : ${chosen ? chosen.label : allLabel}`}
          style={({ pressed }) => ({ flex: 1, minWidth: 0, paddingTop: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: chosen ? c.primary : c.line, opacity: pressed ? 0.6 : 1 })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {Icon ? <Icon size={15} color={c.accent} strokeWidth={2} /> : null}
            <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 11.5, letterSpacing: 0.7, textTransform: 'uppercase', color: c.ink3 }} numberOfLines={1}>{label}</Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, minHeight: 26 }}>
            <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 16, color: chosen ? c.primary : c.ink }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{chosen ? chosen.label : field.empty}</Txt>
            <ChevronDown size={18} color={chosen ? c.primary : c.ink2} />
          </View>
        </Pressable>
        {sheet}
      </>
    );
  }
  return (
    <>
      <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setOpen(true); }} accessibilityRole="button" accessibilityLabel={`${label} : ${chosen ? chosen.label : allLabel}`}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingLeft: 14, paddingRight: 10, borderRadius: radius.pill, borderWidth: 1,
          borderColor: tone.border, backgroundColor: tone.bg, opacity: pressed ? 0.8 : 1 })}>
        <Txt style={{ fontFamily: chosen ? fonts.semibold : fonts.medium, fontSize: 14, color: tone.fg }} numberOfLines={1}>{chosen ? chosen.label : label}</Txt>
        <ChevronDown size={16} color={tone.icon} />
      </Pressable>
      {sheet}
    </>
  );
}
