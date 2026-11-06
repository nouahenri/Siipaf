/**
 * Accueil de l'espace client (client/src/pages/Home.jsx) : bien et avancement, situation financière, prochaine échéance ou
 * retard, messages non lus, dernière publication du chantier, accès rapides (dont SAV et retour à la vitrine).
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { ArrowRight, Camera, FileText, House, LifeBuoy, MapPin, MessageCircle, Ruler, TriangleAlert, Wallet } from 'lucide-react-native';
import { ClientHeader, NoDossier } from '@/components/client/common';
import { Badge, Callout, Card, ProgressBar, Ring, SectionHead, Skeleton, Txt } from '@/components/ui';
import { amount, dayLabel, daysUntil, fcfa, firstName, greeting, plural, shortDate } from '@/lib/format';
import { apiUrl } from '@/lib/api';
import { projectImage, useChantier } from '@/lib/queries';
import type { Dossier } from '@/lib/types';
import { useSession } from '@/providers/session';
import { useTheme } from '@/theme';

/**
 * Tuile du bien (refaite le 06/11 pour un affichage plus net) : photo du programme en bandeau avec le statut et le nom du
 * programme, puis lot, caractéristiques et anneau d'avancement du chantier, chacun avec sa place.
 */
function PropertyCard({ d }: { d: Dossier }) {
  const { c, space, fonts, radius, shadow } = useTheme();
  const p = d.property;
  return (
    <Pressable onPress={() => router.navigate('/espace-client/chantier')} accessibilityRole="button" accessibilityLabel={`Votre bien : lot ${p.lot_code}, ${p.project.name}. Voir le chantier`}
      style={({ pressed }) => ({ borderRadius: radius.lg, backgroundColor: c.surface, overflow: 'hidden', borderWidth: 1, borderColor: c.line, ...shadow(1), transform: [{ scale: pressed ? 0.985 : 1 }] })}>
      <View style={{ height: 140, backgroundColor: c.surfaceAlt }}>
        <Image source={projectImage(p.project)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" />
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 90 }} />
        <View style={{ position: 'absolute', top: space.sm, left: space.sm }}>
          <Badge label={d.status === 'solde' ? 'Soldé' : 'En cours'} tone={d.status === 'solde' ? 'ok' : 'gold'} />
        </View>
        <View style={{ position: 'absolute', left: space.md, right: space.md, bottom: space.sm }}>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Votre bien</Txt>
          <Txt style={{ fontFamily: fonts.bold, fontSize: 16, color: '#fff' }} numberOfLines={2}>{p.project.name}</Txt>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, backgroundColor: c.surfaceAlt }}>
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <Txt style={{ fontFamily: fonts.bold, fontSize: 20, color: c.ink }}>Lot {p.lot_code}{p.ilot ? <Txt style={{ fontSize: 14, color: c.ink2, fontFamily: fonts.medium }}>  ·  Îlot {p.ilot}</Txt> : null}</Txt>
          <View style={{ gap: 4 }}>
            {p.type ? <Meta icon={House} text={p.type} /> : null}
            {p.surface_m2 ? <Meta icon={Ruler} text={`${amount(p.surface_m2)} m²`} /> : null}
            {p.project.city ? <Meta icon={MapPin} text={p.project.city} /> : null}
          </View>
        </View>
        {/* Médaillon blanc : la piste grise de Ring (c.surfaceAlt) reste visible sur le fond crème */}
        <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.goldLight }}>
          <Ring value={d.progress?.progress_pct ?? 0} label="chantier" size={72} />
        </View>
      </View>
    </Pressable>
  );
}
const Meta = ({ icon: Icon, text }: { icon: typeof House; text: string }) => {
  const { c } = useTheme();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon size={14} color={c.accent} /><Txt style={{ color: c.ink2, fontSize: 13 }} numberOfLines={1}>{text}</Txt></View>;
};

function Finance({ d }: { d: Dossier }) {
  const { c, space, fonts } = useTheme();
  return (
    <Card onPress={() => router.navigate('/espace-client/paiements')} accessibilityLabel={`Déjà versé ${fcfa(d.paid_fcfa)}, soit ${d.percent_paid} %. Reste à payer ${fcfa(d.remaining_fcfa)}. Voir mes paiements`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt variant="label">Déjà versé</Txt>
        <Badge label={`${d.percent_paid} %`} tone={d.percent_paid >= 100 ? 'ok' : 'gold'} />
      </View>
      <Txt style={{ fontFamily: fonts.bold, fontSize: 30, color: c.ink, marginVertical: 4 }}>{amount(d.paid_fcfa)} <Txt style={{ fontSize: 14, color: c.ink3 }}>FCFA</Txt></Txt>
      <ProgressBar percent={d.percent_paid} />
      <View style={{ flexDirection: 'row', marginTop: space.md }}>
        <View style={{ flex: 1 }}><Txt variant="tiny">Reste à payer</Txt><Txt variant="bodyStrong" style={{ fontSize: 15 }}>{fcfa(d.remaining_fcfa)}</Txt></View>
        <View style={{ flex: 1 }}><Txt variant="tiny">Prix du bien</Txt><Txt variant="bodyStrong" style={{ fontSize: 15 }}>{fcfa(d.price_fcfa)}</Txt></View>
      </View>
    </Card>
  );
}

function Due({ d }: { d: Dossier }) {
  const { c, space, radius, fonts } = useTheme();
  if (d.overdue_count > 0) {
    return <Callout icon={TriangleAlert} tone="danger" title={plural(d.overdue_count, 'échéance en retard', 'échéances en retard')} text={`${fcfa(d.overdue_fcfa)} à régulariser. Contactez votre conseiller si besoin.`} onPress={() => router.navigate('/espace-client/paiements')} right={<ArrowRight size={18} color={c.danger} />} />;
  }
  if (!d.next_due) return null;
  const n = d.next_due;
  const days = daysUntil(n.due_date);
  const [dd, mm] = shortDate(n.due_date).split(' ');
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ width: 58, height: 64, borderRadius: radius.md, backgroundColor: c.dark, alignItems: 'center', justifyContent: 'center' }}>
          <Txt style={{ color: c.goldLight, fontSize: 11, fontFamily: fonts.semibold, textTransform: 'uppercase' }}>{mm}</Txt>
          <Txt style={{ color: '#fff', fontSize: 24, fontFamily: fonts.bold }}>{dd}</Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="tiny">Prochaine échéance · {n.label}</Txt>
          <Txt style={{ fontFamily: fonts.bold, fontSize: 20, color: c.ink }}>{fcfa(n.remaining_fcfa)}</Txt>
          <Txt variant="small">{days === 0 ? 'Aujourd’hui' : days != null && days > 0 ? `Dans ${plural(days, 'jour', 'jours')}` : ''}</Txt>
        </View>
      </View>
    </Card>
  );
}

function LatestUpdate({ saleId }: { saleId: number }) {
  const { c, space, radius } = useTheme();
  const { data, isLoading } = useChantier(saleId);
  if (isLoading) return <Skeleton h={110} r={16} />;
  const u = data?.updates?.[0];
  if (!u) return <Callout icon={Camera} title="Bientôt les premières photos" text="Les points d’avancement de votre chantier apparaîtront ici." />;
  const photo = u.media.find(m => m.kind === 'image');
  return (
    <Card padded={false} onPress={() => router.navigate('/espace-client/chantier')} accessibilityLabel={`Dernière publication : ${u.title}`}>
      <View style={{ flexDirection: 'row' }}>
        {photo ? <Image source={{ uri: apiUrl(photo.url)! }} style={{ width: 116, minHeight: 112, borderTopLeftRadius: radius.lg, borderBottomLeftRadius: radius.lg }} contentFit="cover" /> : null}
        <View style={{ flex: 1, padding: space.md, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Badge label={u.stage_label} tone="gold" /><Txt variant="tiny">{dayLabel(u.published_at)}</Txt></View>
          <Txt variant="bodyStrong" style={{ fontSize: 15 }} numberOfLines={2}>{u.title}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Txt style={{ color: c.primary, fontSize: 13 }}>Tout le chantier</Txt><ArrowRight size={14} color={c.primary} /></View>
        </View>
      </View>
    </Card>
  );
}

// Damier rouge / noir : Paiements rouge, Documents noir, SAV noir bordeaux, Messages rouge profond
const QUICK_BG = [['#E30613', '#8C040C'], ['#2E2E33', '#0A0A0A'], ['#3A1013', '#0F0A0B'], ['#B3000F', '#5E0008']] as const;
const QUICK = [
  { to: '/espace-client/paiements', icon: Wallet, title: 'Paiements', sub: 'Échéancier et reçus' },
  { to: '/espace-client/documents', icon: FileText, title: 'Documents', sub: 'Contrats, ACD, actes' },
  { to: '/espace-client/sav', icon: LifeBuoy, title: 'SAV', sub: 'Signaler un problème' },
  { to: '/espace-client/messages', icon: MessageCircle, title: 'Messages', sub: 'Écrire à SIIPAF' },
] as const;

export default function ClientHome() {
  const { c, space, radius, fonts } = useTheme();
  const { client, selected: d, loadDossiers, refreshMe } = useSession();
  const [refreshing, setRefreshing] = useState(false);
  // Situation financière à jour à chaque retour sur l'accueil
  useFocusEffect(useCallback(() => { loadDossiers().catch(() => {}); refreshMe(); }, [loadDossiers, refreshMe]));
  const refresh = async () => { setRefreshing(true); await Promise.all([loadDossiers().catch(() => {}), refreshMe()]); setRefreshing(false); };
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ClientHeader eyebrow={today} title={`${greeting()} ${firstName(client?.name)}`} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.md }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />}>
        {!d ? <NoDossier /> : (
          <>
            <PropertyCard d={d} />
            <Finance d={d} />
            <Due d={d} />
            {client && client.unread_messages > 0 && (
              <Callout icon={MessageCircle} tone="info" title={plural(client.unread_messages, 'nouveau message', 'nouveaux messages')} text="L’équipe SIIPAF vous a répondu." onPress={() => router.navigate('/espace-client/messages')} right={<ArrowRight size={18} color={c.info} />} />
            )}
            <SectionHead title="Sur le chantier" action={<Pressable onPress={() => router.navigate('/espace-client/chantier')} hitSlop={8}><Txt style={{ color: c.primary, fontFamily: fonts.semibold, fontSize: 14 }}>Voir tout</Txt></Pressable>} />
            <LatestUpdate saleId={d.id} />
          </>
        )}
        <SectionHead title="Accès rapides" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {/* Fonds en dégradé (06/11) : variantes de rouge et de noir en damier, pictogramme en filigrane */}
          {QUICK.map((q, i) => (
            <Pressable key={q.to} onPress={() => router.push(q.to)} accessibilityRole="button" accessibilityLabel={q.title}
              style={({ pressed }) => ({ flexBasis: '48%', flexGrow: 1, borderRadius: radius.lg, overflow: 'hidden', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
              <LinearGradient colors={QUICK_BG[i % QUICK_BG.length]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: space.lg, gap: 6, minHeight: 124 }}>
                <View style={{ position: 'absolute', right: -14, bottom: -14, opacity: 0.12 }} pointerEvents="none"><q.icon size={84} color="#FFFFFF" /></View>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}><q.icon size={19} color="#FFFFFF" /></View>
                <Txt style={{ fontFamily: fonts.bold, fontSize: 15, color: '#FFFFFF' }}>{q.title}</Txt>
                <Txt style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>{q.title === 'Paiements' && d ? `${d.percent_paid} % versé` : q.sub}</Txt>
              </LinearGradient>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
