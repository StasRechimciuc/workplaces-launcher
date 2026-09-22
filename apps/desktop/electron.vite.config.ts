import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [
      // @workspace-launcher/shared ships as raw TypeScript source (no
      // build step — see packages/shared/package.json), so it must be
      // bundled in, not left as an externalized `require(...)` that
      // Node can't execute at runtime.
      externalizeDepsPlugin({ exclude: ['@workspace-launcher/shared'] }),
    ],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@workspace-launcher/shared'] })],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    server: {
      port: 58217,
      strictPort: true,
    },
  },
});
