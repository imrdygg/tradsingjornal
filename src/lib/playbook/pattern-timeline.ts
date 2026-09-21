import { PatternPhase } from './pattern-types';

/**
 * Timing for the pattern illustrations.
 *
 * The illustrations are built to teach a formation, which means the timeline is not
 * decorative: each phase of the storyboard owns a window of the cycle, and every part of
 * the drawing reveals when its own phase begins. That is what stops an animation from
 * being a finished chart that wiggles — the price path draws through the formation, and
 * the annotation only appears as the market reaches it.
 *
 * The windows come straight from the build spec: prior trend 0-20%, formation 20-55%,
 * the pattern completing/compressing 55-75%, the break 75-90%, then the optional retest
 * and measured move in the last 10%.
 */
export const PHASE_START: Record<PatternPhase, number> = {
  priorTrend: 0,
  formation: 0.2,
  trigger: 0.55,
  breakout: 0.75,
  retest: 0.88,
  target: 0.9,
};

/** Phases in reveal order, for iterating and for captions. */
export const PHASE_ORDER: PatternPhase[] = [
  'priorTrend',
  'formation',
  'trigger',
  'breakout',
  'retest',
  'target',
];

/** What each phase is called in the phase caption under the player. */
export const PHASE_CAPTIONS: Record<PatternPhase, string> = {
  priorTrend: '1. Prior trend',
  formation: '2. Pattern forming',
  trigger: '3. Structure completing',
  breakout: '4. Breakout / breakdown',
  retest: '5. Retest, if it comes',
  target: '6. Measured move reference',
};

/** Seconds of animation at normal speed: inside the 4-7s the spec asks for. */
export const NORMAL_DURATION_MS = 5600;

/** Pause on the finished chart before the loop restarts. */
export const HOLD_MS = 1000;

/** Total cycle at 1x, used by the CSS loop and by the card phase offsets. */
export const CYCLE_MS = NORMAL_DURATION_MS + HOLD_MS;

export const SPEEDS = [0.5, 1, 1.5] as const;
export type PlaybackSpeed = (typeof SPEEDS)[number];

/** Fraction of the cycle at which a phase's elements appear. */
export function revealAt(phase: PatternPhase): number {
  return PHASE_START[phase];
}

/** True once the cycle has reached the phase that owns this element. */
export function isRevealed(phase: PatternPhase, progress: number): boolean {
  return progress >= PHASE_START[phase];
}

/** How far through one phase the cycle is, clamped to 0-1. */
export function phaseProgress(phase: PatternPhase, progress: number): number {
  const next = PHASE_ORDER[PHASE_ORDER.indexOf(phase) + 1];
  const start = PHASE_START[phase];
  const end = next ? PHASE_START[next] : 1;
  if (end <= start) return progress >= end ? 1 : 0;
  return Math.min(1, Math.max(0, (progress - start) / (end - start)));
}

/**
 * Where the cycle is, given elapsed time.
 *
 * `holding` marks the pause on the finished chart, which the player uses to keep the
 * caption on the last phase instead of flashing back to the first one.
 */
export function progressAt(
  elapsedMs: number,
  speed: PlaybackSpeed = 1
): { progress: number; holding: boolean } {
  const drawMs = NORMAL_DURATION_MS / speed;
  const totalMs = CYCLE_MS / speed;
  const elapsed = elapsedMs % totalMs;
  if (elapsed >= drawMs) return { progress: 1, holding: true };
  return { progress: elapsed / drawMs, holding: false };
}

/** The phase a given progress sits in, for the caption. */
export function currentPhase(progress: number): PatternPhase {
  let phase: PatternPhase = 'priorTrend';
  for (const candidate of PHASE_ORDER) {
    if (progress >= PHASE_START[candidate]) phase = candidate;
  }
  return phase;
}

/**
 * A negative `animation-delay` per card, so 20 cards are not drawing in lockstep.
 *
 * Every element of one card shares the same offset, so the staged sequence inside each
 * card survives; only the cards differ from each other. This is the card grid's
 * equivalent of the playbook's staggered candle delay.
 */
export function cardLoopOffset(index: number): string {
  const seconds = (index % 7) * -0.9;
  return `${seconds}s`;
}
