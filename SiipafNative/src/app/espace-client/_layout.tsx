/**
 * Espace client mobile (déclinaison de client.siipaf.com) : réservé au client connecté. Verrou Face ID / empreinte à
 * l'ouverture et après 2 minutes en arrière-plan ; mot de passe provisoire à changer d'abord.
 */
import { Image } from 'expo-image';
import { Redirect, router, Stack } from 'expo-router';
import { View } from 'react-native';
import { ScanFace } from 'lucide-react-native';
import { Button, Spinner, Txt } from '@/components/ui';
import { LOGO, LOGO_ON_DARK, LOGO_RATIO } from '@/lib/content';
import { useSession } from '@/providers/session';
import { fonts, useTheme } from '@/theme';

function Lock() {
  const { c, space, isDark } = useTheme();
  const { unlock, biometric, logout, client } = useSession();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.lg }}>
      <Image source={isDark ? LOGO_ON_DARK : LOGO} style={{ width: 210, height: 210 / LOGO_RATIO }} contentFit="contain" accessibilityLabel="SIIPAF" />
      <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><ScanFace size={40} color={c.primary} /></View>
      <Txt variant="h2" center>Espace client verrouillé</Txt>
      <Txt center>{client ? `${client.name}, déverrouillez` : 'Déverrouillez'} votre espace avec {biometric.label} ou le code de votre téléphone.</Txt>
      <Button label={`Déverrouiller`} icon={ScanFace} block haptic onPress={() => unlock()} />
      <Button label="Revenir au site" variant="ghost" block onPress={() => router.replace('/')} />
      <Button label="Se déconnecter" variant="outline" block onPress={async () => { await logout(); router.replace('/espace'); }} />
    </View>
  );
}

export default function ClientLayout() {
  const { status } = useSession();
  const { c } = useTheme();
  if (status === 'loading') return <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Spinner /></View>;
  if (status === 'anon') return <Redirect href="/espace" />;
  if (status === 'pending') return <Redirect href="/connexion/premiere" />;
  if (status === 'locked') return <Lock />;
  return (
    <Stack screenOptions={{ headerTitleStyle: { fontFamily: fonts.semibold, color: c.ink }, headerTintColor: c.ink, headerStyle: { backgroundColor: c.surface }, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="(onglets)" options={{ headerShown: false }} />
      <Stack.Screen name="sav/index" options={{ title: 'Service après-vente' }} />
      <Stack.Screen name="sav/[id]" options={{ title: 'Ma demande' }} />
      <Stack.Screen name="sav/nouvelle" options={{ title: 'Signaler un problème', presentation: 'modal' }} />
      <Stack.Screen name="profil" options={{ title: 'Mon profil' }} />
      <Stack.Screen name="recu/[id]" options={{ title: 'Reçu de versement' }} />
      <Stack.Screen name="document/[id]" options={{ title: 'Document' }} />
    </Stack>
  );
}
