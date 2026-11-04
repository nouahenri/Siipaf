/** Aperçu web de l'espace client : mêmes onglets que sur téléphone, barre dessinée en bas. */
import { FileText, HardHat, House, MessageCircle, Wallet } from 'lucide-react-native';
import { WebTabs } from '@/components/ui/WebTabs';
import { useSession } from '@/providers/session';
import { useT } from '@/providers/preferences';

export default function ClientTabsWeb() {
  const t = useT();
  const { client } = useSession();
  return (
    <WebTabs tabs={[
      { name: 'index', href: '/espace-client', icon: House, label: t('Accueil') },
      { name: 'chantier', href: '/espace-client/chantier', icon: HardHat, label: t('Chantier') },
      { name: 'paiements', href: '/espace-client/paiements', icon: Wallet, label: t('Paiements') },
      { name: 'documents', href: '/espace-client/documents', icon: FileText, label: t('Documents') },
      { name: 'messages', href: '/espace-client/messages', icon: MessageCircle, label: t('Messages'), badge: client?.unread_messages || 0 },
    ]} />
  );
}
