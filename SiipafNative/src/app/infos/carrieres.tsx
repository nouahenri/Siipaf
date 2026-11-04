/**
 * Carrières (carrieres.html) : offres publiées dans l'ERP › RH › Recrutement, candidature avec CV (PDF ou Word) choisi dans
 * les fichiers du téléphone. La candidature arrive dans le pipeline du recrutement (origine « Application mobile SIIPAF »).
 */
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Briefcase, CalendarDays, FileUp, MapPin, Paperclip, Send } from 'lucide-react-native';
import { Alert, Badge, Button, Card, Empty, ErrorState, Field, Screen, Sheet, Skeleton, Title, Txt, plain } from '@/components/ui';
import { publicApi } from '@/lib/api';
import { useSite } from '@/lib/content';
import { shortDate } from '@/lib/format';
import { useJobs } from '@/lib/queries';
import type { Job } from '@/lib/types';
import { useToast } from '@/providers/toast';
import { useTheme } from '@/theme';

export default function Carrieres() {
  const { c, space } = useTheme();
  const { t } = useSite();
  const { data, error, isLoading, refetch, isRefetching } = useJobs();
  const [apply, setApply] = useState<Job | 'spontanee' | null>(null);
  const head = 'careers.recrutement';
  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}>
      {t('careers.bandeau-de-titre.texte') ? <Txt>{plain(t('careers.bandeau-de-titre.texte'))}</Txt> : null}
      {t(`${head}.titre`) ? <Title variant="h3" style={{ marginTop: space.xl, marginBottom: space.md }}>{t(`${head}.titre`)}</Title> : null}
      <View style={{ gap: space.md }}>
        {isLoading ? <Skeleton h={140} r={16} />
          : error && !data ? <ErrorState error={error} onRetry={refetch} />
          : !data?.length ? <Card><Empty icon={Briefcase} title="Aucune offre ouverte pour le moment" text="Envoyez-nous une candidature spontanée : nous la gardons pour nos prochains recrutements." /></Card>
          : data.map(j => (
            <Card key={j.id}>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: space.sm }}>
                {j.contract_label ? <Badge label={j.contract_label} tone="primary" /> : null}
                {j.department_label ? <Badge label={j.department_label} tone="muted" /> : null}
                {(j.openings || 0) > 1 ? <Badge label={`${j.openings} postes`} tone="gold" /> : null}
              </View>
              <Txt variant="h3">{j.title}</Txt>
              <View style={{ flexDirection: 'row', gap: space.md, marginTop: 4, flexWrap: 'wrap' }}>
                {j.location ? <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}><MapPin size={14} color={c.ink3} /><Txt variant="small">{j.location}</Txt></View> : null}
                {j.closing_date ? <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}><CalendarDays size={14} color={c.ink3} /><Txt variant="small">Jusqu’au {shortDate(j.closing_date)}</Txt></View> : null}
              </View>
              {j.description ? <Txt variant="small" style={{ marginTop: space.sm }} numberOfLines={6}>{j.description}</Txt> : null}
              <Button label="Postuler" icon={Send} size="sm" style={{ marginTop: space.md }} onPress={() => setApply(j)} />
            </Card>
          ))}
      </View>
      <Button label="Candidature spontanée" icon={FileUp} variant="outline" block style={{ marginTop: space.xl }} onPress={() => setApply('spontanee')} />
      <ApplySheet job={apply} onClose={() => setApply(null)} />
    </Screen>
  );
}

function ApplySheet({ job, onClose }: { job: Job | 'spontanee' | null; onClose: () => void }) {
  const { space } = useTheme();
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', phone: '', message: '' });
  const [cv, setCv] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], copyToCacheDirectory: true });
    if (!r.canceled && r.assets?.[0]) {
      if ((r.assets[0].size || 0) > 5 * 1024 * 1024) { setError('Le CV dépasse 5 Mo : choisissez un fichier plus léger.'); return; }
      setCv(r.assets[0]); setError(null);
    }
  };
  const send = async () => {
    if (!cv) return setError('Joignez votre CV (PDF ou Word).');
    setBusy(true); setError(null);
    const form = new FormData();
    form.append('job_id', job && job !== 'spontanee' ? String(job.id) : '');
    form.append('name', f.name.trim()); form.append('email', f.email.trim()); form.append('phone', f.phone.trim());
    if (f.message.trim()) form.append('message', f.message.trim());
    if (Platform.OS === 'web' && cv.file) form.append('cv', cv.file);
    else form.append('cv', { uri: cv.uri, name: cv.name, type: cv.mimeType || 'application/pdf' } as unknown as Blob);
    try {
      await publicApi.post('/candidatures', form);
      toast('Candidature envoyée : merci !');
      setF({ name: '', email: '', phone: '', message: '' }); setCv(null);
      onClose();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Sheet visible={!!job} title={job && job !== 'spontanee' ? job.title : 'Candidature spontanée'} onClose={onClose}
      footer={<Button label="Envoyer ma candidature" icon={Send} block loading={busy} disabled={f.name.trim().length < 3 || !/\S+@\S+\.\S+/.test(f.email) || f.phone.replace(/\D/g, '').length < 8} onPress={send} />}>
      <Alert>{error}</Alert>
      <Field label="Nom complet" value={f.name} onChangeText={v => setF(x => ({ ...x, name: v }))} autoComplete="name" />
      <Field label="E-mail" value={f.email} onChangeText={v => setF(x => ({ ...x, email: v }))} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <Field label="Téléphone" value={f.phone} onChangeText={v => setF(x => ({ ...x, phone: v }))} keyboardType="phone-pad" autoComplete="tel" />
      <Field label="Message (facultatif)" value={f.message} onChangeText={v => setF(x => ({ ...x, message: v }))} multiline maxLength={3000} />
      <Txt variant="label" style={{ marginBottom: 6 }}>CV</Txt>
      <Button label={cv ? cv.name : 'Choisir mon CV (PDF ou Word)'} icon={Paperclip} variant={cv ? 'ghost' : 'outline'} block onPress={pick} />
      <Txt variant="tiny" style={{ marginTop: space.sm }}>5 Mo au plus. Vos données servent uniquement au recrutement.</Txt>
    </Sheet>
  );
}
