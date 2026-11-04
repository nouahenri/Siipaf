/** « Laisser un témoignage » : envoyé au dashboard pour validation (POST /api/public/testimonials), comme sur le site. */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Star } from 'lucide-react-native';
import { Alert, Button, Chip, ChipRow, Field, Sheet, Txt } from '@/components/ui';
import { publicApi } from '@/lib/api';
import { useProjects } from '@/lib/queries';
import { useToast } from '@/providers/toast';
import { useTheme } from '@/theme';

export function TestimonialSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c, space } = useTheme();
  const toast = useToast();
  const projects = useProjects();
  const [f, setF] = useState({ name: '', role_label: '', message: '', rating: 5, project_id: null as number | null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await publicApi.post<{ message: string }>('/testimonials', { ...f, role_label: f.role_label || null, name: f.name.trim(), message: f.message.trim() });
      toast(r.message || 'Merci pour votre témoignage !');
      setF({ name: '', role_label: '', message: '', rating: 5, project_id: null });
      onClose();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Sheet visible={visible} title="Votre témoignage" onClose={onClose}
      footer={<Button label="Envoyer mon témoignage" block loading={busy} disabled={f.name.trim().length < 2 || f.message.trim().length < 20} onPress={send} />}>
      <Txt variant="small" style={{ marginBottom: space.lg }}>Votre avis est publié après validation par notre équipe.</Txt>
      <Alert>{error}</Alert>
      <Txt variant="label" style={{ marginBottom: 6 }}>Votre note</Txt>
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: space.lg }} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map(n => (
          <Pressable key={n} onPress={() => setF(x => ({ ...x, rating: n }))} accessibilityRole="radio" accessibilityState={{ checked: f.rating === n }} accessibilityLabel={`${n} sur 5`} hitSlop={6}>
            <Star size={32} color={c.goldLight} fill={n <= f.rating ? c.goldLight : 'transparent'} />
          </Pressable>
        ))}
      </View>
      <Field label="Nom" value={f.name} onChangeText={v => setF(x => ({ ...x, name: v }))} autoComplete="name" />
      <Field label="Vous êtes (facultatif)" value={f.role_label} onChangeText={v => setF(x => ({ ...x, role_label: v }))} placeholder="Diaspora France, propriétaire à Ahoutoué…" />
      <Txt variant="label" style={{ marginBottom: 6 }}>Programme (facultatif)</Txt>
      <View style={{ marginBottom: space.lg }}>
        <ChipRow>{(projects.data || []).map(p => <Chip key={p.id} label={p.name} selected={f.project_id === p.id} onPress={() => setF(x => ({ ...x, project_id: x.project_id === p.id ? null : p.id }))} />)}</ChipRow>
      </View>
      <Field label="Votre témoignage" value={f.message} onChangeText={v => setF(x => ({ ...x, message: v }))} multiline maxLength={1000} hint="20 caractères au moins." />
    </Sheet>
  );
}
