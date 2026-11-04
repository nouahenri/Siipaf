/**
 * Mes paiements (client/src/pages/Paiements.jsx) : reste à payer, échéancier filtré (à venir, en retard, payées), détail
 * d'une échéance avec les versements qui l'ont réglée (même règle d'imputation que le serveur), versements et reçus,
 * prochains appels de fonds VEFA.
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { CalendarDays, Check, ChevronRight, Clock, Landmark, MessageCircle, Receipt, TriangleAlert, Wallet } from 'lucide-react-native';
import { ClientHeader, NoDossier } from '@/components/client/common';
import { PaySheet } from '@/components/client/PaySheet';
import { Badge, Button, Callout, Card, Chip, ChipRow, Divider, Empty, ErrorState, PageSkeleton, ProgressBar, Row, Segmented, Sheet, Txt } from '@/components/ui';
import { INSTALLMENT_STATUS, PAYMENT_METHODS } from '@/lib/domain';
import { amount, date, daysUntil, fcfa, plural, shortDate } from '@/lib/format';
import { useDossier } from '@/lib/queries';
import type { Installment, Payment } from '@/lib/types';
import { useSession } from '@/providers/session';
import { useTheme } from '@/theme';

const ICONS = { payee: Check, en_retard: TriangleAlert, partielle: Clock, a_venir: CalendarDays } as const;
const TONE = { payee: 'ok', en_retard: 'danger', partielle: 'gold', a_venir: 'muted' } as const;

/** Versements imputés dans l'ordre des dates sur les échéances dans l'ordre (règle du serveur). */
function allocate(lines: Installment[], payments: Payment[]) {
  const pays = [...payments].sort((a, b) => (a.paid_at === b.paid_at ? a.id - b.id : a.paid_at < b.paid_at ? -1 : 1)).map(p => ({ ...p, left: Number(p.amount_fcfa) }));
  const out: Record<number, { id: number; receipt_number: string; paid_at: string; amount: number }[]> = {};
  let i = 0;
  for (const l of [...lines].sort((a, b) => a.seq - b.seq)) {
    let due = Number(l.amount_fcfa);
    out[l.seq] = [];
    while (due > 0 && i < pays.length) {
      const take = Math.min(due, pays[i].left);
      if (take > 0) out[l.seq].push({ id: pays[i].id, receipt_number: pays[i].receipt_number, paid_at: pays[i].paid_at, amount: take });
      due -= take; pays[i].left -= take;
      if (pays[i].left <= 0) i++;
    }
  }
  return out;
}

export default function Paiements() {
  const { c, space, fonts } = useTheme();
  const { selected } = useSession();
  const { data: d, error, isLoading, refetch, isRefetching } = useDossier(selected?.id);
  const [tab, setTab] = useState<'echeancier' | 'versements'>('echeancier');
  const [filter, setFilter] = useState<'tout' | 'a_venir' | 'en_retard' | 'payee' | null>(null);
  const [open, setOpen] = useState<Installment | null>(null);
  const [paying, setPaying] = useState<Installment | null>(null);
  const allocations = useMemo(() => (d ? allocate(d.schedule, d.payments) : {}), [d]);

  const body = () => {
    if (!selected) return <NoDossier />;
    if (isLoading) return <PageSkeleton />;
    if (error || !d) return <ErrorState error={error} onRetry={refetch} />;
    const lines = d.schedule;
    const counts = { tout: lines.length, a_venir: 0, en_retard: 0, payee: 0 };
    lines.forEach(l => { if (l.status === 'partielle') counts.a_venir++; else (counts as Record<string, number>)[l.status]++; });
    const f = filter ?? (counts.en_retard ? 'en_retard' : 'a_venir');
    const shown = lines.filter(l => f === 'tout' || l.status === f || (f === 'a_venir' && l.status === 'partielle'));
    let year: string | null = null;
    return (
      <>
        <Card style={{ backgroundColor: c.dark, borderColor: c.dark }}>
          <Txt style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>Reste à payer</Txt>
          <Txt style={{ fontFamily: fonts.bold, fontSize: 32, color: '#fff', marginVertical: 4 }}>{amount(d.remaining_fcfa)} <Txt style={{ fontSize: 15, color: 'rgba(255,255,255,0.6)' }}>FCFA</Txt></Txt>
          <ProgressBar percent={d.percent_paid} track="rgba(255,255,255,0.15)" />
          <View style={{ flexDirection: 'row', marginTop: space.md }}>
            <View style={{ flex: 1 }}><Txt style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>Déjà versé · {d.percent_paid} %</Txt><Txt style={{ color: '#fff', fontFamily: fonts.semibold }}>{fcfa(d.paid_fcfa)}</Txt></View>
            <View style={{ flex: 1 }}><Txt style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>Prix du bien</Txt><Txt style={{ color: '#fff', fontFamily: fonts.semibold }}>{fcfa(d.price_fcfa)}</Txt></View>
          </View>
          {d.financing_label ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md }}><Landmark size={14} color={c.goldLight} /><Txt style={{ color: c.goldLight, fontSize: 13 }}>{d.financing_label}</Txt></View> : null}
        </Card>
        {d.overdue_count > 0 && (
          <View style={{ marginTop: space.md }}>
            <Callout icon={TriangleAlert} tone="danger" title={`${plural(d.overdue_count, 'échéance en retard', 'échéances en retard')} · ${fcfa(d.overdue_fcfa)}`} text="Les paiements se font par virement ou Mobile Money auprès de SIIPAF. Votre conseiller reste disponible." />
          </View>
        )}
        <View style={{ marginVertical: space.lg }}>
          <Segmented value={tab} onChange={setTab} options={[['echeancier', 'Échéancier'], ['versements', `Versements · ${d.payments.length}`]]} />
        </View>

        {tab === 'echeancier' ? (
          !lines.length ? <Card><Empty icon={CalendarDays} title="Échéancier en préparation" text="Votre échéancier sera disponible dès qu’il aura été établi par notre service comptable." /></Card> : (
            <>
              <ChipRow>
                {([['tout', 'Tout'], ['a_venir', 'À venir'], ['en_retard', 'En retard'], ['payee', 'Payées']] as const).map(([k, l]) => <Chip key={k} label={l} count={counts[k]} selected={f === k} onPress={() => setFilter(k)} />)}
              </ChipRow>
              <Card padded={false} style={{ marginTop: space.md }}>
                {shown.length === 0 ? <Empty title="Rien à afficher" text={f === 'en_retard' ? 'Aucune échéance en retard. Merci !' : 'Aucune échéance dans cette catégorie.'} /> : shown.map((l, i) => {
                  const st = INSTALLMENT_STATUS[l.status] || INSTALLMENT_STATUS.a_venir;
                  const Icon = ICONS[l.status as keyof typeof ICONS] || CalendarDays;
                  const y = l.due_date.slice(0, 4);
                  const header = y !== year ? (year = y) : null;
                  return (
                    <View key={l.id ?? l.seq}>
                      {header ? <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: 4, backgroundColor: c.surfaceAlt }}><Txt variant="tiny">{header}</Txt></View> : null}
                      <Row icon={Icon} iconTone={TONE[l.status as keyof typeof TONE] || 'muted'} title={l.label} sub={`Échéance du ${shortDate(l.due_date)}`}
                        accessibilityLabel={`${l.label}, ${fcfa(l.status === 'payee' ? l.amount_fcfa : l.remaining_fcfa)}, ${st.label}, échéance du ${shortDate(l.due_date)} : voir le détail`} onPress={() => setOpen(l)} last={i === shown.length - 1}
                        end={<View style={{ alignItems: 'flex-end', gap: 4 }}>
                          <Txt variant="bodyStrong" style={{ fontSize: 14, textDecorationLine: l.status === 'payee' ? 'line-through' : 'none', color: l.status === 'payee' ? c.ink3 : c.ink }}>{fcfa(l.status === 'payee' ? l.amount_fcfa : l.remaining_fcfa)}</Txt>
                          <Badge label={st.label} tone={st.tone} />
                        </View>} />
                    </View>
                  );
                })}
              </Card>
              {d.vefa_upcoming?.length ? (
                <Card padded={false} style={{ marginTop: space.md }}>
                  <View style={{ padding: space.lg, paddingBottom: 0 }}><Txt variant="tiny">Prochains appels de fonds · selon l’avancement du chantier</Txt></View>
                  {d.vefa_upcoming.map((v, i) => <Row key={v.seq} icon={Landmark} title={v.label} sub={`${v.pct} % du prix · appelé à l’achèvement de l’étape`} end={<Txt variant="bodyStrong" style={{ fontSize: 14 }}>{fcfa(v.amount_fcfa)}</Txt>} last={i === d.vefa_upcoming!.length - 1} />)}
                </Card>
              ) : null}
            </>
          )
        ) : !d.payments.length ? (
          <Card><Empty icon={Wallet} title="Aucun versement enregistré" text="Vos versements apparaîtront ici dès leur enregistrement par notre service comptable, avec leur reçu." /></Card>
        ) : (
          <Card padded={false}>
            {d.payments.map((p, i) => (
              <Row key={p.id} icon={Receipt} iconTone="ok" title={fcfa(p.amount_fcfa)} sub={`${shortDate(p.paid_at)} · ${PAYMENT_METHODS[p.method] || p.method}`}
                accessibilityLabel={`Reçu ${p.receipt_number}, ${fcfa(p.amount_fcfa)} le ${shortDate(p.paid_at)}`}
                end={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}><Txt variant="small">Reçu</Txt><ChevronRight size={18} color={c.ink3} /></View>}
                onPress={() => router.push(`/espace-client/recu/${p.id}`)} last={i === d.payments.length - 1} />
            ))}
          </Card>
        )}
      </>
    );
  };

  const st = open ? INSTALLMENT_STATUS[open.status] || INSTALLMENT_STATUS.a_venir : null;
  const days = open ? daysUntil(open.due_date) : null;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ClientHeader eyebrow={d ? `Lot ${d.property.lot_code} · ${d.property.project.name}` : undefined} title="Paiements" />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl }} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { refetch(); }} tintColor={c.primary} />}>
        {body()}
      </ScrollView>
      <Sheet visible={!!open} title={open?.label || ''} onClose={() => setOpen(null)}
        footer={open && open.status !== 'payee' ? (
          <View style={{ gap: space.sm }}>
            <Button label="Régler" icon={Wallet} block haptic onPress={() => { setPaying(open); setOpen(null); }} />
            <Button label="Une question ? Écrire à SIIPAF" icon={MessageCircle} variant="ghost" block onPress={() => { setOpen(null); router.navigate('/espace-client/messages'); }} />
          </View>
        ) : undefined}>
        {open && st && d && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Badge label={st.label} tone={st.tone} />
              {open.status !== 'payee' && days != null ? <Txt variant="small" style={{ color: days < 0 ? c.danger : c.ink3 }}>{days < 0 ? `En retard de ${plural(-days, 'jour', 'jours')}` : days === 0 ? 'À régler aujourd’hui' : `Dans ${plural(days, 'jour', 'jours')}`}</Txt> : null}
            </View>
            <Txt style={{ fontFamily: fonts.bold, fontSize: 30, color: c.ink, marginTop: space.md }}>{amount(open.status === 'payee' ? open.amount_fcfa : open.remaining_fcfa)} <Txt variant="small">FCFA {open.status === 'payee' ? 'réglés' : 'à régler'}</Txt></Txt>
            <Card padded={false} style={{ marginTop: space.lg }}>
              <Row title="Échéance" end={<Txt>{date(open.due_date)}</Txt>} />
              <Row title="Montant de l’échéance" end={<Txt>{fcfa(open.amount_fcfa)}</Txt>} />
              <Row title="Déjà réglé" end={<Txt style={{ color: open.paid_fcfa ? c.ok : c.ink2 }}>{fcfa(open.paid_fcfa)}</Txt>} />
              <Row title="Reste à régler" end={<Txt>{fcfa(open.remaining_fcfa)}</Txt>} />
              <Row title="Position" end={<Txt>{open.seq} sur {d.schedule.length}</Txt>} last />
            </Card>
            {/* Reçus des versements imputés sur l'échéance : seulement quand elle est réglée, même en partie */}
            {(allocations[open.seq] || []).length > 0 && (
              <>
              <Txt variant="h3" style={{ marginTop: space.xl, marginBottom: space.sm }}>{open.status === 'payee' ? 'Réglée par' : 'Déjà réglé par'}</Txt>
              <Card padded={false}>
                {allocations[open.seq].map((a, i, all) => (
                  <Row key={a.id} icon={Receipt} iconTone="ok" title={a.receipt_number} sub={shortDate(a.paid_at)} end={<Txt variant="bodyStrong" style={{ fontSize: 14 }}>{fcfa(a.amount)}</Txt>}
                    onPress={() => { setOpen(null); router.push(`/espace-client/recu/${a.id}`); }} last={i === all.length - 1} />
                ))}
              </Card>
              </>
            )}
            {/* Paiements déclarés depuis l'application pour cette échéance */}
            {(d.declarations || []).filter(x => !x.schedule_id || x.schedule_id === open.id).map(x => (
              <View key={x.id} style={{ marginTop: space.md }}>
                <Callout icon={x.status === 'rejete' ? TriangleAlert : Clock} tone={x.status === 'rejete' ? 'danger' : 'gold'}
                  title={x.status === 'rejete' ? `Paiement de ${fcfa(x.amount_fcfa)} non confirmé` : `${fcfa(x.amount_fcfa)} déclarés, en vérification`}
                  text={x.status === 'rejete' ? x.reject_reason || 'Voir le message du service comptable.' : `Réf. ${x.reference || '—'} · confirmé par la Comptabilité sous peu`} />
              </View>
            ))}
            {open.status !== 'payee' && (
              <>
                <Divider />
                <Txt variant="h3" style={{ marginTop: space.xl, marginBottom: space.sm }}>Comment payer</Txt>
                <Txt variant="small" style={{ color: c.ink2 }}>Touchez « Régler » : Wave, Orange Money, MTN MoMo, Moov Money ou PayPal / carte Visa, puis déclarez votre paiement. Le reçu apparaît ici dès sa confirmation par notre service comptable.</Txt>
              </>
            )}
          </>
        )}
      </Sheet>
      {paying && d ? <PaySheet dossier={d} line={paying} onClose={() => setPaying(null)} /> : null}
    </View>
  );
}
