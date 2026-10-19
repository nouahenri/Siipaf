import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Servi par le serveur Node sur client.siipaf.com (localhost:4000 en local) ; en dev, l'API tourne sur le port 4000
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
    },
  },
});
