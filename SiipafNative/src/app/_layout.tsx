/**
 * Racine de l'application SIIPAF : polices de la charte, cache des données, session de l'espace client, messages brefs,
 * ouverture de l'écran visé par une notification push. Pile principale :
 * - (site) : vitrine en onglets natifs (Accueil, Programmes, Sita, Contact, Mon espace) et menu latéral « Infos SIIPAF » ;
 * - espace-client : espace du client connecté (onglets natifs, verrou Face ID) ;
 * - fiches et formulaires ouverts par-dessus (programme, plan interactif, demande, connexion).
 */
import { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, useFonts } from '@expo-google-fonts/poppins';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AnimatedSplash } from '@/components/AnimatedSplash';
import { SCREENS, syncDevice } from '@/lib/push';
import { MenuProvider } from '@/providers/menu';
import { PreferencesProvider, usePrefs, useT } from '@/providers/preferences';
import { SessionProvider, useSession } from '@/providers/session';
import { ToastProvider } from '@/providers/toast';
import { fonts, useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
// Sans fondu : l'écran natif (emblème sur fond noir) cède la place à l'écran animé, identique à sa première image
SplashScreen.setOptions({ duration: 0, fade: false });

/** Notification touchée : écran de l'espace client correspondant (et dossier concerné). */
function NotificationRouter() {
  const { status, select } = useSession();
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!last) return;
    const data = last.notification.request.content.data as { screen?: string; sale_id?: number; url?: string } | undefined;
    // Annonce du dashboard (Ventes › Notifications push) : programme annoncé ou accueil, connecté ou non
    if (data?.url) {
      router.push((data.url.startsWith('/projet/') ? data.url : '/') as never);
      Notifications.clearLastNotificationResponseAsync?.().catch?.(() => {});
      return;
    }
    if (status !== 'ready') return;
    if (data?.sale_id) select(Number(data.sale_id));
    const target = data?.screen && SCREENS[data.screen];
    if (target) router.push(target as never);
    Notifications.clearLastNotificationResponseAsync?.().catch?.(() => {});
  }, [last, status, select]);
  return null;
}

/**
 * Retour des écrans ouverts par-dessus les onglets (menu latéral, Paramètres…) : toujours visible, y compris quand
 * l'écran est ouvert directement (lien, notification, rechargement de l'aperçu web) ; sans historique, retour à l'accueil.
 */
function HeaderBack() {
  const { c } = useTheme();
  const t = useT();
  return (
    <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityRole="button" accessibilityLabel={t('Retour')} hitSlop={8}
      style={({ pressed }) => ({ width: 44, height: 44, marginLeft: Platform.OS === 'web' ? 8 : -6, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
      <ArrowLeft size={24} color={c.ink} />
    </Pressable>
  );
}
const headerLeft = () => <HeaderBack />;

/** Inscription aux annonces tenue à jour : au démarrage et quand la ville préférée ou la langue change. */
function PushSync() {
  const { prefs } = usePrefs();
  useEffect(() => { syncDevice().catch(() => {}); }, [prefs.push, prefs.preferredCity, prefs.language]);
  return null;
}

function Navigation() {
  const { c, isDark } = useTheme();
  const t = useT();
  const headerTitleStyle = { fontFamily: fonts.semibold, fontSize: 17, color: c.ink };
  const navTheme = isDark ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={{ ...navTheme, colors: { ...navTheme.colors, primary: c.primary, background: c.bg, card: c.surface, text: c.ink, border: c.line } }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {Platform.OS !== 'web' && <NotificationRouter />}
      {Platform.OS !== 'web' && <PushSync />}
      <Stack screenOptions={{ headerTitleStyle, headerTintColor: c.ink, headerStyle: { backgroundColor: c.surface }, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="(site)" options={{ headerShown: false }} />
        <Stack.Screen name="espace-client" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="projet/[slug]" options={{ headerShown: false }} />
        <Stack.Screen name="carte/[slug]" options={{ headerShown: false }} />
        <Stack.Screen name="parametres" options={{ headerLeft, headerLargeTitle: true, headerLargeTitleShadowVisible: false, headerLargeTitleStyle: { fontFamily: fonts.bold, color: c.ink }, title: t('Paramètres') }} />
        <Stack.Screen name="confidentialite" options={{ headerLeft, title: t('Confidentialité') }} />
        <Stack.Screen name="infos/a-propos" options={{ headerLeft, headerLargeTitle: true, headerLargeTitleShadowVisible: false, headerLargeTitleStyle: { fontFamily: fonts.bold, color: c.ink }, title: t('Qui sommes-nous') }} />
        <Stack.Screen name="infos/metiers" options={{ headerLeft, headerLargeTitle: true, headerLargeTitleShadowVisible: false, headerLargeTitleStyle: { fontFamily: fonts.bold, color: c.ink }, title: t('Nos métiers') }} />
        <Stack.Screen name="infos/engagements" options={{ headerLeft, headerLargeTitle: true, headerLargeTitleShadowVisible: false, headerLargeTitleStyle: { fontFamily: fonts.bold, color: c.ink }, title: t('Nos engagements') }} />
        <Stack.Screen name="infos/financement" options={{ headerLeft, headerLargeTitle: true, headerLargeTitleShadowVisible: false, headerLargeTitleStyle: { fontFamily: fonts.bold, color: c.ink }, title: t('Financement') }} />
        <Stack.Screen name="infos/avis" options={{ headerLeft, headerLargeTitle: true, headerLargeTitleShadowVisible: false, headerLargeTitleStyle: { fontFamily: fonts.bold, color: c.ink }, title: t('Avis clients') }} />
        <Stack.Screen name="infos/carrieres" options={{ headerLeft, headerLargeTitle: true, headerLargeTitleShadowVisible: false, headerLargeTitleStyle: { fontFamily: fonts.bold, color: c.ink }, title: t('Carrières') }} />
        <Stack.Screen name="plan/[slug]" options={{ headerLeft, title: t('Carte interactive') }} />
        <Stack.Screen name="demande" options={{ headerLeft, presentation: 'modal', title: t('Nous contacter') }} />
        <Stack.Screen name="connexion/oubli" options={{ headerLeft, title: t('Mot de passe oublié') }} />
        <Stack.Screen name="connexion/premiere" options={{ title: t('Votre mot de passe'), headerBackVisible: false, gestureEnabled: false }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 30 * 1000, refetchOnWindowFocus: false } },
  }));
  const [loaded, error] = useFonts({
    Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold,
  });
  useEffect(() => { if (loaded || error) SplashScreen.hideAsync().catch(() => {}); }, [loaded, error]);
  // Écran de démarrage animé : une fois par lancement, par-dessus l'application qui se charge dessous
  const [splash, setSplash] = useState(true);
  const endSplash = useCallback(() => setSplash(false), []);
  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PreferencesProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <ToastProvider>
              <MenuProvider>
                <Navigation />
              </MenuProvider>
            </ToastProvider>
          </SessionProvider>
        </QueryClientProvider>
        {splash && <AnimatedSplash onDone={endSplash} />}
        </PreferencesProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
