/**
 * Menu déroulant mobile : un bouton-pastille (« Ville ▾ ») ouvre une feuille qui monte du bas avec les choix, leur nombre
 * de programmes et une coche sur le choix actif. Fermeture : choix, toucher hors de la feuille ou retour Android.
 */
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronDown, X } from 'lucide-react-native';
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
 */
export function Select<V extends string | number | null>({ label, value, options, onChange, allLabel }: {
  label: string; value: V; options: SelectOption<V>[]; onChange: (v: V) => void; allLabel: string;
}) {
  const { c, radius, fonts } = useTheme();
  const [open, setOpen] = useState(false);
  const chosen = options.find(o => o.value === value && value !== null);
  const all: SelectOption<V> = { value: null as V, label: allLabel };
  return (
    <>
      <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setOpen(true); }} accessibilityRole="button" accessibilityLabel={`${label} : ${chosen ? chosen.label : allLabel}`}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingLeft: 14, paddingRight: 10, borderRadius: radius.pill, borderWidth: 1,
          borderColor: chosen ? c.primary : c.goldLight, backgroundColor: chosen ? c.primary : c.accentSoft, opacity: pressed ? 0.8 : 1 })}>
        <Txt style={{ fontFamily: chosen ? fonts.semibold : fonts.medium, fontSize: 14, color: chosen ? c.onPrimary : c.accent }} numberOfLines={1}>{chosen ? chosen.label : label}</Txt>
        <ChevronDown size={16} color={chosen ? c.onPrimary : c.accent} />
      </Pressable>
      <BottomSheet visible={open} title={label} onClose={() => setOpen(false)}>
        <OptionList options={[all, ...options]} value={(chosen ? value : null) as V} onPick={v => { onChange(v); setOpen(false); }} />
      </BottomSheet>
    </>
  );
}
