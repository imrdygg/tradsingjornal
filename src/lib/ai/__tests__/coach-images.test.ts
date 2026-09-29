import { describe, it, expect } from 'vitest';
import {
  MAX_COACH_IMAGES,
  MAX_COACH_IMAGE_DATA_CHARS,
  isCoachImageDataUrl,
  parseCoachImageDataUrl,
  readCoachImages,
  toCoachImagePart,
} from '../coach-images';

/**
 * These rules are the whole reason a request can carry a screenshot at all: the browser uses
 * them to decide what is worth sending, and the endpoint uses them to decide what it will
 * accept, because a request body is untrusted input whatever the client did.
 *
 * The cases that matter are the refusals. A video's cloud URL, an oversized screenshot and a
 * data URL that is not really an image must all be dropped rather than forwarded, and a
 * batch must stop at its budget instead of growing with whatever a client posts.
 */

/** A data URL with a payload of exactly `payloadChars` base64 characters. */
function dataUrl(mime = 'image/jpeg', payloadChars = 16): string {
  return `data:${mime};base64,${'A'.repeat(payloadChars)}`;
}

describe('parseCoachImageDataUrl', () => {
  it('accepts the image types a canvas re-encode produces', () => {
    expect(parseCoachImageDataUrl(dataUrl('image/png'))?.mimeType).toBe('image/png');
    expect(parseCoachImageDataUrl(dataUrl('image/webp'))?.mimeType).toBe('image/webp');
    expect(parseCoachImageDataUrl(dataUrl('image/gif'))?.mimeType).toBe('image/gif');
  });

  it('normalises image/jpg to the registered image/jpeg', () => {
    expect(parseCoachImageDataUrl(dataUrl('image/jpg'))?.mimeType).toBe('image/jpeg');
  });

  it('strips the data: prefix and keeps the payload', () => {
    const parsed = parseCoachImageDataUrl('data:image/png;base64,QUJD');

    expect(parsed).toEqual({ mimeType: 'image/png', data: 'QUJD' });
  });

  it('refuses a video, a remote URL and anything that is not a data URL', () => {
    expect(parseCoachImageDataUrl('data:video/mp4;base64,AAAA')).toBeNull();
    expect(parseCoachImageDataUrl('https://example.com/chart.png')).toBeNull();
    expect(parseCoachImageDataUrl('data:image/png,notbase64')).toBeNull();
    expect(parseCoachImageDataUrl('')).toBeNull();
    expect(parseCoachImageDataUrl(null)).toBeNull();
    expect(parseCoachImageDataUrl(undefined)).toBeNull();
  });

  it('refuses an image larger than the per-image cap', () => {
    // The cap is on the whole data URL, prefix included, because that is what is sent.
    const prefixChars = 'data:image/jpeg;base64,'.length;
    const atCap = MAX_COACH_IMAGE_DATA_CHARS - prefixChars;

    expect(parseCoachImageDataUrl(dataUrl('image/jpeg', atCap))).not.toBeNull();
    expect(parseCoachImageDataUrl(dataUrl('image/jpeg', atCap + 1))).toBeNull();
  });
});

describe('isCoachImageDataUrl', () => {
  it('is the predicate the browser picks attachments with', () => {
    expect(isCoachImageDataUrl(dataUrl())).toBe(true);
    // A video attached to the same trade is stored as a cloud URL, so it fails here.
    expect(isCoachImageDataUrl('https://example.com/clip.mp4')).toBe(false);
  });
});

describe('toCoachImagePart', () => {
  it('keeps the label on one bounded line', () => {
    const part = toCoachImagePart({
      label: `  2026-09-18   MES LONG  ${'x'.repeat(400)}  `,
      dataUrl: dataUrl(),
    });

    expect(part?.label.length).toBe(160);
    expect(part?.label.startsWith('2026-09-18 MES LONG')).toBe(true);
  });

  it('names an unlabelled image rather than sending a blank line', () => {
    expect(toCoachImagePart({ dataUrl: dataUrl() })?.label).toBe('chart screenshot');
    expect(toCoachImagePart({ label: '   ', dataUrl: dataUrl() })?.label).toBe('chart screenshot');
  });

  it('returns null for anything it cannot use', () => {
    expect(toCoachImagePart(null)).toBeNull();
    expect(toCoachImagePart('data:image/png;base64,AAAA')).toBeNull();
    expect(toCoachImagePart({ label: 'x', dataUrl: 'https://example.com/a.png' })).toBeNull();
  });
});

describe('readCoachImages', () => {
  it('reads a batch in order', () => {
    const parts = readCoachImages([
      { label: 'first', dataUrl: dataUrl('image/png') },
      { label: 'second', dataUrl: dataUrl() },
    ]);

    expect(parts.map((part) => part.label)).toEqual(['first', 'second']);
  });

  it('drops the unusable entries and keeps the rest', () => {
    const parts = readCoachImages([
      { label: 'good', dataUrl: dataUrl() },
      { label: 'video', dataUrl: 'https://example.com/clip.mp4' },
      'not an object',
      { label: 'also good', dataUrl: dataUrl('image/png') },
    ]);

    expect(parts.map((part) => part.label)).toEqual(['good', 'also good']);
  });

  it('stops at the image count cap', () => {
    const raw = Array.from({ length: MAX_COACH_IMAGES + 4 }, (_, i) => ({
      label: `image ${i}`,
      dataUrl: dataUrl(),
    }));

    expect(readCoachImages(raw)).toHaveLength(MAX_COACH_IMAGES);
  });

  it('stops when the batch budget is spent, even with room left under the count', () => {
    const raw = Array.from({ length: 5 }, (_, i) => ({
      label: `image ${i}`,
      dataUrl: dataUrl('image/jpeg', 16),
    }));

    // A generous count next to a tiny budget: it is the cost, not the number, that stops it.
    const parts = readCoachImages(raw, 10, 40);

    expect(parts.map((part) => part.label)).toEqual(['image 0', 'image 1']);
  });

  it('reads anything that is not a list as no images at all', () => {
    expect(readCoachImages(undefined)).toEqual([]);
    expect(readCoachImages(null)).toEqual([]);
    expect(readCoachImages('a string')).toEqual([]);
    expect(readCoachImages({ label: 'x' })).toEqual([]);
  });
});
