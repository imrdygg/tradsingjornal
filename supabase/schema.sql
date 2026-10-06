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
