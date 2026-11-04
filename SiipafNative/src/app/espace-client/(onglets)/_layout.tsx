/** Onglets natifs de l'espace client ; pastille des messages non lus (profil du client). SAV et profil depuis l'accueil. */
import { NativeTabs } from 'expo-router/native-tabs';
import { useSession } from '@/providers/session';
import { useT } from '@/providers/preferences';
import { useTheme } from '@/theme';

export default function ClientTabs() {
  const t = useT();
  const { c } = useTheme();
  const { client } = useSession();
  const unread = client?.unread_messages || 0;
  return (
    <NativeTabs tintColor={c.primary} iconColor={{ default: c.ink3, selected: c.primary }} labelStyle={{ default: { color: c.ink3 }, selected: { color: c.primary } }} backgroundColor={c.surface}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t('Accueil')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chantier">
        <NativeTabs.Trigger.Label>{t('Chantier')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'hammer', selected: 'hammer.fill' }} md="construction" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="paiements">
        <NativeTabs.Trigger.Label>{t('Paiements')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'creditcard', selected: 'creditcard.fill' }} md="payments" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="documents">
        <NativeTabs.Trigger.Label>{t('Documents')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'doc.text', selected: 'doc.text.fill' }} md="description" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="messages">
        <NativeTabs.Trigger.Label>{t('Messages')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'message', selected: 'message.fill' }} md="chat" />
        {unread > 0 ? <NativeTabs.Trigger.Badge>{unread > 9 ? '9+' : String(unread)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
