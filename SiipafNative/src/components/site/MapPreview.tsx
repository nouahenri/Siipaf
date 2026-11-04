/**
 * Aperçu de carte de la fiche programme : tuiles OpenStreetMap assemblées autour de la position du site (sans WebView,
 * mises en cache par expo-image), repère au centre. La carte interactive s'ouvre au toucher (écran /carte).
 */
import { Image } from 'expo-image';
import React, { useState } from 'react';
import { View } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { Txt } from '@/components/ui';
import { useTheme } from '@/theme';

const TILE = 256;
const Z = 15;

/** Position en pixels dans le monde Web Mercator au zoom Z. */
function worldPx(lat: number, lng: number) {
  const n = TILE * 2 ** Z;
  const r = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
}

export function MapPreview({ lat, lng, height = 132 }: { lat: number; lng: number; height?: number }) {
  const { c, isDark } = useTheme();
  const [w, setW] = useState(0);
  const p = worldPx(lat, lng);
  const left = p.x - w / 2, top = p.y - height / 2;
  const tiles: { x: number; y: number }[] = [];
  if (w) for (let x = Math.floor(left / TILE); x <= Math.floor((left + w) / TILE); x++) for (let y = Math.floor(top / TILE); y <= Math.floor((top + height) / TILE); y++) tiles.push({ x, y });
  return (
    <View onLayout={e => setW(Math.round(e.nativeEvent.layout.width))} style={{ height, overflow: 'hidden', backgroundColor: c.surfaceAlt }} importantForAccessibility="no-hide-descendants">
      {tiles.map(t => (
        <Image key={`${t.x}-${t.y}`} source={{ uri: `https://tile.openstreetmap.org/${Z}/${t.x}/${t.y}.png` }} cachePolicy="disk" transition={150}
          style={{ position: 'absolute', left: t.x * TILE - left, top: t.y * TILE - top, width: TILE, height: TILE, opacity: isDark ? 0.75 : 1 }} />
      ))}
      <View style={{ position: 'absolute', left: w / 2 - 17, top: height / 2 - 34 }}>
        <MapPin size={34} color="#fff" fill={c.primary} strokeWidth={1.6} />
      </View>
      <View style={{ position: 'absolute', right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.8)', paddingHorizontal: 5, paddingVertical: 1, borderTopLeftRadius: 6 }}>
        <Txt style={{ fontSize: 10, color: '#333' }}>© OpenStreetMap</Txt>
      </View>
    </View>
  );
}
