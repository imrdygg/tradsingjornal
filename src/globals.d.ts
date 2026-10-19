/**
 * Build-time switch for cloud media uploads.
 *
 * `true` in the journal (screenshots and clips go to Supabase Storage); `false` in the
 * standalone Chart Pattern Playbook, where a screenshot is kept inline and the whole
 * cloud client is compiled out of the bundle. Set by `vite.config.ts` and
 * `vite.chart-patterns.config.ts`; declared here so TypeScript can name it.
 */
declare const __CLOUD_MEDIA__: boolean;
