/**
 * Choix d'un pays (pays de résidence) : champ au style des autres champs, drapeau et nom ; au toucher, feuille avec
 * recherche, pays fréquents de la clientèle SIIPAF en tête, puis tous les pays du monde. Valeur : nom français.
 */
import { Image } from 'expo-image';
import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronDown, Search, X } from 'lucide-react-native';
import { countryByName, COUNTRIES, flagUrl, searchCountries, type Country } from '@/lib/countries';
import * as Haptics from '@/lib/haptics';
import { usePrefs } from '@/providers/preferences';
import { useTheme } from '@/theme';
import { Txt } from './Text';

const FREQUENT = ['CI', 'FR', 'US', 'CA', 'BE', 'CH', 'GB', 'IT', 'ES', 'DE', 'BF', 'ML', 'SN'];
type Row = { kind: 'head'; label: string } | { kind: 'clear'; label: string } | { kind: 'country'; c: Country };

export function Flag({ code, size = 24 }: { code: string; size?: number }) {
  const { c } = useTheme();
  return <Image source={{ uri: flagUrl(code) }} style={{ width: size, height: size * 0.72, borderRadius: 3, backgroundColor: c.surfaceAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line }} contentFit="cover" cachePolicy="disk" />;
}

/** Feuille de choix d'un pays (recherche, fréquents, tous) ; `clearLabel` ajoute en tête une ligne « aucun pays ». */
export function CountrySheet({ visible, title, value, onPick, onClose, clearLabel }: {
  visible: boolean; title: string; value: string; onPick: (v: string) => void; onClose: () => void; clearLabel?: string;
}) {
  const { c, radius, fonts, space } = useTheme();
  const { prefs, t } = usePrefs();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const chosen = countryByName(value);
  const lang = prefs.language;

  const rows = useMemo<Row[]>(() => {
    if (q.trim()) return searchCountries(q, lang).map(c => ({ kind: 'country', c }));
    const top = FREQUENT.map(code => COUNTRIES.find(x => x.code === code)!).filter(Boolean);
    const all = [...COUNTRIES].sort((a, b) => a.name[lang].localeCompare(b.name[lang], lang));
    return [
      ...(clearLabel ? [{ kind: 'clear' as const, label: clearLabel }] : []),
      { kind: 'head', label: t('Pays fréquents') }, ...top.map(c => ({ kind: 'country' as const, c })),
      { kind: 'head', label: t('Tous les pays') }, ...all.map(c => ({ kind: 'country' as const, c })),
    ];
  }, [q, lang, t, clearLabel]);

  const close = () => { onClose(); setQ(''); };
  const pick = (v: string) => { Haptics.selectionAsync().catch(() => {}); onPick(v); close(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay }]} onPress={close} accessibilityRole="button" accessibilityLabel={t('Fermer')} />
        <View style={{ height: '85%', backgroundColor: c.surface, borderTopLeftRadius: radius.xl + 4, borderTopRightRadius: radius.xl + 4, paddingBottom: Math.max(insets.bottom, space.sm) }} accessibilityViewIsModal>
          <View style={{ alignItems: 'center', paddingTop: 8 }}><View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: c.line }} /></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm }}>
            <Txt variant="h3" style={{ flex: 1 }} accessibilityRole="header">{title}</Txt>
            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t('Fermer')} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
              <X size={18} color={c.ink} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: space.lg, marginBottom: space.sm, height: 46, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: c.surfaceAlt }}>
            <Search size={18} color={c.ink3} />
            <TextInput value={q} onChangeText={setQ} placeholder={t('Rechercher un pays')} placeholderTextColor={c.ink3} autoCorrect={false} returnKeyType="search"
              style={{ flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 16, color: c.ink, paddingVertical: 0 }} accessibilityLabel={t('Rechercher un pays')} />
            {q ? <Pressable onPress={() => setQ('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Effacer la recherche')}><X size={16} color={c.ink3} /></Pressable> : null}
          </View>
          <FlatList
            data={rows}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            keyExtractor={(r, i) => (r.kind === 'country' ? `${r.c.code}-${i}` : `${r.kind}-${i}`)}
            contentContainerStyle={{ paddingHorizontal: space.md }}
            ListEmptyComponent={<Txt style={{ padding: space.lg, color: c.ink3 }}>{t('Aucun pays ne correspond à « {q} »', { q: q.trim() })}</Txt>}
            renderItem={({ item }) => {
              if (item.kind === 'head') return <Txt variant="eyebrow" style={{ paddingHorizontal: 12, paddingTop: space.md, paddingBottom: 6 }}>{item.label}</Txt>;
              const on = item.kind === 'clear' ? !value : chosen?.code === item.c.code;
              return (
                <Pressable onPress={() => pick(item.kind === 'clear' ? '' : item.c.name.fr)} accessibilityRole="radio" accessibilityState={{ checked: on }}
                  accessibilityLabel={item.kind === 'clear' ? item.label : item.c.name[lang]}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: on ? c.dangerSoft : pressed ? c.surfaceAlt : 'transparent' })}>
                  {item.kind === 'country' ? <Flag code={item.c.code} size={28} /> : null}
                  <Txt style={{ flex: 1, fontFamily: on ? fonts.semibold : fonts.medium, fontSize: 15.5, color: c.ink }} numberOfLines={1}>{item.kind === 'clear' ? item.label : item.c.name[lang]}</Txt>
                  {on ? <Check size={20} color={c.primary} /> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

/** Champ « pays » des formulaires : drapeau et nom du pays choisi, feuille de choix au toucher. */
export function CountryField({ label, value, onChange, error, placeholder }: { label: string; value: string; onChange: (v: string) => void; error?: string; placeholder?: string }) {
  const { c, radius, fonts, space } = useTheme();
  const { prefs, t } = usePrefs();
  const [open, setOpen] = useState(false);
  const chosen = countryByName(value);
  const lang = prefs.language;
  return (
    <View style={{ marginBottom: space.lg }}>
      <Txt variant="label" style={{ marginBottom: 6 }}>{label}</Txt>
      <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setOpen(true); }} accessibilityRole="button"
        accessibilityLabel={`${label} : ${chosen ? chosen.name[lang] : value || t('Choisir un pays')}`} accessibilityHint={error}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 14, backgroundColor: pressed ? c.surfaceAlt : c.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: error ? c.danger : c.line })}>
        {chosen ? <Flag code={chosen.code} /> : null}
        <Txt style={{ flex: 1, fontFamily: fonts.regular, fontSize: 16, color: chosen || value ? c.ink : c.ink3 }} numberOfLines={1}>
          {chosen ? chosen.name[lang] : value || placeholder || t('Choisir un pays')}
        </Txt>
        <ChevronDown size={18} color={c.ink3} />
      </Pressable>
      {error ? <Txt variant="small" accessibilityLiveRegion="polite" style={{ color: c.danger, marginTop: 4 }}>{error}</Txt> : null}
      <CountrySheet visible={open} title={label.replace(/\s*\*$/, '')} value={value} onPick={onChange} onClose={() => setOpen(false)} />
    </View>
  );
}
