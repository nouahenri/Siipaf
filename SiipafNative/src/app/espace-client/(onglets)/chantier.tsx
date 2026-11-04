/**
 * Avancement du chantier (client/src/pages/Chantier.jsx) : anneau et étape actuelle, frise des étapes du projet
 * (lotissement ou programme), journal des publications avec photos et vidéos, travaux modificatifs et livraison.
 */
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Camera, Check } from 'lucide-react-native';
import { ClientHeader, NoDossier } from '@/components/client/common';
import { Livraison } from '@/components/client/Livraison';
import { Gallery, Lightbox } from '@/components/client/Media';
import { Badge, Card, Empty, ErrorState, PageSkeleton, ProgressBar, Ring, SectionHead, Txt } from '@/components/ui';
import { SCOPE_LABELS } from '@/lib/domain';
import { dayLabel, monthYear } from '@/lib/format';
import { useChantier, useDossier } from '@/lib/queries';
import type { Media } from '@/lib/types';
import { useSession } from '@/providers/session';
import { useTheme } from '@/theme';

function Stages({ stages, current }: { stages: { id: string; label: string }[]; current?: string }) {
  const { c, space, fonts } = useTheme();
  const idx = stages.findIndex(s => s.id === current);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 0, paddingVertical: space.sm }} accessibilityLabel="Étapes du chantier">
      {stages.map((s, i) => {
        const state = idx < 0 ? 'todo' : i < idx ? 'done' : i === idx ? 'current' : 'todo';
        return (
          <View key={s.id} accessible style={{ width: 96, alignItems: 'center' }} accessibilityLabel={`${s.label} : ${state === 'done' ? 'terminé' : state === 'current' ? 'en cours' : 'à venir'}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
              <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? 'transparent' : i <= idx ? c.primary : c.line }} />
              <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: state === 'todo' ? c.surfaceAlt : c.primary, borderWidth: state === 'current' ? 3 : 0, borderColor: c.dangerSoft }}>
                {state === 'done' ? <Check size={15} color="#fff" /> : <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: state === 'todo' ? c.ink3 : '#fff' }}>{i + 1}</Txt>}
              </View>
              <View style={{ flex: 1, height: 2, backgroundColor: i === stages.length - 1 ? 'transparent' : i < idx ? c.primary : c.line }} />
            </View>
            <Txt center style={{ fontFamily: state === 'current' ? fonts.semibold : fonts.regular, fontSize: 12, color: state === 'todo' ? c.ink3 : c.ink, marginTop: 6 }} numberOfLines={2}>{s.label}</Txt>
          </View>
        );
      })}
    </ScrollView>
  );
}

export default function ChantierScreen() {
  const { c, space, fonts } = useTheme();
  const { selected } = useSession();
  const { data, error, isLoading, refetch, isRefetching } = useChantier(selected?.id);
  const dossier = useDossier(selected?.id);
  const [viewer, setViewer] = useState<{ items: Media[]; index: number; caption: string } | null>(null);

  const body = () => {
    if (!selected) return <NoDossier />;
    if (isLoading) return <PageSkeleton />;
    if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
    const updates = data.updates;
    const latest = updates[0];
    const delivery = data.property.project.delivery;
    return (
      <>
        <Card style={{ backgroundColor: c.dark, borderColor: c.dark }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
            <Ring value={latest?.progress_pct ?? 0} size={92} label="réalisé" light />
            <View style={{ flex: 1 }}>
              <Txt style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>Étape actuelle</Txt>
              <Txt style={{ fontFamily: fonts.bold, fontSize: 22, color: '#fff' }}>{latest ? latest.stage_label : 'Démarrage à venir'}</Txt>
              {latest ? <Txt style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>Mis à jour {dayLabel(latest.published_at).toLowerCase()}</Txt> : null}
              {delivery ? <Txt style={{ color: c.goldLight, fontSize: 12, marginTop: 4 }}>Délai de livraison : {delivery}</Txt> : null}
            </View>
          </View>
        </Card>
        {data.stages.length > 0 && <Card padded={false} style={{ marginTop: space.md, paddingVertical: space.sm }}><Stages stages={data.stages} current={latest?.stage} /></Card>}

        <SectionHead title="Journal du chantier" action={updates.length > 0 ? <Txt variant="small">{updates.length} publication{updates.length > 1 ? 's' : ''}</Txt> : undefined} />
        {updates.length === 0 ? (
          <Card><Empty icon={Camera} title="Pas encore de publication" text="Nos équipes publieront ici les photos et les étapes franchies sur votre chantier." /></Card>
        ) : (
          <View style={{ gap: space.md }}>
            {updates.map(u => (
              <Card key={u.id} padded={false}>
                <Gallery media={u.media} onOpen={i => setViewer({ items: u.media, index: i, caption: u.title })} />
                <View style={{ padding: space.lg, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Badge label={u.stage_label} tone="gold" />
                    <Txt variant="tiny">{SCOPE_LABELS[u.scope]}{u.scope === 'ilot' && u.ilot ? ` (${u.ilot})` : ''} · {dayLabel(u.published_at)}</Txt>
                  </View>
                  <Txt variant="h3">{u.title}</Txt>
                  {u.body ? <Txt variant="small" style={{ color: c.ink2, fontSize: 14, lineHeight: 21 }}>{u.body}</Txt> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 4 }}>
                    <Txt variant="tiny">Avancement</Txt>
                    <View style={{ flex: 1 }}><ProgressBar percent={u.progress_pct} /></View>
                    <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.ink }}>{u.progress_pct} %</Txt>
                  </View>
                </View>
              </Card>
            ))}
            <Txt variant="tiny" center>Début du journal · {monthYear(updates[updates.length - 1].published_at)}</Txt>
          </View>
        )}
        <Livraison saleId={selected.id} />
      </>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ClientHeader eyebrow={data?.property.project.name} title="Chantier" />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { refetch(); dossier.refetch(); }} tintColor={c.primary} />}>
        {body()}
      </ScrollView>
      {viewer && <Lightbox items={viewer.items} index={viewer.index} caption={viewer.caption} onClose={() => setViewer(null)} />}
    </View>
  );
}
