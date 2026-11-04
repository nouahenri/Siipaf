/** Nos métiers : domaines d'activité (Contenu du site › Accueil › Expertises), en cartes numérotées. */
import { ScrollView } from 'react-native';
import { EditorialCards, InfoScreenBody } from '@/components/site/Blocks';
import { Txt, plain } from '@/components/ui';
import { useSite } from '@/lib/content';
import { useTheme } from '@/theme';

export default function Metiers() {
  const { c, space } = useTheme();
  const { t } = useSite();
  const s = 'home.expertises';
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic">
      <InfoScreenBody>
        {t(`${s}.sous-titre`) ? <Txt style={{ marginTop: space.sm, marginBottom: space.lg }}>{plain(t(`${s}.sous-titre`))}</Txt> : null}
        <EditorialCards section={s} numbered />
      </InfoScreenBody>
    </ScrollView>
  );
}
