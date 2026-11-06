/**
 * Onglet « Mon espace » : connexion à l'espace client (code client ou téléphone + mot de passe reçu de SIIPAF), comme
 * client.siipaf.com. En-tête immersif (photo, dégradé noir et rouge, logo sans fond, ce que l'espace contient), puis
 * le formulaire sur une feuille arrondie posée sur la photo. Connecté, le client ouvre son espace d'un toucher
 * (Face ID / empreinte demandés si activés).
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, FileText, HardHat, LogOut, Menu, MessageCircle, ScanFace, ShieldCheck, Wallet, type LucideIcon } from 'lucide-react-native';
import { Alert, Button, Field, Txt } from '@/components/ui';
import { LOGO_ON_DARK, LOGO_RATIO, useSite } from '@/lib/content';
import { firstName } from '@/lib/format';
import * as Haptics from '@/lib/haptics';
import { whatsapp } from '@/lib/links';
import { useMenu } from '@/providers/menu';
import { useSession } from '@/providers/session';
import { useT } from '@/providers/preferences';
import { useTheme } from '@/theme';

const PHOTO = require('../../../assets/images/site/connexion.jpg');

function Perk({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  const { fonts } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' }}>
      <Icon size={14} color="#fff" />
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: '#fff' }}>{label}</Txt>
    </View>
  );
}

export default function Espace() {
  const t = useT();
  const { c, space, fonts, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { open } = useMenu();
  const { contact } = useSite();
  const { status, client, login, logout, unlock, biometric, notice } = useSession();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const cl = await login(code, password);
      setPassword('');
      router.push(cl.must_change_password ? '/connexion/premiere' : '/espace-client');
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const connected = status === 'ready' || status === 'locked' || status === 'pending';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior="padding">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.xxxl }} bounces={false}>
        {/* En-tête immersif */}
        <View style={{ height: insets.top + 286, backgroundColor: '#0A0A0A' }}>
          <Image source={PHOTO} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" accessibilityElementsHidden />
          <LinearGradient colors={['rgba(10,10,10,0.55)', 'rgba(10,10,10,0.82)', 'rgba(140,4,12,0.92)']} locations={[0, 0.55, 1]}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          <View style={{ paddingTop: insets.top + 8, paddingHorizontal: space.lg, flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 46 }}>
              <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); open(); }} accessibilityRole="button" accessibilityLabel="Menu : infos SIIPAF" hitSlop={6}
                style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.92 : 1 }] })}>
                <Menu size={20} color="#fff" />
              </Pressable>
              <Image source={LOGO_ON_DARK} style={{ width: 118, height: 118 / LOGO_RATIO }} contentFit="contain" accessibilityLabel="SIIPAF" />
            </View>
            <View style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: 44 }}>
              <Txt style={{ fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, color: '#fff', letterSpacing: -0.4 }} accessibilityRole="header">
                {connected && client ? `${t('Bonjour')} ${firstName(client.name)}` : t('Votre espace client')}
              </Txt>
              <Txt style={{ marginTop: 6, fontSize: 14.5, lineHeight: 21, color: 'rgba(255,255,255,0.85)' }}>{t('Chantier, paiements et documents de votre acquisition')}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: space.md }}>
                <Perk icon={HardHat} label={t('Chantier')} />
                <Perk icon={Wallet} label={t('Paiements')} />
                <Perk icon={FileText} label={t('Documents')} />
              </View>
            </View>
          </View>
        </View>

        {/* Feuille posée sur la photo */}
        <View style={{ marginTop: -26, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: c.bg, paddingHorizontal: space.lg, paddingTop: space.xl }}>
          {connected ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: c.surfaceAlt, marginBottom: space.lg }}>
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}><ShieldCheck size={22} color={c.onPrimary} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt style={{ fontFamily: fonts.bold, fontSize: 16, color: c.ink }} numberOfLines={1}>{client ? client.name : t('Votre espace client')}</Txt>
                  {client ? <Txt variant="small" numberOfLines={1}>{t('Code client {code}', { code: client.client_code })}</Txt> : null}
                </View>
              </View>
              {status === 'locked' ? (
                <Button label={t('Déverrouiller avec {methode}', { methode: biometric.label })} icon={ScanFace} block haptic onPress={async () => { if (await unlock()) router.push('/espace-client'); }} />
              ) : (
                <Button label={t('Ouvrir mon espace client')} iconRight={ArrowRight} block onPress={() => router.push(status === 'pending' ? '/connexion/premiere' : '/espace-client')} />
              )}
              <Button label={t('Se déconnecter')} icon={LogOut} variant="ghost" block style={{ marginTop: space.sm }} onPress={logout} />
            </>
          ) : (
            <>
              <Txt style={{ fontFamily: fonts.bold, fontSize: 22, color: c.ink }}>{t('Connexion')}</Txt>
              <Txt variant="small" style={{ marginTop: 4, marginBottom: space.lg }}>{t('Avec votre code client ou votre numéro de téléphone, et le mot de passe reçu de SIIPAF.')}</Txt>
              <Alert tone="warn">{notice}</Alert>
              <Alert>{error}</Alert>
              <Field label={t('Code client ou téléphone')} value={code} onChangeText={setCode} placeholder="SIIPAF-2026-0001 ou 07 08 97 26 71" autoCapitalize="characters" autoCorrect={false} autoComplete="username" textContentType="username" returnKeyType="next" />
              <Field label={t('Mot de passe')} value={password} onChangeText={setPassword} secure autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} />
              <Pressable onPress={() => router.push('/connexion/oubli')} accessibilityRole="link" hitSlop={8} style={{ alignSelf: 'flex-end', marginTop: -space.sm, marginBottom: space.lg, paddingVertical: 4 }}>
                <Txt style={{ fontFamily: fonts.semibold, color: c.primary, fontSize: 14 }}>{t('Mot de passe oublié ?')}</Txt>
              </Pressable>
              <Button label={t('Se connecter')} iconRight={ArrowRight} block haptic loading={busy} disabled={code.trim().length < 4 || !password} onPress={submit} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: space.md }}>
                <ShieldCheck size={14} color={c.ok} />
                <Txt variant="tiny">{biometric.available ? t('Connecté 30 jours, protégé par {methode}.', { methode: biometric.label }) : t('Vous resterez connecté 30 jours sur ce téléphone.')}</Txt>
              </View>

              {/* Pas encore d'accès */}
              <Pressable onPress={() => whatsapp(contact.whatsapp, 'Bonjour SIIPAF, je souhaite recevoir mon accès à l’espace client.')} accessibilityRole="button"
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xl, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.whatsapp, alignItems: 'center', justifyContent: 'center' }}><MessageCircle size={19} color="#fff" /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 14.5, color: c.ink }}>{t('Pas encore d’accès ?')}</Txt>
                  <Txt variant="tiny">{t('Demandez-le à un conseiller sur WhatsApp')}</Txt>
                </View>
                <ArrowRight size={18} color={c.ink3} />
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
