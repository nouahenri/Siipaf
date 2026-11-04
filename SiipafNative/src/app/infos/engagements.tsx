/** Nos engagements : « Pourquoi choisir SIIPAF » de l'accueil et engagements de la page À propos (dashboard). */
import { ScrollView } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { EditorialCards, EditorialHead, InfoScreenBody } from '@/components/site/Blocks';
import { Txt, plain } from '@/components/ui';
import { useSite } from '@/lib/content';
import { useTheme } from '@/theme';

export default function Engagements() {
  const { c, space } = useTheme();
  const { t, isHidden } = useSite();
  const s = 'home.nos-engagements';
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic">
      <InfoScreenBody>
        {t(`${s}.sous-titre`) ? <Txt style={{ marginTop: space.sm, marginBottom: space.lg }}>{plain(t(`${s}.sous-titre`))}</Txt> : null}
        <EditorialCards section={s} icon={ShieldCheck} />
        {!isHidden('about.nos-engagements') && <><EditorialHead section="about.nos-engagements" /><EditorialCards section="about.nos-engagements" icon={ShieldCheck} /></>}
      </InfoScreenBody>
    </ScrollView>
  );
}
