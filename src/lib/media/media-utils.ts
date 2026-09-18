/**
 * Helpers for attaching chart media to trades and playbook setups.
 *
 * Images are compressed client-side and stored inline as data URLs (they are
 * small enough for the journal snapshot). Videos cannot live in the snapshot —
 * a 30-60 second clip is megabytes of base64 and would bloat localStorage and
 * every cloud save — so they are uploaded to the Supabase Storage bucket
 * below and referenced by their public URL instead.
 */
import { supabase } from '../supabase';

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
