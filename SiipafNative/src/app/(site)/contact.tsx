/**
 * Contact : les quatre façons de joindre SIIPAF (message, rendez-vous, WhatsApp, appel), coordonnées réglées dans le
 * dashboard (Contenu du site › Coordonnées), itinéraire vers les bureaux et réseaux sociaux.
 */
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { CalendarDays, ChevronRight, Clock, Globe, Mail, MapPin, MessageCircle, Phone, Send, type LucideIcon } from 'lucide-react-native';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card, Row, Txt } from '@/components/ui';
import { useSite } from '@/lib/content';
import { call, mail, whatsapp } from '@/lib/links';
import { useT } from '@/providers/preferences';
import { useTheme } from '@/theme';

export default function Contact() {
  const t = useT();
  const { c, space, radius, fonts, shadow } = useTheme();
  const { contact } = useSite();
  const socials = Object.entries(contact.socials || {}).filter(([, u]) => /^https?:/.test(String(u)));
  const actions: { icon: LucideIcon; label: string; sub: string; bg: string; onPress: () => void }[] = [
    { icon: Send, label: t('Écrire'), sub: t('Réponse sous 24 h'), bg: c.primary, onPress: () => router.push('/demande') },
    { icon: CalendarDays, label: t('Rendez-vous'), sub: t('Visite, bureau, visio'), bg: c.dark, onPress: () => router.push({ pathname: '/demande', params: { type: 'rdv' } }) },
    { icon: MessageCircle, label: t('WhatsApp'), sub: t('Un conseiller'), bg: c.whatsapp, onPress: () => whatsapp(contact.whatsapp, 'Bonjour SIIPAF, je vous écris depuis l’application.') },
    { icon: Phone, label: t('Appeler'), sub: contact.phone, bg: c.call, onPress: () => call(contact.phone) },
  ];
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <AppHeader title={t('Contact')} subtitle={t('Un conseiller SIIPAF vous accompagne, d’Abidjan ou de l’étranger.')} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.lg }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {actions.map(a => (
            <Pressable key={a.label} onPress={a.onPress} accessibilityRole="button" accessibilityLabel={a.label}
              style={({ pressed }) => ({ flexBasis: '47%', flexGrow: 1, padding: space.md, borderRadius: radius.lg, backgroundColor: c.surface, gap: 8, ...shadow(1), transform: [{ scale: pressed ? 0.97 : 1 }] })}>
              <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: a.bg, alignItems: 'center', justifyContent: 'center' }}><a.icon size={20} color="#fff" /></View>
              <View>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.ink }}>{a.label}</Txt>
                <Txt style={{ fontSize: 12, color: c.ink3 }} numberOfLines={1}>{a.sub}</Txt>
              </View>
            </Pressable>
          ))}
        </View>

        <Card padded={false}>
          <Row icon={Phone} title={contact.phone} sub={t('Mobile et WhatsApp')} onPress={() => call(contact.phone)} end={<ChevronRight size={18} color={c.ink3} />} />
          <Row icon={Phone} title={contact.phone2} sub={t('Bureau')} onPress={() => call(contact.phone2)} end={<ChevronRight size={18} color={c.ink3} />} />
          <Row icon={Mail} title={contact.email} onPress={() => mail(contact.email)} end={<ChevronRight size={18} color={c.ink3} />} />
          <Row icon={MapPin} title={contact.address} sub={t('Itinéraire')} last end={<ChevronRight size={18} color={c.ink3} />}
            onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`SIIPAF ${contact.address}`)}`).catch(() => {})} />
        </Card>
        {socials.length > 0 && (
          <Card padded={false}>
            {socials.map(([k, url], i) => <Row key={k} icon={Globe} title={`Nous suivre sur ${k.charAt(0).toUpperCase()}${k.slice(1)}`} onPress={() => WebBrowser.openBrowserAsync(String(url))} end={<ChevronRight size={18} color={c.ink3} />} last={i === socials.length - 1} />)}
          </Card>
        )}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Clock size={15} color={c.ink3} />
          <Txt variant="small" style={{ flex: 1 }}>{t('Bureaux ouverts du lundi au samedi. Sita vous répond à toute heure dans l’onglet Sita.')}</Txt>
        </View>
      </ScrollView>
    </View>
  );
}
