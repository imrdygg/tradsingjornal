import { describe, it, expect } from 'vitest';
import {
  CHRONIC_REPEAT_COUNT,
  DEFAULT_SIMILARITY_THRESHOLD,
  findLessonRecurrence,
  findSimilarLessons,
  lessonRepeatCounts,
  RECURRING_REPEAT_COUNT,
} from '../lesson-recurrence';
import type { Lesson, LessonKind } from '../../../types';

/** A lesson with only the fields this module reads spelled out, so each test says its point. */
function lesson(partial: Partial<Lesson> & { id: string; title: string }): Lesson {
  return {
    userId: 'u1',
    notes: '',
    kind: 'pattern',
    createdAt: '2026-09-20T09:00:00.000Z',
    updatedAt: '2026-09-20T09:00:00.000Z',
    ...partial,
  } as Lesson;
}

/** Five lessons that share a title, spread over consecutive days. */
function identicalRun(count: number, options: { kind?: LessonKind; tags?: string[] } = {}): Lesson[] {
  return Array.from({ length: count }, (_, index) =>
    lesson({
      id: `l${index + 1}`,
      title: 'Overnight high sweeps the pre-open range',
      notes: 'The sweep takes the stops above the range, then the move fades back inside it.',
      kind: options.kind ?? 'mistake',
      tags: options.tags ?? ['liquidity', 'pre-open'],
      createdAt: `2026-09-0${index + 1}T09:00:00.000Z`,
    })
  );
}

describe('findLessonRecurrence', () => {
  it('is empty for a journal with nothing in it', () => {
    const report = findLessonRecurrence([]);

    expect(report.total).toBe(0);
    expect(report.clusters).toEqual([]);
    expect(report.terms).toEqual([]);
    expect(report.empty).toBe(true);
  });

  it('never calls a single lesson a repeat', () => {
    const report = findLessonRecurrence([
      lesson({ id: 'only', title: 'Overnight high sweeps the pre-open range' }),
    ]);

    expect(report.total).toBe(1);
    expect(report.clusters).toEqual([]);
    // One lesson cannot share a term with itself any more than it can repeat itself.
    expect(report.terms).toEqual([]);
    expect(report.empty).toBe(true);
  });

  it('clusters two lessons that are the same finding in different words', () => {
    const report = findLessonRecurrence([
      lesson({
        id: 'first',
        title: 'Overnight high gets swept before the open reverses',
        createdAt: '2026-09-10T09:00:00.000Z',
      }),
      lesson({
        id: 'second',
        title: 'Pre-open sweep of the overnight high reverses',
        createdAt: '2026-09-18T09:00:00.000Z',
      }),
    ]);

    expect(report.clusters).toHaveLength(1);
    const cluster = report.clusters[0];
    expect(cluster.count).toBe(2);
    expect(cluster.level).toBe('emerging');
    // The finding is named by the first time it was written down.
    expect(cluster.representativeId).toBe('first');
    expect(cluster.lessonIds).toEqual(['first', 'second']);
    expect(cluster.firstDate).toBe('2026-09-10');
    expect(cluster.lastDate).toBe('2026-09-18');
    expect(cluster.spanDays).toBe(8);
    expect(report.clusteredLessons).toBe(2);
  });

  it('leaves lessons about different things apart', () => {
    const report = findLessonRecurrence([
      lesson({ id: 'a', title: 'FOMO chase into the open drive' }),
      lesson({ id: 'b', title: 'Stop moved on the last runner' }),
    ]);

    expect(report.clusters).toEqual([]);
    expect(report.empty).toBe(true);
  });

  it('links two differently worded lessons that share the trader’s tags', () => {
    const report = findLessonRecurrence([
      lesson({
        id: 'a',
        title: 'Overnight high gets swept',
        tags: ['liquidity', 'pre-open'],
      }),
      lesson({
        id: 'b',
        title: 'Range compresses before the drive',
        tags: ['liquidity', 'pre-open'],
      }),
    ]);

    expect(report.clusters).toHaveLength(1);
    expect(report.clusters[0].lessonIds).toEqual(['a', 'b']);
    expect(report.clusters[0].sharedTags).toEqual(['liquidity', 'pre-open']);
  });

  it('needs the full shared-tag rule, not a single common tag', () => {
    // One tag in common is not enough on its own; the wording has to agree too.
    const report = findLessonRecurrence([
      lesson({ id: 'a', title: 'Overnight high gets swept', tags: ['liquidity'] }),
      lesson({ id: 'b', title: 'Range compresses before the drive', tags: ['liquidity'] }),
    ]);

    expect(report.clusters).toEqual([]);
  });

  it('ignores stopwords, punctuation and case when comparing titles', () => {
    const report = findLessonRecurrence([
      lesson({ id: 'a', title: 'Overnight high!' }),
      lesson({ id: 'b', title: '  overnight   HIGH  ' }),
    ]);

    expect(report.clusters).toHaveLength(1);
  });

  it('collapses a plural or a gerund, so “sweep” and “sweeps” are the same word', () => {
    const report = findLessonRecurrence([
      lesson({ id: 'a', title: 'Overnight high sweep reverses the range' }),
      lesson({ id: 'b', title: 'Overnight high sweeps reverses the range' }),
    ]);

    expect(report.clusters).toHaveLength(1);
    // The chip reads as a word the trader would recognise, not as the stem it compares by.
    expect(report.terms.find((term) => term.term === 'revers')?.label).toBe('reverses');
  });

  it('counts recurring terms even when no two lessons cluster', () => {
    const report = findLessonRecurrence(
      [
        lesson({ id: 'a', title: 'Overnight high sweep', createdAt: '2026-09-01T09:00:00.000Z' }),
        lesson({ id: 'b', title: 'Overnight low fail', createdAt: '2026-09-02T09:00:00.000Z' }),
        lesson({ id: 'c', title: 'Overnight range hold', createdAt: '2026-09-03T09:00:00.000Z' }),
      ],
      // Force the wording apart so this tests terms on their own, not clustering.
      { similarityThreshold: 0.99 }
    );

    expect(report.clusters).toEqual([]);
    const overnight = report.terms.find((term) => term.term === 'overnight');
    expect(overnight).toBeDefined();
    expect(overnight?.label).toBe('overnight');
    expect(overnight?.lessons).toBe(3);
    expect(overnight?.lessonIds).toEqual(['a', 'b', 'c']);
    expect(report.empty).toBe(false);
  });

  it('ranks the most-shared term first and drops a one-off word', () => {
    const report = findLessonRecurrence(
      [
        lesson({ id: 'a', title: 'Overnight high sweep' }),
        lesson({ id: 'b', title: 'Overnight low fail' }),
        lesson({ id: 'c', title: 'Liquidity grab fail' }),
      ],
      { similarityThreshold: 0.99 }
    );

    // "overnight" is in two lessons; "fail" is in two; "liquidity" and "sweep" are in one each.
    expect(report.terms.map((term) => term.term)).toEqual(['fail', 'overnight']);
    expect(report.terms.map((term) => term.lessons)).toEqual([2, 2]);
    expect(report.terms.some((term) => term.term === 'sweep')).toBe(false);
  });

  it('reads a run of five as chronic and a run of three as recurring', () => {
    const chronic = findLessonRecurrence(identicalRun(CHRONIC_REPEAT_COUNT));
    expect(chronic.clusters[0].count).toBe(CHRONIC_REPEAT_COUNT);
    expect(chronic.clusters[0].level).toBe('chronic');

    const recurring = findLessonRecurrence(identicalRun(RECURRING_REPEAT_COUNT));
    expect(recurring.clusters[0].level).toBe('recurring');
  });

  it('reports the kinds it finds and lets the most common one lead', () => {
    const lessons = identicalRun(2, { kind: 'mistake' });
    lessons.push(
      lesson({
        id: 'third',
        title: 'Overnight high sweeps the pre-open range',
        kind: 'psychology',
        createdAt: '2026-09-09T09:00:00.000Z',
      })
    );

    const cluster = findLessonRecurrence(lessons).clusters[0];
    expect(cluster.count).toBe(3);
    expect(cluster.dominantKind).toBe('mistake');
    expect(cluster.kinds).toContain('psychology');
  });

  it('orders clusters by how often they repeat, strongest first', () => {
    const report = findLessonRecurrence([
      // A run of three about the overnight sweep.
      ...identicalRun(3, { kind: 'mistake' }),
      // Two about a different repeating idea.
      lesson({ id: 'r1', title: 'Chased the open after a loss', createdAt: '2026-09-02T09:00:00.000Z' }),
      lesson({ id: 'r2', title: 'Chased the open after a loss', createdAt: '2026-09-03T09:00:00.000Z' }),
    ]);

    expect(report.clusters.map((cluster) => cluster.count)).toEqual([3, 2]);
  });

  it('respects a raised similarity threshold', () => {
    const lessons = [
      lesson({ id: 'a', title: 'Overnight high sweep reverses the open' }),
      lesson({ id: 'b', title: 'Overnight high sweep fails at the open' }),
    ];

    // At the default they are close enough to group; at 0.95 they are plainly different notes.
    expect(findLessonRecurrence(lessons).clusters).toHaveLength(1);
    expect(findLessonRecurrence(lessons, { similarityThreshold: 0.95 }).clusters).toEqual([]);
    expect(DEFAULT_SIMILARITY_THRESHOLD).toBeLessThan(0.95);
  });

  it('caps the number of clusters and terms it returns', () => {
    const lessons = [
      ...identicalRun(3),
      lesson({ id: 'r1', title: 'Chased the open after a loss' }),
      lesson({ id: 'r2', title: 'Chased the open after a loss' }),
    ];

    const report = findLessonRecurrence(lessons, { maxClusters: 1, maxTerms: 1 });
    expect(report.clusters).toHaveLength(1);
    expect(report.terms).toHaveLength(1);
  });

  it('is deterministic — the same lessons read the same way every time', () => {
    const lessons = identicalRun(4);
    const first = findLessonRecurrence(lessons);
    const second = findLessonRecurrence(lessons);
    expect(second).toEqual(first);
  });
});

describe('findSimilarLessons', () => {
  it('says nothing when no saved lesson reads like the draft', () => {
    const matches = findSimilarLessons(
      { title: 'Chased the open after a loss' },
      [lesson({ id: 'a', title: 'Overnight high sweep reverses' })]
    );

    expect(matches).toEqual([]);
  });

  it('flags a draft that is the same finding in different words', () => {
    const matches = findSimilarLessons(
      { title: 'Pre-open sweep of the overnight high reverses' },
      [
        lesson({
          id: 'old',
          title: 'Overnight high gets swept before the open reverses',
        }),
      ]
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].lesson.id).toBe('old');
    expect(matches[0].reason).toBe('wording');
    expect(matches[0].similarity).toBeGreaterThanOrEqual(DEFAULT_SIMILARITY_THRESHOLD);
  });

  it('links a differently worded draft through the tags it shares', () => {
    const matches = findSimilarLessons(
      { title: 'Range compresses before the drive', tags: ['liquidity', 'pre-open'] },
      [
        lesson({
          id: 'old',
          title: 'Overnight high gets swept',
          tags: ['liquidity', 'pre-open'],
        }),
      ]
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].reason).toBe('tags');
    expect(matches[0].sharedTags).toEqual(['liquidity', 'pre-open']);
  });

  it('never matches a lesson against itself while it is being edited', () => {
    const matches = findSimilarLessons(
      { id: 'same', title: 'Overnight high sweep reverses' },
      [lesson({ id: 'same', title: 'Overnight high sweep reverses' })]
    );

    expect(matches).toEqual([]);
  });

  it('needs two shared tags, not one, to link by filing alone', () => {
    const matches = findSimilarLessons(
      { title: 'Range compresses before the drive', tags: ['liquidity'] },
      [lesson({ id: 'old', title: 'Overnight high gets swept', tags: ['liquidity'] })]
    );

    expect(matches).toEqual([]);
  });

  it('puts the closest match first and stops at the cap', () => {
    const lessons = [
      lesson({ id: 'a', title: 'Overnight high sweep reverses the open' }),
      lesson({ id: 'b', title: 'Overnight high sweep reverses the range' }),
      lesson({ id: 'c', title: 'Overnight high sweep reverses the open again' }),
      lesson({ id: 'd', title: 'Overnight high sweep reverses everywhere' }),
    ];

    const matches = findSimilarLessons(
      { title: 'Overnight high sweep reverses the open' },
      lessons,
      { maxMatches: 2 }
    );

    expect(matches).toHaveLength(2);
    // The verbatim note leads; everything else is ranked behind it.
    expect(matches[0].lesson.id).toBe('a');
    expect(matches[0].similarity).toBe(1);
  });

  it('is deterministic — the same draft always reads the same matches', () => {
    const lessons = [
      lesson({ id: 'a', title: 'Overnight high sweep reverses the open' }),
      lesson({ id: 'b', title: 'Overnight high sweep reverses the range' }),
    ];
    const draft = { title: 'Overnight high sweep reverses the open' };

    expect(findSimilarLessons(draft, lessons)).toEqual(findSimilarLessons(draft, lessons));
  });
});

describe('lessonRepeatCounts', () => {
  it('maps each clustered lesson to the size of its repeat', () => {
    const report = findLessonRecurrence(identicalRun(3));
    const counts = lessonRepeatCounts(report);

    expect(counts).toEqual({ l1: 3, l2: 3, l3: 3 });
  });

  it('omits a lesson that does not repeat rather than counting it as one', () => {
    const report = findLessonRecurrence([
      lesson({ id: 'lonely', title: 'FOMO chase into the open drive' }),
    ]);

    expect(lessonRepeatCounts(report)).toEqual({});
  });
});
