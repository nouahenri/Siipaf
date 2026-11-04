/**
 * Confidentialité : ce que l'application garde sur le téléphone et ce qu'elle envoie au serveur SIIPAF (description
 * factuelle du fonctionnement). La politique de confidentialité exigée par les stores reste à publier par SIIPAF ;
 * son adresse se règle dans app.json › extra.privacyUrl et remplace alors cet écran.
 */
import { ScrollView, View } from 'react-native';
import { Database, KeyRound, MessageCircle, Send, Smartphone, type LucideIcon } from 'lucide-react-native';
import { Card, Txt } from '@/components/ui';
import { useT } from '@/providers/preferences';
import { useTheme } from '@/theme';

export default function Confidentialite() {
  const { c, space } = useTheme();
  const t = useT();
  const rows: [LucideIcon, string, string][] = [
    [KeyRound, t('Session de l’espace client'), t('Un jeton de connexion de 30 jours, gardé dans le coffre sécurisé du téléphone (Keychain ou Keystore). Il est effacé à la déconnexion.')],
    [Smartphone, t('Préférences'), t('Thème, langue, devise et autres réglages de cet écran, gardés sur le téléphone seulement.')],
    [MessageCircle, t('Conversation avec Sita'), t('Le fil de discussion est gardé sur le téléphone ; les messages sont aussi envoyés au serveur SIIPAF pour que Sita réponde. Vous pouvez l’effacer dans Paramètres.')],
    [Send, t('Formulaires'), t('Les coordonnées saisies dans un formulaire (contact, rendez-vous, intérêt, candidature) sont envoyées à SIIPAF pour vous recontacter.')],
    [Database, t('Notifications'), t('Si vous êtes connecté et que vous les acceptez, l’identifiant de notification du téléphone est enregistré par SIIPAF ; il est retiré à la déconnexion.')],
  ];
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.lg, gap: space.sm }}>
      {rows.map(([Icon, title, text]) => (
        <Card key={title} style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><Icon size={18} color={c.primary} /></View>
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong" style={{ fontSize: 15 }}>{title}</Txt>
            <Txt variant="small" style={{ color: c.ink2 }}>{text}</Txt>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}
