import { Stack } from 'expo-router';
import { useTheme } from '@/theme';

export default function ProgrammesLayout() {
  const { c } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
