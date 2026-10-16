import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryImage, TradingObservation } from '../../../types';
import {
  MEMORY_BUCKET,
  checksumDataUrl,
  createMemoryImageUrl,
  createMemoryImageUrls,
  extensionForMimeType,
  isMemoryStorageConfigured,
  memoryImagePath,
  migrateObservationImages,
  readImageDataUrl,
  uploadMemoryImage,
} from '../storage';

/**
 * Private storage.
 *
 * A fake Supabase, because the behaviours worth pinning down are the failure paths: an upload
 * that cannot be read back must not let the inline copy be discarded, a retry must not create a
 * second object, and a traversal in an id must not move an object out from under the storage
 * policy that protects it. Those are cheap to assert against a fake and expensive to discover in
 * production.
 */

const fake = vi.hoisted(() => {
  interface Uploaded {
    path: string;
    size: number;
    contentType: string;
  }

  const state = {
    uploaded: [] as Uploaded[],
    signedUrlCalls: [] as string[],
    /** What the next upload returns. A string means an error carrying that message. */
    uploadError: null as string | null,
    signedUrlFails: false,
    user: { id: 'user-1' } as { id: string } | null,
  };

  const client = {
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
    },
    storage: {
      from: () => ({
        upload: async (path: string, blob: Blob, options?: { contentType?: string }) => {
          if (state.uploadError) return { data: null, error: { message: state.uploadError } };
          state.uploaded.push({ path, size: blob.size, contentType: options?.contentType ?? '' });
          return { data: { path }, error: null };
        },
        createSignedUrl: async (path: string) => {
          state.signedUrlCalls.push(path);
          if (state.signedUrlFails) return { data: null, error: { message: 'unavailable' } };
          return { data: { signedUrl: `https://signed.example/${path}` }, error: null };
        },
      }),
    },
  };

  return { state, client };
});

vi.mock('../../supabase', () => ({ supabase: fake.client, isSupabaseConfigured: true }));

/** A one-pixel PNG, and a second valid data URL with different bytes. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
// Built with `btoa` rather than `Buffer`: the project's tsconfig includes `vite/client` as its
// only ambient type package, so a Node global here would type-check by accident, if it did at all.
const OTHER_PNG = `data:image/png;base64,${btoa('a different picture')}`;

function makeImage(overrides: Partial<MemoryImage> = {}): MemoryImage {
  return {
    id: 'img-1',
    observationId: 'obs-1',
    role: 'before-setup',
    dataUrl: PNG,
    indexStatus: 'pending',
    createdAt: '2026-03-01T13:00:00.000Z',
    updatedAt: '2026-03-01T13:00:00.000Z',
    ...overrides,
  };
}

function makeObservation(overrides: Partial<TradingObservation> = {}): TradingObservation {
  return {
    id: 'obs-1',
    userId: 'user-1',
    observedAt: '2026-03-01T14:00:00.000Z',
    observedAtSource: 'recorded',
    marketTimezone: 'America/New_York',
    instrumentId: 'mes',
    symbol: 'MES',
    images: [makeImage()],
    createdAt: '2026-03-01T13:00:00.000Z',
    updatedAt: '2026-03-01T13:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  fake.state.uploaded = [];
  fake.state.signedUrlCalls = [];
  fake.state.uploadError = null;
  fake.state.signedUrlFails = false;
  fake.state.user = { id: 'user-1' };
});

describe('readImageDataUrl', () => {
  it('splits an inline image into its MIME type and payload', () => {
    const parts = readImageDataUrl(PNG);
    expect(parts?.mimeType).toBe('image/png');
    expect(parts?.base64.length).toBeGreaterThan(0);
  });

  it('normalises image/jpg, which is not a registered type', () => {
    expect(readImageDataUrl('data:image/jpg;base64,QUJD')?.mimeType).toBe('image/jpeg');
  });

  it('refuses anything that is not an inline base64 image', () => {
    expect(readImageDataUrl('https://example.com/chart.png')).toBeNull();
    expect(readImageDataUrl('data:image/png,notbase64')).toBeNull();
    expect(readImageDataUrl('data:video/mp4;base64,QUJD')).toBeNull();
    expect(readImageDataUrl('data:image/png;base64,')).toBeNull();
    expect(readImageDataUrl('')).toBeNull();
    expect(readImageDataUrl(null)).toBeNull();
    expect(readImageDataUrl(undefined)).toBeNull();
  });
});

describe('extensionForMimeType', () => {
  it('names the format, defaulting to jpg', () => {
    expect(extensionForMimeType('image/png')).toBe('png');
    expect(extensionForMimeType('image/webp')).toBe('webp');
    expect(extensionForMimeType('image/gif')).toBe('gif');
    expect(extensionForMimeType('image/jpeg')).toBe('jpg');
    expect(extensionForMimeType('application/octet-stream')).toBe('jpg');
  });
});

describe('memoryImagePath', () => {
  it('puts the owner in the first folder, which is what the storage policy reads', () => {
    const path = memoryImagePath('user-1', 'obs-1', 'img-1', 'jpg');
    expect(path).toBe('user-1/obs-1/img-1.jpg');
    expect(path.split('/')[0]).toBe('user-1');
  });

  it('strips anything that could add a folder level or alter the path', () => {
    const path = memoryImagePath('../../etc', 'obs/1', 'img 1', 'jp/g');
    expect(path.split('/')).toHaveLength(3);
    expect(path).not.toContain('..');
    expect(path).not.toContain(' ');
    expect(path).not.toContain('//');
    // The owner segment survives sanitising, so the policy still matches it.
    expect(path.startsWith('etc/')).toBe(true);
  });

  it('never produces an empty segment', () => {
    const path = memoryImagePath('', '', '', '');
    for (const segment of path.split('/')) expect(segment.length).toBeGreaterThan(0);
  });
});

describe('checksumDataUrl', () => {
  it('is the same for the same picture and different for a different one', async () => {
    const a = await checksumDataUrl(PNG);
    const b = await checksumDataUrl(PNG);
    const c = await checksumDataUrl(OTHER_PNG);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('is a lower-case hex sha-256', async () => {
    expect(await checksumDataUrl(PNG)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns null rather than guessing when there is nothing to digest', async () => {
    expect(await checksumDataUrl('https://example.com/chart.png')).toBeNull();
  });
});

describe('uploadMemoryImage', () => {
  it('stores the picture and returns the path it will be read back from', async () => {
    const result = await uploadMemoryImage({
      userId: 'user-1',
      observationId: 'obs-1',
      imageId: 'img-1',
      dataUrl: PNG,
    });

    // The extension follows the MIME type, so a PNG is stored as a PNG.
    expect(result.storagePath).toBe('user-1/obs-1/img-1.png');
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(fake.state.uploaded).toHaveLength(1);
    expect(fake.state.uploaded[0].path).toBe(result.storagePath);
    expect(fake.state.uploaded[0].contentType).toBe('image/png');
    // The upload was verified by actually asking for a URL, not assumed from a status code.
    expect(fake.state.signedUrlCalls).toContain(result.storagePath);
  });

  it('treats "already there" as success, so a retried backfill adds no second object', async () => {
    fake.state.uploadError = 'The resource already exists';
    const result = await uploadMemoryImage({
      userId: 'user-1',
      observationId: 'obs-1',
      imageId: 'img-1',
      dataUrl: PNG,
    });
    expect(result.storagePath).toBe('user-1/obs-1/img-1.png');
    expect(fake.state.signedUrlCalls).toContain(result.storagePath);
  });

  it('throws on a real upload failure without claiming anything was stored', async () => {
    fake.state.uploadError = 'Payload too large';
    await expect(
      uploadMemoryImage({ userId: 'user-1', observationId: 'obs-1', imageId: 'img-1', dataUrl: PNG })
    ).rejects.toThrow(/Payload too large/);
    // Nothing was verified, because nothing was written.
    expect(fake.state.signedUrlCalls).toHaveLength(0);
  });

  it('refuses an object it cannot read back, so the inline copy is never discarded for nothing', async () => {
    fake.state.signedUrlFails = true;
    await expect(
      uploadMemoryImage({ userId: 'user-1', observationId: 'obs-1', imageId: 'img-1', dataUrl: PNG })
    ).rejects.toThrow(/could not be read back/);
  });

  it('refuses something that is not an inline image', async () => {
    await expect(
      uploadMemoryImage({
        userId: 'user-1',
        observationId: 'obs-1',
        imageId: 'img-1',
        dataUrl: 'https://example.com/chart.png',
      })
    ).rejects.toThrow(/not an inline image/);
  });

  it('refuses an oversized screenshot with an actionable message', async () => {
    const huge = `data:image/png;base64,${'A'.repeat(8_000_001)}`;
    await expect(
      uploadMemoryImage({ userId: 'user-1', observationId: 'obs-1', imageId: 'img-1', dataUrl: huge })
    ).rejects.toThrow(/too large to store/);
  });

  it('requires a signed-in account, because the folder path is the account', async () => {
    fake.state.user = null;
    await expect(
      uploadMemoryImage({ userId: 'user-1', observationId: 'obs-1', imageId: 'img-1', dataUrl: PNG })
    ).rejects.toThrow(/Sign in first/);
  });
});

describe('signed URLs', () => {
  it('produces a short-lived URL for a stored picture', async () => {
    expect(await createMemoryImageUrl('user-1/obs-1/img-1.png')).toBe(
      'https://signed.example/user-1/obs-1/img-1.png'
    );
  });

  it('returns null instead of throwing, so one broken picture does not break a grid', async () => {
    fake.state.signedUrlFails = true;
    expect(await createMemoryImageUrl('user-1/obs-1/img-1.png')).toBeNull();
    expect(await createMemoryImageUrl('')).toBeNull();
  });

  it('resolves a batch in the order it was asked for', async () => {
    expect(await createMemoryImageUrls(['a/1/x.png', 'a/1/y.png'], 60)).toEqual([
      'https://signed.example/a/1/x.png',
      'https://signed.example/a/1/y.png',
    ]);
  });
});

describe('isMemoryStorageConfigured', () => {
  it('is true once a project is configured, and points at the private bucket', () => {
    expect(isMemoryStorageConfigured()).toBe(true);
    expect(MEMORY_BUCKET).toBe('journal-memory');
  });
});

describe('migrateObservationImages', () => {
  const NOW = '2026-03-02T00:00:00.000Z';

  const uploader = async (image: MemoryImage) =>
    uploadMemoryImage({
      userId: 'user-1',
      observationId: image.observationId,
      imageId: image.id,
      dataUrl: image.dataUrl as string,
    });

  it('moves an inline picture into the private bucket and frees its bytes', async () => {
    const { observations, counts } = await migrateObservationImages([makeObservation()], uploader, NOW);

    const image = observations[0].images[0];
    expect(image.storagePath).toBe('user-1/obs-1/img-1.png');
    expect(image.dataUrl).toBeUndefined();
    expect(image.migratedAt).toBe(NOW);
    expect(image.checksum).toMatch(/^[0-9a-f]{64}$/);

    expect(counts.uploaded).toBe(1);
    expect(counts.records).toBe(1);
    expect(counts.failed).toBe(0);
    expect(counts.freedChars).toBe(PNG.length);
    expect(counts.remainingInlineChars).toBe(0);
  });

  it('leaves the inline copy in place when the upload fails, and names the picture', async () => {
    fake.state.signedUrlFails = true;
    const original = makeObservation();

    const { observations, counts } = await migrateObservationImages([original], uploader, NOW);

    const image = observations[0].images[0];
    expect(image.dataUrl).toBe(PNG);
    expect(image.storagePath).toBeUndefined();
    expect(counts.failed).toBe(1);
    expect(counts.uploaded).toBe(0);
    expect(counts.remainingInlineChars).toBe(PNG.length);
    expect(counts.failures).toEqual([
      { observationId: 'obs-1', imageId: 'img-1', message: expect.stringContaining('read back') },
    ]);
    // The trader's picture is still exactly where it was, not a rebuilt copy of it.
    expect(observations[0].images[0]).toBe(original.images[0]);
  });

  it('does not drop a picture that has neither an object nor inline bytes', async () => {
    const stranded = makeObservation({
      images: [makeImage({ dataUrl: undefined, storagePath: undefined })],
    });
    const { observations, counts } = await migrateObservationImages([stranded], uploader, NOW);
    expect(observations[0].images).toHaveLength(1);
    expect(counts.uploaded).toBe(0);
    expect(counts.failed).toBe(0);
  });

  it('leaves an already-migrated library completely alone', async () => {
    const migrated = makeObservation({
      images: [makeImage({ dataUrl: undefined, storagePath: 'user-1/obs-1/img-1.png' })],
    });

    const { observations, counts } = await migrateObservationImages([migrated], uploader, NOW);

    // Same object, not a copy: a second device's run cannot rewrite a staler reference.
    expect(observations[0]).toBe(migrated);
    expect(fake.state.uploaded).toHaveLength(0);
    expect(counts.alreadyMigrated).toBe(1);
    expect(counts.records).toBe(0);
  });

  it('returns an observation with no pictures untouched', async () => {
    const empty = makeObservation({ images: [] });
    const { observations, counts } = await migrateObservationImages([empty], uploader, NOW);
    expect(observations[0]).toBe(empty);
    expect(counts.records).toBe(0);
  });

  it('migrates part of a library and reports the split honestly', async () => {
    const good = makeObservation({ id: 'obs-good', images: [makeImage({ observationId: 'obs-good' })] });
    const already = makeObservation({
      id: 'obs-done',
      images: [
        makeImage({
          id: 'done',
          observationId: 'obs-done',
          dataUrl: undefined,
          storagePath: 'p/done.png',
        }),
      ],
    });

    const { observations, counts } = await migrateObservationImages([good, already], uploader, NOW);

    expect(counts.uploaded).toBe(1);
    expect(counts.records).toBe(1);
    expect(counts.alreadyMigrated).toBe(1);
    expect(observations[0].images[0].storagePath).toContain('obs-good');
    expect(observations[1]).toBe(already);
  });

  it('is idempotent: running it twice over its own output uploads nothing the second time', async () => {
    const first = await migrateObservationImages([makeObservation()], uploader, NOW);
    fake.state.uploaded = [];
    const second = await migrateObservationImages(first.observations, uploader, NOW);
    expect(fake.state.uploaded).toHaveLength(0);
    expect(second.counts.uploaded).toBe(0);
    expect(second.observations).toEqual(first.observations);
  });
});
