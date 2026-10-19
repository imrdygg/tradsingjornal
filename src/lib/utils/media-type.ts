/**
 * Pure attachment classification, with no cloud client behind it.
 *
 * These predicates used to live in `lib/media/media-utils.ts`, next to the Supabase upload
 * functions. Every screen that only needed to *draw* a video imported that module and, with
 * it, `@supabase/supabase-js` — which is exactly the dependency the standalone Chart Pattern
 * Playbook must not carry. The upload functions stay in `media-utils`; what a file is stays
 * here.
 */

/** Longest clip the journal accepts — "quick 30 sec / 1 min" recordings. */
export const MAX_VIDEO_SECONDS = 90;

/** True when the attachment is a video rather than a still image. */
export function isVideoUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (url.startsWith('data:video/')) return true;
  // Uploaded clips keep their extension in the public Storage URL.
  return /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|#|$)/i.test(url);
}

/**
 * True when a URL is an image held inline rather than uploaded.
 *
 * This is the test the media migration is built on: anything it reports true for is weight
 * the browser is carrying, and moving it to the bucket is what frees the space.
 */
export function isInlineImage(url: string | undefined | null): boolean {
  return !!url && url.startsWith('data:image/');
}

/** True when a URL is a video held inline. Should never occur, but is counted. */
export function isInlineVideo(url: string | undefined | null): boolean {
  return !!url && url.startsWith('data:video/');
}
