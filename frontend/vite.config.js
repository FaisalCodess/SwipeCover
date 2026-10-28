import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The frontend always calls `/api`. In development Vite forwards it to the
// Python server; in production the Python server hosts the built files itself.
const apiTarget = process.env.GAME_API_PROXY || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: { '/api': apiTarget },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    proxy: { '/api': apiTarget },
  },
});
