/**
 * Prise en charge des visiteurs : boutons WhatsApp / Appeler / Sita.
 * Numéros lus dans Contenu du site › Coordonnées (dashboard).
 */
import { router } from 'expo-router';
import { View } from 'react-native';
import { MessageCircle, Phone, Sparkles } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { useSite } from '@/lib/content';
import { call, whatsapp } from '@/lib/links';
import { useTheme } from '@/theme';

export function QuickContact({ context, compact }: { context?: string; compact?: boolean }) {
  const { contact } = useSite();
  const { space } = useTheme();
  const text = context ? `Bonjour SIIPAF, je souhaite des informations sur ${context}.` : 'Bonjour SIIPAF, je souhaite des informations sur vos programmes.';
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      <Button label="WhatsApp" icon={MessageCircle} variant="whatsapp" size={compact ? 'sm' : 'md'} onPress={() => whatsapp(contact.whatsapp, text)} />
      <Button label="Appeler" icon={Phone} variant="dark" size={compact ? 'sm' : 'md'} onPress={() => call(contact.phone)} />
      <Button label="Demander à Sita" icon={Sparkles} variant="ghost" size={compact ? 'sm' : 'md'} onPress={() => router.navigate('/sita')} />
    </View>
  );
}
