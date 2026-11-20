/**
 * Filet de sécurité du lien siipaf://paiement-retour (normalement intercepté par +native-intent) : si l'écran est tout de même
 * ouvert, il s'efface aussitôt — retour à l'écran précédent (fenêtre « Régler » intacte), sinon écran Paiements.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme';

export default function PaymentReturn() {
  const { c } = useTheme();
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/espace-client/paiements');
  }, []);
  return <View style={{ flex: 1, backgroundColor: c.bg }} />;
}
