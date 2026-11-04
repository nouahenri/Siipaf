/**
 * Paramètres de l'application (menu latéral) : apparence et langue, notifications et sécurité (client connecté),
 * préférences d'achat, données, à propos. Les réglages sont gardés sur le téléphone (lib/prefs.ts) ; les catégories de
 * notifications sont gardées sur le serveur, comme dans le profil de l'espace client.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as StoreReview from 'expo-store-review';
import * as WebBrowser from 'expo-web-browser';
import { useState, type ReactNode } from 'react';
import { Alert as RNAlert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  Bell, BellRing, Brush, ChevronRight, Database, Eraser, Globe, HandCoins, Info, Languages, Lock, LogOut, MapPin, MessageSquareWarning,
  Moon, ScanFace, Share2, ShieldCheck, Smartphone, Star, Trash2, Type, Vibrate, Volume2, Wallet, Zap, type LucideIcon,
} from 'lucide-react-native';
import { BottomSheet, OptionList, type SelectOption } from '@/components/ui/Select';
import { AppSwitch, Segmented, Txt } from '@/components/ui';
import { PRIVACY_URL } from '@/config';
import { clientApi } from '@/lib/api';
import { useSite } from '@/lib/content';
import { LANGUAGES } from '@/lib/i18n';
import { mail } from '@/lib/links';
import { disablePush, enablePush } from '@/lib/push';
import type { Prefs } from '@/lib/prefs';
import { useFilters } from '@/lib/queries';
import { KEYS, prefs as storage } from '@/lib/storage';
import { shareApp } from '@/providers/menu';
import { usePrefs } from '@/providers/preferences';
import { useSession } from '@/providers/session';
import { useToast } from '@/providers/toast';
import { useTheme } from '@/theme';

const COUNTRIES = ['Côte d’Ivoire', 'France', 'Belgique', 'Suisse', 'Canada', 'États-Unis', 'Royaume-Uni', 'Italie', 'Espagne', 'Allemagne', 'Burkina Faso', 'Mali', 'Sénégal', 'Autre pays'];

function Group({ title, children }: { title: string; children: ReactNode }) {
  const { c, space, radius } = useTheme();
  return (
    <View style={{ marginTop: space.xl }}>
      <Txt variant="eyebrow" style={{ marginBottom: 8, marginLeft: 4 }} accessibilityRole="header">{title}</Txt>
      <View style={{ backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, overflow: 'hidden' }}>{children}</View>
    </View>
  );
}

function Item({ icon: Icon, label, sub, right, onPress, last, danger }: { icon: LucideIcon; label: string; sub?: string; right?: ReactNode; onPress?: () => void; last?: boolean; danger?: boolean }) {
  const { c, space, fonts } = useTheme();
  const body = (
    <>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: danger ? c.dangerSoft : c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><Icon size={18} color={danger ? c.danger : c.ink2} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontFamily: fonts.medium, fontSize: 15.5, color: danger ? c.danger : c.ink }}>{label}</Txt>
        {sub ? <Txt style={{ fontSize: 12.5, color: c.ink3 }} numberOfLines={2}>{sub}</Txt> : null}
      </View>
      {right ?? (onPress ? <ChevronRight size={18} color={c.ink3} /> : null)}
    </>
  );
  const style = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.md, minHeight: 56, paddingVertical: 10, paddingHorizontal: space.md, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: c.line };
  return onPress
    ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={sub ? `${label}, ${sub}` : label} style={({ pressed }) => [style, pressed && { backgroundColor: c.surfaceAlt }]}>{body}</Pressable>
    : <View style={style} accessible accessibilityLabel={sub ? `${label}, ${sub}` : label}>{body}</View>;
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return <AppSwitch value={value} onValueChange={onChange} label={label} />;
}

/** Ligne qui ouvre une liste de choix dans une feuille. */
function Choice<V extends string | number | null>({ icon, label, value, options, onChange, last }: { icon: LucideIcon; label: string; value: V; options: SelectOption<V>[]; onChange: (v: V) => void; last?: boolean }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.value === value);
  return (
    <>
      <Item icon={icon} label={label} last={last} onPress={() => setOpen(true)}
        right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '45%' }}><Txt style={{ fontSize: 14, color: c.ink3 }} numberOfLines={1}>{current?.label}</Txt><ChevronRight size={18} color={c.ink3} /></View>} />
      <BottomSheet visible={open} title={label} onClose={() => setOpen(false)}>
        <OptionList options={options} value={value} onPick={v => { onChange(v); setOpen(false); }} />
      </BottomSheet>
    </>
  );
}

type PushPrefs = { prefs: Record<string, boolean>; kinds: Record<string, string> };

export default function Parametres() {
  const { c, space } = useTheme();
  const { prefs, set, reset, t } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const { contact } = useSite();
  const { status, client, biometric, logout } = useSession();
  const filters = useFilters();
  const connected = status === 'ready' && !!client;
  const push = useQuery({ queryKey: ['client', 'push-prefs'], queryFn: () => clientApi.get<PushPrefs>('/push/prefs'), enabled: connected });
  const version = `${Application.nativeApplicationVersion || '1.0.0'}${Application.nativeBuildVersion ? ` (${Application.nativeBuildVersion})` : ''}`;

  const togglePush = async (k: string, on: boolean) => {
    qc.setQueryData<PushPrefs>(['client', 'push-prefs'], old => old && { ...old, prefs: { ...old.prefs, [k]: on } });
    try { await clientApi.put('/push/prefs', { [k]: on }); } catch (e: any) { toast(e.message, 'error'); push.refetch(); }
  };
  // Interrupteur général : activé si choisi, ou par défaut pour le client connecté (inscrit à la connexion)
  const pushOn = prefs.push === 'on' || (prefs.push === 'unset' && connected);
  const togglePushAll = async (on: boolean) => {
    if (!on) { await disablePush(connected); toast(t('Notifications push désactivées')); return; }
    const res = await enablePush(connected);
    if (res.token) toast(t('Notifications push activées'));
    else toast(res.reason === 'web' || res.reason === 'device' ? t('Disponible dans l’application installée sur votre téléphone')
      : res.reason === 'refused' ? t('Autorisez les notifications de SIIPAF dans les réglages du téléphone') : t('Activation impossible pour le moment'), 'error');
  };
  const confirm = (title: string, message: string, action: () => void, ok = t('Confirmer')) => {
    if (Platform.OS === 'web') { if (globalThis.confirm?.(`${title}\n\n${message}`)) action(); return; }
    RNAlert.alert(title, message, [{ text: t('Annuler'), style: 'cancel' }, { text: ok, style: 'destructive', onPress: action }]);
  };
  const clearCache = async () => {
    qc.removeQueries({ predicate: q => q.queryKey[0] !== 'client' });
    await Promise.all([Image.clearDiskCache().catch(() => false), Image.clearMemoryCache().catch(() => false)]);
    toast(t('Cache vidé : les données seront rechargées'));
  };
  const clearSita = async () => {
    await Promise.all([storage.remove(KEYS.sitaThread), storage.remove(KEYS.visitor)]);
    toast(t('Conversation avec Sita effacée'));
  };
  const rate = async () => {
    if (await StoreReview.hasAction().catch(() => false)) await StoreReview.requestReview().catch(() => {});
    else toast(t('La notation sera possible une fois l’application publiée dans les stores'));
  };
  const report = () => mail(contact.email, `${t('Application SIIPAF : signaler un problème')} (v${version}, ${Platform.OS} ${Device.osVersion || ''}, ${Device.modelName || ''})`);

  const themeOptions: [Prefs['theme'], string][] = [['light', t('Clair')], ['dark', t('Sombre')], ['system', t('Système')]];
  const lockOptions: SelectOption<Prefs['lockDelay']>[] = [
    { value: 0, label: t('À chaque retour') }, { value: 1, label: t('Après 1 minute') }, { value: 2, label: t('Après 2 minutes') },
    { value: 5, label: t('Après 5 minutes') }, { value: 15, label: t('Après 15 minutes') },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl }}>
      {/* Apparence et langue */}
      <Group title={t('Apparence et langue')}>
        <View style={{ padding: space.md, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><Moon size={18} color={c.ink2} /></View>
            <Txt variant="bodyStrong" style={{ fontSize: 15.5 }}>{t('Thème')}</Txt>
          </View>
          <Segmented value={prefs.theme} onChange={v => set('theme', v)} options={themeOptions} />
        </View>
        <Choice icon={Languages} label={t('Langue')} value={prefs.language} onChange={v => set('language', v)}
          options={(Object.keys(LANGUAGES) as Prefs['language'][]).map(l => ({ value: l, label: LANGUAGES[l] }))} />
        <Item icon={Type} label={t('Grand texte')} sub={t('Agrandit les textes de l’application')} right={<Toggle label={t('Grand texte')} value={prefs.textScale === 'large'} onChange={v => set('textScale', v ? 'large' : 'normal')} />} />
        <Item icon={Zap} label={t('Réduire les animations')} right={<Toggle label={t('Réduire les animations')} value={prefs.reduceMotion} onChange={v => set('reduceMotion', v)} />} />
        <Item icon={Vibrate} label={t('Vibrations')} sub={t('Retour au toucher des boutons et des choix')} last right={<Toggle label={t('Vibrations')} value={prefs.haptics} onChange={v => set('haptics', v)} />} />
      </Group>

      {/* Notifications */}
      <Group title={t('Notifications')}>
        <Item icon={BellRing} label={t('Recevoir des notifications push')} sub={t('Nouveaux programmes, lancements et offres de SIIPAF')}
          right={<Toggle label={t('Recevoir des notifications push')} value={pushOn} onChange={togglePushAll} />} />
        {connected ? (push.data ? Object.entries(push.data.kinds).map(([k, label]) => (
          <Item key={k} icon={Bell} label={t(label)} right={<Toggle label={t(label)} value={push.data!.prefs[k] !== false} onChange={on => togglePush(k, on)} />} />
        )) : <Item icon={Bell} label={push.error ? t('Réglages indisponibles pour le moment') : t('Chargement…')} />)
          : <Item icon={Bell} label={t('Notifications de votre dossier')} sub={t('Connectez-vous à votre espace client pour les recevoir')} onPress={() => router.push('/espace')} />}
        <Item icon={Volume2} label={t('Son des notifications')} last right={<Toggle label={t('Son des notifications')} value={prefs.notificationSound} onChange={v => set('notificationSound', v)} />} />
      </Group>

      {/* Sécurité */}
      {connected && (
        <Group title={t('Sécurité')}>
          {biometric.available ? (
            <Item icon={ScanFace} label={t('Déverrouiller avec {methode}', { methode: biometric.label })}
              right={<Toggle label={biometric.label} value={biometric.enabled} onChange={async on => { if (!(await biometric.setEnabled(on))) toast(t('Réglage inchangé'), 'error'); }} />} />
          ) : null}
          {biometric.enabled ? <Choice icon={Lock} label={t('Verrouillage automatique')} value={prefs.lockDelay} options={lockOptions} onChange={v => set('lockDelay', v)} /> : null}
          <Item icon={ShieldCheck} label={t('Mot de passe')} sub={t('Le changer depuis votre profil')} onPress={() => router.push('/espace-client/profil')} />
          <Item icon={LogOut} label={t('Se déconnecter de cet appareil')} danger last onPress={() => confirm(t('Se déconnecter ?'), t('Vous devrez saisir à nouveau votre code client et votre mot de passe.'), async () => { await logout(); router.replace('/espace'); }, t('Se déconnecter'))} />
        </Group>
      )}

      {/* Préférences d'achat */}
      <Group title={t('Préférences d’achat')}>
        <Choice icon={Wallet} label={t('Devise des prix')} value={prefs.currency} onChange={v => set('currency', v)}
          options={[{ value: 'FCFA', label: 'FCFA' }, { value: 'EUR', label: t('Euro (parité fixe 655,957)') }]} />
        <Choice icon={HandCoins} label={t('Formule du simulateur')} value={prefs.simulator} onChange={v => set('simulator', v)}
          options={[{ value: 'echelonne', label: t('Paiement échelonné') }, { value: 'diaspora', label: t('Formule Diaspora') }, { value: 'comptant', label: t('Paiement comptant') }]} />
        <Choice icon={MapPin} label={t('Ville préférée')} value={prefs.preferredCity} onChange={v => set('preferredCity', v)}
          options={[{ value: null, label: t('Aucune') }, ...(filters.data?.villes || []).map(v => ({ value: v.id, label: v.label }))]} />
        <Choice icon={Globe} label={t('Pays de résidence')} value={prefs.country} onChange={v => set('country', v)} last
          options={[{ value: '', label: t('Non renseigné') }, ...COUNTRIES.map(p => ({ value: p, label: t(p) }))]} />
      </Group>

      {/* Données */}
      <Group title={t('Données')}>
        <Item icon={Database} label={t('Économie de données')} sub={t('Pas d’actualisation automatique des messages')} right={<Toggle label={t('Économie de données')} value={prefs.dataSaver} onChange={v => set('dataSaver', v)} />} />
        <Item icon={Eraser} label={t('Vider le cache')} sub={t('Images et programmes enregistrés sur le téléphone')} onPress={clearCache} />
        <Item icon={Trash2} label={t('Effacer la conversation avec Sita')} onPress={() => confirm(t('Effacer la conversation ?'), t('Le fil de discussion avec Sita sera supprimé de ce téléphone.'), clearSita, t('Effacer'))} />
        <Item icon={Brush} label={t('Réinitialiser les paramètres')} last onPress={() => confirm(t('Réinitialiser les paramètres ?'), t('Thème, langue et préférences reviennent aux valeurs d’origine.'), async () => { await reset(); toast(t('Paramètres réinitialisés')); }, t('Réinitialiser'))} />
      </Group>

      {/* À propos */}
      <Group title={t('À propos')}>
        <Item icon={Star} label={t('Noter l’application')} onPress={rate} />
        <Item icon={Share2} label={t('Partager l’application')} onPress={shareApp} />
        <Item icon={MessageSquareWarning} label={t('Signaler un problème')} sub={contact.email} onPress={report} />
        <Item icon={Info} label={t('Confidentialité')} sub={t('Ce que l’application garde sur votre téléphone')} onPress={() => (PRIVACY_URL ? WebBrowser.openBrowserAsync(PRIVACY_URL) : router.push('/confidentialite'))} />
        <Item icon={Smartphone} label={t('Version')} sub={`SIIPAF ${version}`} last />
      </Group>
    </ScrollView>
  );
}
