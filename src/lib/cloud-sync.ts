import { supabase } from './supabase';
import { StorageState } from './storage';

export async function loadOrMigrateJournal(userId: string, localState: StorageState): Promise<StorageState> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase
    .from('journal_snapshots')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;

  if (data?.data) {
    return data.data as StorageState;
  }

  await saveJournal(userId, localState);
  return localState;
}

export async function saveJournal(userId: string, state: StorageState): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { error } = await supabase.from('journal_snapshots').upsert(
    {
      user_id: userId,
      data: state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) throw error;
}
