/** Service après-vente (client/src/pages/Demandes.jsx) : demandes en cours puis terminées, et « Signaler un problème ». */
import { router } from 'expo-router';
import { View } from 'react-native';
import { ChevronRight, LifeBuoy, Plus } from 'lucide-react-native';
import { Badge, Button, Card, Empty, ErrorState, PageSkeleton, Row, Screen, Txt } from '@/components/ui';
import { savStatus } from '@/lib/domain';
import { shortDate } from '@/lib/format';
import { useSavList } from '@/lib/queries';
import { useSession } from '@/providers/session';
import { useTheme } from '@/theme';

export default function SavList() {
  const { c, space } = useTheme();
  const { dossiers } = useSession();
  const { data, error, isLoading, refetch, isRefetching } = useSavList();
  if (isLoading) return <PageSkeleton />;
  if (error && !data) return <ErrorState error={error} onRetry={refetch} />;
  const rows = data || [];
  const open = rows.filter(t => savStatus(t.status).step < 2);
  const closed = rows.filter(t => savStatus(t.status).step === 2);
  const item = (t: (typeof rows)[number], last: boolean) => {
    const st = savStatus(t.status);
    return <Row key={t.id} icon={LifeBuoy} iconTone={st.step === 2 ? 'ok' : 'gold'} title={t.title} sub={`${t.ref} · ${shortDate(t.created_at)}${t.lot_code ? ` · lot ${t.lot_code}` : ''}`}
      end={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Badge label={st.label} tone={st.tone} /><ChevronRight size={18} color={c.ink3} /></View>}
      onPress={() => router.push(`/espace-client/sav/${t.id}`)} last={last} />;
  };
  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}
      footer={dossiers.length > 0 ? <Button label="Signaler un problème" icon={Plus} block haptic onPress={() => router.push('/espace-client/sav/nouvelle')} /> : undefined}>
      <Txt style={{ marginBottom: space.lg }}>Un souci dans votre logement ? Signalez-le avec une photo : l’équipe SAV vous répond ici et organise l’intervention.</Txt>
      {rows.length === 0 ? (
        <Card><Empty icon={LifeBuoy} title="Aucune demande" text="Fuite, fissure, porte qui ferme mal, équipement en panne… Décrivez le problème et joignez une photo, nous revenons vers vous rapidement." /></Card>
      ) : (
        <View style={{ gap: space.lg }}>
          {open.length > 0 && <View><Txt variant="tiny" style={{ marginBottom: 6 }}>En cours · {open.length}</Txt><Card padded={false}>{open.map((t, i) => item(t, i === open.length - 1))}</Card></View>}
          {closed.length > 0 && <View><Txt variant="tiny" style={{ marginBottom: 6 }}>Terminées</Txt><Card padded={false}>{closed.map((t, i) => item(t, i === closed.length - 1))}</Card></View>}
        </View>
      )}
    </Screen>
  );
}
