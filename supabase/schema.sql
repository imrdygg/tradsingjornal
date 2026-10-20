create table if not exists public.journal_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  -- Optimistic concurrency token. The client sends the revision it last read and
  -- the update only matches while that is still current, so a second device
  -- cannot silently flatten the first one's journal: the refused write is
  -- reported and the trader chooses which copy to keep.
  revision bigint not null default 1
);

-- Existing projects created the table without the column, so add it in place.
-- `if not exists` keeps this whole file safe to re-run.
alter table public.journal_snapshots
  add column if not exists revision bigint not null default 1;

alter table public.journal_snapshots enable row level security;

drop policy if exists "Users can read their own journal" on public.journal_snapshots;
create policy "Users can read their own journal"
  on public.journal_snapshots for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own journal" on public.journal_snapshots;
create policy "Users can insert their own journal"
  on public.journal_snapshots for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own journal" on public.journal_snapshots;
create policy "Users can update their own journal"
  on public.journal_snapshots for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Trade / playbook videos
--
-- Images stay inline in the journal snapshot (they are small), but videos are
-- megabytes, so they are uploaded to this bucket instead and the journal only
-- stores the URL. Files live under <user-id>/<timestamp>-<random>.<ext>, so the
-- policies below let a user write and delete only inside their own folder.
--
-- The bucket is public because the app plays clips straight from the stored URL
-- without an async signed-URL round trip. Paths contain a random suffix so they
-- cannot be guessed, and only the owner can write/delete. Switch `public` to
-- false and use createSignedUrl if you would rather clips were never
-- URL-accessible.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('journal-media', 'journal-media', true)
on conflict (id) do update set public = true;

drop policy if exists "Users can upload their own media" on storage.objects;
create policy "Users can upload their own media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'journal-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can read their own media" on storage.objects;
create policy "Users can read their own media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'journal-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their own media" on storage.objects;
create policy "Users can delete their own media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'journal-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- The coach's shared rate limit
--
-- The coach endpoint spends a paid Gemini key, so it needs a ceiling on how often one trader
-- may ask. Counted only in the endpoint's memory that ceiling was per running instance and
-- reset on a cold start -- a speed bump rather than a quota. The table below makes it global:
-- every instance spends from the same row, keyed on the signed-in user.
--
-- The endpoint calls coach_consume_quota with the caller's own access token, so row-level
-- security -- not a service-role key -- is what keeps a trader inside their own row. The
-- anonymous fallback keeps its in-memory per-IP counter instead, and only ever runs on a
-- deployment with no Supabase project to share a row with.
-- ---------------------------------------------------------------------------

create table if not exists public.coach_quota (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0
);

alter table public.coach_quota enable row level security;

drop policy if exists "Users can spend their own coach quota" on public.coach_quota;
create policy "Users can spend their own coach quota"
  on public.coach_quota for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Explicit so the function below works whatever the project's default privileges are.
-- RLS, not the grant, is what scopes a trader to their own row.
grant select, insert, update on public.coach_quota to authenticated;

-- Spends one unit of the caller's allowance and reports what is left.
--
-- SECURITY INVOKER on purpose: it runs as the signed-in caller, so RLS and auth.uid()
-- below are theirs. The `for update` lock serialises concurrent requests from the same
-- trader, so two instances cannot both read the same count and both write count + 1.
create or replace function public.coach_consume_quota(
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window interval := make_interval(secs => greatest(1, p_window_seconds));
  v_started timestamptz;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'coach_consume_quota requires a signed-in user'
      using errcode = '28000';
  end if;

  insert into public.coach_quota (user_id, window_started_at, request_count)
  values (auth.uid(), v_now, 0)
  on conflict (user_id) do nothing;

  select q.window_started_at, q.request_count
    into v_started, v_count
    from public.coach_quota q
   where q.user_id = auth.uid()
     for update;

  -- Roll the window over when it has expired, so the count is measured within it.
  if v_started is null or v_now - v_started >= v_window then
    v_started := v_now;
    v_count := 0;
  end if;

  if v_count >= greatest(1, p_limit) then
    return query
      select false,
             0,
             greatest(1, ceil(extract(epoch from (v_started + v_window - v_now)))::int);
    return;
  end if;

  v_count := v_count + 1;

  update public.coach_quota
     set window_started_at = v_started,
         request_count = v_count
   where user_id = auth.uid();

  return query select true, greatest(0, p_limit - v_count), 0;
end;
$$;

-- Only a signed-in caller can spend an allowance; the anonymous role has no identity to key
-- a row on and keeps the in-memory per-IP counter instead.
revoke all on function public.coach_consume_quota(integer, integer) from public;
revoke all on function public.coach_consume_quota(integer, integer) from anon;
grant execute on function public.coach_consume_quota(integer, integer) to authenticated;

-- ===========================================================================
-- Trading Memory — private screenshot storage and the observation index
--
-- Everything below is additive. It creates new objects and changes no existing
-- one, so re-running this file against a live project cannot damage the journal
-- snapshot, the coach quota ledger, or the media already in `journal-media`.
--
-- Why a SECOND bucket rather than making `journal-media` private
-- ---------------------------------------------------------------------------
-- `journal-media` is public and its object URLs are stored as the canonical
-- address of videos already attached to trades and lessons. Flipping that flag
-- would break every stored clip at once, with no way to tell from the database
-- which records had been affected. So the private home for chart screenshots is
-- a new bucket, and existing media is left exactly where it is until a staged
-- migration has re-pointed it.
--
-- KNOWN GAP, deliberately not closed here: `journal-media` stays public-read, and
-- the line above it still re-asserts `public = true` on every re-run. Any video
-- already attached to a trade is therefore reachable by anyone holding its URL
-- (paths carry a random suffix, so they cannot be guessed). Closing that means
-- re-pointing every stored video URL at a private bucket and switching the app to
-- signed URLs — a migration that has to run before the flag moves, which is why
-- it is not attempted in the same change as the new bucket.
--
-- The private bucket is named `journal-memory` and holds the chart screenshots
-- the memory engine indexes. Nothing in it is public, so every read goes through
-- a short-lived signed URL; the row keeps the object's path, never the signed
-- URL, because a signed URL expires and is not an identifier.
-- ===========================================================================

-- pgvector: the embedding type and the cosine-distance operator the search uses.
-- Supabase installs extensions into the `extensions` schema, which is on the
-- default search_path; the functions below name it explicitly so they keep working
-- on a project where it landed in `public` instead.
create extension if not exists vector;

insert into storage.buckets (id, name, public)
values ('journal-memory', 'journal-memory', false)
-- `do update set public = false` rather than `do nothing`: re-running this file is
-- the normal upgrade path, and it must never be able to hand public access back to
-- a bucket that has been made private.
on conflict (id) do update set public = false;

drop policy if exists "Users can upload their own memory images" on storage.objects;
create policy "Users can upload their own memory images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'journal-memory'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can read their own memory images" on storage.objects;
create policy "Users can read their own memory images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'journal-memory'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their own memory images" on storage.objects;
create policy "Users can delete their own memory images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'journal-memory'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Observations: a market situation the trader recorded
--
-- An observation is deliberately NOT a trade. Limiting the memory to executed
-- trades would bias it in one direction only: the trader would be able to ask
-- "what happened the last times I took this setup", but never "what happened the
-- last times I SAW this setup", and those are different questions with different
-- answers. An observation can therefore exist on its own, with a trade attached
-- when there was one.
--
-- The primary key is text and is the CLIENT's own record id rather than a
-- server-generated uuid. That is what makes the whole subsystem idempotent:
-- observations travel in the journal snapshot and are re-offered to this table on
-- every sync, and a row keyed by its own id can be upserted any number of times
-- without producing a second copy. `linked_trade_id` is text for the same reason —
-- it points at a trade id that lives in the snapshot, not at a row in here.
-- ---------------------------------------------------------------------------

create table if not exists public.trading_observations (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The journal trade this observation belongs to, when one was taken. Text, not a
  -- foreign key: trades live in the journal snapshot, not in this schema.
  linked_trade_id text,
  -- When the situation was observed — the trader's decision moment.
  observed_at timestamptz not null,
  -- Where `observed_at` came from. 'upload-time' is a weaker claim than 'recorded'
  -- and is treated as uncertain by the replay filter below rather than trusted.
  observed_at_source text not null default 'recorded',
  market_timezone text not null default 'America/New_York',
  instrument text not null,
  timeframe text,
  session_type text,
  setup_id text,
  setup_name text,
  setup_category text,
  previous_trend text,
  observed_direction text,
  market_context text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trading_observations_user_time_idx
  on public.trading_observations (user_id, observed_at desc);
create index if not exists trading_observations_user_instrument_idx
  on public.trading_observations (user_id, instrument);

-- ---------------------------------------------------------------------------
-- Memory images: one screenshot, its private object, and its embedding
--
-- The embedding the search reads is stored beside the object rather than derived
-- on demand, so a search costs one embedding of the query image and one vector
-- lookup — not one model call per historical screenshot.
--
-- `image_role` is the guard against future-information leakage and is the single
-- most important column here. A chart that shows candles printed AFTER the entry
-- is not evidence that was available at the decision point, and matching against it
-- would let the system "find" a setup using hindsight. `memory_match_images`
-- therefore reads only pre-decision roles, so the exclusion is enforced by the
-- database rather than by the UI that happens to call it.
--
-- The model name, version and dimension travel with every vector because vectors
-- from different models (or different dimensions) are not comparable. The match
-- function rejects a row whose configuration does not match the query's, so two
-- generations of embeddings can never be silently mixed into one ranking.
-- ---------------------------------------------------------------------------

create table if not exists public.memory_images (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  observation_id text not null references public.trading_observations(id) on delete cascade,
  linked_trade_id text,
  image_role text not null default 'context',
  bucket_id text not null default 'journal-memory',
  storage_path text not null,
  -- SHA-256 of the image bytes. Doubles as the change detector: a screenshot whose
  -- checksum moved is a different picture and must be re-embedded, while an
  -- identical re-upload is recognised and skipped.
  image_checksum text,
  -- What the trader saw in this picture, in their own words. One note per picture rather
  -- than one per observation: a multi-day view and a zoomed entry are two observations, and
  -- the coach reads these notes to find a repeated pattern.
  note text,
  width integer,
  height integer,
  mime_type text,
  captured_at timestamptz,
  embedding_model text,
  embedding_version integer,
  embedding_dimension integer,
  embedding vector(768),
  indexing_status text not null default 'pending',
  indexing_error text,
  indexed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One object per path per user: a re-upload that reuses the path cannot become a
  -- second row, which is what stops a retried migration from duplicating an image.
  constraint memory_images_user_path_key unique (user_id, storage_path),
  -- The same picture logged twice against one observation is one picture. Across two
  -- observations it is two legitimate rows, so the scope stops at the observation.
  constraint memory_images_observation_checksum_key unique (observation_id, image_checksum)
);

create index if not exists memory_images_user_observation_idx
  on public.memory_images (user_id, observation_id);

-- Added after the table shipped, so an existing project picks it up without being dropped.
-- `create table if not exists` above is a no-op on a database that already has the table.
alter table public.memory_images add column if not exists note text;
-- Only indexed rows are ever searched, so the partial index keeps the candidate set
-- to exactly what the match function will consider.
create index if not exists memory_images_searchable_idx
  on public.memory_images (user_id, indexing_status, image_role)
  where embedding is not null;
-- Approximate nearest-neighbour over cosine distance, the metric both the
-- embedding model and the resemblance score below are built on. HNSW is added now
-- rather than "when it is needed": it costs one statement and no infrastructure,
-- and a personal library reaches the thousands of screenshots where a sequential
-- scan starts to show well before the trader would think to add it.
create index if not exists memory_images_embedding_idx
  on public.memory_images using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Outcomes: what price did afterwards, and what the trader did
--
-- Kept in its own table and its own vocabulary because these are two different
-- facts that must never be averaged together. The market can continue upward after
-- a setup while the trader's own trade loses money — an early exit, a poor entry, a
-- stop in the wrong place — and a system that reports one number for both would be
-- claiming a market result it does not have and hiding an execution result it does.
--
-- `outcome_status` defaults to 'unknown' and unknown is a first-class answer.
-- `measured_market_movement` and the two excursion columns are nullable on purpose:
-- the journal records no continuous price history for an observation, so those can
-- only be filled from something the trader actually documented, and a null must mean
-- "not recorded" rather than be quietly read as zero.
-- ---------------------------------------------------------------------------

create table if not exists public.memory_outcomes (
  observation_id text primary key references public.trading_observations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  outcome_status text not null default 'unknown',
  -- The horizon the reading is about ("30 minutes after the open", "end of session").
  outcome_window text,
  -- The moment the observation must have existed before to count, used by replay.
  observation_cutoff timestamptz,
  continuation_or_reversal text,
  measured_market_movement numeric,
  max_favorable_excursion numeric,
  max_adverse_excursion numeric,
  outcome_source text not null default 'trader-recorded',
  verified_at timestamptz,
  notes text,
  updated_at timestamptz not null default now()
);

create index if not exists memory_outcomes_user_status_idx
  on public.memory_outcomes (user_id, outcome_status);

-- ---------------------------------------------------------------------------
-- Search history
--
-- Saved so the trader can see which of their charts found real matches, and so a
-- retrieval change can be judged against searches already made. It is capped rather
-- than unbounded: `expires_at` is stamped on every row and `memory_prune_searches`
-- deletes what has aged out, because a table that only ever grows is a table that
-- eventually costs money for rows nobody will read again.
-- ---------------------------------------------------------------------------

create table if not exists public.memory_searches (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  searched_at timestamptz not null default now(),
  -- Which image was asked about, by checksum rather than by URL: the query image is
  -- often not an observation at all (it is today's chart), so it usually has no row.
  query_checksum text,
  filters jsonb not null default '{}'::jsonb,
  matched_observation_ids text[] not null default '{}',
  retrieval_model text,
  retrieval_version integer,
  result_metadata jsonb not null default '{}'::jsonb,
  -- The trader's own 'strong match' / 'partial match' / 'wrong match' verdicts. Kept as
  -- a record of what they judged, NOT as training signal: nothing here retrains the model.
  feedback jsonb,
  expires_at timestamptz not null default (now() + interval '90 days')
);

create index if not exists memory_searches_user_time_idx
  on public.memory_searches (user_id, searched_at desc);
create index if not exists memory_searches_expiry_idx
  on public.memory_searches (expires_at);

-- ---------------------------------------------------------------------------
-- Indexing jobs
--
-- A backfill over a library of screenshots is a long, interruptible, paid operation:
-- it talks to a rate-limited API once per image. The job row is what makes it
-- resumable — `cursor` is where it got to, and the item counters say what happened —
-- and `status` makes it honest: a run that stopped is 'cancelled' or 'failed', never
-- reported as finished.
-- ---------------------------------------------------------------------------

create table if not exists public.memory_index_jobs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'backfill',
  status text not null default 'pending',
  total_items integer not null default 0,
  processed_items integer not null default 0,
  failed_items integer not null default 0,
  skipped_items integer not null default 0,
  -- The last item handled, so a resumed run continues instead of starting over.
  cursor text,
  model text,
  embedding_version integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists memory_index_jobs_user_idx
  on public.memory_index_jobs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security on every new table
--
-- RLS is the boundary here, not the application. The browser talks to these tables
-- with the anon key and the trader's own session, so a policy that scopes every
-- statement to `auth.uid() = user_id` is what makes a guessed observation id useless:
-- the row simply is not in the result set, whichever query asked for it.
-- ---------------------------------------------------------------------------

alter table public.trading_observations enable row level security;
alter table public.memory_images enable row level security;
alter table public.memory_outcomes enable row level security;
alter table public.memory_searches enable row level security;
alter table public.memory_index_jobs enable row level security;

drop policy if exists "Users own their observations" on public.trading_observations;
create policy "Users own their observations"
  on public.trading_observations for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users own their memory images" on public.memory_images;
create policy "Users own their memory images"
  on public.memory_images for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users own their outcomes" on public.memory_outcomes;
create policy "Users own their outcomes"
  on public.memory_outcomes for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users own their searches" on public.memory_searches;
create policy "Users own their searches"
  on public.memory_searches for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users own their indexing jobs" on public.memory_index_jobs;
create policy "Users own their indexing jobs"
  on public.memory_index_jobs for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.trading_observations to authenticated;
grant select, insert, update, delete on public.memory_images to authenticated;
grant select, insert, update, delete on public.memory_outcomes to authenticated;
grant select, insert, update, delete on public.memory_searches to authenticated;
grant select, insert, update, delete on public.memory_index_jobs to authenticated;

-- ---------------------------------------------------------------------------
-- The similarity search
--
-- SECURITY INVOKER, on purpose, exactly like `coach_consume_quota` above: the
-- function runs as the signed-in caller, so `auth.uid()` is theirs and RLS applies to
-- the rows it reads. A SECURITY DEFINER version would run as the owner and could
-- return another trader's rows if the WHERE clause were ever wrong, which is a bad
-- property to give the one query that returns private screenshots.
--
-- There is no `p_user_id` parameter for the same reason. The caller cannot name the
-- owner they want to search, only their own embedding.
--
-- The exclusions are the point of the whole function:
--   * only roles that were visible BEFORE the decision are candidates (no hindsight);
--   * only rows whose indexing finished, with an embedding present;
--   * only rows embedded by the SAME model and version as the query — vectors from a
--     different configuration are not on the same scale and must never be ranked
--     against each other;
--   * `p_cutoff` drops every observation at or after it, which is what makes a
--     historical replay a replay rather than a search that can see the future.
-- ---------------------------------------------------------------------------

create or replace function public.memory_match_images(
  p_query vector(768),
  p_match_count integer default 12,
  p_model text default null,
  p_version integer default null,
  p_roles text[] default array['before-setup', 'entry'],
  p_instrument text default null,
  p_timeframe text default null,
  p_session text default null,
  p_setup_name text default null,
  p_cutoff timestamptz default null
)
returns table (
  observation_id text,
  image_id text,
  image_role text,
  storage_path text,
  cosine_distance double precision,
  observed_at timestamptz,
  instrument text,
  timeframe text,
  session_type text,
  setup_name text,
  linked_trade_id text
)
language plpgsql
security invoker
-- `extensions` is named because pgvector lives there on Supabase; `public` keeps the
-- project's own tables reachable. Nothing outside these two is on the path, so a
-- function name in another schema cannot be shadowed into this one.
set search_path = public, extensions
as $$
declare
  v_limit integer := least(greatest(coalesce(p_match_count, 12), 1), 100);
begin
  -- Fail closed. Without this, a null `auth.uid()` would compare `user_id = null`,
  -- which is never true, so the function would return nothing — safe by accident. It is
  -- raised explicitly so the reason is a message rather than an empty result.
  if auth.uid() is null then
    raise exception 'memory_match_images requires a signed-in user'
      using errcode = '28000';
  end if;

  return query
    select i.observation_id,
           i.id,
           i.image_role,
           i.storage_path,
           (i.embedding <=> p_query)::double precision,
           o.observed_at,
           o.instrument,
           o.timeframe,
           o.session_type,
           o.setup_name,
           o.linked_trade_id
      from public.memory_images i
      join public.trading_observations o on o.id = i.observation_id
     where i.user_id = auth.uid()
       and o.user_id = auth.uid()
       and i.embedding is not null
       and i.indexing_status = 'completed'
       and i.image_role = any (p_roles)
       -- Same embedding configuration as the query. A null on either side is rejected
       -- rather than treated as a wildcard: an unstamped vector cannot be compared.
       and p_model is not null and i.embedding_model = p_model
       and p_version is not null and i.embedding_version = p_version
       and (p_instrument is null or o.instrument = p_instrument)
       and (p_timeframe is null or o.timeframe = p_timeframe)
       and (p_session is null or o.session_type = p_session)
       and (p_setup_name is null or o.setup_name = p_setup_name)
       -- Chronology: strictly before the cutoff. Nothing from the cutoff instant or
       -- later may be treated as knowable at the cutoff.
       and (p_cutoff is null or o.observed_at < p_cutoff)
     order by i.embedding <=> p_query
     limit v_limit;
end;
$$;

-- The argument list is left off on purpose, which PostgreSQL allows while the name is unique in
-- its schema. Writing it out would mean naming the `vector` type here as well, and that type lives
-- in whichever schema the extension was installed into — `extensions` on Supabase, `public`
-- elsewhere — so a literal signature would make this file fail on one of the two.
-- By default PostgreSQL grants EXECUTE on every new function to PUBLIC, so the revoke is the part
-- that matters: without it the anonymous role could call the search.
revoke all on function public.memory_match_images from public;
revoke all on function public.memory_match_images from anon;
grant execute on function public.memory_match_images to authenticated;

-- ---------------------------------------------------------------------------
-- Search-history retention
--
-- The documented policy: ninety days, enforced by a function the trader (or a
-- scheduled job of their choosing) can run, rather than by a trigger. Retention is a
-- decision about their own history, so it stays an explicit call they can make and
-- read the result of.
-- ---------------------------------------------------------------------------

create or replace function public.memory_prune_searches(p_keep_days integer default 90)
returns integer
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_deleted integer;
begin
  if auth.uid() is null then
    raise exception 'memory_prune_searches requires a signed-in user'
      using errcode = '28000';
  end if;

  delete from public.memory_searches
   where user_id = auth.uid()
     and searched_at < now() - make_interval(days => greatest(1, coalesce(p_keep_days, 90)));

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.memory_prune_searches from public;
revoke all on function public.memory_prune_searches from anon;
grant execute on function public.memory_prune_searches to authenticated;
