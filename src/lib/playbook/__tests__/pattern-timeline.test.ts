import { describe, expect, it } from 'vitest';
import {
  CYCLE_MS,
  HOLD_MS,
  NORMAL_DURATION_MS,
  PHASE_CAPTIONS,
  PHASE_ORDER,
  PHASE_START,
  SPEEDS,
  cardLoopOffset,
  currentPhase,
  isRevealed,
  phaseProgress,
  progressAt,
  revealAt,
} from '../pattern-timeline';
import type { PatternPhase } from '../pattern-types';

/**
 * The illustrations teach by revealing things in order, so the timing is behaviour, not
 * decoration: if the phases stop being ordered, or a reveal stops being monotonic, a
 * pattern would start drawing its breakout before its structure and no screenshot would
 * make the cause obvious. Hence direct tests on the maths.
 */
describe('pattern timeline phases', () => {
  it('lists every phase once, in reveal order', () => {
    expect(PHASE_ORDER).toEqual(['priorTrend', 'formation', 'trigger', 'breakout', 'retest', 'target']);
    expect(new Set(PHASE_ORDER).size).toBe(PHASE_ORDER.length);
  });

  it('starts each phase after the one before it', () => {
    const starts = PHASE_ORDER.map((phase) => PHASE_START[phase]);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(new Set(starts).size).toBe(starts.length);
    starts.forEach((start) => {
      expect(start).toBeGreaterThanOrEqual(0);
      expect(start).toBeLessThan(1);
    });
  });

  it('keeps the prior trend first and the measured move last', () => {
    expect(PHASE_START.priorTrend).toBe(0);
    expect(PHASE_START.target).toBeGreaterThan(PHASE_START.breakout);
    expect(PHASE_START.retest).toBeGreaterThan(PHASE_START.breakout);
  });

  it('caps the pressure phase inside the window the spec asks for', () => {
    // Prior trend 0-20%, then the pattern forms, completes, and breaks by 90%.
    expect(PHASE_START.formation).toBeLessThanOrEqual(0.2);
    expect(PHASE_START.breakout).toBeLessThan(0.9);
  });

  it('captions every phase', () => {
    PHASE_ORDER.forEach((phase) => {
      expect(PHASE_CAPTIONS[phase].trim().length).toBeGreaterThan(3);
    });
  });

  it('reveals a phase exactly when its window opens', () => {
    PHASE_ORDER.forEach((phase) => {
      const start = revealAt(phase);
      expect(revealAt(phase)).toBe(PHASE_START[phase]);
      expect(isRevealed(phase, start)).toBe(true);
      expect(isRevealed(phase, 0)).toBe(phase === 'priorTrend');
      expect(isRevealed(phase, start - 0.001)).toBe(false);
    });
  });

  it('never hides something that was already revealed', () => {
    PHASE_ORDER.forEach((phase) => {
      const start = PHASE_START[phase];
      expect(isRevealed(phase, Math.min(1, start + 0.2))).toBe(true);
      expect(isRevealed(phase, 1)).toBe(true);
    });
  });
});

describe('pattern timeline playback', () => {
  it('runs for a sensible length and then holds on the finished chart', () => {
    expect(NORMAL_DURATION_MS).toBeGreaterThanOrEqual(4000);
    expect(NORMAL_DURATION_MS).toBeLessThanOrEqual(7000);
    expect(HOLD_MS).toBeGreaterThan(0);
    expect(CYCLE_MS).toBe(NORMAL_DURATION_MS + HOLD_MS);
  });

  it('starts at the beginning of the cycle', () => {
    expect(progressAt(0)).toEqual({ progress: 0, holding: false });
  });

  it('advances smoothly and monotonically inside the draw window', () => {
    let previous = -1;
    // Strictly inside the draw window: the exact end is the hold, tested below.
    for (let elapsed = 0; elapsed < NORMAL_DURATION_MS; elapsed += 200) {
      const { progress, holding } = progressAt(elapsed);
      expect(holding).toBe(false);
      expect(progress).toBeGreaterThanOrEqual(previous);
      previous = progress;
    }
    expect(progressAt(NORMAL_DURATION_MS / 2).progress).toBeCloseTo(0.5, 5);
  });

  it('holds the finished chart, then loops instead of stopping', () => {
    expect(progressAt(NORMAL_DURATION_MS)).toEqual({ progress: 1, holding: true });
    expect(progressAt(NORMAL_DURATION_MS + HOLD_MS / 2)).toEqual({ progress: 1, holding: true });
    // One full cycle later it is drawing again from the top.
    const looped = progressAt(CYCLE_MS);
    expect(looped.holding).toBe(false);
    expect(looped.progress).toBe(0);
  });

  it('plays a faster cycle at a higher speed without changing the staging', () => {
    SPEEDS.forEach((speed) => {
      const elapsed = NORMAL_DURATION_MS / speed - 1;
      expect(progressAt(elapsed, speed).progress).toBeCloseTo(1, 2);
    });

    const normal = progressAt(1000, 1).progress;
    const fast = progressAt(1000, 1.5).progress;
    const slow = progressAt(1000, 0.5).progress;
    expect(fast).toBeGreaterThan(normal);
    expect(slow).toBeLessThan(normal);
  });

  it('offers slow, normal and fast', () => {
    expect(SPEEDS).toEqual([0.5, 1, 1.5]);
  });

  it('names the phase the cycle is actually in', () => {
    expect(currentPhase(0)).toBe('priorTrend');
    expect(currentPhase(1)).toBe('target');
    PHASE_ORDER.forEach((phase) => {
      expect(currentPhase(PHASE_START[phase])).toBe(phase);
    });
    // Between two windows it is still the earlier phase.
    expect(currentPhase(PHASE_START.breakout + 0.01)).toBe('breakout');
  });

  it('measures progress through a phase between 0 and 1', () => {
    PHASE_ORDER.forEach((phase, index) => {
      const next = PHASE_ORDER[index + 1];
      expect(phaseProgress(phase, PHASE_START[phase])).toBeCloseTo(0, 5);
      if (next) {
        expect(phaseProgress(phase, PHASE_START[next])).toBeCloseTo(1, 5);
      }
      for (const sample of [0, 0.25, 0.5, 1]) {
        const value = phaseProgress(phase, sample);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });
    // The final phase has no successor, so it only completes at the end.
    expect(phaseProgress('target', 1)).toBe(1);
    expect(phaseProgress('target', 0)).toBe(0);
  });
});

describe('card loop offsets', () => {
  it('staggers the grid instead of drawing 20 cards in lockstep', () => {
    const offsets = Array.from({ length: 7 }, (_, index) => cardLoopOffset(index));
    expect(new Set(offsets).size).toBe(7);
    offsets.forEach((offset) => {
      // Cards are offset backwards through the cycle; the first one starts at zero.
      expect(parseFloat(offset)).toBeLessThanOrEqual(0);
      expect(offset).toMatch(/^-?[\d.]+s$/);
    });
  });

  it('reuses the offsets once a row is longer than the cycle', () => {
    expect(cardLoopOffset(7)).toBe(cardLoopOffset(0));
    expect(cardLoopOffset(20)).toBe(cardLoopOffset(6));
    expect(cardLoopOffset(0)).toBe('0s');
  });

  it('never delays a card so far that it opens on a half-drawn chart', () => {
    for (let index = 0; index < 20; index += 1) {
      expect(Math.abs(parseFloat(cardLoopOffset(index)))).toBeLessThan(CYCLE_MS / 1000);
    }
  });
});

describe('every phase is covered by the player', () => {
  it('has a caption and a start time for all six phases', () => {
    (['priorTrend', 'formation', 'trigger', 'breakout', 'retest', 'target'] as PatternPhase[]).forEach(
      (phase) => {
        expect(PHASE_START[phase]).toBeTypeOf('number');
        expect(PHASE_CAPTIONS[phase]).toBeTruthy();
      }
    );
  });
});
