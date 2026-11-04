/** Carte OpenStreetMap dans l'application (WebView). Le site SIIPAF sert d'origine : les tuiles OSM exigent un référent. */
import React from 'react';
import { WebView } from 'react-native-webview';
import { SITE_URL } from '@/config';
import { osmHtml } from './osmHtml';

export function OsmMap({ lat, lng, color, dark, zoom, style }: { lat: number; lng: number; color: string; dark?: boolean; zoom?: number; style?: object }) {
  return (
    <WebView source={{ html: osmHtml({ lat, lng, color, dark, zoom }), baseUrl: SITE_URL }} originWhitelist={['*']} style={[{ flex: 1, backgroundColor: 'transparent' }, style]}
      scrollEnabled={false} overScrollMode="never" setBuiltInZoomControls={false} javaScriptEnabled />
  );
}
