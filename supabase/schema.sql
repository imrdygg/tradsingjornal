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
