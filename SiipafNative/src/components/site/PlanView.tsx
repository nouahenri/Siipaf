/**
 * Plan de masse interactif (même données que plan-interactif.html) : image du plan, lots dessinés en couleurs de statut
 * (coordonnées 0–1 du dashboard), zoom à deux doigts, déplacement, double toucher pour zoomer, toucher d'un lot pour le choisir.
 */
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { View } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { G, Polygon, Text as SvgText } from 'react-native-svg';
import { apiUrl } from '@/lib/api';
import { LOT_COLORS } from '@/lib/domain';
import type { PlanLot, SitePlan } from '@/lib/types';
import { useTheme } from '@/theme';

const centroid = (s: [number, number][]) => s.reduce((a, p) => [a[0] + p[0] / s.length, a[1] + p[1] / s.length], [0, 0]);
const area = (s: [number, number][]) => Math.abs(s.reduce((a, p, i) => { const q = s[(i + 1) % s.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
/** Point dans un polygone (lancer de rayon). */
function inside(x: number, y: number, s: [number, number][]) {
  let ok = false;
  for (let i = 0, j = s.length - 1; i < s.length; j = i++) {
    const [xi, yi] = s[i]; const [xj, yj] = s[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
}

type Props = { plan: SitePlan; width: number; height: number; selectedId?: number | null; hidden: Record<string, boolean>; onSelect: (lot: PlanLot | null) => void };

export function PlanView({ plan, width, height, selectedId, hidden, onSelect }: Props) {
  const { c, fonts } = useTheme();
  const ratio = (plan.height || 1) / (plan.width || 1);
  // Le plan tient dans la zone, centré
  const W = Math.min(width, height / ratio);
  const H = W * ratio;
  const lots = useMemo(() => plan.lots.filter(l => Array.isArray(l.shape) && l.shape.length >= 3), [plan.lots]);

  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const pinch = usePinchGesture({
    onActivate: () => { 'worklet'; saved.value = scale.value; },
    onUpdate: e => { 'worklet'; scale.value = Math.max(1, Math.min(8, saved.value * e.scale)); },
    onDeactivate: () => { 'worklet'; if (scale.value <= 1.02) { scale.value = withTiming(1); tx.value = withTiming(0); ty.value = withTiming(0); } },
  });
  const pan = usePanGesture({
    minPointers: 1,
    onActivate: () => { 'worklet'; startX.value = tx.value; startY.value = ty.value; },
    onUpdate: e => {
      'worklet';
      const maxX = (W * scale.value - W) / 2 + 40;
      const maxY = (H * scale.value - H) / 2 + 40;
      tx.value = Math.max(-maxX, Math.min(maxX, startX.value + e.translationX));
      ty.value = Math.max(-maxY, Math.min(maxY, startY.value + e.translationY));
    },
  });
  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: () => { 'worklet'; const next = scale.value > 1.5 ? 1 : 2.5; scale.value = withTiming(next); if (next === 1) { tx.value = withTiming(0); ty.value = withTiming(0); } },
  });
  const tap = useTapGesture({
    runOnJS: true,
    maxDuration: 300,
    onActivate: e => {
      // Point touché → coordonnées 0–1 du plan (transformation inverse : déplacement puis zoom autour du centre)
      const s = scale.value;
      const lx = ((e.x - width / 2 - tx.value) / s + W / 2) / W;
      const ly = ((e.y - height / 2 - ty.value) / s + H / 2) / H;
      const hit = lots.find(l => !hidden[l.status] && inside(lx, ly, l.shape!));
      onSelect(hit || null);
    },
  });
  const gesture = useSimultaneousGestures(pinch, pan, doubleTap, tap);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }] }));
  const image = apiUrl(plan.image);

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceAlt }} accessibilityLabel={`Plan ${plan.name} : ${lots.length} lots`}>
        <Animated.View style={[{ width: W, height: H }, style]}>
          {image ? <Image source={{ uri: image }} style={{ position: 'absolute', width: W, height: H }} contentFit="fill" /> : null}
          <Svg width={W} height={H} style={{ position: 'absolute' }}>
            {lots.map(l => {
              if (hidden[l.status]) return null;
              const pts = l.shape!.map(([x, y]) => `${x * W},${y * H}`).join(' ');
              const [cx, cy] = centroid(l.shape!);
              const size = Math.max(5, Math.sqrt(area(l.shape!) * W * H) * 0.3);
              const sel = l.id === selectedId;
              return (
                <G key={l.id}>
                  <Polygon points={pts} fill={LOT_COLORS[l.status] || LOT_COLORS.bloque} fillOpacity={sel ? 0.95 : 0.62} stroke={sel ? '#fff' : 'rgba(255,255,255,0.8)'} strokeWidth={sel ? 2.5 : 0.8} />
                  <SvgText x={cx * W} y={cy * H + size * 0.35} fontSize={size} fontFamily={fonts.semibold} fill="#fff" textAnchor="middle">{l.code}</SvgText>
                </G>
              );
            })}
          </Svg>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
