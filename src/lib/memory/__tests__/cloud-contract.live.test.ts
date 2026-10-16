/**
 * The project's side of the contract: row-level security, the private bucket, and signed-URL expiry.
 *
 * Everything else in this subsystem is verified without a cloud — the app's code is tested over a
 * real socket against an in-process Storage API, and the rules are unit-tested. What none of that can
 * prove is what Supabase itself enforces: that RLS actually hides one trader's rows from another,
 * that `memory_match_images` is not callable by the anonymous role, that the `journal-memory` bucket
 * is not URL-readable, and that a signed link dies without its token (and with time). Those are
 * assertions about a deployed project, so this file needs one.
 *
 * It is OFF unless explicitly pointed at a project AND explicitly confirmed, because it writes and
 * deletes rows and objects:
 *
 *   MEMORY_LIVE_URL=https://<project>.supabase.co
 *   MEMORY_LIVE_ANON_KEY=<anon key>
 *   MEMORY_LIVE_CONFIRM=yes-write-test-rows      # the guard: without it nothing here runs
 *   MEMORY_LIVE_USER_A_EMAIL=...  MEMORY_LIVE_USER_A_PASSWORD=...   # optional; see below
 *   MEMORY_LIVE_USER_B_EMAIL=...  MEMORY_LIVE_USER_B_PASSWORD=...   # optional; see below
 *   MEMORY_LIVE_EXPIRY=1                          # opt in to the 30-second expiry wait
 *
 * The two accounts are only needed for the tenancy assertions, and only one thing about them
 * matters: that they are DIFFERENT users. On a local stack (or a project with confirmations off)
 * they are created on the fly, so nothing has to be set up by hand — on a project that requires
 * email confirmation they cannot be, and the failure says so.
 *
 * Point it at a THROWAWAY project or a local Supabase stack — `npx supabase start` gives a real
 * Postgres, real RLS and real storage on your machine, which is the cheapest way to run this whole
 * file. Never at the project holding your own journal: the rows it writes are named `live-…` and it
 * cleans up after itself, but the point of a tenancy test is to behave like a second trader.
 *
 * Why it is not faked. A fake server cannot test RLS, because the fake IS the policy: whatever it
 * answers, the test passes. That is exactly the class of self-fulfilling test this file exists to
 * avoid, so it either runs against a real project or it is skipped with the reason on screen.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  MEMORY_EMBEDDING_DIMENSION,
  MEMORY_EMBEDDING_MODEL,
  MEMORY_EMBEDDING_VERSION,
} from '../embeddings';
import { toPgVector } from '../db';
import { MEMORY_BUCKET } from '../storage';

const CONFIRMATION = 'yes-write-test-rows';

const url = process.env.MEMORY_LIVE_URL ?? '';
const anonKey = process.env.MEMORY_LIVE_ANON_KEY ?? '';
const confirmed = process.env.MEMORY_LIVE_CONFIRM === CONFIRMATION;
const userA = {
  email: process.env.MEMORY_LIVE_USER_A_EMAIL ?? '',
  password: process.env.MEMORY_LIVE_USER_A_PASSWORD ?? '',
};
const userB = {
  email: process.env.MEMORY_LIVE_USER_B_EMAIL ?? '',
  password: process.env.MEMORY_LIVE_USER_B_PASSWORD ?? '',
};

/** A project has to be named AND the write confirmed, so a stray env var cannot start this. */
const configured = Boolean(url && anonKey && confirmed);
/** The expiry wait is opt-in: it costs half a minute and proves one narrow thing. */
const checkExpiry = process.env.MEMORY_LIVE_EXPIRY === '1';
/**
 * True only under `npm run test:live` (see `vitest.live.config.ts`).
 *
 * It is what tells "nobody asked" apart from "somebody asked and this machine has no project":
 * `npm test` skips this file quietly, while `npm run test:live` fails loudly with the variables to
 * set, because a suite that answers a question with a skipped check has answered nothing.
 */
const askedForLiveRun = process.env.MEMORY_LIVE_INTENT === '1';

/** A one-pixel PNG: something real to store and read back. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/** The query vector, and the vector stamped on the stored picture: identical, so the distance is 0. */
const VECTOR = Array.from({ length: MEMORY_EMBEDDING_DIMENSION }, (_, index) => (index === 0 ? 1 : 0));

const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(4, 14);
const observationId = `live-obs-${stamp}`;
const imageId = `live-img-${stamp}`;
const missingBUserId = `live-img-b-${stamp}`;

/**
 * The credentials for one test account: the ones given, or ones this run can create for itself.
 *
 * A generated pair is what lets the tenancy half of this file run with nothing set up by hand on a
 * local stack. On a project that requires email confirmation a fresh sign-up yields no session, and
 * the failure names that rather than quietly skipping the half of the suite that proves the point.
 */
const accountFor = (label: string, given: { email: string; password: string }) =>
  given.email && given.password
    ? given
    : { email: `memory-live-${label}-${stamp}@example.com`, password: `Live-${stamp}-${label}!!` };

function client(): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Signs a test account in, creating it when it does not exist yet.
 *
 * A project with email confirmations on cannot produce a session from a fresh sign-up, and an
 * obfuscated sign-up response for an existing account hands back a user object with NO session — so
 * the session is required here rather than the user, and the failure says what to do about it.
 */
async function signIn(
  session: SupabaseClient,
  credentials: { email: string; password: string },
  label: string
): Promise<string> {
  const { data, error } = await session.auth.signInWithPassword(credentials);
  if (!error && data.user) return data.user.id;

  const { data: created, error: signUpError } = await session.auth.signUp(credentials);
  if (signUpError) {
    throw new Error(
      `Live test user ${label} could not sign in (${signUpError.message}). Create it in the ` +
        `project's Authentication tab, or use a local Supabase stack where sign-up needs no email.`
    );
  }
  if (!created.session || !created.user) {
    throw new Error(
      `Live test user ${label} could not sign in and could not be created with a session. Either ` +
        `the password is wrong, or this project requires email confirmation: create both test ` +
        `accounts by hand (Authentication → Add user → auto-confirm) and set the credentials.`
    );
  }
  return created.user.id;
}

if (askedForLiveRun && !configured) {
  describe('the live cloud contract was asked for, and has no project to check', () => {
    it('needs MEMORY_LIVE_URL, MEMORY_LIVE_ANON_KEY and MEMORY_LIVE_CONFIRM', () => {
      throw new Error(
        'Nothing ran, which is not the same as passing. Set MEMORY_LIVE_URL and ' +
          'MEMORY_LIVE_ANON_KEY for a THROWAWAY project or a local `npx supabase start` stack, ' +
          'plus MEMORY_LIVE_CONFIRM=yes-write-test-rows, then run this again. See "Verifying your ' +
          'own project" in the README.'
      );
    });
  });
}

describe.skipIf(!configured)(
  'cloud contract against a live project (skipped unless MEMORY_LIVE_* is set)',
  () => {
    // Built in `beforeAll`, never here: a `describe` body runs even when the suite is skipped, and
    // `createClient` refuses an empty URL — so a configured-at-collection-time client would break
    // the skip path that keeps this file out of `npm test` on a machine with no project.
    let anon: SupabaseClient | null = null;
    let owner: SupabaseClient | null = null;
    let other: SupabaseClient | null = null;
    let ownerId = '';
    let otherId = '';
    let objectPath = '';
    /** True once the owner's object exists, so the bucket assertions have something to point at. */
    let seeded = false;

    /** The client for a role that has to exist by the time a test asks for it. */
    function must(name: 'anon' | 'owner' | 'other'): SupabaseClient {
      const held = name === 'anon' ? anon : name === 'owner' ? owner : other;
      if (!held) throw new Error(`the live suite did not get a ${name} client — check the setup`);
      return held;
    }

    beforeAll(async () => {
      anon = client();
      owner = client();
      ownerId = await signIn(owner, accountFor('a', userA), 'A');
      objectPath = `${ownerId}/${observationId}/${imageId}.png`;

      const observation = await owner.from('trading_observations').upsert({
        id: observationId,
        user_id: ownerId,
        observed_at: new Date().toISOString(),
        observed_at_source: 'recorded',
        market_timezone: 'America/New_York',
        instrument: 'MES',
      });
      if (observation.error) throw new Error(`live seed: ${observation.error.message}`);

      const image = await owner.from('memory_images').upsert({
        id: imageId,
        user_id: ownerId,
        observation_id: observationId,
        image_role: 'before-setup',
        bucket_id: MEMORY_BUCKET,
        storage_path: objectPath,
        image_checksum: `live-${stamp}`,
        mime_type: 'image/png',
        embedding: toPgVector(VECTOR),
        embedding_model: MEMORY_EMBEDDING_MODEL,
        embedding_version: MEMORY_EMBEDDING_VERSION,
        embedding_dimension: MEMORY_EMBEDDING_DIMENSION,
        indexing_status: 'completed',
      });
      if (image.error) throw new Error(`live seed: ${image.error.message}`);

      // Not `upsert: true`: the bucket's policy grants insert and delete, not update, so a re-run
      // over an object a previous run left behind is a duplicate rather than a rewrite — the same
      // pair of facts the app's own uploader deals with by reading a duplicate as success.
      const upload = await owner.storage
        .from(MEMORY_BUCKET)
        .upload(objectPath, new Blob([PNG_BYTES], { type: 'image/png' }), {
          contentType: 'image/png',
        });
      if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) {
        throw new Error(`live seed: ${upload.error.message}`);
      }
      seeded = true;

      // The second trader, always: without a second account there is no way to distinguish "RLS
      // works" from "nothing was ever asked for", so this is required rather than optional.
      other = client();
      otherId = await signIn(other, accountFor('b', userB), 'B');
    });

    afterAll(async () => {
      if (owner && seeded) {
        // Best effort, and in the order the foreign keys demand: the picture, then what it hangs
        // from, then the object. A failure here is reported rather than swallowed silently.
        const removed = await owner.storage.from(MEMORY_BUCKET).remove([objectPath]);
        if (removed.error) console.warn(`live cleanup: object left behind — ${removed.error.message}`);
        await owner.from('memory_images').delete().eq('id', imageId);
        await owner.from('trading_observations').delete().eq('id', observationId);
      }
      if (other) {
        await other.from('memory_images').delete().eq('id', missingBUserId);
      }
    });

    describe('the anonymous role', () => {
      it('reads no rows from any memory table', async () => {
        for (const table of [
          'trading_observations',
          'memory_images',
          'memory_outcomes',
          'memory_searches',
          'memory_index_jobs',
        ]) {
          const { data, error } = await must('anon').from(table).select('id');
          // RLS with no policy for `anon` answers with nothing rather than with an error, so both
          // are acceptable and one row is not: a single visible row would be the leak.
          expect(error === null || typeof error.message === 'string').toBe(true);
          expect(data ?? []).toHaveLength(0);
        }
      });

      it('cannot call the similarity search at all', async () => {
        const { data, error } = await must('anon').rpc('memory_match_images', {
          p_query: toPgVector(VECTOR),
          p_model: MEMORY_EMBEDDING_MODEL,
          p_version: MEMORY_EMBEDDING_VERSION,
          p_match_count: 5,
        });

        // Not "returned nothing": refused. An empty result here would be indistinguishable from a
        // search that ran and found no matches, which is the confusion the schema's revoke prevents.
        expect(error).not.toBeNull();
        expect(data ?? []).toHaveLength(0);
      });

      it('cannot read the private bucket by URL', async () => {
        const publicUrl = must('anon').storage.from(MEMORY_BUCKET).getPublicUrl(objectPath).data
          .publicUrl;
        const response = await fetch(publicUrl);
        expect(response.ok).toBe(false);
      });
    });

    describe('the owner', () => {
      it('finds their own picture through the search, with its configured stamp', async () => {
        const { data, error } = await must('owner').rpc('memory_match_images', {
          p_query: toPgVector(VECTOR),
          p_model: MEMORY_EMBEDDING_MODEL,
          p_version: MEMORY_EMBEDDING_VERSION,
          p_match_count: 5,
        });

        expect(error).toBeNull();
        const rows = (data ?? []) as { image_id: string; image_role: string }[];
        expect(rows.some((row) => row.image_id === imageId)).toBe(true);
        // And only pre-decision roles can ever come back, which is the anti-hindsight rule the SQL
        // enforces rather than the UI.
        expect(rows.every((row) => ['before-setup', 'entry'].includes(row.image_role))).toBe(true);
      });

      it('gets a signed link that serves the exact bytes', async () => {
        const { data, error } = await must('owner').storage
          .from(MEMORY_BUCKET)
          .createSignedUrl(objectPath, 120);
        expect(error).toBeNull();
        expect(data?.signedUrl).toBeTruthy();

        const response = await fetch(data?.signedUrl as string);
        expect(response.ok).toBe(true);
        expect(Buffer.from(await response.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
      });

      it('gets nothing from a signed URL whose token is gone or altered', async () => {
        const { data } = await must('owner').storage
          .from(MEMORY_BUCKET)
          .createSignedUrl(objectPath, 120);
        const signedUrl = new URL(data?.signedUrl as string);

        // The token is the whole of the authorisation: a private object is not readable because a
        // URL looks structurally right.
        const withoutToken = new URL(signedUrl.toString());
        withoutToken.search = '';
        expect((await fetch(withoutToken.toString())).ok).toBe(false);

        const tampered = new URL(signedUrl.toString());
        tampered.searchParams.set('token', 'not-the-token');
        expect((await fetch(tampered.toString())).ok).toBe(false);
      });

      it.runIf(checkExpiry)(
        'gets a 404 once the signed link has expired',
        async () => {
          // Signed directly through the client rather than through `createMemoryImageUrl`, which
          // clamps to a 30-second floor so no screen can hold a link that dies mid-render.
          const { data, error } = await must('owner').storage
            .from(MEMORY_BUCKET)
            .createSignedUrl(objectPath, 1);
          expect(error).toBeNull();
          const signedUrl = data?.signedUrl as string;

          expect((await fetch(signedUrl)).ok).toBe(true);
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          expect((await fetch(signedUrl)).ok).toBe(false);
        },
        20_000
      );
    });

    describe('a second account', () => {
      it('sees none of the first account’s rows', async () => {
        for (const table of ['trading_observations', 'memory_images']) {
          const all = await must('other').from(table).select('id');
          expect(all.data ?? []).toHaveLength(0);

          // Named directly, too: guessing an id must not get you the row.
          const named = await must('other')
            .from(table)
            .select('id')
            .eq('id', table === 'memory_images' ? imageId : observationId);
          expect(named.data ?? []).toHaveLength(0);
        }
      });

      it('cannot call the search and receive the first account’s picture', async () => {
        const { data } = await must('other').rpc('memory_match_images', {
          p_query: toPgVector(VECTOR),
          p_model: MEMORY_EMBEDDING_MODEL,
          p_version: MEMORY_EMBEDDING_VERSION,
          p_match_count: 5,
        });
        // The vector is identical, so a missing `auth.uid()` filter would return the owner's row.
        expect(data ?? []).toHaveLength(0);
      });

      it('cannot update or delete the first account’s observation', async () => {
        await must('other')
          .from('trading_observations')
          .update({ instrument: 'HIJACKED' })
          .eq('id', observationId);
        await must('other').from('trading_observations').delete().eq('id', observationId);

        // The row is still there and unchanged, which is what matters: an update that matched
        // nothing is indistinguishable from one that was refused, and only re-reading proves it.
        const reread = await must('owner')
          .from('trading_observations')
          .select('instrument')
          .eq('id', observationId)
          .single();
        expect(reread.error).toBeNull();
        expect(reread.data?.instrument).toBe('MES');
      });

      it('cannot write an object into the first account’s folder', async () => {
        const { error } = await must('other').storage
          .from(MEMORY_BUCKET)
          .upload(`${ownerId}/${observationId}/intruder.png`, new Blob([PNG_BYTES]), {
            contentType: 'image/png',
          });
        expect(error).not.toBeNull();
      });

      it('cannot sign a link to the first account’s object', async () => {
        const { data, error } = await must('other').storage
          .from(MEMORY_BUCKET)
          .createSignedUrl(objectPath, 120);
        expect(error !== null || !data?.signedUrl).toBe(true);
      });

      /**
       * Known gap, recorded rather than asserted as correct.
       *
       * `memory_images.observation_id` is a single-column foreign key, so it proves the observation
       * exists — not that it belongs to the same trader. Nothing leaks: the search joins on
       * `o.user_id = auth.uid()`, so a row pointing at someone else's observation can never be
       * returned. What it does allow is a pointless cross-tenant row, and an existence oracle for
       * another trader's observation id.
       *
       * Closing it is a two-line schema change (`unique (id, user_id)` on `trading_observations`,
       * then a composite foreign key on `memory_images`), and it is NOT applied here because the
       * new key is validated against existing rows the moment the file is re-run: on a project
       * where any picture already points at another trader's observation, adding it would fail and
       * take the whole file with it. This test flips to a hard failure the moment the key exists,
       * which is the signal to drop the `.fails`.
       */
      it.fails('cannot attach a picture to the first account’s observation', async () => {
        const { error } = await must('other').from('memory_images').insert({
          id: missingBUserId,
          user_id: otherId,
          observation_id: observationId,
          image_role: 'context',
          bucket_id: MEMORY_BUCKET,
          storage_path: `${otherId}/${observationId}/${missingBUserId}.png`,
          indexing_status: 'pending',
        });
        expect(error).not.toBeNull();
      });
    });
  }
);
