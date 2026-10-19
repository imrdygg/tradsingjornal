import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The standalone Chart Pattern Playbook build.
 *
 * Kept separate from `vite.config.ts` on purpose: this entry renders one feature with a
 * local licence gate, so the zip can be served from any static host or subfolder. `base`
 * is relative for exactly that reason — a buyer can drop the folder anywhere.
 *
 * The HTML entry stays at the repository root so Tailwind 4's automatic source detection
 * still sees `src/`. The packaging script renames the emitted `chart-patterns.html` to
 * `index.html`.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // No cloud client in this product: a pattern screenshot is kept inline.
  define: { __CLOUD_MEDIA__: 'false' },
  base: './',
  build: {
    outDir: 'dist/chart-patterns',
    emptyOutDir: true,
    rollupOptions: {
      input: 'chart-patterns.html',
    },
  },
});
