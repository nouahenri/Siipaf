/**
 * Vitrine SIIPAF en onglets natifs (barre système iOS / Android) : Accueil, Programmes, Sita, Contact, Mon espace.
 * Les informations sur SIIPAF (qui sommes-nous, métiers, financement, avis, carrières) sont dans le menu latéral.
 */
import { NativeTabs } from 'expo-router/native-tabs';
import { useT } from '@/providers/preferences';
import { useTheme } from '@/theme';

export default function SiteTabs() {
  const t = useT();
  const { c } = useTheme();
  return (
    <NativeTabs tintColor={c.primary} iconColor={{ default: c.ink3, selected: c.primary }} labelStyle={{ default: { color: c.ink3 }, selected: { color: c.primary } }} backgroundColor={c.surface}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t('Accueil')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="programmes">
        <NativeTabs.Trigger.Label>{t('Programmes')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'building.2', selected: 'building.2.fill' }} md="apartment" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="sita">
        <NativeTabs.Trigger.Label>{t('Sita')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} md="forum" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="contact">
        <NativeTabs.Trigger.Label>{t('Contact')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'phone', selected: 'phone.fill' }} md="call" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="espace">
        <NativeTabs.Trigger.Label>{t('Mon espace')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
