/**
 * Effective Eureka - Vite configuration (Vite 8)
 * https://vite.dev/config/
 *
 * Modes:
 *  - development / production: the normal dev server and `npm run build`
 *  - standalone: used only by `npm run build:standalone`, which packs the
 *    whole game into a single HTML file you can double-click (USB friendly)
 */
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// Basic security headers for the local dev and preview servers.
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** Temporary output for the standalone build (inside the git-ignored build/ folder). */
export const STANDALONE_TEMP_DIR = 'build/.standalone-tmp';

export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';

  return {
    // Use relative paths so the build works on any static host
    // (Netlify, GitHub Pages subfolders, etc.).
    base: './',

    // Static files copied as-is into the build (favicons, icons).
    publicDir: 'public',

    resolve: {
      alias: {
        // Lets us write:  import { x } from '@/core/engine.js'
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },

    server: {
      port: 5173,
      strictPort: false, // Use the next free port if 5173 is busy
      host: 'localhost', // Only reachable from your own machine
      open: true, // Open the browser automatically on `npm run dev`
      headers: securityHeaders,
    },

    preview: {
      port: 4173,
      strictPort: false,
      host: 'localhost',
      open: true,
      headers: securityHeaders,
    },

    build: {
      outDir: standalone ? STANDALONE_TEMP_DIR : 'dist',
      emptyOutDir: true,
      assetsDir: 'assets',

      // Don't ship readable source code in production builds.
      sourcemap: mode === 'development',

      // Babylon.js is a large 3D engine, so raise the warning limit (in kB).
      // The standalone build is one big file on purpose.
      chunkSizeWarningLimit: standalone ? 20000 : 2500,

      // Standalone: one CSS file, assets inlined, no preload helpers,
      // because everything gets packed into a single HTML file.
      cssCodeSplit: !standalone,
      assetsInlineLimit: standalone ? Number.MAX_SAFE_INTEGER : 4096,
      ...(standalone ? { modulePreload: false } : {}),

      // Vite 8 uses Rolldown (this replaces the old `rollupOptions`).
      rolldownOptions: {
        output: standalone
          ? {
              // Put ALL code (including Babylon's lazily loaded shaders)
              // into one JavaScript file.
              codeSplitting: false,
            }
          : {
              // Put Babylon in its own chunk so browsers can cache it separately
              // from our game code, which changes more often.
              codeSplitting: {
                groups: [
                  {
                    name: 'babylon',
                    test: /node_modules[\\/]@babylonjs/,
                  },
                ],
              },
            },
      },
    },
  };
});