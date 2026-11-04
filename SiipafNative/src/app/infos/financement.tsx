/** Financement : formules (flexibilité), sécurité des paiements, étapes de l'acquisition (page Financement du dashboard). */
import { ScrollView } from 'react-native';
import { HandCoins, ShieldCheck } from 'lucide-react-native';
import { EditorialCards, EditorialHead, InfoScreenBody } from '@/components/site/Blocks';
import { Callout, Txt, plain } from '@/components/ui';
import { useSite } from '@/lib/content';
import { useTheme } from '@/theme';

export default function Financement() {
  const { c, space } = useTheme();
  const { t, isHidden } = useSite();
  const sec = 'financing.securite';
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic">
      <InfoScreenBody>
        {t('financing.bandeau-de-titre.texte') ? <Txt style={{ marginTop: space.sm }}>{plain(t('financing.bandeau-de-titre.texte'))}</Txt> : null}
        {!isHidden('financing.flexibilite') && <><EditorialHead section="financing.flexibilite" /><EditorialCards section="financing.flexibilite" icon={HandCoins} /></>}
        {!isHidden(sec) && <>
          <EditorialHead section={sec} />
          <EditorialCards section={sec} icon={ShieldCheck} />
          {t(`${sec}.titre-2`) ? <Callout icon={ShieldCheck} tone="ok" title={plain(t(`${sec}.titre-2`))} text={plain(t(`${sec}.texte`))} /> : null}
        </>}
        {!isHidden('financing.processus') && <><EditorialHead section="financing.processus" /><EditorialCards section="financing.processus" numbered /></>}
      </InfoScreenBody>
    </ScrollView>
  );
}
