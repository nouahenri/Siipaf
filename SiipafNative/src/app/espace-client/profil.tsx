/**
 * Mon profil (client/src/pages/Profile.jsx) : identité et biens, sécurité (Face ID / empreinte, mot de passe),
 * notifications push par catégorie (réglage gardé sur le serveur), contacts, déconnexion.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View, Platform } from 'react-native';
import { Bell, Building, ChevronRight, KeyRound, LogOut, Mail, MessageCircle, Phone, ScanFace } from 'lucide-react-native';
import { Alert, AppSwitch, Button, Card, Field, Row, Screen, SectionHead, Txt } from '@/components/ui';
import { PASSWORD_MIN } from '@/config';
import { clientApi } from '@/lib/api';
import { useSite } from '@/lib/content';
import { amount, initials } from '@/lib/format';
import { call, mail, whatsapp } from '@/lib/links';
import { registerForPush } from '@/lib/push';
import type { ClientProfile } from '@/lib/types';
import { useSession } from '@/providers/session';
import { useToast } from '@/providers/toast';
import { useTheme } from '@/theme';

type Prefs = { prefs: Record<string, boolean>; kinds: Record<string, string> };

export default function Profil() {
  const { c, space, fonts } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const { contact } = useSite();
  const { client, dossiers, logout, biometric, accept } = useSession();
  const prefs = useQuery({ queryKey: ['client', 'push-prefs'], queryFn: () => clientApi.get<Prefs>('/push/prefs') });
  const [pw, setPw] = useState({ open: false, current: '', next: '', confirm: '', error: '' as string, busy: false });

  if (!client) return null;

  const togglePref = async (k: string, on: boolean) => {
    qc.setQueryData<Prefs>(['client', 'push-prefs'], old => old && { ...old, prefs: { ...old.prefs, [k]: on } });
    try {
      await clientApi.put('/push/prefs', { [k]: on });
      if (on) registerForPush().catch(() => {});
    } catch (e: any) { toast(e.message, 'error'); prefs.refetch(); }
  };
  const changePassword = async () => {
    if (pw.next.length < PASSWORD_MIN) return setPw(p => ({ ...p, error: `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.` }));
    if (pw.next !== pw.confirm) return setPw(p => ({ ...p, error: 'Les deux mots de passe ne sont pas identiques.' }));
    setPw(p => ({ ...p, busy: true, error: '' }));
    try {
      const r = await clientApi.post<{ client: ClientProfile; token?: string }>('/password', { current: pw.current, next: pw.next });
      await accept(r);
      setPw({ open: false, current: '', next: '', confirm: '', error: '', busy: false });
      toast('Mot de passe modifié. Vos autres appareils sont déconnectés.');
    } catch (e: any) { setPw(p => ({ ...p, busy: false, error: e.message })); }
  };

  return (
    <Screen>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: c.dark, alignItems: 'center', justifyContent: 'center' }}>
            <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 20 }}>{initials(client.name)}</Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="h3">{client.name}</Txt>
            <Txt style={{ fontFamily: fonts.semibold, color: c.primary, fontSize: 14, letterSpacing: 0.5 }}>{client.client_code}</Txt>
          </View>
        </View>
        <View style={{ marginTop: space.lg, gap: 10 }}>
          <Kv k="E-mail" v={client.email || '—'} />
          <Kv k="Téléphone" v={client.phone || '—'} />
          {client.country ? <Kv k="Pays de résidence" v={client.country} /> : null}
          <Kv k={dossiers.length > 1 ? 'Biens' : 'Bien'} v={dossiers.map(d => `Lot ${d.property.lot_code} — ${d.property.project.name}`).join('\n') || '—'} />
          {dossiers[0] ? <Kv k="Prix convenu" v={`${amount(dossiers[0].price_fcfa)} FCFA`} /> : null}
        </View>
        <Txt variant="small" style={{ marginTop: space.md }}>Une information à corriger ? Signalez-le-nous par message.</Txt>
      </Card>

      <SectionHead title="Sécurité" />
      <Card padded={false}>
        {biometric.available ? (
          <Row icon={ScanFace} iconTone="primary" title={`Déverrouiller avec ${biometric.label}`} sub={Platform.OS === 'android' ? 'Demandé à l’ouverture et après 2 minutes d’absence. Votre téléphone choisit la méthode (empreinte, visage ou code) selon ses réglages.' : 'Demandé à l’ouverture de l’espace client et après 2 minutes d’absence'}
            end={<AppSwitch value={biometric.enabled} onValueChange={async on => { if (!(await biometric.setEnabled(on))) toast('Réglage inchangé', 'error'); }} label={`Déverrouiller avec ${biometric.label}`} />} />
        ) : null}
        <Row icon={KeyRound} title="Mot de passe" sub="Changez-le à tout moment" end={<ChevronRight size={18} color={c.ink3} />} onPress={() => setPw(p => ({ ...p, open: !p.open, error: '' }))} last={!pw.open} />
        {pw.open && (
          <View style={{ padding: space.lg }}>
            <Alert>{pw.error}</Alert>
            <Field label="Mot de passe actuel" value={pw.current} onChangeText={v => setPw(p => ({ ...p, current: v }))} secure autoComplete="current-password" />
            <Field label="Nouveau mot de passe" value={pw.next} onChangeText={v => setPw(p => ({ ...p, next: v }))} secure autoComplete="new-password" hint={`${PASSWORD_MIN} caractères minimum.`} />
            <Field label="Confirmez le nouveau mot de passe" value={pw.confirm} onChangeText={v => setPw(p => ({ ...p, confirm: v }))} secure autoComplete="new-password" />
            <Button label="Enregistrer" block loading={pw.busy} disabled={!pw.current || !pw.next || !pw.confirm} onPress={changePassword} />
          </View>
        )}
      </Card>

      <SectionHead title="Notifications" />
      <Card padded={false}>
        {prefs.data ? Object.entries(prefs.data.kinds).map(([k, label], i, all) => (
          <Row key={k} icon={Bell} title={label} last={i === all.length - 1}
            end={<AppSwitch value={prefs.data!.prefs[k] !== false} onValueChange={on => togglePref(k, on)} label={label} />} />
        )) : <View style={{ padding: space.lg }}><Txt variant="small">{prefs.error ? 'Réglages indisponibles pour le moment.' : 'Chargement…'}</Txt></View>}
      </Card>
      <Txt variant="tiny" style={{ marginTop: 6 }}>Les notifications ne montrent jamais le détail (montants, documents) : il reste dans votre espace.</Txt>

      <SectionHead title="Nous contacter" />
      <Card padded={false}>
        <Row icon={MessageCircle} iconTone="ok" title="WhatsApp" sub={contact.phone} end={<ChevronRight size={18} color={c.ink3} />} onPress={() => whatsapp(contact.whatsapp, `Bonjour SIIPAF, client ${client.client_code}.`)} />
        <Row icon={Phone} title="Appeler" sub={`${contact.phone} · bureau ${contact.phone2}`} end={<ChevronRight size={18} color={c.ink3} />} onPress={() => call(contact.phone)} />
        <Row icon={Mail} title="E-mail" sub={contact.email} end={<ChevronRight size={18} color={c.ink3} />} onPress={() => mail(contact.email, `Espace client ${client.client_code}`)} last />
      </Card>

      <View style={{ gap: space.sm, marginTop: space.xl }}>
        <Button label="Découvrir nos programmes" icon={Building} variant="ghost" block onPress={() => router.navigate('/')} />
        <Button label="Se déconnecter" icon={LogOut} variant="outline" block onPress={async () => { await logout(); router.replace('/espace'); }} />
      </View>
    </Screen>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  const { space } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.md }}>
      <Txt variant="small" style={{ width: 120 }}>{k}</Txt>
      <Txt variant="bodyStrong" style={{ flex: 1, fontSize: 14 }}>{v}</Txt>
    </View>
  );
}
