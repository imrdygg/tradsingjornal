/**
 * Weekly bucketing, shared by the analytics trends.
 *
 * Weeks run Monday to Sunday, and the arithmetic is done in UTC: the dates these functions
 * receive are plain calendar dates (YYYY-MM-DD), so reading them in local time would push an
 * entry into the neighbouring week for anyone east or west of the machine that wrote it.
 */

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "2026-09-14" -> "Sep 14". Built by hand so the label never depends on the machine's locale. */
export function formatBucket(bucketKey: string): string {
  const [, month, day] = bucketKey.split('-').map(Number);
  return `${MONTH_LABELS[month - 1] ?? '?'} ${day}`;
}

/** The Monday of the week an ISO date falls in, as YYYY-MM-DD, or null for an unusable date. */
export function weekStart(dateStr: string): string | null {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - sinceMonday);
  return date.toISOString().slice(0, 10);
}
