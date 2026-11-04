/**
 * Éléments communs de l'espace client : en-tête mobile des onglets (menu latéral, titre, choix du dossier quand le client a
 * plusieurs biens, pastille du profil), écran « aucun dossier », hook du dossier sélectionné.
 */
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Check, ChevronDown, FolderOpen, MessageCircle } from 'lucide-react-native';
import { AppHeader } from '@/components/ui/AppHeader';
import { Button, Card, Empty, Ring, Sheet, Txt } from '@/components/ui';
import { initials } from '@/lib/format';
import { useSession } from '@/providers/session';
import { useTheme } from '@/theme';

export function ClientHeader({ eyebrow, title, right }: { eyebrow?: string; title: string; right?: ReactNode }) {
  const { c, space, fonts, radius } = useTheme();
  const { client, dossiers, selected, select } = useSession();
  const [open, setOpen] = useState(false);
  const multi = dossiers.length > 1 && !!selected;
  return (
    <>
      <AppHeader title={title} subtitle={multi ? undefined : eyebrow}
        right={<View style={{ flexDirection: 'row', gap: 8 }}>
          {right}
          <Pressable onPress={() => router.push('/espace-client/profil')} accessibilityRole="button" accessibilityLabel="Mon profil" hitSlop={6}
            style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 21, backgroundColor: c.surfaceAlt, borderWidth: 2, borderColor: c.primary, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.92 : 1 }] })}>
            <Txt style={{ color: c.ink, fontFamily: fonts.bold, fontSize: 14 }}>{initials(client?.name)}</Txt>
          </Pressable>
        </View>}>
        {multi ? (
          <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`Bien affiché : lot ${selected!.property.lot_code}. Changer de bien`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: c.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: 14, height: 36 }}>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.ink }}>Lot {selected!.property.lot_code} · {selected!.property.project.name}</Txt><ChevronDown size={15} color={c.ink} />
          </Pressable>
        ) : null}
      </AppHeader>
      <Sheet visible={open} title="Choisir un bien" onClose={() => setOpen(false)}>
        {dossiers.map(d => (
          <Pressable key={d.id} onPress={() => { select(d.id); setOpen(false); }} accessibilityRole="radio" accessibilityState={{ checked: d.id === selected?.id }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: c.line }}>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">Lot {d.property.lot_code}{d.property.ilot ? ` · Îlot ${d.property.ilot}` : ''}</Txt>
              <Txt variant="small">{d.property.project.name}</Txt>
            </View>
            {d.id === selected?.id ? <Check size={20} color={c.primary} /> : null}
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

/** Client sans dossier d'acquisition ouvert (repris de l'ancienne plateforme ou dossier en préparation). */
export function NoDossier() {
  const { client } = useSession();
  const { space } = useTheme();
  const bien = client?.property_type ? [client.property_type, client.project_name].filter(Boolean).join(' · ') : '';
  return (
    <Card>
      <Empty icon={FolderOpen} title={bien || 'Aucun dossier actif'}
        text={bien ? 'Le détail de votre dossier (lot, échéancier, documents) apparaîtra ici dès sa mise à jour par nos équipes. Une question ? Écrivez-nous.'
          : 'Votre dossier d’acquisition apparaîtra ici dès son ouverture par nos équipes. Une question ? Écrivez-nous.'}>
        {bien && client?.progress ? <View style={{ alignItems: 'center', marginBottom: space.md }}><Ring value={client.progress.progress_pct} label="chantier" /></View> : null}
        <Button label="Nous écrire" icon={MessageCircle} variant="dark" size="sm" onPress={() => router.push('/espace-client/messages')} />
      </Empty>
    </Card>
  );
}
