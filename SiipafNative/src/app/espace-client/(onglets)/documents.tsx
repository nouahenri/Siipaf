/** Mes documents (client/src/pages/Documents.jsx) : dossier administratif et juridique, de la réservation à la livraison. */
import { router } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { ChevronRight, FileCheck, FileClock, FileText } from 'lucide-react-native';
import { ClientHeader, NoDossier } from '@/components/client/common';
import { Badge, Callout, Card, Empty, ErrorState, PageSkeleton, Steps, Txt } from '@/components/ui';
import { DOCUMENT_STATUS } from '@/lib/domain';
import { useDossier } from '@/lib/queries';
import { useSession } from '@/providers/session';
import { useTheme } from '@/theme';

export default function Documents() {
  const { c, space } = useTheme();
  const { selected } = useSession();
  const { data: d, error, isLoading, refetch, isRefetching } = useDossier(selected?.id);

  const body = () => {
    if (!selected) return <NoDossier />;
    if (isLoading) return <PageSkeleton />;
    if (error || !d) return <ErrorState error={error} onRetry={refetch} />;
    const docs = d.documents;
    if (!docs.length) return <Card><Empty icon={FileText} title="Aucun document pour le moment" text="Vos documents apparaîtront ici au fil de l’avancement de votre dossier." /></Card>;
    const ready = docs.filter(x => DOCUMENT_STATUS[x.status]?.step === 2).length;
    return (
      <>
        <Callout icon={FileCheck} title={`${ready} sur ${docs.length} document${docs.length > 1 ? 's' : ''} finalisé${ready > 1 ? 's' : ''}`} text="Contrat, attestation, ACD, acte notarié et procès-verbal de livraison suivent les étapes de votre acquisition." />
        <Card padded={false} style={{ marginTop: space.md }}>
          {docs.map((doc, i) => {
            const st = DOCUMENT_STATUS[doc.status] || DOCUMENT_STATUS.a_fournir;
            const done = st.step === 2;
            const Icon = done ? FileCheck : FileClock;
            return (
              <View key={doc.id} style={{ borderBottomWidth: i < docs.length - 1 ? 1 : 0, borderBottomColor: c.line }}>
                <Card padded={false} style={{ borderWidth: 0, shadowOpacity: 0, elevation: 0, borderRadius: 0 }} onPress={() => router.push(`/espace-client/document/${doc.id}`)} accessibilityLabel={`${doc.label}, ${st.label} : consulter`}>
                  <View style={{ flexDirection: 'row', gap: space.md, padding: space.lg, alignItems: 'flex-start' }}>
                    <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: done ? c.okSoft : c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><Icon size={19} color={done ? c.ok : c.ink3} /></View>
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyStrong" style={{ fontSize: 15 }}>{doc.label}</Txt>
                      <Txt variant="small" numberOfLines={2}>{doc.note || st.hint}</Txt>
                      <Steps step={st.step} />
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <Badge label={st.label} tone={st.tone} />
                      <ChevronRight size={18} color={c.ink3} />
                    </View>
                  </View>
                </Card>
              </View>
            );
          })}
        </Card>
      </>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ClientHeader eyebrow={d ? `Lot ${d.property.lot_code} · ${d.property.project.name}` : undefined} title="Documents" />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl }} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { refetch(); }} tintColor={c.primary} />}>
        {body()}
      </ScrollView>
    </View>
  );
}
