/**
 * Taking back the last change to the marked-level record.
 *
 * Marking a line, deciding a touch, correcting a price and deleting either one are all one small
 * write to a list. Undo does not keep a snapshot of the whole journal — it keeps the list as it
 * was on either side of that single write, works out exactly what the write changed, and stores
 * the inverse. Reversing by diff rather than by rebuilding is what makes an undone line come
 * back with the same id, so the touches that point at it still resolve, and a price that was only
 * edited returns to the number it had.
 */

/** One reversal step: put an item back as it was, or take a newly added one out. */
export type UndoWrite<T> = { kind: 'restore'; item: T } | { kind: 'remove'; id: string };

/** The inverse of one write, and the words to put on the undo button. */
export interface LevelUndoPlan<T> {
  writes: UndoWrite<T>[];
  label: string;
}

/**
 * Whether two records of the same shape hold the same values.
 *
 * Storage parses its JSON fresh on every read, so two reads of one untouched record are equal by
 * value but never the same object. Comparing by value is what keeps an untouched line out of the
 * undo, so taking back one deletion does not also rewrite every unrelated line's timestamp.
 */
function sameRecord(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The wording for the undo button, named after what the write actually did. */
function labelFor(added: number, removed: number, changed: number, noun: string): string {
  if (removed > 0) {
    return removed === 1 ? `the ${noun} you removed` : `the ${removed} ${noun}s you removed`;
  }
  if (added > 0) {
    return added === 1 ? `the ${noun} you just logged` : `the ${added} ${noun}s you just logged`;
  }
  if (changed > 0) return `the last change to a ${noun}`;
  return 'the last action';
}

/**
 * Works out how to reverse one write, given the list before it and the list after it.
 *
 * Three things can differ between the two lists, and each has an inverse: a record that is new
 * after the write is taken out again, a record that disappeared is put back, and a record whose
 * values changed is restored to the version held before. `noun` names the records — a marked line
 * and a level touch are described differently even though they reverse the same way.
 */
export function describeUndo<T extends { id: string }>(
  before: T[],
  after: T[],
  noun: string
): LevelUndoPlan<T> {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const afterById = new Map(after.map((item) => [item.id, item]));

  const added = after.filter((item) => !beforeById.has(item.id));
  const removed = before.filter((item) => !afterById.has(item.id));
  const changed = before.filter((item) => {
    const now = afterById.get(item.id);
    return now !== undefined && !sameRecord(now, item);
  });

  const writes: UndoWrite<T>[] = [
    ...added.map<UndoWrite<T>>((item) => ({ kind: 'remove', id: item.id })),
    ...removed.map<UndoWrite<T>>((item) => ({ kind: 'restore', item })),
    ...changed.map<UndoWrite<T>>((item) => ({ kind: 'restore', item })),
  ];

  return { writes, label: labelFor(added.length, removed.length, changed.length, noun) };
}

/**
 * Runs an undo plan against whichever record it came from.
 *
 * The writes are applied in the order they were planned — new records are removed before old
 * ones are restored — so a restore can never be undone by a later step of the same plan.
 */
export function applyUndo<T extends { id: string }>(
  writes: UndoWrite<T>[],
  ops: { restore: (item: T) => void; remove: (id: string) => void }
): void {
  for (const write of writes) {
    if (write.kind === 'restore') ops.restore(write.item);
    else ops.remove(write.id);
  }
}
