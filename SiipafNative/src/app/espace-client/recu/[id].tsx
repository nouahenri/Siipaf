/**
 * Reçu de versement (client/src/pages/Receipt.jsx) : affiché dans l'application, puis généré en PDF sur le téléphone
 * (expo-print) pour l'imprimer, l'enregistrer dans Fichiers ou le partager (WhatsApp, e-mail).
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Image } from 'expo-image';
import { Printer, Share2 } from 'lucide-react-native';
import { Button, Card, Empty, ErrorState, PageSkeleton, Screen, Txt } from '@/components/ui';
import { LOGO } from '@/lib/content';
import { PAYMENT_METHODS } from '@/lib/domain';
import { amount, date } from '@/lib/format';
import { useDossier } from '@/lib/queries';
import { useSession } from '@/providers/session';
import { useToast } from '@/providers/toast';
import { useTheme } from '@/theme';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

export default function Recu() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, space, fonts } = useTheme();
  const toast = useToast();
  const { client, selected } = useSession();
  const { data: d, error, isLoading, refetch } = useDossier(selected?.id);
  const [busy, setBusy] = useState<'share' | 'print' | null>(null);

  if (isLoading) return <PageSkeleton />;
  if (error || !d) return <ErrorState error={error} onRetry={refetch} />;
  const p = d.payments.find(x => String(x.id) === String(id));
  if (!p) return <Screen><Card><Empty title="Reçu introuvable" text="Ce versement n’existe pas dans le dossier sélectionné." /></Card></Screen>;

  const lines: [string, string][] = [
    ['Date du versement', date(p.paid_at)],
    ['Mode de paiement', PAYMENT_METHODS[p.method] || p.method],
    ...(p.reference ? [['Référence', p.reference] as [string, string]] : []),
    ['Client', client?.name || ''],
    ['Code client', client?.client_code || ''],
    ['Bien', `${d.property.project.name} — Lot ${d.property.lot_code}${d.property.ilot ? `, îlot ${d.property.ilot}` : ''}`],
    ['Prix du bien', `${amount(d.price_fcfa)} FCFA`],
    ['Total versé à ce jour', `${amount(d.paid_fcfa)} FCFA`],
    ['Reste à payer à ce jour', `${amount(d.remaining_fcfa)} FCFA`],
  ];
  const foot = `Reçu édité depuis l’application SIIPAF le ${date(new Date())}. Il atteste de l’enregistrement du versement par le service comptable de SIIPAF SA. Les totaux indiqués sont ceux du jour d’édition.`;

  const html = async () => {
    let logo = '';
    // Logo intégré au PDF (données base64 : la mise en page n'a pas accès aux fichiers de l'application)
    try { const a = Asset.fromModule(LOGO); await a.downloadAsync(); logo = Platform.OS === 'web' ? a.uri : `data:image/png;base64,${await new File(a.localUri || a.uri).base64()}`; } catch { /* reçu sans logo */ }
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,Roboto,Helvetica,Arial,sans-serif;color:#111;padding:36px}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #E30613;padding-bottom:16px}
      .head img{height:56px}.co{font-size:11px;text-align:right;color:#444;line-height:1.5}
      h1{font-size:22px;margin:28px 0 4px}.num{color:#666;font-size:12px}
      .amount{margin:22px 0;padding:18px;background:#F6F5F3;border-radius:10px}.amount strong{display:block;font-size:28px;color:#E30613}
      table{width:100%;border-collapse:collapse;font-size:13px}td{padding:9px 0;border-bottom:1px solid #E6E3DE}td:first-child{color:#666;width:45%}
      .foot{margin-top:26px;font-size:10.5px;color:#666;line-height:1.5}</style></head><body>
      <div class="head">${logo ? `<img src="${esc(logo)}"/>` : '<strong>SIIPAF SA</strong>'}<div class="co"><strong>SIIPAF SA</strong><br/>Promoteur et aménageur immobilier agréé MCLU<br/>Abidjan, Côte d’Ivoire<br/>+225 27 22 20 50 20 · info@siipaf.com</div></div>
      <h1>Reçu de versement</h1><div class="num">N° ${esc(p.receipt_number)}</div>
      <div class="amount">Montant reçu<strong>${esc(amount(p.amount_fcfa))} FCFA</strong></div>
      <table>${lines.map(([k, v]) => `<tr><td>${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`).join('')}</table>
      <p class="foot">${esc(foot)}</p></body></html>`;
  };

  const share = async () => {
    setBusy('share');
    try {
      const { uri } = await Print.printToFileAsync({ html: await html() });
      if (Platform.OS !== 'web' && (await Sharing.isAvailableAsync())) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `Reçu ${p.receipt_number}` });
    } catch { toast('Le PDF n’a pas pu être créé. Réessayez.', 'error'); }
    setBusy(null);
  };
  const print = async () => {
    setBusy('print');
    try { await Print.printAsync({ html: await html() }); } catch { /* impression annulée */ }
    setBusy(null);
  };

  return (
    <Screen footer={<View style={{ flexDirection: 'row', gap: space.sm }}>
      <Button label="Imprimer" icon={Printer} variant="ghost" style={{ flex: 1 }} loading={busy === 'print'} onPress={print} />
      <Button label="PDF / Partager" icon={Share2} style={{ flex: 1.3 }} loading={busy === 'share'} onPress={share} />
    </View>}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 3, borderBottomColor: c.red, paddingBottom: space.md }}>
          <Image source={LOGO} style={{ width: 120, height: 40 }} contentFit="contain" />
          <Txt variant="tiny" style={{ textAlign: 'right' }}>SIIPAF SA{'\n'}Agréé MCLU · Abidjan</Txt>
        </View>
        <Txt variant="h2" style={{ marginTop: space.lg }}>Reçu de versement</Txt>
        <Txt variant="small">N° {p.receipt_number}</Txt>
        <View style={{ backgroundColor: c.surfaceAlt, borderRadius: 12, padding: space.lg, marginVertical: space.lg }}>
          <Txt variant="small">Montant reçu</Txt>
          <Txt style={{ fontFamily: fonts.bold, fontSize: 28, color: c.primary }}>{amount(p.amount_fcfa)} FCFA</Txt>
        </View>
        {lines.map(([k, v]) => (
          <View key={k} style={{ flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.line, gap: space.md }}>
            <Txt variant="small" style={{ width: '42%' }}>{k}</Txt>
            <Txt variant="bodyStrong" style={{ flex: 1, fontSize: 14 }}>{v}</Txt>
          </View>
        ))}
        <Txt variant="tiny" style={{ marginTop: space.lg }}>{foot}</Txt>
      </Card>
    </Screen>
  );
}
