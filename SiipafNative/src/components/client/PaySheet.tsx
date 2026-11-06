/**
 * « Régler » une échéance depuis l'application (feuille coulissante) :
 * 1. choix du moyen (logos officiels, assets/logo_payment) parmi ceux réglés dans le dashboard › Paramètres › Général ;
 * 2. montant (reste à régler, modifiable, plafonné) ; « Payer dans Wave » ouvre l'application de l'opérateur sur le lien
 *    marchand (prioritaire), le numéro marchand reste à copier en secours ;
 * 3. retour guidé : revenu dans l'application, le client trouve le champ Référence prêt, peut joindre une capture du reçu
 *    (facultatif), puis déclare. Fermer sans déclarer après être parti payer demande confirmation.
 * La déclaration est « à confirmer » par la Comptabilité : rien ne compte avant (le reçu officiel arrive ensuite).
 */
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Alert as RNAlert, AppState, Linking, Platform, Pressable, View } from 'react-native';
import { ArrowLeft, Camera, Check, ChevronRight, CircleCheck, Copy, ExternalLink, ShieldCheck, Undo2, Wallet, X } from 'lucide-react-native';
import { Alert, Button, Callout, Empty, Field, Sheet, Txt } from '@/components/ui';
import { apiUrl, clientApi } from '@/lib/api';
import { amount, fcfa } from '@/lib/format';
import * as Haptics from '@/lib/haptics';
import type { DossierDetail, Installment } from '@/lib/types';
import { useSession } from '@/providers/session';
import { useToast } from '@/providers/toast';
import { useTheme } from '@/theme';

type Channel = { key: string; label: string; link: string | null; number: string | null };

/**
 * Lien marchand Wave (pay.wave.com) : le montant saisi dans « Montant à payer » est passé dans `amount` (demande du client
 * du 06/11), en remplaçant celui du lien réglé au dashboard s'il y en a un. Les autres liens sont ouverts tels quels.
 */
export function withAmount(url: string, sum: number) {
  if (!/^https:\/\/pay\.wave\.com\//i.test(url) || !(sum > 0)) return url;
  const [base, hash = ''] = url.split('#');
  const [path, query = ''] = base.split('?');
  const params = query.split('&').filter(p => p && !/^amount=/i.test(p));
  params.push(`amount=${Math.round(sum)}`);
  return `${path}?${params.join('&')}${hash ? `#${hash}` : ''}`;
}

/** Logos officiels (sources et licences : assets/logo_payment/SOURCES.md). */
const LOGOS: Record<string, number> = {
  wave: require('../../../assets/logo_payment/wave-icon.png'),
  orange_money: require('../../../assets/logo_payment/orange-money.png'),
  mtn_money: require('../../../assets/logo_payment/mtn-money.png'),
  moov_money: require('../../../assets/logo_payment/moov-money.png'),
  paypal: require('../../../assets/logo_payment/paypal.svg'),
};
const VISA = require('../../../assets/logo_payment/visa.svg');
/** Logos carrés à fond plein (couleur de la marque jusqu'au bord) : affichés tels quels, coins arrondis. */
const FULL_BLEED = new Set(['wave', 'mtn_money', 'moov_money']);

function Logo({ k, size = 46 }: { k: string; size?: number }) {
  const { c } = useTheme();
  // Logos à fond plein : tuile pleine ; les autres sur une tuile blanche (logos prévus pour fond clair)
  return FULL_BLEED.has(k)
    ? <Image source={LOGOS[k]} style={{ width: size, height: size, borderRadius: 12 }} contentFit="cover" accessibilityIgnoresInvertColors />
    : (
      <View style={{ width: size, height: size, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center', padding: k === 'orange_money' ? 0 : 6, overflow: 'hidden' }}>
        <Image source={LOGOS[k]} style={{ width: '100%', height: '100%' }} contentFit="contain" accessibilityIgnoresInvertColors />
      </View>
    );
}

export function PaySheet({ dossier, line, onClose }: { dossier: DossierDetail; line: Installment; onClose: () => void }) {
  const { c, space, radius, fonts } = useTheme();
  const { client } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const channels = useQuery({ queryKey: ['client', 'payer'], queryFn: () => clientApi.get<Channel[]>('/payer') });
  const pending = (dossier.declarations || []).filter(d => d.status === 'a_confirmer').reduce((s, d) => s + d.amount_fcfa, 0);
  const max = Math.max(0, dossier.remaining_fcfa - pending);
  const [ch, setCh] = useState<Channel | null>(null);
  const [value, setValue] = useState(String(Math.min(line.remaining_fcfa, max)));
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState<{ id: number; uri: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<{ amount?: string; reference?: string }>({});
  const [done, setDone] = useState(false);
  // Parti payer dans l'application de l'opérateur, puis revenu : champ Référence prêt (remonté avec autoFocus)
  const [launched, setLaunched] = useState(false);
  const [back, setBack] = useState(0);
  const away = useRef(false);
  const sum = Number(value.replace(/\D/g, '')) || 0;

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active' && away.current) { away.current = false; setBack(n => n + 1); Haptics.selectionAsync().catch(() => {}); }
    });
    return () => sub.remove();
  }, []);

  const declare = useMutation({
    mutationFn: () => clientApi.post(`/dossiers/${dossier.id}/declarations`, { channel: ch!.key, amount_fcfa: sum, reference: reference.trim(), schedule_id: line.id || null, proof_file_id: proof?.id || null }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      qc.invalidateQueries({ queryKey: ['client', 'dossier', dossier.id] });
      setDone(true);
    },
  });
  const submit = () => {
    const e: typeof errors = {};
    if (sum <= 0) e.amount = 'Indiquez le montant payé.';
    else if (sum > max) e.amount = `Au plus ${fcfa(max)} (reste à régler${pending ? ', paiements déjà déclarés déduits' : ''}).`;
    if (reference.trim().length < 3) e.reference = 'Indiquez la référence de la transaction (reçue par SMS ou dans l’application de paiement).';
    setErrors(e);
    if (Object.keys(e).length) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); return; }
    declare.mutate();
  };
  const openLink = (url: string) => {
    if (sum <= 0 || sum > max) { setErrors({ amount: sum <= 0 ? 'Indiquez le montant à payer.' : `Au plus ${fcfa(max)}.` }); return; }
    away.current = true;
    setLaunched(true);
    Linking.openURL(withAmount(url, sum)).catch(() => { away.current = false; toast('Lien de paiement indisponible', 'error'); });
  };
  const copy = async (text: string) => { await Clipboard.setStringAsync(text); Haptics.selectionAsync().catch(() => {}); setLaunched(true); toast('Numéro copié'); };

  // Capture du reçu (facultative) : photo envoyée au serveur, jointe à la déclaration
  const pickProof = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    const form = new FormData();
    const type = a.mimeType || 'image/jpeg';
    if (Platform.OS === 'web' && a.file) form.append('files', a.file);
    else form.append('files', { uri: a.uri, name: a.fileName || `recu-${Date.now()}.${type.split('/')[1] || 'jpg'}`, type } as unknown as Blob);
    setUploading(true);
    try {
      const [f] = await clientApi.post<{ id: number }[]>('/sav/files', form);
      setProof({ id: f.id, uri: a.uri });
    } catch (e: any) { toast(e.message, 'error'); }
    setUploading(false);
  };

  // Parti payer sans déclarer : on demande avant de fermer
  const beforeClose = () => {
    if (!launched || done) return true;
    const msg = 'Votre paiement n’est pas encore déclaré. Sans déclaration, notre service comptable ne peut pas le rattacher à votre dossier.';
    if (Platform.OS === 'web') return !!globalThis.confirm?.(`Fermer sans déclarer ?\n\n${msg}`);
    return new Promise<boolean>(resolve => RNAlert.alert('Fermer sans déclarer ?', msg, [
      { text: 'Déclarer maintenant', onPress: () => resolve(false) },
      { text: 'Fermer', style: 'destructive', onPress: () => resolve(true) },
    ]));
  };

  const title = done ? 'Paiement déclaré' : ch ? `Payer avec ${ch.label}` : `Régler : ${line.label}`;
  const footer = done ? <Button label="Terminé" block onPress={onClose} />
    : ch ? <Button label="J’ai payé : déclarer ce paiement" icon={Check} block haptic loading={declare.isPending} onPress={submit} />
    : undefined;

  return (
    <Sheet visible title={title} onClose={onClose} footer={footer} beforeClose={beforeClose}>
      {done ? (
        <View style={{ alignItems: 'center', paddingVertical: space.xl, gap: space.md }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: c.okSoft, alignItems: 'center', justifyContent: 'center' }}><CircleCheck size={38} color={c.ok} /></View>
          <Txt variant="h2" center>{fcfa(sum)} déclarés</Txt>
          <Txt center style={{ color: c.ink2 }}>Notre service comptable vérifie la réception des fonds. Vous recevez une notification dès la confirmation, et le reçu apparaît dans « Versements ».</Txt>
        </View>
      ) : !ch ? (
        <>
          <View style={{ padding: space.md, borderRadius: radius.lg, backgroundColor: c.surfaceAlt, marginBottom: space.lg }}>
            <Txt variant="small">Reste à régler sur cette échéance</Txt>
            <Txt style={{ fontFamily: fonts.bold, fontSize: 26, color: c.ink }}>{amount(line.remaining_fcfa)} <Txt variant="small">FCFA</Txt></Txt>
            {pending ? <Txt variant="tiny" style={{ marginTop: 4 }}>{fcfa(pending)} déjà déclarés, en cours de vérification.</Txt> : null}
          </View>
          <Txt variant="h3" style={{ marginBottom: space.sm }}>Choisissez votre moyen de paiement</Txt>
          {channels.isLoading ? <Txt variant="small">Chargement…</Txt>
            : !channels.data?.length ? (
              <Empty icon={Wallet} title="Paiement en ligne bientôt disponible" text="En attendant, réglez par virement ou auprès de nos bureaux, et écrivez-nous dans Messages." />
            ) : (
              <View style={{ gap: space.sm }}>
                {channels.data.map(x => (
                  <Pressable key={x.key} onPress={() => { Haptics.selectionAsync().catch(() => {}); setCh(x); }} accessibilityRole="button" accessibilityLabel={`Payer avec ${x.label}`}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 72, paddingHorizontal: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.surfaceAlt : c.surface })}>
                    <Logo k={x.key} size={54} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt style={{ fontFamily: fonts.semibold, fontSize: 15.5, color: c.ink }}>{x.label}</Txt>
                      <Txt variant="tiny" numberOfLines={1}>{x.link ? `Paiement direct dans l’application ${x.key === 'paypal' ? 'PayPal' : x.label}` : `Numéro marchand ${x.number}`}</Txt>
                    </View>
                    {x.key === 'paypal' ? <Image source={VISA} style={{ width: 38, height: 13 }} contentFit="contain" accessibilityLabel="Visa" /> : null}
                    <ChevronRight size={18} color={c.ink3} />
                  </Pressable>
                ))}
              </View>
            )}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: space.lg }}>
            <ShieldCheck size={15} color={c.ok} />
            <Txt variant="tiny" style={{ flex: 1 }}>Le paiement est confirmé par la Comptabilité de SIIPAF avant d’être compté ; le reçu officiel suit.</Txt>
          </View>
        </>
      ) : (
        <>
          <Pressable onPress={() => { setCh(null); setLaunched(false); }} accessibilityRole="button" hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6, marginBottom: space.sm }}>
            <ArrowLeft size={16} color={c.ink2} /><Txt style={{ fontFamily: fonts.medium, color: c.ink2 }}>Autre moyen</Txt>
          </Pressable>
          <Alert>{declare.error ? (declare.error as Error).message : null}</Alert>
          <Field label="Montant à payer (FCFA)" value={value} onChangeText={t => setValue(t.replace(/[^\d ]/g, ''))} keyboardType="number-pad" error={errors.amount}
            hint={`Reste à régler sur le dossier : ${fcfa(max)}. Vous pouvez payer une partie.`} />

          {/* Étape 1 : payer dans l'application de l'opérateur (lien marchand prioritaire, numéro en secours) */}
          <View style={{ padding: space.md, borderRadius: radius.lg, backgroundColor: c.surfaceAlt, gap: space.sm, marginBottom: space.lg }}>
            {/* Logo à gauche ; titre, bouton et numéro compacts à droite */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
              <Logo k={ch.key} size={64} />
              <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.ink }}>1. Payez {fcfa(sum)} avec {ch.label}</Txt>
                {ch.link ? <Button label={`Payer dans ${ch.key === 'paypal' ? 'PayPal' : ch.label}`} icon={ExternalLink} variant="dark" size="sm" block haptic onPress={() => openLink(ch.link!)} /> : null}
                {ch.number ? (
                  <Pressable onPress={() => copy(ch.number!)} accessibilityRole="button" accessibilityLabel={`Copier le numéro marchand ${ch.number}`}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.md, backgroundColor: pressed ? c.line : c.surface, borderWidth: 1, borderColor: c.line })}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt style={{ fontSize: 10.5, color: c.ink3 }} numberOfLines={1}>{ch.link ? 'Ou au numéro marchand' : 'Numéro marchand SIIPAF'}</Txt>
                      <Txt style={{ fontFamily: fonts.bold, fontSize: 15, color: c.ink, letterSpacing: 0.4 }} numberOfLines={1}>{ch.number}</Txt>
                    </View>
                    <Copy size={15} color={c.primary} /><Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.primary }}>Copier</Txt>
                  </Pressable>
                ) : null}
              </View>
            </View>
            <Txt variant="tiny">Indiquez en motif votre code client {client?.client_code ? <Txt variant="tiny" style={{ fontFamily: fonts.semibold, color: c.ink }}>{client.client_code}</Txt> : null}.</Txt>
          </View>

          {/* Retour de l'application de paiement */}
          {back > 0 ? (
            <View style={{ marginBottom: space.md }}>
              <Callout icon={Undo2} tone="ok" title={`De retour de ${ch.key === 'paypal' ? 'PayPal' : ch.label}`} text="Saisissez la référence de la transaction ci-dessous puis déclarez votre paiement." />
            </View>
          ) : null}

          {/* Étape 2 : déclarer avec la référence (et la capture du reçu, facultative) */}
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.ink, marginBottom: space.sm }}>2. Déclarez votre paiement</Txt>
          <Field key={`ref-${back}`} autoFocus={back > 0} label="Référence de la transaction *" value={reference} onChangeText={setReference} autoCapitalize="characters" autoCorrect={false} error={errors.reference}
            placeholder="Ex. : WV2611041234" hint="Elle figure dans le SMS de confirmation ou dans l’historique de votre application." />
          {proof ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: c.line }}>
              <Image source={{ uri: proof.uri.startsWith('/') ? apiUrl(proof.uri)! : proof.uri }} style={{ width: 52, height: 52, borderRadius: 8, backgroundColor: c.surfaceAlt }} contentFit="cover" />
              <Txt style={{ flex: 1, fontFamily: fonts.medium, color: c.ink }}>Capture du reçu jointe</Txt>
              <Pressable onPress={() => setProof(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retirer la capture"><X size={18} color={c.ink3} /></Pressable>
            </View>
          ) : (
            <Button label={uploading ? 'Envoi de la capture…' : 'Joindre une capture du reçu (facultatif)'} icon={Camera} variant="outline" block loading={uploading} onPress={pickProof} />
          )}
        </>
      )}
    </Sheet>
  );
}
