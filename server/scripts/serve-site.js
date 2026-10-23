/**
 * Petit serveur statique pour prévisualiser le site public en local : node server/scripts/serve-site.js <dossier du site> (port 8765, ou PORT).
 * SIIPAF_API=http://localhost:4003 : les pages appellent cette API (démo sur un autre port) au lieu de localhost:4000.
 */
const http=require('http'),fs=require('fs'),path=require('path');
const root=process.argv[2]||process.cwd();
const api=process.env.SIIPAF_API;
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(root,p);
fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);return r.end('404')}
if(api&&f.endsWith('.html'))d=d.toString('utf8').replace('<head>','<head><script>window.SIIPAF_API='+JSON.stringify(api)+'</script>');
r.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});r.end(d)})}).listen(Number(process.env.PORT)||8765);
