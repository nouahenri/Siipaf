/** Message bref en bas d'écran après une action (« Demande envoyée »), avec retour haptique. */
import * as Haptics from '@/lib/haptics';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleCheck, CircleAlert } from 'lucide-react-native';
import { Txt } from '@/components/ui/Text';
import { useTheme } from '@/theme';

type Toast = { text: string; tone: 'ok' | 'error' };
const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const { c, radius, space } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<Toast | null>(null);
  const [anim] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    Haptics.notificationAsync(tone === 'ok' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
    setToast({ text, tone });
    AccessibilityInfo.announceForAccessibility(text);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true }).start();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setToast(null));
    }, 4500);
  }, [anim]);

  const Icon = toast?.tone === 'error' ? CircleAlert : CircleCheck;
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <Animated.View pointerEvents="none" accessibilityLiveRegion="polite"
          style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: insets.bottom + 96, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.dark, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 16 }}>
            <Icon size={20} color={toast.tone === 'error' ? '#FF8A8F' : '#6EE7A8'} />
            <Txt style={{ color: '#fff', flex: 1, fontSize: 15 }}>{toast.text}</Txt>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
