/**
 * Formulaire prospect de l'application (même circuit que contact.html et le plan interactif du site) :
 * - message : POST /api/public/contact ;
 * - rendez-vous : POST /api/public/appointments (créneaux de 30 min, 8 h – 17 h 30 heure d'Abidjan, pas le dimanche) ;
 * - intérêt pour un lot : POST /api/public/interest ; pré-réservation d'un lot : POST /api/public/lots/:id/option.
 * Le serveur classe la demande « Application mobile » (en-tête X-Siipaf-App) et prévient l'équipe commerciale.
 * Paramètres : type (message | rdv | interet | option), projet (slug), bien, lot (id), lotCode, budget.
 */
import * as Haptics from '@/lib/haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Building, CalendarCheck, CircleCheck, MapPin, Phone, Send, Video, type LucideIcon } from 'lucide-react-native';
import { CountryField } from '@/components/ui/CountryField';
import { DateTimeField, toIsoDay } from '@/components/ui/DateTimeField';
import { Alert, Button, Chip, ChipRow, Field, Screen, Segmented, Txt } from '@/components/ui';
import { publicApi } from '@/lib/api';
import { APPOINTMENT_KINDS, FINANCING_LABELS } from '@/lib/domain';
import { useProjects } from '@/lib/queries';
import { usePrefs } from '@/providers/preferences';
import { useTheme } from '@/theme';

type Mode = 'message' | 'rdv' | 'interet' | 'option';
const KINDS: { key: keyof typeof APPOINTMENT_KINDS; icon: LucideIcon }[] = [
  { key: 'visite', icon: MapPin }, { key: 'appel', icon: Phone }, { key: 'bureau', icon: Building }, { key: 'visio', icon: Video },
];
const TITLES: Record<Mode, string> = { message: 'Nous écrire', rdv: 'Prendre rendez-vous', interet: 'Ce lot m’intéresse', option: 'Pré-réserver ce lot' };

/** Jours ouvrables proposés : de demain à 3 mois, sans les dimanches (bureaux fermés). */
function days() {
  const out: { iso: string; label: string; day: string }[] = [];
  for (let i = 1; i <= 92 && out.length < 40; i++) {
    const d = new Date(Date.now() + i * 864e5);
    if (d.getUTCDay() === 0) continue;
    out.push({
      iso: d.toISOString().slice(0, 10),
      day: d.toLocaleDateString('fr-FR', { weekday: 'short', timeZone: 'UTC' }).replace('.', ''),
      label: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    });
  }
  return out;
}

export default function Demande() {
  const params = useLocalSearchParams<{ type?: string; projet?: string; bien?: string; lot?: string; lotCode?: string; budget?: string }>();
  const lotId = Number(params.lot) || null;
  const initial: Mode = (['rdv', 'interet', 'option'].includes(String(params.type)) ? params.type : 'message') as Mode;
  const { c, space, radius, fonts } = useTheme();
  const { prefs, t } = usePrefs();
  const initialCountry = prefs.country && !/^C[ôo]te d.Ivoire$/i.test(prefs.country) && prefs.country !== 'Autre pays' ? prefs.country : '';
  const projects = useProjects();
  const dayList = useMemo(() => days(), []);
  const [minDay] = useState(() => new Date(Date.now() + 864e5));
  const [maxDay] = useState(() => new Date(Date.now() + 92 * 864e5));

  const [mode, setMode] = useState<Mode>(lotId ? initial : initial === 'rdv' ? 'rdv' : 'message');
  const [f, setF] = useState({
    name: '', phone: '', email: '', country: initialCountry, financing: '' as string, diaspora: !!initialCountry,
    project: String(params.projet || '').toLowerCase(), bien: String(params.bien || ''), budget: String(params.budget || ''),
    message: '', kind: 'visite', date: dayList[0]?.iso || '', time: '10:00',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string | boolean) => setF(x => ({ ...x, [k]: v }));
  const project = (projects.data || []).find(p => p.slug === f.project);

  // « Nous écrire » et « Rendez-vous » : tous les champs obligatoires (demande du client du 04/11) ;
  // intérêt et pré-réservation d'un lot : le nom et un moyen de contact suffisent
  const strict = mode === 'message' || mode === 'rdv';
  const req = (label: string) => (strict ? `${label} *` : label);
  const validate = () => {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2) e.name = t('Indiquez votre nom.');
    if (strict && !f.phone.trim()) e.phone = t('Indiquez votre téléphone.');
    else if (!strict && !f.phone.trim() && !f.email.trim()) e.phone = t('Indiquez un téléphone ou un e-mail.');
    if (f.phone.trim() && f.phone.replace(/\D/g, '').length < 8) e.phone = t('Numéro trop court.');
    if (strict && !f.email.trim()) e.email = t('Indiquez votre e-mail.');
    else if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = t('Adresse e-mail invalide.');
    if (strict && f.diaspora && f.country.trim().length < 2) e.country = t('Indiquez votre pays de résidence.');
    if (strict && f.message.trim().length < 5) e.message = t('Écrivez votre message (5 caractères au moins).');
    if (mode === 'rdv') {
      const d = new Date(`${f.date}T12:00:00Z`);
      if (Number.isNaN(d.getTime()) || f.date < toIsoDay(minDay) || f.date > toIsoDay(maxDay)) e.date = t('Choisissez une date entre demain et dans trois mois.');
      else if (d.getUTCDay() === 0) e.date = t('Nos bureaux sont fermés le dimanche : choisissez un autre jour.');
    }
    setErrors(e);
    return !Object.keys(e).length;
  };

  const submit = async () => {
    if (!validate()) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); return; }
    setBusy(true); setError(null);
    const who = {
      name: f.name.trim(), phone: f.phone.trim() || undefined, email: f.email.trim() || undefined, country: f.country.trim() || undefined,
      is_diaspora: f.diaspora || undefined, financing: f.financing || undefined,
    };
    const extra = [f.bien && `Type de bien : ${f.bien}`, f.budget && `Budget : ${f.budget}`].filter(Boolean).join('\n');
    try {
      if (mode === 'message') {
        await publicApi.post('/contact', {
          ...who, project: project?.slug, property_type: f.bien || undefined, subject: project ? undefined : 'Renseignement général',
          message: f.message.trim() + (f.budget ? `\n\nBudget : ${f.budget}` : ''),
        });
        setDone('Merci ! Votre message est bien arrivé à notre équipe. Un conseiller SIIPAF vous répond très prochainement.');
      } else if (mode === 'rdv') {
        await publicApi.post('/appointments', {
          ...who, kind: f.kind, starts_at: `${f.date}T${f.time}:00Z`, project_id: project?.id, lot_id: lotId || undefined,
          message: [extra, f.message.trim()].filter(Boolean).join('\n') || undefined,
        });
        const when = new Date(`${f.date}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
        setDone(`Merci ! Votre demande de rendez-vous du ${when} à ${f.time.replace(':', ' h ')} est enregistrée. Un conseiller vous recontacte pour la confirmer.`);
      } else if (mode === 'interet') {
        await publicApi.post('/interest', { ...who, lot_id: lotId || undefined, project_id: lotId ? undefined : project?.id, message: [extra, f.message.trim()].filter(Boolean).join('\n') || undefined });
        setDone(`Merci ! Votre intérêt${params.lotCode ? ` pour le lot ${params.lotCode}` : ''} est enregistré. Un conseiller SIIPAF vous contacte très prochainement.`);
      } else {
        const r = await publicApi.post<{ expires_at: string; days: number }>(`/lots/${lotId}/option`, { ...who, message: f.message.trim() || undefined });
        setDone(`Le lot ${params.lotCode || ''} vous est réservé pendant ${r.days} jours, jusqu’au ${new Date(r.expires_at).toLocaleDateString('fr-FR')}. Un conseiller vous contacte pour finaliser votre réservation.`);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      setError(e.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
    setBusy(false);
  };

  if (done) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('Demande envoyée') }} />
        <View style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.md }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: c.okSoft, alignItems: 'center', justifyContent: 'center' }}>
            {mode === 'rdv' ? <CalendarCheck size={38} color={c.ok} /> : <CircleCheck size={38} color={c.ok} />}
          </View>
          <Txt variant="h2" center>{t('C’est envoyé')}</Txt>
          <Txt center style={{ maxWidth: 340 }}>{done}</Txt>
        </View>
        <Button label={t('Retour')} variant="outline" block style={{ marginTop: space.xl }} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </Screen>
    );
  }

  return (
    <Screen footer={<Button label={{ message: 'Envoyer ma demande', rdv: 'Demander ce rendez-vous', interet: 'Envoyer mon intérêt', option: 'Pré-réserver ce lot' }[mode]} icon={mode === 'rdv' ? CalendarCheck : Send} block haptic loading={busy} onPress={submit} />}>
      <Stack.Screen options={{ title: TITLES[mode] }} />
      {lotId ? (
        <Segmented value={mode} onChange={v => setMode(v)} options={[['interet', t('Intérêt')], ['option', t('Pré-réserver')], ['rdv', t('Visite')]]} />
      ) : (
        <Segmented value={mode} onChange={v => setMode(v)} options={[['message', t('Message')], ['rdv', 'Rendez-vous']]} />
      )}
      <Txt variant="small" style={{ marginTop: space.md, marginBottom: space.lg }}>
        {mode === 'option'
          ? `Le lot ${params.lotCode || ''} est bloqué à votre nom pendant la durée d’option du programme. Un conseiller vous accompagne pour la réservation.`
          : mode === 'interet' ? 'Sans engagement : un conseiller vous rappelle pour vous présenter ce lot.'
          : mode === 'rdv' ? 'Choisissez un créneau (heure d’Abidjan). Un conseiller vous confirme le rendez-vous.'
          : t('Votre message arrive directement à l’équipe commerciale de SIIPAF.')}
      </Txt>
      <Alert>{error}</Alert>

      <Field label={req(t('Nom et prénom'))} value={f.name} onChangeText={set('name')} autoComplete="name" textContentType="name" returnKeyType="next" error={errors.name} />
      <Field label={req(t('Téléphone (WhatsApp de préférence)'))} value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="+225 07 00 00 00 00" error={errors.phone} />
      <Field label={req(t('E-mail'))} value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" error={errors.email} />

      <Pressable onPress={() => set('diaspora')(!f.diaspora)} accessibilityRole="checkbox" accessibilityState={{ checked: f.diaspora }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: space.lg, minHeight: 44 }}>
        <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: f.diaspora ? c.primary : c.line, backgroundColor: f.diaspora ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          {f.diaspora ? <CircleCheck size={16} color="#fff" /> : null}
        </View>
        <Txt style={{ flex: 1 }}>{t('J’habite hors de Côte d’Ivoire (diaspora)')}</Txt>
      </Pressable>
      {f.diaspora && <CountryField label={req(t('Pays de résidence'))} value={f.country} onChange={v => { set('country')(v); setErrors(e => ({ ...e, country: '' })); }} error={errors.country} />}

      {!lotId && (
        <View style={{ marginBottom: space.lg }}>
          <Txt variant="label" style={{ marginBottom: 6 }}>{t('Programme')}</Txt>
          <ChipRow>
            <Chip label={t('Je ne sais pas encore')} selected={!f.project} onPress={() => set('project')('')} />
            {(projects.data || []).map(p => <Chip key={p.slug} label={p.name} selected={f.project === p.slug} onPress={() => set('project')(p.slug)} />)}
          </ChipRow>
          {project?.property_types?.length ? (
            <View style={{ marginTop: space.md }}>
              <Txt variant="label" style={{ marginBottom: 6 }}>{t('Type de bien')}</Txt>
              <ChipRow>{project.property_types.map(tp => <Chip key={tp} label={tp} selected={f.bien === tp} onPress={() => set('bien')(f.bien === tp ? '' : tp)} />)}</ChipRow>
            </View>
          ) : null}
        </View>
      )}

      {mode === 'rdv' && (
        <View style={{ marginBottom: space.lg, gap: space.lg }}>
          <View>
            <Txt variant="label" style={{ marginBottom: 6 }}>{t('Type de rendez-vous')}</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityRole="radiogroup">
              {KINDS.map(({ key, icon: Icon }) => {
                const on = f.kind === key;
                return (
                  <Pressable key={key} onPress={() => { Haptics.selectionAsync().catch(() => {}); set('kind')(key); }} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={t(APPOINTMENT_KINDS[key])}
                    style={({ pressed }) => ({ flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 12, borderRadius: radius.lg, borderWidth: 1.5,
                      borderColor: on ? c.primary : c.line, backgroundColor: on ? c.dangerSoft : c.surface, opacity: pressed ? 0.85 : 1 })}>
                    <Icon size={20} color={on ? c.primary : c.ink2} />
                    <Txt style={{ flex: 1, fontFamily: on ? fonts.semibold : fonts.medium, fontSize: 14, color: c.ink }} numberOfLines={2}>{t(APPOINTMENT_KINDS[key])}</Txt>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1.4 }}>
              <DateTimeField mode="date" label={req(t('Date'))} value={f.date} minimumDate={minDay} maximumDate={maxDay} error={errors.date}
                onChange={v => { set('date')(v); setErrors(e => ({ ...e, date: '' })); }} />
            </View>
            <View style={{ flex: 1 }}>
              <DateTimeField mode="time" label={req(t('Heure'))} value={f.time} minTime="08:00" maxTime="17:30" minuteInterval={30} onChange={set('time')} />
            </View>
          </View>
          <Txt variant="tiny">{t('Du lundi au samedi, de 8 h à 17 h 30 (heure d’Abidjan). Un conseiller vous confirme le rendez-vous.')}</Txt>
        </View>
      )}

      {mode === 'interet' && ( // retiré de « Nous écrire » et des rendez-vous (demandes du client du 04/11)
        <View style={{ marginBottom: space.lg }}>
          <Txt variant="label" style={{ marginBottom: 6 }}>{t('Mode de financement envisagé (facultatif)')}</Txt>
          <ChipRow>{Object.entries(FINANCING_LABELS).map(([k, l]) => <Chip key={k} label={l} selected={f.financing === k} onPress={() => set('financing')(f.financing === k ? '' : k)} />)}</ChipRow>
        </View>
      )}

      <Field label={strict ? req(t('Votre message')) : t('Précisions (facultatif)')} value={f.message} onChangeText={set('message')} multiline maxLength={2000}
        placeholder={mode === 'message' ? t('Votre projet, vos questions, le meilleur moment pour vous appeler…') : t('Questions, disponibilités…')} error={errors.message} />
      <Txt variant="tiny" style={{ marginTop: -space.sm }}>{strict ? `${t('* Champs obligatoires')} · ` : ''}{t('Vos coordonnées servent uniquement à vous recontacter au sujet de votre demande.')}</Txt>
    </Screen>
  );
}
