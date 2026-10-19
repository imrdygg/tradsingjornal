import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The standalone MES Indicator Level Tracker build.
 *
 * Separate from the journal and from the playbook so the zip carries one feature and a local
 * licence gate. `base` is relative so a buyer can serve the folder from any path.
 *
 * The HTML entry stays at the repository root so Tailwind 4's automatic source detection
 * still sees `src/`. The packaging script renames the emitted `mes-tracker.html`.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // This product has no media uploads at all; the flag keeps the build honest if one is
  // ever added by accident.
  define: { __CLOUD_MEDIA__: 'false' },
  base: './',
  build: {
    outDir: 'dist/mes-tracker',
    emptyOutDir: true,
    rollupOptions: {
      input: 'mes-tracker.html',
    },
  },
});
