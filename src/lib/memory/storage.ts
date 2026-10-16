/**
 * Private storage for the memory library's screenshots.
 *
 * The rest of the app keeps chart images inline as base64 in the journal snapshot, or uploads
 * them to a public bucket and stores the URL. Neither is the right home for a library of
 * hundreds of charts:
 *
 *   - Inline base64 is what fills a browser's ~5 MB and silently stops later saves. Fine for a
 *     handful of pictures attached to trades, fatal for a searchable library.
 *   - A public bucket means every stored screenshot is reachable by anyone holding its URL
 *     forever. The rest of the journal tolerates that; a library the trader searches by
 *     uploading current charts should not have to.
 *
 * So this module uses its own private bucket, and three rules follow from the bucket being
 * private:
 *
 *   1. **The row keeps the path, never the URL.** A signed URL expires, and an expiring string
 *      cannot be the identity of a stored picture. Paths are derived from stable ids, so they are
 *      also what makes an upload idempotent: the same picture retried lands on the same object
 *      instead of a second one beside it.
 *   2. **An upload is not finished until it can be read back.** Every upload is followed by a
 *      signed-URL round trip, so "it worked" is a check the storage layer actually performed
 *      rather than a status code someone assumed. The existing media migration, which has no
 *      such check, is the reason this one does.
 *   3. **A failed upload never costs the trader the picture.** The inline copy is only dropped
 *      after the object is confirmed retrievable and the new reference is in hand. The same rule
 *      the existing migration follows, for the same reason.
 *
 * The migration is pure with respect to storage — it takes a library and an uploader and returns
 * the library it would become — so it is unit-testable with no bucket and no network, and the
 * caller decides when to persist the result.
 */

import { supabase } from '../supabase';
import type { MemoryImage, TradingObservation } from '../../types';

/** The private bucket that holds memory screenshots. Created by `supabase/schema.sql`. */
export const MEMORY_BUCKET = 'journal-memory';

/**
 * How long a signed URL lasts, in seconds.
 *
 * Fifteen minutes: long enough that a page of thumbnails loaded over a slow connection does not
 * expire mid-render, short enough that a URL copied out of devtools is useless soon after. It is
 * a window to *fetch* the picture, not a second life for it.
 */
export const MEMORY_SIGNED_URL_TTL_SECONDS = 900;

/**
 * The largest inline screenshot this module will upload, in characters.
 *
 * A screenshot compressed to 1600px at JPEG quality 0.82 lands well under this; the cap exists so
 * that a pathological input is refused with a message rather than turned into a multi-megabyte
 * upload. Inline base64 is about a third larger than the bytes it carries, so this is roughly
 * 6 MB of image.
 */
export const MEMORY_MAX_IMAGE_DATA_CHARS = 8_000_000;

/** Whether there is a Supabase project to store memory images in. */
export function isMemoryStorageConfigured(): boolean {
  return supabase !== null;
}

/** The parts of an inline image data URL, or null when the string is not one. */
export interface ImageDataUrlParts {
  mimeType: string;
  base64: string;
}

/**
 * Splits a `data:image/...;base64,...` string.
 *
 * Total — it returns null rather than throwing — because it runs over whatever a journal happens
 * to hold, including entries a different device or an older build wrote.
 */
export function readImageDataUrl(dataUrl: string | undefined | null): ImageDataUrlParts | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  if (!dataUrl.startsWith('data:image/')) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const header = dataUrl.slice(5, comma); // "image/jpeg;base64"
  const semi = header.indexOf(';');
  if (semi < 0) return null;
  const mimeType = header.slice(0, semi).toLowerCase();
  const encoding = header.slice(semi + 1).toLowerCase();
  if (encoding !== 'base64') return null;
  const base64 = dataUrl.slice(comma + 1);
  if (!base64) return null;
  // `image/jpg` is not a registered type; the encoder and the storage layer both want `jpeg`.
  return { mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType, base64 };
}

/** The file extension to give a stored picture, from its MIME type. */
export function extensionForMimeType(mimeType: string): string {
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'jpg';
}

/**
 * Strips anything from a path segment that could change the path's shape.
 *
 * This is not defensive tidiness: the storage policy reads the first folder of the object name
 * and compares it to `auth.uid()`, so a segment containing a slash would both create an
 * unintended folder level and move the object out from under the policy that is supposed to
 * protect it. Ids are app-generated and tame, and this makes that a fact rather than an
 * assumption about every caller.
 */
function safeSegment(value: string): string {
  const cleaned = String(value ?? '')
    .replace(/[^A-Za-z0-9._-]/g, '')
    // A run of dots is the one thing that could still look like a traversal to anything that
    // normalises the path further down (a CDN, a cache key, a signed-URL builder), so it is
    // collapsed to a single dot and stripped from the front.
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '');
  return cleaned || 'unknown';
}

/**
 * The object path for one picture: `<user>/<observation>/<image>.<ext>`.
 *
 * Derived from ids rather than from a timestamp and a random suffix, which is what makes the
 * upload idempotent. The existing media uploader cannot be retried safely — a retry produces a
 * second object with a new random name — and a backfill over a library is exactly the workload
 * where retries happen.
 */
export function memoryImagePath(
  userId: string,
  observationId: string,
  imageId: string,
  extension: string
): string {
  return `${safeSegment(userId)}/${safeSegment(observationId)}/${safeSegment(imageId)}.${safeSegment(
    extension
  )}`;
}

/** Lower-case hex, for a checksum that has to be compared as a string. */
function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * SHA-256 of an inline image, or null when it cannot be computed.
 *
 * Null is a real answer and callers must handle it: `crypto.subtle` only exists in a secure
 * context, so the same code runs in a browser on plain HTTP with no digest at all. A picture with
 * no checksum is still uploadable — it simply does not participate in deduplication or change
 * detection, which is better than refusing to store it.
 */
export async function checksumDataUrl(dataUrl: string): Promise<string | null> {
  const parts = readImageDataUrl(dataUrl);
  if (!parts) return null;

  let bytes: Uint8Array;
  try {
    const binary = atob(parts.base64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } catch {
    return null;
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;

  try {
    // The view is freshly allocated, so its buffer is exactly the image's bytes.
    const digest = await subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
    return toHex(new Uint8Array(digest));
  } catch {
    return null;
  }
}

export interface MemoryUploadRequest {
  userId: string;
  observationId: string;
  imageId: string;
  dataUrl: string;
}

export interface MemoryUploadResult {
  storagePath: string;
  /** Null when the browser could not compute a digest. Never a fabricated value. */
  checksum: string | null;
}

/** True when a storage error means the object is already there, which is success on a retry. */
function isAlreadyStored(message: string): boolean {
  return /already exists|duplicate|resource already|409/i.test(message);
}

/**
 * Uploads one inline screenshot to the private bucket and proves it can be read back.
 *
 * Throws on every failure, deliberately, and never partially succeeds: the caller's contract is
 * that a returned path points at a verified object, so it can drop the inline copy without
 * checking anything itself. A retry of a completed upload succeeds — the object being present is
 * exactly the outcome being asked for.
 */
export async function uploadMemoryImage(request: MemoryUploadRequest): Promise<MemoryUploadResult> {
  if (!supabase) {
    throw new Error('Memory image storage needs cloud storage. Add your Supabase credentials.');
  }

  const parts = readImageDataUrl(request.dataUrl);
  if (!parts) throw new Error('That is not an inline image to upload.');
  if (request.dataUrl.length > MEMORY_MAX_IMAGE_DATA_CHARS) {
    throw new Error(
      'That screenshot is too large to store. Compress it, or attach a smaller crop of the chart.'
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Sign in first — chart screenshots are saved to your private cloud folder.');
  }

  const extension = extensionForMimeType(parts.mimeType);
  const storagePath = memoryImagePath(
    request.userId || user.id,
    request.observationId,
    request.imageId,
    extension
  );

  const binary = atob(parts.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const { error } = await supabase.storage
    .from(MEMORY_BUCKET)
    .upload(storagePath, new Blob([bytes], { type: parts.mimeType }), {
      contentType: parts.mimeType,
      cacheControl: '3600',
      upsert: false,
    });

  // An object already at this path is the state we wanted, so it is not a failure. Any other
  // error is, and is reported with the storage layer's own words rather than a paraphrase.
  if (error && !isAlreadyStored(error.message ?? '')) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  // Verify rather than assume: the write succeeding is not the same claim as the object being
  // retrievable, and only the second one justifies discarding the trader's inline copy.
  const verified = await createMemoryImageUrl(storagePath);
  if (!verified) {
    throw new Error(
      'The screenshot was uploaded but could not be read back, so it has been left in the ' +
        'journal. Nothing was lost — try again once the storage is reachable.'
    );
  }

  return { storagePath, checksum: await checksumDataUrl(request.dataUrl) };
}

/**
 * A short-lived URL for one stored picture, or null when it cannot be produced.
 *
 * Null rather than throwing: this is called while rendering a list, and one picture whose URL
 * failed must leave a gap in the grid rather than take the whole screen down with it.
 */
export async function createMemoryImageUrl(
  storagePath: string,
  ttlSeconds: number = MEMORY_SIGNED_URL_TTL_SECONDS
): Promise<string | null> {
  if (!supabase || !storagePath) return null;
  try {
    const { data, error } = await supabase.storage
      .from(MEMORY_BUCKET)
      .createSignedUrl(storagePath, Math.max(30, Math.round(ttlSeconds)));
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/**
 * Signed URLs for several pictures at once, in the order they were asked for.
 *
 * One round trip for a page of thumbnails. A path that fails resolves to null in its own slot
 * rather than shifting the others, so the caller can line the results up with what it asked for.
 */
export async function createMemoryImageUrls(
  storagePaths: readonly string[],
  ttlSeconds: number = MEMORY_SIGNED_URL_TTL_SECONDS
): Promise<(string | null)[]> {
  if (!supabase) return storagePaths.map(() => null);
  return Promise.all(storagePaths.map((path) => createMemoryImageUrl(path, ttlSeconds)));
}

// ---------------------------------------------------------------------------
// Moving an existing library off inline base64
// ---------------------------------------------------------------------------

/** What one run of the migration did, counted rather than summarised. */
export interface MemoryMigrationCounts {
  /** Pictures uploaded and verified. */
  uploaded: number;
  /** Records whose picture references changed at all. */
  records: number;
  /** Pictures that could not be moved; their inline copy is still intact. */
  failed: number;
  /** Observations left alone because they had already been moved by another device. */
  alreadyMigrated: number;
  /** Characters of inline base64 still held after the run. */
  remainingInlineChars: number;
  /** Characters of inline base64 the run freed. */
  freedChars: number;
  /** One entry per failure, so a report can name what broke instead of only how much. */
  failures: { observationId: string; imageId: string; message: string }[];
}

/** Uploads one picture and returns its object path. Supplied by the caller so this stays testable. */
export type MemoryImageUploader = (
  image: MemoryImage,
  observation: TradingObservation
) => Promise<{ storagePath: string; checksum?: string | null }>;

/**
 * Moves every inline picture in a library into the private bucket.
 *
 * The shape is the existing media migration's, on purpose: it takes a library and returns the
 * library it would become, replaces records wholesale rather than mutating them, stamps what it
 * touched so a second device's run is a no-op, and reports what actually moved. Those are the
 * properties that make it safe to interrupt, safe to retry and safe to run twice.
 *
 * One deliberate difference: the destination is the private bucket, so the same routine that
 * frees the browser's storage is also the one that takes the pictures out of public reach.
 *
 * Nothing is ever deleted before it is verified, and nothing is ever deleted on failure — a run
 * that fails halfway leaves a library that is partly moved and entirely intact, which is a state
 * it can simply be re-run from.
 */
export async function migrateObservationImages(
  observations: readonly TradingObservation[],
  upload: MemoryImageUploader,
  now: string
): Promise<{ observations: TradingObservation[]; counts: MemoryMigrationCounts }> {
  const counts: MemoryMigrationCounts = {
    uploaded: 0,
    records: 0,
    failed: 0,
    alreadyMigrated: 0,
    remainingInlineChars: 0,
    freedChars: 0,
    failures: [],
  };

  const next: TradingObservation[] = [];

  for (const observation of observations) {
    const images = observation.images ?? [];
    if (images.length === 0) {
      next.push(observation);
      continue;
    }

    let changed = false;
    const migratedImages: MemoryImage[] = [];

    for (const image of images) {
      // Already in the bucket: leave it exactly as it is, so a device that has already moved its
      // own pictures can never have them rewritten from a staler copy of the journal.
      if (image.storagePath || !image.dataUrl) {
        migratedImages.push(image);
        counts.remainingInlineChars += image.dataUrl?.length ?? 0;
        continue;
      }

      try {
        const result = await upload(image, observation);
        counts.uploaded += 1;
        counts.freedChars += image.dataUrl.length;
        changed = true;
        migratedImages.push({
          ...image,
          storagePath: result.storagePath,
          checksum: result.checksum ?? image.checksum,
          // The inline copy goes only now that the object is confirmed readable and its path is
          // in hand.
          dataUrl: undefined,
          migratedAt: now,
          updatedAt: now,
        });
      } catch (err) {
        // The picture stays where it was. A failed move must cost the trader nothing but the
        // space it was meant to free.
        counts.failed += 1;
        counts.remainingInlineChars += image.dataUrl.length;
        counts.failures.push({
          observationId: observation.id,
          imageId: image.id,
          message: err instanceof Error ? err.message : 'The upload failed.',
        });
        migratedImages.push(image);
      }
    }

    if (changed) {
      counts.records += 1;
      next.push({ ...observation, images: migratedImages, updatedAt: now });
    } else {
      if (!images.some((image) => image.dataUrl)) counts.alreadyMigrated += 1;
      next.push(observation);
    }
  }

  return { observations: next, counts };
}
