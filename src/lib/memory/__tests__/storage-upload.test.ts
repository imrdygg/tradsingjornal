/**
 * The private-upload path, over real HTTP.
 *
 * `storage.test.ts` stubs the Supabase client, so it proves the DECISIONS — that a verified path is
 * only returned when the object can be read back, that a failed upload costs nothing, that a retried
 * migration does not double-store. What it cannot prove is the part that actually goes on the wire:
 * the request the client builds, the multipart body carrying the picture, the path it asks for, the
 * bearer token, and whether the signed URL that comes back really serves the bytes. Those are the
 * pieces that break silently — a wrong field name or a dropped header fails in production and in no
 * other test — so this file runs the REAL `@supabase/supabase-js` client against a server that
 * speaks the Storage API, and nothing here is stubbed between the app's code and the socket.
 *
 * Why not a real project: it needs credentials, a bucket and a signed-in user, which makes it a test
 * that cannot run on a laptop or in CI. Why that is still worth doing: RLS and the bucket policy are
 * the only parts this cannot reach, and they belong to Supabase's side of the contract. Everything
 * this repository is responsible for — the path shape, the upload, the read-back verification, the
 * idempotent retry — is exercised here end to end.
 */

import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemoryImage, Trade, TradingObservation } from '../../../types';

/** The signed-in user the fake auth endpoint reports. */
const USER_ID = 'a0000000-0000-4000-8000-000000000001';

/** A real one-pixel PNG, so what is uploaded is a picture and not a string. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64');
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

interface FakeObject {
  bytes: Buffer;
  contentType: string;
}

/** What the fake Storage API saw, so the assertions can be about the wire and not only the result. */
interface FakeStorageApi {
  url: string;
  objects: Map<string, FakeObject>;
  requests: { method: string; path: string; authorization: string | undefined }[];
  /** Refusals of a second upload to a path that is already taken. */
  duplicates: number;
  /** When set, uploads fail with this message, as the storage layer would report it. */
  failUpload?: string;
  /** When true, signing a URL fails: the write works but the object cannot be proven readable. */
  failSign: boolean;
  close: () => Promise<void>;
}

/** A JWT the auth client can decode. Not signed — this server never verifies one. */
function accessToken(): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({ sub: USER_ID, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }),
    // A base64url-shaped signature. The client decodes all three parts and refuses anything that is
    // not valid base64url, so the placeholder has to look like one.
    Buffer.from('signature').toString('base64url'),
  ].join('.');
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * The picture out of a multipart body.
 *
 * The storage client sends a Blob as `FormData`, so the picture arrives inside a part rather than as
 * the whole body. This reads the part whose header says it is an image, which is also the check that
 * the client put the right content type on it.
 */
function multipartImage(body: Buffer, contentType: string): FakeObject | null {
  const boundary = /boundary=("?)([^";]+)\1/i.exec(contentType)?.[2];
  if (!boundary) return null;

  const delimiter = Buffer.from(`--${boundary}`);
  let index = body.indexOf(delimiter);

  while (index >= 0) {
    const start = index + delimiter.length;
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;

    const part = body.subarray(start, next);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const headers = part.subarray(0, headerEnd).toString('utf8');
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim();
      if (type?.startsWith('image/')) {
        const payload = part.subarray(headerEnd + 4);
        // A part's payload is followed by the CRLF that precedes the next delimiter.
        const endsWithCrlf =
          payload.length >= 2 && payload[payload.length - 2] === 13 && payload[payload.length - 1] === 10;
        return {
          bytes: Buffer.from(payload.subarray(0, endsWithCrlf ? payload.length - 2 : payload.length)),
          contentType: type,
        };
      }
    }

    index = next;
  }

  return null;
}

/** A Storage API, in process: real HTTP, real routing, real bodies, no credentials. */
async function startStorageApi(): Promise<FakeStorageApi> {
  const objects = new Map<string, FakeObject>();
  const requests: FakeStorageApi['requests'] = [];
  const state = {
    duplicates: 0,
    failUpload: undefined as string | undefined,
    failSign: false,
  };

  const server = createServer((req, res) => {
    void respond(req, res);
  });

  async function respond(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    requests.push({
      method: req.method ?? 'GET',
      path: path + (url.search || ''),
      authorization: req.headers.authorization,
    });

    const json = (status: number, payload: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    };
    const body = await readBody(req);

    // ---- Auth: the client asks who the bearer token belongs to before it uploads anything ----
    if (path === '/auth/v1/user' && req.method === 'GET') {
      if (!req.headers.authorization?.startsWith('Bearer ')) {
        json(401, { message: 'no bearer token' });
        return;
      }
      json(200, { id: USER_ID, aud: 'authenticated', role: 'authenticated' });
      return;
    }

    if (path === '/auth/v1/logout') {
      res.statusCode = 204;
      res.end();
      return;
    }

    // ---- Storage: sign, then upload, then serve the signed URL back ----
    const signPrefix = '/storage/v1/object/sign/';
    const objectPrefix = '/storage/v1/object/';

    if (path.startsWith(signPrefix)) {
      const key = decodeURIComponent(path.slice(signPrefix.length));

      if (req.method === 'POST') {
        if (state.failSign) {
          json(500, { statusCode: '500', error: 'InternalError', message: 'signing is down' });
          return;
        }
        json(200, { signedURL: `/object/sign/${key}?token=fake-token` });
        return;
      }

      const stored = objects.get(key);
      if (!stored) {
        json(400, { statusCode: '404', error: 'NotFound', message: 'Object not found' });
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', stored.contentType);
      res.end(stored.bytes);
      return;
    }

    if (path.startsWith(objectPrefix) && req.method === 'POST') {
      const key = decodeURIComponent(path.slice(objectPrefix.length));

      if (state.failUpload) {
        json(400, { statusCode: '500', error: 'InternalError', message: state.failUpload });
        return;
      }
      // What a real bucket does with `upsert: false` on a path that is already taken.
      if (objects.has(key) && req.headers['x-upsert'] !== 'true') {
        state.duplicates += 1;
        json(400, {
          statusCode: '409',
          error: 'Duplicate',
          message: 'The resource already exists',
        });
        return;
      }
      const image = multipartImage(body, String(req.headers['content-type'] ?? ''));
      if (!image) {
        json(400, { statusCode: '400', error: 'InvalidRequest', message: 'no image in the body' });
        return;
      }
      objects.set(key, image);
      json(200, { Key: key });
      return;
    }

    json(404, { statusCode: '404', error: 'NotFound', message: `unhandled ${req.method} ${path}` });
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('the fake storage API did not listen');

  return {
    url: `http://127.0.0.1:${address.port}`,
    objects,
    requests,
    get duplicates() {
      return state.duplicates;
    },
    get failUpload() {
      return state.failUpload;
    },
    set failUpload(message: string | undefined) {
      state.failUpload = message;
    },
    get failSign() {
      return state.failSign;
    },
    set failSign(value: boolean) {
      state.failSign = value;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** The client the app builds, without the null the module carries for an unconfigured build. */
type TestClient = NonNullable<typeof import('../../supabase').supabase>;

let api: FakeStorageApi;
let storage: typeof import('../storage');
let supabase: TestClient;

beforeAll(async () => {
  api = await startStorageApi();
  // The Supabase module reads these at import time, so they are set before it is loaded and the
  // module registry is reset in between: the client under test is built from THIS address.
  vi.stubEnv('VITE_SUPABASE_URL', api.url);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  vi.resetModules();

  const client = (await import('../../supabase')).supabase;
  if (!client) throw new Error('the client was not built from the test environment');
  supabase = client;
  storage = await import('../storage');

  // A real session, adopted the way the app adopts one: the client decodes the token, checks it
  // against the auth endpoint and keeps what comes back.
  const { error } = await supabase.auth.setSession({
    access_token: accessToken(),
    refresh_token: 'test-refresh-token',
  });
  if (error) throw error;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await api?.close();
});

beforeEach(() => {
  api.objects.clear();
  api.requests.length = 0;
  api.failUpload = undefined;
  api.failSign = false;
});

function image(overrides: Partial<MemoryImage> = {}): MemoryImage {
  return {
    id: 'img-1',
    observationId: 'obs-1',
    role: 'before-setup',
    dataUrl: PNG_DATA_URL,
    indexStatus: 'pending',
    createdAt: '2026-10-16T12:00:00.000Z',
    updatedAt: '2026-10-16T12:00:00.000Z',
    ...overrides,
  };
}

function observation(overrides: Partial<TradingObservation> = {}): TradingObservation {
  return {
    id: 'obs-1',
    userId: USER_ID,
    observedAt: '2026-10-16T12:00:00.000Z',
    observedAtSource: 'recorded',
    marketTimezone: 'America/New_York',
    instrumentId: 'mes',
    symbol: 'MES',
    images: [],
    createdAt: '2026-10-16T12:00:00.000Z',
    updatedAt: '2026-10-16T12:00:00.000Z',
    ...overrides,
  };
}

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-1',
    userId: USER_ID,
    tradingDayId: 'day-1',
    instrumentId: 'mes',
    source: 'manual',
    direction: 'long',
    contracts: 1,
    entryPrice: 5000,
    initialStop: 4995,
    entryTime: '2026-10-14T14:30:00.000Z',
    session: 'Regular Session',
    initialRisk: 50,
    grossPnL: 50,
    pointsPnL: 10,
    rMultiple: 1,
    status: 'closed',
    images: [PNG_DATA_URL],
    createdAt: '2026-10-14T14:31:00.000Z',
    updatedAt: '2026-10-14T14:31:00.000Z',
    ...overrides,
  };
}

describe('uploadMemoryImage — the real request, against a real storage surface', () => {
  it('stores the picture at the path the record will hold, and proves it readable', async () => {
    const result = await storage.uploadMemoryImage({
      userId: USER_ID,
      observationId: 'obs-1',
      imageId: 'img-1',
      dataUrl: PNG_DATA_URL,
    });

    // The path is derived from ids, which is what makes a retry land on the same object.
    expect(result.storagePath).toBe(`${USER_ID}/obs-1/img-1.png`);

    const stored = api.objects.get(`${storage.MEMORY_BUCKET}/${result.storagePath}`);
    expect(stored).toBeDefined();
    expect(stored?.bytes.equals(PNG_BYTES)).toBe(true);
    expect(stored?.contentType).toBe('image/png');

    // A real digest of the bytes that were sent, which is the change detector the row relies on.
    expect(result.checksum).toBe(createHash('sha256').update(PNG_BYTES).digest('hex'));

    // The upload carried a bearer token: this is a private bucket, and the row is only usable if
    // the write was authenticated as this user.
    const upload = api.requests.find((entry) => entry.method === 'POST' && entry.path.includes('/object/'));
    expect(upload?.authorization).toMatch(/^Bearer /);

    // And the URL the app hands to a screen really serves the picture back.
    const signed = await storage.createMemoryImageUrl(result.storagePath);
    expect(signed).toBeTruthy();
    const response = await fetch(signed as string);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
  });

  it('treats a second upload to the same path as success, which is what a retry is', async () => {
    const request = {
      userId: USER_ID,
      observationId: 'obs-1',
      imageId: 'img-1',
      dataUrl: PNG_DATA_URL,
    };

    const first = await storage.uploadMemoryImage(request);
    const second = await storage.uploadMemoryImage(request);

    expect(second.storagePath).toBe(first.storagePath);
    // The bucket refused the second write (upsert is false) and the app read that refusal as the
    // state it wanted, rather than as a failure to report.
    expect(api.duplicates).toBe(1);
    expect(api.objects.get(`${storage.MEMORY_BUCKET}/${first.storagePath}`)?.bytes.equals(PNG_BYTES)).toBe(
      true
    );
  });

  it('reports a genuine upload failure in the storage layer’s own words, and stores nothing', async () => {
    api.failUpload = 'the bucket said no';

    const error = await storage
      .uploadMemoryImage({
        userId: USER_ID,
        observationId: 'obs-1',
        imageId: 'img-1',
        dataUrl: PNG_DATA_URL,
      })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('the bucket said no');
    expect(api.objects.size).toBe(0);
  });

  it('refuses to claim a stored path when the object cannot be read back', async () => {
    // The one failure that must never be reported as success: the inline copy in the journal is
    // dropped on the strength of this check, so a path handed back here would be a lost picture.
    api.failSign = true;

    const error = await storage
      .uploadMemoryImage({
        userId: USER_ID,
        observationId: 'obs-1',
        imageId: 'img-1',
        dataUrl: PNG_DATA_URL,
      })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('could not be read back');
  });

  it('refuses to upload without a session, before anything leaves the browser', async () => {
    await supabase.auth.signOut();
    api.requests.length = 0;

    const error = await storage
      .uploadMemoryImage({
        userId: USER_ID,
        observationId: 'obs-1',
        imageId: 'img-1',
        dataUrl: PNG_DATA_URL,
      })
      .catch((err: unknown) => err);

    expect((error as Error).message).toContain('Sign in');
    expect(api.requests.some((entry) => entry.method === 'POST')).toBe(false);
    expect(api.objects.size).toBe(0);

    // Back in for the tests that follow (and for a re-run of this file).
    await supabase.auth.setSession({
      access_token: accessToken(),
      refresh_token: 'test-refresh-token',
    });
  });
});

describe('the journal import, storing through the real uploader', () => {
  it('uploads each imported picture and keeps no inline copy', async () => {
    // No injected io at all: the default reader, the default uploader and the real client.
    const { planJournalImport } = await import('../journal-import');
    const { importJournalScreenshots } = await import('../journal-import-runner');

    const planned = planJournalImport({ trades: [trade()], observations: [] });
    const result = await importJournalScreenshots({
      plan: planned,
      trades: [trade()],
      observations: [],
      instruments: [],
      userId: USER_ID,
      timezone: 'America/New_York',
      consent: true,
      cloudEnabled: true,
    });

    expect(result.failures).toEqual([]);
    expect(result.imported).toBe(1);

    const candidate = planned.candidates[0];
    const record = result.observations[0];
    const picture = record.images[0];
    expect(picture.role).toBe('context');
    // The path is the ids the plan chose, under the user's own folder — which is the arrangement
    // the storage policy reads to decide who may touch the object.
    expect(picture.storagePath).toBe(
      `${USER_ID}/${candidate.observationId}/${candidate.images[0].imageId}.png`
    );
    expect(picture.dataUrl).toBeUndefined();
    expect(picture.indexStatus).toBe('pending');

    const stored = api.objects.get(`${storage.MEMORY_BUCKET}/${picture.storagePath}`);
    expect(stored?.bytes.equals(PNG_BYTES)).toBe(true);
  });
});

describe('migrateObservationImages, through the real uploader', () => {
  it('moves an inline picture into the bucket and drops the inline copy only after it verifies', async () => {
    const library = [observation({ images: [image()] })];

    const migrated = await storage.migrateObservationImages(
      library,
      (entry, owner) =>
        storage.uploadMemoryImage({
          userId: owner.userId,
          observationId: owner.id,
          imageId: entry.id,
          dataUrl: entry.dataUrl ?? '',
        }),
      '2026-10-16T12:00:00.000Z'
    );

    expect(migrated.counts.uploaded).toBe(1);
    expect(migrated.counts.failed).toBe(0);
    expect(migrated.counts.freedChars).toBe(PNG_DATA_URL.length);

    const moved = migrated.observations[0].images[0];
    expect(moved.dataUrl).toBeUndefined();
    expect(moved.migratedAt).toBe('2026-10-16T12:00:00.000Z');
    expect(api.objects.get(`${storage.MEMORY_BUCKET}/${moved.storagePath}`)?.bytes.equals(PNG_BYTES)).toBe(
      true
    );
  });
});
