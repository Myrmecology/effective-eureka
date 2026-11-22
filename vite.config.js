/**
 * Effective Eureka - Vite configuration (Vite 8)
 * https://vite.dev/config/
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

export default defineConfig(({ mode }) => ({
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
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',

    // Don't ship readable source code in production builds.
    sourcemap: mode === 'development',

    // Babylon.js is a large 3D engine, so raise the warning limit (in kB).
    chunkSizeWarningLimit: 2500,

    // Vite 8 uses Rolldown (this replaces the old `rollupOptions`).
    rolldownOptions: {
      output: {
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
}));