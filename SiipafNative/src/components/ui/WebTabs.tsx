/**
 * Barre d'onglets de l'aperçu web (mise au point uniquement) : dessinée en bas comme sur téléphone. Les téléphones
 * utilisent la barre native des fichiers _layout.tsx.
 */
import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { forwardRef } from 'react';
import { Pressable, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Txt } from './Text';

type Props = TabTriggerSlotProps & { icon: LucideIcon; label: string; badge?: number };

const TabButton = forwardRef<any, Props>(({ icon: Icon, label, badge, isFocused, ...props }, ref) => {
  const { c, fonts } = useTheme();
  return (
    <Pressable ref={ref} {...props} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <View style={{ width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: isFocused ? c.dangerSoft : 'transparent' }}>
        <Icon size={21} color={isFocused ? c.primary : c.ink3} />
        {badge ? <View style={{ position: 'absolute', top: 0, right: 10, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}><Txt style={{ color: '#fff', fontSize: 9.5, fontFamily: fonts.bold }}>{badge > 9 ? '9+' : badge}</Txt></View> : null}
      </View>
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 11, color: isFocused ? c.primary : c.ink3 }}>{label}</Txt>
    </Pressable>
  );
});
TabButton.displayName = 'TabButton';

export function WebTabs({ tabs }: { tabs: { name: string; href: string; icon: LucideIcon; label: string; badge?: number }[] }) {
  const { c } = useTheme();
  return (
    <Tabs>
      <TabSlot style={{ flex: 1 }} />
      <TabList style={{ flexDirection: 'row', backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 6, paddingBottom: 10 }}>
        {tabs.map(t => (
          <TabTrigger key={t.name} name={t.name} href={t.href as never} asChild>
            <TabButton icon={t.icon} label={t.label} badge={t.badge} />
          </TabTrigger>
        ))}
      </TabList>
    </Tabs>
  );
}
