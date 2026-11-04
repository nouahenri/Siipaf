/**
 * Champ de recherche de l'accueil, avec suggestions en direct tirées de la base : programmes publiés (nom, ville,
 * localisation, types de biens) et valeurs des listes de Paramètres (villes, localisations, types de biens), avec leur
 * nombre de programmes. Un programme ouvre sa fiche ; une ville, une localisation ou un type ouvre la recherche filtrée ;
 * « Voir les résultats » ouvre la recherche avec le texte saisi.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ArrowUpRight, Building, House, MapPin, Search, X, type LucideIcon } from 'lucide-react-native';
import { Txt } from '@/components/ui';
import { projectKind } from '@/lib/domain';
import * as Haptics from '@/lib/haptics';
import { projectImage, useFilters, useProjects } from '@/lib/queries';
import { usePrefs } from '@/providers/preferences';
import { useTheme } from '@/theme';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

type Suggestion = { key: string; icon: LucideIcon; label: string; sub: string; image?: ReturnType<typeof projectImage>; go: () => void };

export function SearchBox({ onFocus }: { onFocus?: () => void }) {
  const { c, radius, fonts, space } = useTheme();
  const { t } = usePrefs();
  const projects = useProjects();
  const filters = useFilters();
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);

  const done = (fn: () => void) => { Haptics.selectionAsync().catch(() => {}); Keyboard.dismiss(); setFocused(false); fn(); };
  const suggestions = useMemo<Suggestion[]>(() => {
    const term = norm(q.trim());
    if (term.length < 1) return [];
    const has = (s?: string | null) => !!s && norm(s).includes(term);
    const out: Suggestion[] = [];
    for (const p of projects.data || []) {
      if ([p.name, p.city, p.location, p.tagline, ...p.property_types].some(has)) {
        out.push({ key: `p${p.id}`, icon: Building, label: p.name, sub: [projectKind(p), p.city].filter(Boolean).join(' · '), image: projectImage(p), go: () => router.push(`/projet/${p.slug}`) });
      }
    }
    const f = filters.data;
    for (const v of f?.villes || []) if (has(v.label)) out.push({ key: `v${v.id}`, icon: MapPin, label: v.label, sub: t('Ville · {n} programme(s)', { n: v.count }), go: () => router.navigate({ pathname: '/programmes', params: { ville: String(v.id) } }) });
    for (const l of f?.localisations || []) if (has(l.label)) out.push({ key: `l${l.id}`, icon: MapPin, label: l.label, sub: t('Localisation · {n} programme(s)', { n: l.count }), go: () => router.navigate({ pathname: '/programmes', params: { lieu: String(l.id), ...(l.ville_id ? { ville: String(l.ville_id) } : {}) } }) });
    for (const x of f?.types_bien || []) if (has(x.label)) out.push({ key: `b${x.id}`, icon: House, label: x.label, sub: t('Type de bien · {n} programme(s)', { n: x.count }), go: () => router.navigate({ pathname: '/programmes', params: { bien: String(x.id) } }) });
    return out.slice(0, 8);
  }, [q, projects.data, filters.data, t]);

  const open = focused && q.trim().length > 0;
  return (
    <View style={{ zIndex: 10 }}>
      {/* Toute la pastille donne le focus au champ ; le champ occupe toute la largeur et la hauteur */}
      <Pressable onPress={() => input.current?.focus()} accessible={false}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 54, paddingLeft: 18, paddingRight: 6, borderRadius: radius.pill, backgroundColor: focused ? c.surface : c.surfaceAlt, borderWidth: 1.5, borderColor: focused ? c.ink : c.line }}>
        <Search size={20} color={focused ? c.ink : c.ink3} />
        <TextInput ref={input} value={q} onChangeText={setQ} onFocus={() => { setFocused(true); onFocus?.(); }} onBlur={() => setTimeout(() => setFocused(false), 200)}
          placeholder={t('Programme, ville, type de bien…')} placeholderTextColor={c.ink3} returnKeyType="search" autoCorrect={false}
          onSubmitEditing={() => q.trim() && done(() => router.navigate({ pathname: '/programmes', params: { q: q.trim() } }))}
          style={[{ flex: 1, minWidth: 0, alignSelf: 'stretch', paddingVertical: 0, fontFamily: fonts.regular, fontSize: 16, color: c.ink }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
          accessibilityLabel={t('Rechercher un programme')} clearButtonMode="never" enterKeyHint="search" />
        {q ? (
          <Pressable onPress={() => { setQ(''); input.current?.focus(); }} accessibilityRole="button" accessibilityLabel={t('Effacer la recherche')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <X size={18} color={c.ink3} />
          </Pressable>
        ) : null}
      </Pressable>

      {open && (
        <View style={{ marginTop: 8, borderRadius: radius.lg, backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, overflow: 'hidden' }} accessibilityLiveRegion="polite">
          {suggestions.length === 0 ? (
            <View style={{ padding: space.md }}><Txt variant="small">{t('Aucun programme ne correspond à « {q} »', { q: q.trim() })}</Txt></View>
          ) : suggestions.map(sg => (
            <Pressable key={sg.key} onPress={() => done(sg.go)} accessibilityRole="button" accessibilityLabel={`${sg.label}, ${sg.sub}`}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: space.md, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
              {sg.image ? <Image source={sg.image} style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: c.surfaceAlt }} contentFit="cover" />
                : <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: c.dangerSoft, alignItems: 'center', justifyContent: 'center' }}><sg.icon size={18} color={c.primary} /></View>}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 14.5, color: c.ink }} numberOfLines={1}>{sg.label}</Txt>
                <Txt style={{ fontSize: 12.5, color: c.ink3 }} numberOfLines={1}>{sg.sub}</Txt>
              </View>
              <ArrowUpRight size={16} color={c.ink3} />
            </Pressable>
          ))}
          <Pressable onPress={() => done(() => router.navigate({ pathname: '/programmes', params: { q: q.trim() } }))} accessibilityRole="button"
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
            <Search size={15} color={c.primary} />
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: c.primary }}>{t('Voir tous les résultats pour « {q} »', { q: q.trim() })}</Txt>
          </Pressable>
        </View>
      )}
    </View>
  );
}
