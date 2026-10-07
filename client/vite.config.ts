import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API_URL permite apuntar a otra API (p. ej. una base de datos de pruebas)
const API = process.env.API_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT ?? 5173),
    proxy: {
      '/api': API,
      '/uploads': API,
    },
  },
});
