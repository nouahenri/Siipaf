/**
 * Page Leaflet affichée dans la carte du programme : fond OpenStreetMap et repère SIIPAF sur la position du site.
 * Partagée par la WebView (téléphone) et l'iframe (aperçu web).
 */
export function osmHtml({ lat, lng, color, dark, zoom = 16 }: { lat: number; lng: number; color: string; dark?: boolean; zoom?: number }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
html,body,#m{height:100%;margin:0;background:${dark ? '#1b1b1f' : '#eef0f3'}}
${dark ? '.leaflet-tile-pane{filter:brightness(.72) invert(1) contrast(.9) hue-rotate(200deg) saturate(.35)}' : ''}
.leaflet-control-attribution{font:10px sans-serif;border-radius:8px 0 0 0}
.pin{position:relative;width:44px;height:56px}
.pin:before{content:'';position:absolute;left:4px;top:0;width:36px;height:36px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);box-shadow:0 6px 14px rgba(0,0,0,.3)}
.pin:after{content:'';position:absolute;left:15px;top:11px;width:14px;height:14px;border-radius:50%;background:#fff}
.halo{position:absolute;left:12px;top:44px;width:20px;height:8px;border-radius:50%;background:rgba(0,0,0,.25)}
</style></head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var p=[${lat},${lng}];
var map=L.map('m',{zoomControl:false}).setView(p,${zoom});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
L.marker(p,{icon:L.divIcon({className:'',html:'<div class="pin"><div class="halo"></div></div>',iconSize:[44,56],iconAnchor:[22,50]})}).addTo(map);
</script></body></html>`;
}
