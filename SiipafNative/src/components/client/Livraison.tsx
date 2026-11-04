/**
 * Chantier › travaux modificatifs (demande, devis à accepter ou refuser — accepté, le montant s'ajoute aux paiements) et
 * livraison du lot (procès-verbal, réserves et leur levée). Même circuit que client/src/components/Livraison.jsx.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { Check, FileText, KeyRound, Plus, Wrench, X } from 'lucide-react-native';
import { openPrivateFile } from '@/components/client/files';
import { Alert, Badge, Button, Card, Empty, Field, Row, SectionHead, Sheet, Txt } from '@/components/ui';
import { clientApi } from '@/lib/api';
import { TMA_TONES } from '@/lib/domain';
import { dayLabel, fcfa } from '@/lib/format';
import { useDossier } from '@/lib/queries';
import type { Change } from '@/lib/types';
import { useSession } from '@/providers/session';
import { useToast } from '@/providers/toast';
import { useTheme } from '@/theme';

export function Livraison({ saleId }: { saleId: number }) {
  const { c, space } = useTheme();
  const qc = useQueryClient();
  const toast = useToast();
  const { loadDossiers } = useSession();
  const { data: d } = useDossier(saleId);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ t: Change; accept: boolean } | null>(null);
  if (!d) return null;
  const refresh = (msg?: string) => { qc.invalidateQueries({ queryKey: ['client', 'dossier'] }); loadDossiers().catch(() => {}); if (msg) toast(msg); };
  const changes = d.changes || [];
  const delivery = d.delivery;

  return (
    <>
      {(changes.length > 0 || d.can_request_changes) && (
        <>
          <SectionHead title="Travaux modificatifs" action={d.can_request_changes ? <Button label="Demander" icon={Plus} size="sm" variant="dark" onPress={() => setAsking(true)} /> : undefined} />
          {changes.length === 0 ? (
            <Card><Empty icon={Wrench} title="Aucune demande" text="Un aménagement à modifier (carrelage, prises, cloisons…) ? Demandez-le avant la livraison : nous vous adressons un devis à accepter ici." /></Card>
          ) : (
            <Card padded={false}>
              {changes.map((t, i) => (
                <View key={t.id} style={{ padding: space.lg, borderBottomWidth: i < changes.length - 1 ? 1 : 0, borderBottomColor: c.line, gap: 6 }}>
                  <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
                    <Wrench size={18} color={c.ink3} style={{ marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyStrong" style={{ fontSize: 15 }}>{t.title}</Txt>
                      <Txt variant="small">{t.reference}{t.delay_days ? ` · réalisation en ${t.delay_days} jours` : ''}{t.due_date ? ` · à régler avant le ${dayLabel(t.due_date).toLowerCase()}` : ''}</Txt>
                      {t.quote_note ? <Txt variant="small" style={{ color: c.ink2 }}>{t.quote_note}</Txt> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      {t.amount_fcfa != null ? <Txt variant="bodyStrong" style={{ fontSize: 14 }}>{fcfa(t.amount_fcfa)}</Txt> : null}
                      <Badge label={t.status === 'demandee' ? 'Devis en préparation' : t.status_label || t.status} tone={TMA_TONES[t.status] || 'muted'} />
                    </View>
                  </View>
                  {t.can_answer && (
                    <View style={{ flexDirection: 'row', gap: space.sm, marginTop: 4 }}>
                      <Button label="Accepter le devis" icon={Check} size="sm" onPress={() => setAnswer({ t, accept: true })} />
                      <Button label="Refuser" icon={X} size="sm" variant="ghost" onPress={() => setAnswer({ t, accept: false })} />
                    </View>
                  )}
                </View>
              ))}
            </Card>
          )}
        </>
      )}

      {delivery?.handover && (
        <>
          <SectionHead title="Livraison de votre bien" />
          <Card padded={false}>
            <Row icon={KeyRound} iconTone="ok" title={`Réceptionné le ${dayLabel(delivery.handover.handed_on).toLowerCase()}`}
              sub={`${delivery.handover.client_signed ? 'Procès-verbal signé' : 'Procès-verbal établi'} · vos garanties courent depuis cette date`}
              end={delivery.handover.pv_url ? <Button label="PV" icon={FileText} size="sm" variant="ghost" onPress={() => openPrivateFile(delivery.handover!.pv_url!, 'Procès-verbal de réception.pdf')} /> : undefined}
              last={!delivery.reserves.length} />
            {delivery.reserves.length > 0 ? delivery.reserves.map((r, i) => (
              <Row key={r.id} title={r.label} sub={[r.location, r.category_label].filter(Boolean).join(' · ') + (r.deadline && r.status === 'ouverte' ? ` · levée prévue avant le ${dayLabel(r.deadline).toLowerCase()}` : '')}
                end={<Badge label={r.status === 'levee' ? 'Levée' : 'En cours'} tone={r.status === 'levee' ? 'ok' : 'gold'} />} last={i === delivery.reserves.length - 1} />
            )) : null}
          </Card>
          {!delivery.reserves.length ? <Txt variant="small" style={{ marginTop: space.sm }}>Aucune réserve n’a été notée à la réception.</Txt> : null}
        </>
      )}

      <AskSheet visible={asking} saleId={saleId} onClose={() => setAsking(false)} onDone={() => { setAsking(false); refresh('Demande envoyée : nous vous adressons un devis'); }} />
      {answer && <AnswerSheet {...answer} onClose={() => setAnswer(null)} onDone={msg => { setAnswer(null); refresh(msg); }} />}
    </>
  );
}

function AskSheet({ visible, saleId, onClose, onDone }: { visible: boolean; saleId: number; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: '', description: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await clientApi.post(`/dossiers/${saleId}/tma`, { title: f.title.trim(), description: f.description.trim() || undefined }); setF({ title: '', description: '' }); onDone(); } catch (e: any) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Sheet visible={visible} title="Demander des travaux modificatifs" onClose={onClose} footer={<Button label="Envoyer la demande" block loading={busy} disabled={f.title.trim().length < 3} onPress={submit} />}>
      <Alert>{error}</Alert>
      <Field label="Travaux souhaités" value={f.title} onChangeText={v => setF(x => ({ ...x, title: v }))} maxLength={200} placeholder="Carrelage grand format au séjour, prise supplémentaire…" />
      <Field label="Précisions (facultatif)" value={f.description} onChangeText={v => setF(x => ({ ...x, description: v }))} multiline maxLength={4000} placeholder="Pièce, matériaux, références…" />
      <Txt variant="small">Le conducteur de travaux chiffre votre demande ; vous recevez le devis ici et l’acceptez ou le refusez.</Txt>
    </Sheet>
  );
}

function AnswerSheet({ t, accept, onClose, onDone }: { t: Change; accept: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await clientApi.post(`/tma/${t.id}/reponse`, { accept, note: note.trim() || undefined });
      onDone(accept ? 'Devis accepté : l’échéance figure dans vos paiements' : 'Devis refusé');
    } catch (e: any) { setError(e.message); setBusy(false); }
  };
  return (
    <Sheet visible title={accept ? 'Accepter le devis' : 'Refuser le devis'} onClose={onClose}
      footer={<Button label={accept ? `Accepter (${fcfa(t.amount_fcfa)})` : 'Confirmer le refus'} variant={accept ? 'primary' : 'dark'} block haptic loading={busy} onPress={submit} />}>
      <Alert>{error}</Alert>
      <Txt variant="bodyStrong">{t.title} — {fcfa(t.amount_fcfa)}{t.delay_days ? `, réalisation en ${t.delay_days} jours` : ''}.</Txt>
      <Txt variant="small" style={{ marginVertical: 12 }}>{accept ? 'En acceptant, ce montant s’ajoute à votre échéancier, à régler à la date indiquée dans « Paiements ».' : 'Les travaux ne seront pas réalisés. Vous pouvez préciser la raison.'}</Txt>
      <Field label={accept ? 'Un mot pour l’équipe (facultatif)' : 'Raison (facultatif)'} value={note} onChangeText={setNote} multiline maxLength={500} />
    </Sheet>
  );
}
