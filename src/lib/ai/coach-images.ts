/**
 * The rules for the chart images the coach is allowed to look at.
 *
 * One module, imported by both sides, so the browser that picks the images and the endpoint
 * that forwards them to the model cannot disagree about what a usable image is. The browser
 * uses it to decide what is worth sending; the server uses it to decide what it will accept,
 * because a request body is untrusted input no matter which client sent it.
 *
 * Images travel as base64 data URLs — the form the journal already stores a compressed
 * screenshot in — so there is no upload, no public URL and no bucket to expose. The cost is
 * size: base64 is roughly a third larger than the bytes it encodes, and a prompt is sent on
 * every request. Hence the caps below, which are the reason this is a module rather than a
 * couple of regexes copied into two files.
 */

/**
 * How many images one `learn` read may carry.
 *
 * Six matches the most a single journal entry can hold, and is the point past which extra
 * pictures stop adding anything the model can act on while the request keeps growing.
 */
export const MAX_COACH_IMAGES = 6;

/**
 * Longest single data URL that will be sent or accepted, in characters.
 *
 * A screenshot compressed to 1600px at JPEG quality 0.82 usually lands well under this. A
 * larger one is dropped rather than truncated: half an image is worse than no image, because
 * the model would describe a chart it cannot actually see.
 */
export const MAX_COACH_IMAGE_DATA_CHARS = 600_000;

/**
 * Total the whole batch may occupy, in characters.
 *
 * The per-image cap alone would still allow a multi-megabyte request body, so the budget is
 * spent image by image and the collection stops when it runs out.
 */
export const MAX_COACH_IMAGE_TOTAL_CHARS = 1_800_000;

/** The image types a canvas re-encode produces, plus the common pasted formats. */
const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

/** One image, split into the two pieces Gemini's `inlineData` wants. */
export interface CoachImagePart {
  /** Names the trade the image belongs to, shown to the model as text, never sent blind. */
  label: string;
  mimeType: string;
  /** Base64 payload, with the `data:` prefix stripped. */
  data: string;
}

/** A parsed data URL, or null when it is not a usable inline image. */
export interface ParsedCoachImage {
  mimeType: string;
  data: string;
}

/**
 * True when a string is a data-URL image this app will send.
 *
 * Used by the browser to pick which of a trade's attachments are images worth attaching.
 * A video attachment is a cloud URL rather than a data URL, so it fails here naturally.
 */
export function isCoachImageDataUrl(value: string | null | undefined): boolean {
  return parseCoachImageDataUrl(value) !== null;
}

/**
 * Splits a data URL into a MIME type and its base64 payload, or returns null.
 *
 * Deliberately total — no throwing — because it runs over whatever the journal happens to
 * hold and whatever a client happened to post, and one bad entry must never break a read.
 */
export function parseCoachImageDataUrl(value: string | null | undefined): ParsedCoachImage | null {
  if (!value || typeof value !== 'string') return null;
  if (value.length > MAX_COACH_IMAGE_DATA_CHARS) return null;
  const match = DATA_URL_PATTERN.exec(value);
  if (!match) return null;

  // `image/jpg` is not a registered type; the model API wants `image/jpeg`.
  const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const data = match[2];
  if (!data) return null;
  return { mimeType, data };
}

/**
 * Turns one wire entry into an image part, or null when it is not usable.
 *
 * The label is bound to a single short line: it is pasted into the prompt as text, so an
 * enormous one would be a way to smuggle a page of instructions into the request.
 */
export function toCoachImagePart(raw: unknown): CoachImagePart | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const parsed = parseCoachImageDataUrl(
    typeof record.dataUrl === 'string' ? record.dataUrl : null
  );
  if (!parsed) return null;

  const label = typeof record.label === 'string' ? record.label.replace(/\s+/g, ' ').trim() : '';
  return {
    label: label.slice(0, 160) || 'chart screenshot',
    mimeType: parsed.mimeType,
    data: parsed.data,
  };
}

/**
 * Reads a whole batch in order, dropping anything unusable and stopping at the caps.
 *
 * Order is preserved on purpose: the prompt lists the images by position, so keeping the
 * sequence lets the model tie the third picture to the third line of the list.
 */
export function readCoachImages(
  raw: unknown,
  max = MAX_COACH_IMAGES,
  maxTotalChars = MAX_COACH_IMAGE_TOTAL_CHARS
): CoachImagePart[] {
  if (!Array.isArray(raw)) return [];
  const parts: CoachImagePart[] = [];
  let total = 0;
  for (const item of raw) {
    if (parts.length >= max) break;
    const part = toCoachImagePart(item);
    if (!part) continue;
    if (total + part.data.length > maxTotalChars) break;
    total += part.data.length;
    parts.push(part);
  }
  return parts;
}
