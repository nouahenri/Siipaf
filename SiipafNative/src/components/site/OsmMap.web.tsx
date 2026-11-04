/** Aperçu web : même carte OpenStreetMap, dans une iframe. */
import React from 'react';
import { osmHtml } from './osmHtml';

export function OsmMap({ lat, lng, color, dark, zoom }: { lat: number; lng: number; color: string; dark?: boolean; zoom?: number; style?: object }) {
  return <iframe title="Carte OpenStreetMap" srcDoc={osmHtml({ lat, lng, color, dark, zoom })} style={{ border: 0, width: '100%', height: '100%', display: 'block' }} />;
}
