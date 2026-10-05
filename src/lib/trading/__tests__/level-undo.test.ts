import { describe, it, expect, vi } from 'vitest';
import { applyUndo, describeUndo, type UndoWrite } from '../level-undo';

/** A stand-in record: only the id and one value matter to the planner. */
interface Row {
  id: string;
  price: number;
}

const row = (id: string, price: number): Row => ({ id, price });

/** Applies a plan the way the app does, collecting the calls instead of writing storage. */
function run<T extends { id: string }>(writes: UndoWrite<T>[]) {
  const restore = vi.fn();
  const remove = vi.fn();
  applyUndo(writes, { restore, remove });
  return { restore, remove };
}

describe('describeUndo', () => {
  it('takes a newly marked line back out', () => {
    const before = [row('a', 7760)];
    const after = [row('b', 7750), row('a', 7760)];

    const plan = describeUndo(before, after, 'line');

    expect(plan.writes).toEqual([{ kind: 'remove', id: 'b' }]);
    expect(plan.label).toBe('the line you just logged');
    const { restore, remove } = run(plan.writes);
    expect(restore).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('b');
  });

  it('puts a removed line back with the same record it had', () => {
    const kept = row('a', 7760);
    const deleted = row('b', 7750);
    const before = [kept, deleted];
    const after = [kept];

    const plan = describeUndo(before, after, 'line');

    expect(plan.writes).toEqual([{ kind: 'restore', item: deleted }]);
    expect(plan.label).toBe('the line you removed');
    const { restore, remove } = run(plan.writes);
    expect(remove).not.toHaveBeenCalled();
    // Restored by identity, so the record keeps its id and anything pointing at it still resolves.
    expect(restore).toHaveBeenCalledWith(deleted);
  });

  it('restores the earlier value of an edited line', () => {
    const before = [row('a', 7760)];
    const after = [row('a', 7742.25)];

    const plan = describeUndo(before, after, 'line');

    expect(plan.writes).toEqual([{ kind: 'restore', item: row('a', 7760) }]);
    expect(plan.label).toBe('the last change to a line');
    const { restore } = run(plan.writes);
    expect(restore).toHaveBeenCalledWith(before[0]);
  });

  it('leaves untouched records out, even though each read is a fresh object', () => {
    const before = [row('a', 7760), row('b', 7750)];
    // Same values, brand new objects — exactly what a second storage read returns.
    const after = [row('b', 7750), row('a', 7760), row('c', 7740)];

    const plan = describeUndo(before, after, 'line');

    expect(plan.writes).toEqual([{ kind: 'remove', id: 'c' }]);
  });

  it('counts a batch of marked lines', () => {
    const plan = describeUndo<Row>([], [row('a', 1), row('b', 2), row('c', 3)], 'line');
    expect(plan.label).toBe('the 3 lines you just logged');
    expect(plan.writes).toHaveLength(3);
  });

  it('counts a batch of removed lines', () => {
    const before = [row('a', 1), row('b', 2)];
    const plan = describeUndo(before, [], 'line');
    expect(plan.label).toBe('the 2 lines you removed');
    expect(plan.writes).toEqual([
      { kind: 'restore', item: row('a', 1) },
      { kind: 'restore', item: row('b', 2) },
    ]);
  });

  it('has nothing to reverse when the write changed nothing', () => {
    const before = [row('a', 7760)];
    const plan = describeUndo(before, [row('a', 7760)], 'line');
    expect(plan.writes).toEqual([]);
    expect(plan.label).toBe('the last action');
  });

  it('names touches as touches, not lines', () => {
    const plan = describeUndo([row('t1', 7760)], [], 'touch');
    expect(plan.label).toBe('the touch you removed');
  });
});

describe('applyUndo', () => {
  it('removes new records before restoring existing ones', () => {
    const order: string[] = [];
    applyUndo<Row>(
      [
        { kind: 'remove', id: 'new' },
        { kind: 'restore', item: row('old', 1) },
      ],
      {
        restore: (item) => order.push(`restore:${item.id}`),
        remove: (id) => order.push(`remove:${id}`),
      }
    );
    expect(order).toEqual(['remove:new', 'restore:old']);
  });
});
