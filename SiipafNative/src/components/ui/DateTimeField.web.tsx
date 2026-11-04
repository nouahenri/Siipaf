/** Aperçu web (mise au point) : champs date et heure du navigateur, même interface que la version native. */
import { createElement } from 'react';
import { View } from 'react-native';
import { CalendarDays, Clock } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Txt } from './Text';
import type { DateTimeFieldProps } from './DateTimeField';

export type { DateTimeFieldProps };
const pad = (n: number) => String(n).padStart(2, '0');
export const toIsoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function DateTimeField({ mode, label, value, onChange, minimumDate, maximumDate, minTime, maxTime, minuteInterval = 30, error }: DateTimeFieldProps) {
  const { c, radius, fonts } = useTheme();
  const Icon = mode === 'date' ? CalendarDays : Clock;
  return (
    <View style={{ flex: 1 }}>
      <Txt variant="label" style={{ marginBottom: 6 }}>{label}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: error ? c.danger : c.line, backgroundColor: c.surface }}>
        <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: c.dangerSoft, alignItems: 'center', justifyContent: 'center' }}><Icon size={18} color={c.primary} /></View>
        {createElement('input', {
          type: mode, value, 'aria-label': label,
          min: mode === 'date' ? (minimumDate ? toIsoDay(minimumDate) : undefined) : minTime,
          max: mode === 'date' ? (maximumDate ? toIsoDay(maximumDate) : undefined) : maxTime,
          step: mode === 'time' ? minuteInterval * 60 : undefined,
          onChange: (e: { target: { value: string } }) => e.target.value && onChange(e.target.value),
          style: { flex: 1, border: 'none', outline: 'none', background: 'transparent', color: c.ink, fontFamily: fonts.semibold, fontSize: 15, colorScheme: 'light dark' },
        })}
      </View>
      {error ? <Txt variant="small" style={{ color: c.danger, marginTop: 4 }}>{error}</Txt> : null}
    </View>
  );
}
