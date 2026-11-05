/**
 * Menu latéral (spécification de l'expert design mobile du 03/11) : carte du compte, 7 entrées au plus sans sous-titre
 * avec l'entrée active surlignée, puis WhatsApp et Appeler, et « Zone Siipaf » (lien vers l'ERP). Fermeture : toucher hors du panneau, glissement vers la
 * gauche, bouton X, retour Android, et avant chaque navigation. Pas d'ouverture depuis le bord (geste retour d'iOS).
 * Chiffres clés et agrément sont dans « Qui sommes-nous », e-mail, bureaux et réseaux dans l'onglet Contact.
 */
import { Image, type ImageRef } from 'expo-image';
import { router, usePathname, type Href } from 'expo-router';
import * as Haptics from '@/lib/haptics';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Linking, Modal, Pressable, ScrollView, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Briefcase, Building, ChevronRight, CircleUserRound, HandCoins, HardHat, House, LayoutGrid, LogOut, MessageCircle, Phone, Settings, Share2, ShieldCheck, Star, X, type LucideIcon,
} from 'lucide-react-native';
import { Txt } from '@/components/ui/Text';
import { LOGO_ON_RED, LOGO_RATIO, useSite } from '@/lib/content';
import { initials } from '@/lib/format';
import { call, whatsapp } from '@/lib/links';
import { APP_STORE_URL, ERP_URL, PLAY_STORE_URL, SHARE_URL } from '@/config';
import { getPrefs } from '@/lib/prefs';
import { useT } from '@/providers/preferences';
import { useSession } from '@/providers/session';
import { useTheme } from '@/theme';

/** Menu sur fond noir (demande du client du 04/11), sous le bandeau rouge du logo, quel que soit le thème. */
const M = {
  bg: '#0A0A0A', card: '#1C1C1F', ink: '#FFFFFF', ink2: 'rgba(255,255,255,0.78)', ink3: 'rgba(255,255,255,0.58)',
  line: 'rgba(255,255,255,0.12)', pressed: 'rgba(255,255,255,0.08)', active: 'rgba(227,6,19,0.22)', accent: '#FF4D57', danger: '#FF6B72',
};

const MenuContext = createContext<{ open: () => void; close: () => void }>({ open: () => {}, close: () => {} });

/**
 * Partage natif de l'application : présentation, lien du site, puis liens de téléchargement App Store et Google Play dès
 * qu'ils sont réglés (app.json › extra.appStoreUrl / extra.playStoreUrl, une fois l'application publiée).
 */
export const shareApp = () => {
  const lang = getPrefs().language;
  const intro = lang === 'fr' ? 'Découvrez SIIPAF, promoteur immobilier agréé en Côte d’Ivoire : programmes, terrains et suivi de votre acquisition.'
    : lang === 'es' ? 'Descubre SIIPAF, promotor inmobiliario autorizado en Costa de Marfil.' : 'Discover SIIPAF, licensed real estate developer in Côte d’Ivoire.';
  const site = lang === 'fr' ? 'Site' : lang === 'es' ? 'Sitio' : 'Website';
  const stores = [APP_STORE_URL && `iPhone (App Store) : ${APP_STORE_URL}`, PLAY_STORE_URL && `Android (Google Play) : ${PLAY_STORE_URL}`].filter(Boolean);
  const message = [intro, `${site} : ${SHARE_URL}`, ...stores].join('\n');
  return Share.share({ message, url: SHARE_URL, title: 'SIIPAF' }).catch(() => {});
};

const ENTRIES: { icon: LucideIcon; title: string; to: string }[] = [
  { icon: Building, title: 'Qui sommes-nous', to: '/infos/a-propos' },
  { icon: HardHat, title: 'Nos métiers', to: '/infos/metiers' },
  { icon: ShieldCheck, title: 'Nos engagements', to: '/infos/engagements' },
  { icon: HandCoins, title: 'Financement', to: '/infos/financement' },
  { icon: Star, title: 'Avis clients', to: '/infos/avis' },
  { icon: Briefcase, title: 'Carrières', to: '/infos/carrieres' },
];

function MenuRow({ icon: Icon, title, active, onPress }: { icon: LucideIcon; title: string; active?: boolean; onPress: () => void }) {
  const { radius, fonts } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ selected: !!active }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, height: 52, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: active ? M.active : pressed ? M.pressed : 'transparent' })}>
      <Icon size={22} color={active ? M.accent : M.ink2} />
      <Txt style={{ flex: 1, fontFamily: active ? fonts.semibold : fonts.medium, fontSize: 16, color: M.ink }}>{title}</Txt>
    </Pressable>
  );
}

function Panel({ onClosed, logo }: { onClosed: () => void; logo: ImageRef | null }) {
  const { c, space, radius, fonts } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { contact } = useSite();
  const { status, client, logout } = useSession();
  const t = useT();
  const panelW = Math.min(320, width * 0.82);
  const [x] = useState(() => new Animated.Value(-panelW));
  const [reduce, setReduce] = useState(false);
  const connected = (status === 'ready' || status === 'locked') && !!client;
  const inClient = pathname.startsWith('/espace-client');

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(sys => {
      if (!live) return;
      const r = sys || getPrefs().reduceMotion;
      setReduce(r);
      Animated.timing(x, { toValue: 0, duration: r ? 120 : 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }).catch(() => Animated.timing(x, { toValue: 0, duration: 260, useNativeDriver: true }).start());
    return () => { live = false; };
  }, [x]);

  const close = (then?: () => void) => {
    Animated.timing(x, { toValue: -panelW, duration: reduce ? 120 : 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => { onClosed(); then?.(); });
  };
  const go = (to: string) => close(() => router.push(to as Href));

  // Glissement vers la gauche : le panneau suit le doigt, se ferme au-delà de 30 % ou sur un geste rapide
  const pan = usePanGesture({
    runOnJS: true,
    activeOffsetX: [-12, 12],
    onUpdate: e => x.setValue(Math.min(0, e.translationX)),
    onDeactivate: e => {
      if (e.translationX < -panelW * 0.3 || e.velocityX < -500) close();
      else Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
    },
  });

  const backdrop = x.interpolate({ inputRange: [-panelW, 0], outputRange: [0, 1], extrapolate: 'clamp' });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay, opacity: backdrop }]}>
        <Pressable style={{ flex: 1 }} onPress={() => close()} accessibilityRole="button" accessibilityLabel="Fermer le menu" />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View accessibilityViewIsModal
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: panelW, backgroundColor: M.bg, borderTopRightRadius: radius.xl, borderBottomRightRadius: radius.xl, overflow: 'hidden', transform: [{ translateX: x }], opacity: reduce ? backdrop : 1 }}>
          {/* Bandeau rouge sur toute la largeur : logo sans fond (déclinaison pour le rouge) agrandi, et fermeture */}
          <View style={{ backgroundColor: c.red, paddingTop: insets.top + 10, paddingBottom: 10, paddingLeft: space.md, paddingRight: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Image source={logo ?? LOGO_ON_RED} transition={0} priority="high" style={{ flex: 1, aspectRatio: LOGO_RATIO, maxHeight: 76 }} contentFit="contain" contentPosition="left" accessibilityLabel="SIIPAF, promoteur immobilier agréé" />
            <Pressable onPress={() => close()} accessibilityRole="button" accessibilityLabel="Fermer le menu" hitSlop={4}
              style={({ pressed }) => ({ alignSelf: 'flex-start', width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.75 : 1 })}>
              <X size={20} color="#fff" />
            </Pressable>
          </View>
          <View style={{ flex: 1, paddingTop: space.sm, paddingBottom: Math.max(insets.bottom, space.md), paddingHorizontal: space.lg }}>

            {/* Compte */}
            <Pressable onPress={() => go(connected ? '/espace-client' : '/espace')} accessibilityRole="button"
              accessibilityLabel={connected ? `${client!.name}, code client ${client!.client_code} : ouvrir mon espace client` : 'Se connecter à l’espace client'}
              style={({ pressed }) => ({ marginTop: space.md, height: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space.md, borderRadius: radius.lg, backgroundColor: M.card, opacity: pressed ? 0.85 : 1 })}>
              {connected ? (
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt style={{ fontFamily: fonts.bold, fontSize: 16, color: c.onPrimary }}>{initials(client!.name)}</Txt>
                </View>
              ) : <CircleUserRound size={40} color={M.ink2} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontFamily: fonts.bold, fontSize: 17, color: M.ink }} numberOfLines={1}>{connected ? client!.name : t('Se connecter')}</Txt>
                <Txt style={{ fontSize: 13, color: M.ink3 }} numberOfLines={1}>{connected ? t('Code client {code}', { code: client!.client_code }) : t('Suivre mon chantier et mes paiements')}</Txt>
              </View>
              <ChevronRight size={18} color={M.ink3} />
            </Pressable>

            {/* Navigation */}
            <ScrollView style={{ flex: 1, marginTop: space.md }} showsVerticalScrollIndicator={false}>
              {inClient ? <MenuRow icon={House} title={t('Accueil SIIPAF')} onPress={() => close(() => router.navigate('/'))} /> : null}
              {ENTRIES.map(e => <MenuRow key={e.to} icon={e.icon} title={t(e.title)} active={pathname === e.to} onPress={() => go(e.to)} />)}

              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: M.line, marginVertical: space.md }} />
              <MenuRow icon={Settings} title={t('Paramètres')} active={pathname === '/parametres'} onPress={() => go('/parametres')} />
              <MenuRow icon={Share2} title={t('Partager l’application')} onPress={() => close(shareApp)} />
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                {/* Ouverts tout de suite au toucher (sinon le navigateur bloque l'ouverture), puis le menu se ferme */}
                <Pressable onPress={() => { whatsapp(contact.whatsapp, 'Bonjour SIIPAF, je vous écris depuis l’application.'); close(); }} accessibilityRole="button" accessibilityLabel="Écrire sur WhatsApp"
                  style={({ pressed }) => ({ flex: 1, height: 48, borderRadius: radius.pill, backgroundColor: c.whatsapp, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: pressed ? 0.85 : 1 })}>
                  <MessageCircle size={18} color={c.onPrimary} /><Txt style={{ fontFamily: fonts.semibold, fontSize: 14.5, color: c.onPrimary }}>WhatsApp</Txt>
                </Pressable>
                <Pressable onPress={() => { call(contact.phone); close(); }} accessibilityRole="button" accessibilityLabel={`Appeler SIIPAF au ${contact.phone}`}
                  style={({ pressed }) => ({ flex: 1, height: 48, borderRadius: radius.pill, backgroundColor: c.call, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: pressed ? 0.85 : 1 })}>
                  <Phone size={18} color={c.onPrimary} /><Txt style={{ fontFamily: fonts.semibold, fontSize: 14.5, color: c.onPrimary }}>{t('Appeler')}</Txt>
                </Pressable>
              </View>
              {/* Accès du personnel à l'ERP (demande du client du 05/11), ouvert dans le navigateur du téléphone */}
              <Pressable onPress={() => { Linking.openURL(ERP_URL).catch(() => {}); close(); }} accessibilityRole="link" accessibilityLabel="Zone Siipaf : ouvrir l’ERP SIIPAF"
                hitSlop={6} style={({ pressed }) => ({ marginTop: space.md, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
                <LayoutGrid size={14} color={M.ink3} /><Txt style={{ fontFamily: fonts.regular, fontSize: 13, color: M.ink3 }}>Zone Siipaf</Txt>
              </Pressable>
            </ScrollView>

            {connected ? (
              <Pressable onPress={() => close(async () => { await logout(); router.replace('/espace'); })} accessibilityRole="button" accessibilityLabel="Se déconnecter"
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, height: 48, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: pressed ? M.pressed : 'transparent' })}>
                <LogOut size={20} color={M.danger} /><Txt style={{ fontFamily: fonts.medium, fontSize: 15, color: M.danger }}>{t('Se déconnecter')}</Txt>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

export function MenuProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  // Logo décodé en mémoire dès le lancement de l'application (demande du client du 05/11) : le panneau, recréé à chaque
  // ouverture, l'affiche alors instantanément au lieu de le recharger à chaque fois.
  const [logo, setLogo] = useState<ImageRef | null>(null);
  useEffect(() => {
    let live = true;
    Image.loadAsync(LOGO_ON_RED).then(ref => { if (live) setLogo(ref); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const open = useCallback(() => { Haptics.selectionAsync().catch(() => {}); setVisible(true); }, []);
  const close = useCallback(() => setVisible(false), []);
  const value = useMemo(() => ({ open, close }), [open, close]);
  return (
    <MenuContext.Provider value={value}>
      {children}
      <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
        {visible ? <Panel onClosed={close} logo={logo} /> : null}
      </Modal>
    </MenuContext.Provider>
  );
}

export const useMenu = () => useContext(MenuContext);
