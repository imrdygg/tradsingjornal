create table if not exists public.journal_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

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
