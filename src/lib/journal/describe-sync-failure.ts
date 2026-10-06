/**
 * Keeps the app's plain-language fallback for cloud failures, unless the error
 * itself carries instructions worth reading (a missing schema column, an
 * unconfigured client). Those are more useful than "sync is unavailable".
 */
export function describeSyncFailure(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  if (/schema\.sql|is not configured/i.test(message)) return message;
  return fallback;
}
