/**
 * Signaler un problème (SAV) en trois étapes numérotées : 1. type de problème (tuiles avec icône, rangées en quatre familles,
 * repliées en un rappel une fois le choix fait), 2. description (titre, lieu, détails), 3. photos. Bien concerné en tête
 * de l'étape 1 quand le client a plusieurs dossiers. Les valeurs envoyées restent les clés du serveur (/sav/meta).
 * Ouvert aussi depuis un document (catégorie administrative, titre et détails préremplis).
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  BrickWall, Check, CircleHelp, DoorOpen, Droplets, Fence, FileText, LandPlot, PaintRoller, RefreshCw, ScrollText, SendHorizontal,
  ShowerHead, UtilityPole, Wrench, Zap, type LucideIcon,
} from 'lucide-react-native';
import { PhotoField } from '@/components/client/Photos';
import { Alert, Button, Chip, ChipRow, Field, Screen, Skeleton, Txt } from '@/components/ui';
import { clientApi } from '@/lib/api';
import * as Haptics from '@/lib/haptics';
import { useSavMeta } from '@/lib/queries';
import type { SavFile, SavTicket } from '@/lib/types';
import { useSession } from '@/providers/session';
import { useToast } from '@/providers/toast';
import { useTheme } from '@/theme';

/** Familles d'affichage des catégories du serveur (une clé inconnue rejoint « Autre » avec l'icône générique). */
const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Terrain & foncier', keys: ['bornage', 'foncier', 'viabilisation', 'vrd'] },
  { title: 'Construction', keys: ['maconnerie', 'etancheite', 'menuiserie', 'revetements'] },
  { title: 'Équipements', keys: ['plomberie', 'electricite', 'equipements'] },
  { title: 'Autre', keys: ['administratif', 'autre'] },
];
const ICONS: Record<string, LucideIcon> = {
  bornage: LandPlot, foncier: ScrollText, viabilisation: UtilityPole, vrd: Fence,
  maconnerie: BrickWall, etancheite: Droplets, menuiserie: DoorOpen, revetements: PaintRoller,
  plomberie: Wrench, electricite: Zap, equipements: ShowerHead,
  administratif: FileText, autre: CircleHelp,
};
/** Icône d'une catégorie (lecture directe de la table : pas de composant créé pendant le rendu). */
function CategoryIcon({ k, size, color }: { k: string; size: number; color: string }) {
  const Icon = ICONS[k] ?? CircleHelp;
  return <Icon size={size} color={color} />;
}

export default function NouvelleDemande() {
  const params = useLocalSearchParams<{ category?: string; title?: string; description?: string; sale?: string }>();
  const { c, space, radius, fonts } = useTheme();
  const qc = useQueryClient();
  const toast = useToast();
  const { dossiers, selected } = useSession();
  const meta = useSavMeta();
  const [f, setF] = useState({
    sale_id: Number(params.sale) || selected?.id || dossiers[0]?.id || 0,
    category: params.category || '', title: params.title || '', location: '', description: params.description || '',
  });
  const [photos, setPhotos] = useState<SavFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Liste des types dépliée tant qu'aucun choix n'est fait ; repliée en un rappel « Modifier » ensuite
  const [picking, setPicking] = useState(!params.category);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const t = await clientApi.post<SavTicket>('/sav', {
        sale_id: saleId, category: f.category, title: f.title.trim(), location: f.location.trim() || undefined,
        description: f.description.trim() || undefined, media_ids: photos.map(p => p.id),
      });
      qc.invalidateQueries({ queryKey: ['client', 'sav'] });
      toast('Demande envoyée à l’équipe SAV');
      router.replace(`/espace-client/sav/${t.id}`);
    } catch (e: any) { setError(e.message); setBusy(false); }
  };

  const categories = meta.data?.categories || {};
  const known = new Set(GROUPS.flatMap(g => g.keys));
  const groups = GROUPS.map(g => ({
    title: g.title,
    keys: [...g.keys, ...(g.title === 'Autre' ? Object.keys(categories).filter(k => !known.has(k)) : [])].filter(k => categories[k]),
  })).filter(g => g.keys.length);
  const chosenLabel = categories[f.category];
  const showSummary = !picking && !!f.category && !!chosenLabel;
  const titleOk = f.title.trim().length >= 3;
  // Dossier concerné : choix du client, sinon celui de la session (la liste peut arriver après l'ouverture de l'écran)
  const saleId = f.sale_id || selected?.id || dossiers[0]?.id || 0;
  const canSend = !!f.category && titleOk && !!saleId;
  const missing = !f.category ? 'Choisissez le type de problème pour continuer.' : !titleOk ? 'Décrivez le problème en quelques mots pour continuer.'
    : !saleId ? 'Aucun dossier d’acquisition n’est encore rattaché à votre compte : contactez SIIPAF.' : null;

  const pick = (k: string) => {
    Haptics.selectionAsync().catch(() => {});
    setF(x => ({ ...x, category: k }));
    setPicking(false);
  };

  const tile = (k: string) => {
    const on = f.category === k;
    return (
      <Pressable key={k} onPress={() => pick(k)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={categories[k]}
        style={({ pressed }) => ({
          flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, paddingVertical: 10, paddingHorizontal: 10,
          borderRadius: radius.md, borderWidth: 1.5, borderColor: on ? c.primary : c.line, backgroundColor: on ? c.dangerSoft : c.surface,
          opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.98 : 1 }],
        })}>
        {/* Icône neutre (gris) : l'or et le crème sont réservés aux pastilles d'étape, le rouge au choix (09/11) */}
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: on ? c.primary : c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
          <CategoryIcon k={k} size={18} color={on ? c.onPrimary : c.ink2} />
        </View>
        <Txt style={{ flex: 1, fontFamily: on ? fonts.semibold : fonts.medium, fontSize: 13.5, lineHeight: 18, color: c.ink }}>{categories[k]}</Txt>
      </Pressable>
    );
  };

  // Tuiles deux par deux (la dernière d'une famille impaire garde la largeur d'une demi-ligne)
  const pairs = (keys: string[]) => {
    const rows: string[][] = [];
    for (let i = 0; i < keys.length; i += 2) rows.push(keys.slice(i, i + 2));
    return rows.map(r => (
      <View key={r.join('-')} style={{ flexDirection: 'row', gap: space.sm }}>
        {r.map(tile)}
        {r.length === 1 && <View style={{ flex: 1 }} />}
      </View>
    ));
  };

  let typeBlock: ReactNode;
  if (meta.isLoading) {
    typeBlock = (
      <View style={{ gap: space.sm }} accessibilityLabel="Chargement des types de problème">
        {[0, 1, 2].map(i => <View key={i} style={{ flexDirection: 'row', gap: space.sm }}><View style={{ flex: 1 }}><Skeleton h={64} r={radius.md} /></View><View style={{ flex: 1 }}><Skeleton h={64} r={radius.md} /></View></View>)}
      </View>
    );
  } else if (meta.isError) {
    typeBlock = (
      <View>
        <Alert>Les types de problème n’ont pas pu être chargés. Vérifiez votre connexion puis réessayez.</Alert>
        <Button label="Réessayer" icon={RefreshCw} variant="ghost" size="sm" onPress={() => meta.refetch()} />
      </View>
    );
  } else if (showSummary) {
    typeBlock = (
      <Pressable onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel={`Type de problème : ${chosenLabel}. Modifier`}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 12, padding: space.md, borderRadius: radius.lg,
          borderWidth: 1.5, borderColor: c.primary, backgroundColor: c.dangerSoft, opacity: pressed ? 0.85 : 1,
        })}>
        <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
          <CategoryIcon k={f.category} size={20} color={c.onPrimary} />
        </View>
        <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: c.ink }}>{chosenLabel}</Txt>
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 13.5, color: c.danger }}>Modifier</Txt>
      </Pressable>
    );
  } else {
    typeBlock = (
      <View accessibilityRole="radiogroup" accessibilityLabel="Type de problème" style={{ gap: space.lg }}>
        {groups.map(g => (
          <View key={g.title} style={{ gap: space.sm }}>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 11.5, letterSpacing: 0.8, textTransform: 'uppercase', color: c.ink3 }}>{g.title}</Txt>
            {pairs(g.keys)}
          </View>
        ))}
      </View>
    );
  }

  return (
    <Screen footer={
      <View style={{ gap: space.sm }}>
        {missing && !busy ? <Txt variant="small" center>{missing}</Txt> : null}
        <Button label="Envoyer la demande" icon={SendHorizontal} block haptic loading={busy} disabled={!canSend} onPress={submit} />
      </View>
    }>
      <Txt variant="body" style={{ marginBottom: space.xl }}>Trois étapes pour transmettre votre demande à l’équipe SAV.</Txt>
      <Alert>{error}</Alert>

      <Step n={1} title="Quel est le problème ?" sub="Choisissez la famille qui s’en rapproche le plus." done={!!f.category}>
        {dossiers.length > 1 && (
          <View style={{ marginBottom: space.lg }}>
            <Txt variant="label" style={{ marginBottom: 6 }}>Bien concerné</Txt>
            <ChipRow>{dossiers.map(d => <Chip key={d.id} label={`Lot ${d.property.lot_code} · ${d.property.project.name}`} selected={saleId === d.id} onPress={() => setF(x => ({ ...x, sale_id: d.id }))} />)}</ChipRow>
          </View>
        )}
        {typeBlock}
      </Step>

      <Step n={2} title="Décrivez-le" sub="Quelques mots suffisent, les détails aident à préparer la visite." done={titleOk}>
        <Field label="En quelques mots" value={f.title} onChangeText={v => setF(x => ({ ...x, title: v }))} maxLength={160} placeholder="Ex. Fuite sous l’évier de la cuisine"
          hint={f.title.trim().length > 0 && !titleOk ? '3 caractères au moins.' : undefined} />
        <Field label="Où dans le logement ? (facultatif)" value={f.location} onChangeText={v => setF(x => ({ ...x, location: v }))} maxLength={120} placeholder="Cuisine, chambre 2, façade…" />
        <Field label="Détails (facultatif)" value={f.description} onChangeText={v => setF(x => ({ ...x, description: v }))} multiline maxLength={5000} placeholder="Depuis quand, à quel moment, ce que vous avez constaté…" />
      </Step>

      <Step n={3} title="Ajoutez des photos" sub="Facultatif. Une photo du problème aide nos équipes à préparer l’intervention." done={photos.length > 0} last>
        <PhotoField value={photos} onChange={setPhotos} />
      </Step>
    </Screen>
  );
}

/**
 * Étape numérotée : en-tête en bandeau (fond gris, filet rouge à gauche), pastille pleine (numéro blanc sur rouge, coche
 * blanche sur vert une fois remplie), titre, aide courte, puis son contenu. Le bandeau se détache nettement des tuiles
 * de choix, qui restent blanches à icône grise (demande du client du 09/11).
 */
function Step({ n, title, sub, done, last, children }: { n: number; title: string; sub: string; done: boolean; last?: boolean; children: ReactNode }) {
  const { c, space, fonts, radius } = useTheme();
  return (
    <View style={[{ paddingBottom: space.xl }, !last && { marginBottom: space.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg, paddingVertical: 12, paddingHorizontal: space.md,
        backgroundColor: c.surfaceAlt, borderRadius: radius.md, borderLeftWidth: 4, borderLeftColor: done ? c.ok : c.primary }}>
        <View accessibilityLabel={done ? `Étape ${n}, remplie` : `Étape ${n}`}
          style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? c.ok : c.primary }}>
          {done ? <Check size={17} color="#fff" strokeWidth={3} /> : <Txt style={{ fontFamily: fonts.bold, fontSize: 15, color: c.onPrimary }}>{n}</Txt>}
        </View>
        <View style={{ flex: 1 }}>
          <Txt style={{ fontFamily: fonts.bold, fontSize: 17, color: c.ink }} accessibilityRole="header">{title}</Txt>
          <Txt style={{ fontSize: 12.5, lineHeight: 17, color: c.ink2, marginTop: 1 }}>{sub}</Txt>
        </View>
      </View>
      {children}
    </View>
  );
}
