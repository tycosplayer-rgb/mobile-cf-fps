import { defineConfig } from 'vite';

export default defineConfig({
  // Project Pages URL: https://tycosplayer-rgb.github.io/mobile-cf-fps/
  base: '/mobile-cf-fps/',
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
