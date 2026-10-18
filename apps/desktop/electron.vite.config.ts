import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // Loads apps/desktop/.env (gitignored — see .env.example for the
  // documented keys) into this CLI process's own process.env, which the
  // spawned Electron process then inherits (electron-vite's own
  // startElectron() spawns it with no `env` override, so Node's default
  // child-inherits-parent-env applies). An empty prefix filter loads
  // every key, not just electron-vite's default VITE_-prefixed ones —
  // this is for real main-process secrets like SPOTIFY_CLIENT_ID
  // (main/spotify/auth.ts's process.env.SPOTIFY_CLIENT_ID lookup), not
  // values baked into the bundled renderer via import.meta.env.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  return {
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
  };
});
