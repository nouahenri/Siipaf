/** Aperçu web de la vitrine : mêmes onglets que sur téléphone, barre dessinée en bas. */
import { CircleUserRound, House, MessagesSquare, Phone, Building } from 'lucide-react-native';
import { WebTabs } from '@/components/ui/WebTabs';
import { useT } from '@/providers/preferences';

export default function SiteTabsWeb() {
  const t = useT();
  return (
    <WebTabs tabs={[
      { name: 'index', href: '/', icon: House, label: t('Accueil') },
      { name: 'programmes', href: '/programmes', icon: Building, label: t('Programmes') },
      { name: 'sita', href: '/sita', icon: MessagesSquare, label: t('Sita') },
      { name: 'contact', href: '/contact', icon: Phone, label: t('Contact') },
      { name: 'espace', href: '/espace', icon: CircleUserRound, label: t('Mon espace') },
    ]} />
  );
}
