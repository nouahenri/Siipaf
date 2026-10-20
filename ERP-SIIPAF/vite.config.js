import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ERP SIIPAF, servi par le serveur Node sur erp.siipaf.com (erp.localhost:4000 en local).
// Il réutilise les briques du dashboard (appels API, session, composants, styles) via l'alias « @admin ».
const adminSrc = fileURLToPath(new URL('../admin/src', import.meta.url));

export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: { '@admin': adminSrc },
    // Une seule copie de React, même pour les fichiers importés depuis ../admin
    dedupe: ['react', 'react-dom', 'react-router-dom', 'lucide-react'],
  },
  server: {
    port: 5174,
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
    },
  },
});
