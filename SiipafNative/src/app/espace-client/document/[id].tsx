/**
 * Détail d'un document (client/src/components/DocumentDetail.jsx) : état et étapes, ouverture dans la visionneuse du
 * téléphone (enregistrer, imprimer, partager), aperçu des images, et actions : appeler, WhatsApp, écrire à SIIPAF au sujet
 * du document, signaler un problème (SAV, catégorie administrative).
 */
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Download, FileClock, FileText, Flag, MessageCircle, Phone } from 'lucide-react-native';
import { openPrivateFile } from '@/components/client/files';
import { Alert, Badge, Button, Card, Empty, ErrorState, PageSkeleton, Screen, Steps, Txt } from '@/components/ui';
import { apiUrl, appHeaders, authedSource } from '@/lib/api';
import { useSite } from '@/lib/content';
import { DOCUMENT_STATUS } from '@/lib/domain';
import { shortDate } from '@/lib/format';
import { call, whatsapp } from '@/lib/links';
import { useDossier } from '@/lib/queries';
import { useSession } from '@/providers/session';
import { useTheme } from '@/theme';

export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, space } = useTheme();
  const { contact } = useSite();
  const { selected } = useSession();
  const { data: d, error, isLoading, refetch } = useDossier(selected?.id);
  const [busy, setBusy] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [mime, setMime] = useState<string | null>(null);
  const docUrl = d?.documents.find(x => String(x.id) === String(id))?.download_url;
  // Type du fichier (même route privée que le téléchargement) : les images s'affichent ici, un PDF s'ouvre dans la visionneuse
  useEffect(() => {
    if (!docUrl) return;
    fetch(apiUrl(`${docUrl}?preview=1`)!, { method: 'HEAD', headers: appHeaders() })
      .then(r => setMime(r.ok ? (r.headers.get('content-type') || '').split(';')[0] : null)).catch(() => setMime(null));
  }, [docUrl]);

  if (isLoading) return <PageSkeleton />;
  if (error || !d) return <ErrorState error={error} onRetry={refetch} />;
  const doc = d.documents.find(x => String(x.id) === String(id));
  if (!doc) return <Screen><Card><Empty icon={FileText} title="Document introuvable" text="Ce document n’est pas disponible dans le dossier sélectionné." /></Card></Screen>;

  const st = DOCUMENT_STATUS[doc.status] || DOCUMENT_STATUS.a_fournir;
  const context = `le document « ${doc.label} » (lot ${d.property.lot_code} · ${d.property.project.name})`;
  const open = async () => {
    if (!doc.download_url) return;
    setBusy(true); setOpenError(null);
    try { await openPrivateFile(doc.download_url, doc.label); } catch (e: any) { setOpenError(e.message || 'Impossible d’ouvrir le document.'); }
    setBusy(false);
  };

  return (
    <Screen footer={doc.download_url ? <Button label="Ouvrir, enregistrer ou partager" icon={Download} block loading={busy} onPress={open} /> : undefined}>
      <Stack.Screen options={{ title: doc.label }} />
      <Card style={{ backgroundColor: c.dark, borderColor: c.dark }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: space.md }}><FileText size={22} color={c.goldLight} /></View>
        <Txt variant="h2" style={{ color: '#fff' }}>{doc.label}</Txt>
        <Txt style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>Lot {d.property.lot_code} · {d.property.project.name}</Txt>
        <Txt style={{ color: 'rgba(255,255,255,0.85)', marginTop: space.sm, fontSize: 14 }}>{doc.note || st.hint}</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: space.md }}>
          <Badge label={st.label} tone={st.tone === 'muted' ? 'dark' : st.tone} />
          {doc.updated_at ? <Txt style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>Mis à jour le {shortDate(doc.updated_at)}</Txt> : null}
        </View>
        <Steps step={st.step} />
      </Card>
      <Alert>{openError}</Alert>

      {!doc.download_url ? (
        <Card style={{ marginTop: space.md }}><Empty icon={FileClock} title="Document en attente de mise à disposition" text="Aucun fichier n’est joint pour le moment. Vous pouvez contacter votre conseiller ou lui écrire au sujet de ce document." /></Card>
      ) : (
        <Card style={{ marginTop: space.md }}>
          <Txt variant="bodyStrong">Aperçu</Txt>
          <Txt variant="small" style={{ marginBottom: space.md }}>Le document s’ouvre dans la visionneuse de votre téléphone : vous pouvez l’enregistrer dans vos fichiers, l’imprimer ou l’envoyer.</Txt>
          {mime?.startsWith('image/') ? (
            <Image source={authedSource(`${doc.download_url}?preview=1`)} style={{ height: 300, borderRadius: 12, backgroundColor: c.surfaceAlt }} contentFit="contain" accessibilityLabel={`Aperçu de ${doc.label}`} />
          ) : (
            <View style={{ height: 140, borderRadius: 12, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <FileText size={36} color={c.primary} />
              <Txt variant="small">{mime === 'application/pdf' ? 'Document PDF' : 'Document'}</Txt>
            </View>
          )}
        </Card>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg }}>
        <Button label="Appeler" icon={Phone} variant="ghost" size="sm" onPress={() => call(contact.phone)} />
        <Button label="WhatsApp" icon={MessageCircle} variant="whatsapp" size="sm" onPress={() => whatsapp(contact.whatsapp, `Bonjour SIIPAF, je vous contacte au sujet de ${context}.`)} />
        <Button label="Écrire à SIIPAF" icon={MessageCircle} variant="ghost" size="sm" onPress={() => router.push({ pathname: '/espace-client/messages', params: { context: `Bonjour, je vous contacte au sujet de ${context}.\n\n`, sale: String(d.id) } })} />
        <Button label="Signaler un problème" icon={Flag} variant="outline" size="sm" onPress={() => router.push({ pathname: '/espace-client/sav/nouvelle', params: { category: 'administratif', title: `Problème : ${doc.label}`.slice(0, 160), description: `Document « ${doc.label} » — lot ${d.property.lot_code} · ${d.property.project.name}.\n\n`, sale: String(d.id) } })} />
      </View>
    </Screen>
  );
}
