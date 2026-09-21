import { useSyncExternalStore } from 'react';
import { getStorageFailure, subscribeToStorageFailure } from './index';
import type { StorageFailure } from './index';

/**
 * The current journal storage failure, or null when saving is healthy.
 *
 * Read through `useSyncExternalStore` so every component sees the same value
 * and re-renders the moment a write fails, however deep in the app the write
 * happened — the storage layer is a plain module, not React state.
 */
export function useStorageFailure(): StorageFailure | null {
  return useSyncExternalStore(subscribeToStorageFailure, getStorageFailure, () => null);
}
