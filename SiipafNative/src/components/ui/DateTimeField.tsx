/**
 * Champ date ou heure avec le sélecteur natif du téléphone (calendrier / roue iOS, boîte de dialogue Android).
 * Sur iOS le sélecteur s'ouvre dans une feuille avec « Valider » ; sur Android la boîte de dialogue suffit.
 * `value` : « AAAA-MM-JJ » (date) ou « HH:MM » (heure) ; bornes et pas de 30 minutes réglables.
 */
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { CalendarDays, ChevronDown, Clock } from 'lucide-react-native';
import { LOCALES } from '@/lib/i18n';
import { usePrefs } from '@/providers/preferences';
import { useTheme } from '@/theme';
import { Button } from './index';
import { BottomSheet } from './Select';
import { Txt } from './Text';

export type DateTimeFieldProps = {
  mode: 'date' | 'time';
  label: string;
  value: string;
  onChange: (v: string) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  /** Heures permises (« 08:00 » – « 17:30 ») et pas en minutes, pour le mode heure. */
  minTime?: string;
  maxTime?: string;
  minuteInterval?: 30 | 15;
  error?: string | null;
};

const pad = (n: number) => String(n).padStart(2, '0');
export const toIsoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromValue = (mode: 'date' | 'time', v: string) => {
  if (mode === 'date') { const [y, m, d] = v.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1, 12); }
  const [h, mi] = v.split(':').map(Number); const d = new Date(); d.setHours(h || 10, mi || 0, 0, 0); return d;
};
const clampTime = (d: Date, step: number, min?: string, max?: string) => {
  let mins = Math.round((d.getHours() * 60 + d.getMinutes()) / step) * step;
  const toMin = (s?: string) => (s ? Number(s.split(':')[0]) * 60 + Number(s.split(':')[1]) : null);
  const lo = toMin(min); const hi = toMin(max);
  if (lo != null) mins = Math.max(lo, mins);
  if (hi != null) mins = Math.min(hi, mins);
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
};

export function DateTimeField({ mode, label, value, onChange, minimumDate, maximumDate, minTime, maxTime, minuteInterval = 30, error }: DateTimeFieldProps) {
  const { c, space, radius, fonts, isDark } = useTheme();
  const { prefs, t } = usePrefs();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(() => fromValue(mode, value));
  const locale = LOCALES[prefs.language];
  const shown = mode === 'date'
    ? fromValue('date', value).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : value.replace(':', ' h ');

  const commit = (d: Date) => onChange(mode === 'date' ? toIsoDay(d) : clampTime(d, minuteInterval, minTime, maxTime));
  const openPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: fromValue(mode, value), mode, is24Hour: true, minimumDate, maximumDate,
        onChange: (e: DateTimePickerEvent, d?: Date) => { if (e.type === 'set' && d) commit(d); },
      });
      return;
    }
    setDraft(fromValue(mode, value));
    setOpen(true);
  };
  const Icon = mode === 'date' ? CalendarDays : Clock;

  return (
    <View style={{ flex: 1 }}>
      <Txt variant="label" style={{ marginBottom: 6 }}>{label}</Txt>
      <Pressable onPress={openPicker} accessibilityRole="button" accessibilityLabel={`${label} : ${shown}`} accessibilityHint={error || t('Toucher pour changer')}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1.5,
          borderColor: error ? c.danger : c.line, backgroundColor: c.surface, opacity: pressed ? 0.85 : 1 })}>
        <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: c.dangerSoft, alignItems: 'center', justifyContent: 'center' }}><Icon size={18} color={c.primary} /></View>
        <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: c.ink, textTransform: mode === 'date' ? 'capitalize' : 'none' }} numberOfLines={1}>{shown}</Txt>
        <ChevronDown size={18} color={c.ink3} />
      </Pressable>
      {error ? <Txt variant="small" style={{ color: c.danger, marginTop: 4 }}>{error}</Txt> : null}

      {Platform.OS === 'ios' && (
        <BottomSheet visible={open} title={label} onClose={() => setOpen(false)}>
          <View style={{ alignItems: 'center' }}>
            <DateTimePicker value={draft} mode={mode} display={mode === 'date' ? 'inline' : 'spinner'} locale={locale} minimumDate={minimumDate} maximumDate={maximumDate}
              minuteInterval={minuteInterval} accentColor={c.primary} themeVariant={isDark ? 'dark' : 'light'} onChange={(_, d) => d && setDraft(d)} />
          </View>
          <Button label={t('Valider')} block style={{ marginTop: space.md }} onPress={() => { commit(draft); setOpen(false); }} />
        </BottomSheet>
      )}
    </View>
  );
}
