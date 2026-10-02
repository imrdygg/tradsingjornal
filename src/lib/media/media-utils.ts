/**
 * Helpers for attaching chart media to trades and playbook setups.
 *
 * Images are compressed client-side, then stored the same way videos are: uploaded to the
 * Supabase Storage bucket below and referenced by their public URL. They used to live inline
 * as base64 data URLs, which is what eventually filled a browser's ~5 MB localStorage and
 * silently stopped every later save. Inline storage is still the fallback when there is no
 * signed-in account to upload to, and the `isInlineImage`/`isInlineVideo` helpers below are
 * what tells the two apart when reading a journal written either way.
 */
import { supabase } from '../supabase';
import type { StorageState } from '../storage';

/** Public-read Storage bucket that holds uploaded trade/playbook videos. */
export const MEDIA_BUCKET = 'journal-media';

/** Longest clip we accept — "quick 30 sec / 1 min" recordings. */
export const MAX_VIDEO_SECONDS = 90;

/** Hard size cap so a phone recording never blows up the upload. */
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

/** True when the attachment is a video rather than a still image. */
export function isVideoUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (url.startsWith('data:video/')) return true;
  // Uploaded clips keep their extension in the public Storage URL.
  return /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|#|$)/i.test(url);
}

/**
 * True when a URL is an image held inline in the journal rather than uploaded.
 *
 * This is the test the migration is built on: anything it reports true for is weight the
 * browser is carrying, and moving it to the bucket is what frees the space. Deliberately
 * separate from `isVideoUrl` so a clip can never be mistaken for a screenshot.
 */
export function isInlineImage(url: string | undefined | null): boolean {
  return !!url && url.startsWith('data:image/');
}

/** True when a URL is a video held inline in the journal. Should never occur, but is counted. */
export function isInlineVideo(url: string | undefined | null): boolean {
  return !!url && url.startsWith('data:video/');
}

/** The characters a base64 data URL actually carries, for weighing what a move would free. */
export function inlineDataChars(urls: (string | undefined | null)[]): number {
  let total = 0;
  for (const url of urls) {
    if (url && url.startsWith('data:')) total += url.length;
  }
  return total;
}

/** The image format and extension a data URL carries, defaulting to JPEG when unclear. */
function imageFormatOf(dataUrl: string): { mime: string; extension: string } {
  const match = /^data:(image\/[a-z0-9.+-]+);/i.exec(dataUrl);
  const mime = match ? match[1].toLowerCase() : 'image/jpeg';
  const extension = mime.includes('png')
    ? 'png'
    : mime.includes('webp')
    ? 'webp'
    : mime.includes('gif')
    ? 'gif'
    : 'jpg';
  // `image/jpg` is not a registered type, so it is normalised on the way out.
  return { mime: mime === 'image/jpg' ? 'image/jpeg' : mime, extension };
}

/**
 * Uploads a compressed screenshot (a data URL) to the trader's folder and returns its URL.
 *
 * Split out from `uploadMediaFile` because a screenshot arrives as a data URL rather than a
 * File, and because both the attach path and the storage migration need exactly this: take
 * the bytes, put them in the bucket, hand back the address to store instead. Throws when
 * there is nobody to upload as, which is what keeps an unconfigured journal on the inline
 * path instead of losing the picture.
 */
export async function uploadImageDataUrl(dataUrl: string): Promise<string> {
  if (!supabase) {
    throw new Error('Image uploads need cloud storage. Add your Supabase credentials.');
  }
  if (!isInlineImage(dataUrl)) {
    throw new Error('That is not an inline image to upload.');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Sign in first — screenshots are saved to your cloud media folder.');
  }

  const { mime, extension } = imageFormatOf(dataUrl);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${user.id}/${unique}.${extension}`;

  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, new Blob([bytes], { type: mime }), {
      contentType: mime,
      cacheControl: '3600',
      upsert: false,
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Whether there is a signed-in account this journal can upload screenshots to. */
export async function canUploadMedia(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return !!user;
  } catch {
    return false;
  }
}

/**
 * Moves every inline image in one journal snapshot to the bucket, returning a new snapshot.
 *
 * Pure with respect to storage — it takes a state and an uploader and hands back the state it
 * would become — so the caller decides when to write and the function is testable without a
 * bucket. Each record is replaced wholesale rather than mutated, and the returned counters
 * describe what actually moved, so a partial failure is reported as one rather than as success.
 *
 * `movedAt` is stamped on each record that changed, which is what makes the move safe to run
 * again: a record already migrated carries a marker and is left alone, so a journal written by
 * a second device cannot quietly be overwritten with stale URLs.
 */
export interface MediaMigrationCounts {
  /** Inline images that were uploaded and replaced with their URL. */
  moved: number;
  /** Records changed at all. */
  records: number;
  /** Records that had inline images but could not be migrated. */
  failed: number;
  /** Characters of inline base64 still held after the run. */
  remainingChars: number;
  /** Characters of inline base64 that were freed by the run. */
  freedChars: number;
}

export type MediaUploader = (dataUrl: string) => Promise<string>;

/**
 * Replaces every inline image on one record's media list.
 *
 * A record with nothing to move is returned untouched — the same object, not a copy — so the
 * caller can tell by identity whether anything changed without comparing JSON.
 */
async function migrateMediaList(
  media: string[] | undefined,
  upload: MediaUploader
): Promise<{ media: string[] | undefined; moved: number; failed: number; freed: number }> {
  if (!media || media.length === 0) return { media, moved: 0, failed: 0, freed: 0 };

  let moved = 0;
  let failed = 0;
  let freed = 0;
  const next: string[] = [];

  for (const item of media) {
    if (!isInlineImage(item)) {
      next.push(item);
      continue;
    }
    try {
      const url = await upload(item);
      next.push(url);
      moved += 1;
      freed += item.length;
    } catch {
      // The picture stays inline rather than being dropped: a failed move must never cost
      // the trader their screenshot, only the space it was meant to free.
      next.push(item);
      failed += 1;
    }
  }

  return { media: next, moved, failed, freed };
}

/**
 * Moves the screenshots in a whole journal out of localStorage and into the media bucket.
 *
 * Covers every place this app stores a picture: trade charts, review screenshots, pattern-study
 * examples, lesson media and the saved picture-search thumbnails. The caller passes the state it
 * holds and gets back the state to write, plus what happened, so the write itself — and the
 * cloud save that follows it — stays in the app's hands.
 */
export async function migrateJournalMedia(
  state: StorageState,
  upload: MediaUploader,
  now: string
): Promise<{ state: StorageState; counts: MediaMigrationCounts }> {
  const counts: MediaMigrationCounts = {
    moved: 0,
    records: 0,
    failed: 0,
    remainingChars: 0,
    freedChars: 0,
  };

  /** Applies one record's outcome to the running totals. */
  const tally = (result: { moved: number; failed: number; freed: number }) => {
    counts.moved += result.moved;
    counts.failed += result.failed;
    counts.freedChars += result.freed;
    if (result.moved > 0) counts.records += 1;
  };

  const trades: typeof state.trades = [];
  for (const trade of state.trades) {
    // Already migrated by another device: leave it alone rather than overwriting its URLs.
    if (trade.movedAt || !(trade.images ?? []).some(isInlineImage)) {
      trades.push(trade);
      continue;
    }
    const result = await migrateMediaList(trade.images, upload);
    tally(result);
    trades.push(result.moved > 0 ? { ...trade, images: result.media, movedAt: now } : trade);
  }

  const reviews: typeof state.reviews = [];
  for (const review of state.reviews) {
    if (review.movedAt || !(review.media ?? []).some(isInlineImage)) {
      reviews.push(review);
      continue;
    }
    const result = await migrateMediaList(review.media, upload);
    tally(result);
    reviews.push(result.moved > 0 ? { ...review, media: result.media, movedAt: now } : review);
  }

  const lessons: typeof state.lessons = [];
  for (const lesson of state.lessons ?? []) {
    if (lesson.movedAt || !(lesson.media ?? []).some(isInlineImage)) {
      lessons.push(lesson);
      continue;
    }
    const result = await migrateMediaList(lesson.media, upload);
    tally(result);
    lessons.push(result.moved > 0 ? { ...lesson, media: result.media, movedAt: now } : lesson);
  }

  // A pattern study keeps its pictures per logged example rather than on the study itself,
  // so each example is walked and the study is replaced only when one of them changed.
  const patternStudies: typeof state.patternStudies = [];
  for (const study of state.patternStudies ?? []) {
    const entries: typeof study.entries = [];
    let changed = false;
    for (const entry of study.entries) {
      if (!isInlineImage(entry.beforeImage) && !isInlineImage(entry.afterImage)) {
        entries.push(entry);
        continue;
      }
      const before = await migrateMediaList(
        entry.beforeImage ? [entry.beforeImage] : [],
        upload
      );
      const after = await migrateMediaList(entry.afterImage ? [entry.afterImage] : [], upload);
      tally(before);
      tally(after);
      if (before.moved + after.moved === 0) {
        entries.push(entry);
        continue;
      }
      changed = true;
      entries.push({
        ...entry,
        beforeImage: before.media?.[0],
        afterImage: after.media?.[0],
      });
    }
    patternStudies.push(changed ? { ...study, entries, movedAt: now } : study);
  }

  const chartSearches: typeof state.chartSearches = [];
  for (const search of state.chartSearches ?? []) {
    // A search carries one thumbnail rather than a list, so it is handled on its own.
    if (search.movedAt || !isInlineImage(search.thumbnail)) {
      chartSearches.push(search);
      continue;
    }
    try {
      const url = await upload(search.thumbnail as string);
      counts.moved += 1;
      counts.records += 1;
      counts.freedChars += (search.thumbnail as string).length;
      chartSearches.push({ ...search, thumbnail: url, movedAt: now });
    } catch {
      counts.failed += 1;
      chartSearches.push(search);
    }
  }

  // What is left inline anywhere, counted so the report can say the journal is genuinely
  // lighter rather than only that the run finished.
  const leftover: (string | undefined)[] = [];
  for (const trade of trades) leftover.push(...(trade.images ?? []));
  for (const review of reviews) leftover.push(...(review.media ?? []));
  for (const lesson of lessons ?? []) leftover.push(...(lesson.media ?? []));
  for (const study of patternStudies ?? []) {
    for (const entry of study.entries) leftover.push(entry.beforeImage, entry.afterImage);
  }
  for (const search of chartSearches ?? []) leftover.push(search.thumbnail);
  counts.remainingChars = inlineDataChars(leftover);

  return {
    state: {
      ...state,
      trades,
      reviews,
      ...(state.lessons ? { lessons } : {}),
      ...(state.patternStudies ? { patternStudies } : {}),
      ...(state.chartSearches ? { chartSearches } : {}),
    },
    counts,
  };
}

/** Human-readable file size, used in error messages. */
export function formatBytes(bytes: number): string {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** Reads a video's duration (seconds) without uploading it. */
export function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(url);
      // Some container formats report Infinity until the file is seeked.
      if (!isFinite(duration) || duration <= 0) {
        resolve(0);
      } else {
        resolve(duration);
      }
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That video file could not be read.'));
    };
    video.src = url;
  });
}

export interface VideoCheck {
  ok: boolean;
  /** Populated when the file is readable, even if it failed a size/duration rule. */
  durationSeconds?: number;
  error?: string;
}

/**
 * Validates a video before upload so the trader finds out immediately rather
 * than after a long upload.
 */
export async function validateVideoFile(file: File): Promise<VideoCheck> {
  if (!isVideoUrl(file.name) && !file.type.startsWith('video/')) {
    return { ok: false, error: 'That file is not a recognised video.' };
  }

  if (file.size > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      error: `Video is ${formatBytes(file.size)}. Keep clips under ${formatBytes(
        MAX_VIDEO_BYTES
      )} (about a minute of phone video).`,
    };
  }

  let durationSeconds = 0;
  try {
    durationSeconds = await readVideoDuration(file);
  } catch (err: any) {
    return { ok: false, error: err?.message || 'That video file could not be read.' };
  }

  if (durationSeconds > MAX_VIDEO_SECONDS) {
    return {
      ok: false,
      durationSeconds,
      error: `Video is ${Math.round(
        durationSeconds
      )}s long. Trim it to ${MAX_VIDEO_SECONDS}s or less — these are meant to be quick 30-60 second clips.`,
    };
  }

  return { ok: true, durationSeconds };
}

/**
 * Uploads a video (or any raw file) to the signed-in user's folder in the
 * media bucket and returns its public URL, ready to store in the journal.
 */
export async function uploadMediaFile(file: File): Promise<string> {
  if (!supabase) {
    throw new Error(
      'Video uploads need cloud storage. Add your Supabase credentials, or attach a screenshot instead.'
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Sign in first — videos are saved to your cloud media folder.');
  }

  const extension = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'mp4').toLowerCase();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${user.id}/${unique}.${extension}`;

  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, {
    contentType: file.type || 'video/mp4',
    cacheControl: '3600',
    upsert: false,
  });

  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
