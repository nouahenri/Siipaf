/**
 * Vitrine SIIPAF en onglets : Accueil, Programmes, Sita (bouton central surélevé), Contact, Mon espace.
 * Barre dessinée par l'application (components/ui/FabTabs), identique sur Android, iOS et l'aperçu web : la barre native
 * du système ne permet pas de bouton central. Les informations sur SIIPAF (qui sommes-nous, métiers, financement, avis,
 * carrières) sont dans le menu latéral.
 */
import { Building, CircleUserRound, House, MessagesSquare, Phone } from 'lucide-react-native';
import { FabTabs } from '@/components/ui/FabTabs';
import { useT } from '@/providers/preferences';

export default function SiteTabs() {
  const t = useT();
  return (
    <FabTabs tabs={[
      { name: 'index', href: '/', icon: House, label: t('Accueil') },
      { name: 'programmes', href: '/programmes', icon: Building, label: t('Programmes') },
      { name: 'sita', href: '/sita', icon: MessagesSquare, label: t('Sita'), center: true },
      { name: 'contact', href: '/contact', icon: Phone, label: t('Contact') },
      { name: 'espace', href: '/espace', icon: CircleUserRound, label: t('Mon espace') },
    ]} />
  );
}
