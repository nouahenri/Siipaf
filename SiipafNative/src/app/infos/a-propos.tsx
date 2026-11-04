/**
 * Qui sommes-nous : chiffres clés, agréments, identité, mission et vision, certifications, ADN (textes du dashboard).
 * Pas de témoignages ici (ils sont dans « Avis clients »), pas de bouton de fin de page.
 */
import { ScrollView, View } from 'react-native';
import { Award, BadgeCheck, Target } from 'lucide-react-native';
import { EditorialCards, EditorialHead, InfoScreenBody } from '@/components/site/Blocks';
import { Card, Txt, plain } from '@/components/ui';
import { useSite, useSiteContent } from '@/lib/content';
import { useTheme } from '@/theme';

export default function APropos() {
  const { c, space, radius, fonts } = useTheme();
  const { t, list, isHidden } = useSite();
  const content = useSiteContent();
  const id = 'about.notre-identite';
  const agrements = list('home.a-propos-de-siipaf.liste');
  const stats = content.data?.stats?.items?.slice(0, 4) || [];
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic">
      <InfoScreenBody>
        <Txt style={{ marginTop: space.sm }}>Promoteur immobilier et aménageur foncier agréé par le Ministère de la Construction, du Logement et de l’Urbanisme (MCLU), en Côte d’Ivoire.</Txt>

        {stats.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg }}>
            {stats.map((s, i) => (
              <View key={i} style={{ flexBasis: '47%', flexGrow: 1, padding: space.md, borderRadius: radius.lg, backgroundColor: c.surfaceAlt }} accessible accessibilityLabel={`${s.value}${s.unit ? ` ${s.unit}` : ''} ${s.label}`}>
                <Txt style={{ fontFamily: fonts.bold, fontSize: 22, color: c.primary }}>{s.value}{s.unit ? <Txt style={{ fontSize: 13, color: c.primary }}> {s.unit}</Txt> : null}</Txt>
                <Txt style={{ fontSize: 13, color: c.ink2 }} numberOfLines={1}>{s.label}</Txt>
              </View>
            ))}
          </View>
        )}

        {agrements.length > 0 && (
          <Card style={{ marginTop: space.md, gap: 10 }}>
            {agrements.map(a => (
              <View key={a} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <BadgeCheck size={18} color={c.ok} />
                <Txt style={{ flex: 1, fontFamily: fonts.medium, fontSize: 14, color: c.ink }}>{a}</Txt>
              </View>
            ))}
          </Card>
        )}

        {!isHidden(id) && <>
          <EditorialHead section={id} />
          {t(`${id}.texte`) ? <Txt style={{ marginBottom: space.md }}>{plain(t(`${id}.texte`))}</Txt> : null}
          <EditorialCards section={id} icon={Target} />
        </>}
        {!isHidden('about.mission-et-vision') && <><EditorialHead section="about.mission-et-vision" /><EditorialCards section="about.mission-et-vision" icon={Target} /></>}
        {!isHidden('about.certifications') && <><EditorialHead section="about.certifications" /><EditorialCards section="about.certifications" icon={Award} /></>}
        {!isHidden('about.notre-adn') && <><EditorialHead section="about.notre-adn" /><EditorialCards section="about.notre-adn" /></>}
      </InfoScreenBody>
    </ScrollView>
  );
}
