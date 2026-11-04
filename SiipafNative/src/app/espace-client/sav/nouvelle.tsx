/**
 * Signaler un problème (SAV) : bien concerné, type de problème (catégories du serveur), titre, lieu, détails et photos.
 * Ouvert aussi depuis un document (catégorie administrative, titre et détails préremplis).
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { SendHorizontal } from 'lucide-react-native';
import { PhotoField } from '@/components/client/Photos';
import { Alert, Button, Chip, ChipRow, Field, Screen, Txt } from '@/components/ui';
import { clientApi } from '@/lib/api';
import { useSavMeta } from '@/lib/queries';
import type { SavFile, SavTicket } from '@/lib/types';
import { useSession } from '@/providers/session';
import { useToast } from '@/providers/toast';
import { useTheme } from '@/theme';

export default function NouvelleDemande() {
  const params = useLocalSearchParams<{ category?: string; title?: string; description?: string; sale?: string }>();
  const { space } = useTheme();
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

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const t = await clientApi.post<SavTicket>('/sav', {
        sale_id: f.sale_id, category: f.category, title: f.title.trim(), location: f.location.trim() || undefined,
        description: f.description.trim() || undefined, media_ids: photos.map(p => p.id),
      });
      qc.invalidateQueries({ queryKey: ['client', 'sav'] });
      toast('Demande envoyée à l’équipe SAV');
      router.replace(`/espace-client/sav/${t.id}`);
    } catch (e: any) { setError(e.message); setBusy(false); }
  };

  return (
    <Screen footer={<Button label="Envoyer la demande" icon={SendHorizontal} block haptic loading={busy} disabled={!f.category || f.title.trim().length < 3 || !f.sale_id} onPress={submit} />}>
      <Alert>{error}</Alert>
      {dossiers.length > 1 && (
        <View style={{ marginBottom: space.lg }}>
          <Txt variant="label" style={{ marginBottom: 6 }}>Bien concerné</Txt>
          <ChipRow>{dossiers.map(d => <Chip key={d.id} label={`Lot ${d.property.lot_code} · ${d.property.project.name}`} selected={f.sale_id === d.id} onPress={() => setF(x => ({ ...x, sale_id: d.id }))} />)}</ChipRow>
        </View>
      )}
      <Txt variant="label" style={{ marginBottom: 6 }}>Type de problème</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: space.lg }}>
        {Object.entries(meta.data?.categories || {}).map(([k, l]) => <Chip key={k} label={l} selected={f.category === k} onPress={() => setF(x => ({ ...x, category: k }))} />)}
      </View>
      <Field label="En quelques mots" value={f.title} onChangeText={v => setF(x => ({ ...x, title: v }))} maxLength={160} placeholder="Ex. Fuite sous l’évier de la cuisine" />
      <Field label="Où dans le logement ?" value={f.location} onChangeText={v => setF(x => ({ ...x, location: v }))} maxLength={120} placeholder="Cuisine, chambre 2, façade…" />
      <Field label="Détails (facultatif)" value={f.description} onChangeText={v => setF(x => ({ ...x, description: v }))} multiline maxLength={5000} placeholder="Depuis quand, à quel moment, ce que vous avez constaté…" />
      <Txt variant="label" style={{ marginBottom: 6 }}>Photos</Txt>
      <PhotoField value={photos} onChange={setPhotos} />
      <Txt variant="small">Une photo du problème aide nos équipes à préparer l’intervention.</Txt>
    </Screen>
  );
}
