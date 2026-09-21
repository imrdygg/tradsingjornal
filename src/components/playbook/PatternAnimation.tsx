import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { PatternPhase } from '../../lib/playbook/pattern-types';
import {
  getPatternAnimation,
  PatternAnimationSpec,
  PatternFeature,
  PatternPoint,
} from '../../lib/playbook/pattern-animations';
import {
  PHASE_CAPTIONS,
  PHASE_ORDER,
  PHASE_START,
  PlaybackSpeed,
  SPEEDS,
  cardLoopOffset,
  currentPhase,
  isRevealed,
  progressAt,
} from '../../lib/playbook/pattern-timeline';

/**
 * The pattern illustration engine.
 *
 * Every pattern in the playbook is drawn by this component from the coordinates in
 * `src/lib/playbook/pattern-animations.ts`. Nothing here is pattern-specific: the same
 * primitives (price path, structure line, breakout marker, retest dot, measured-move
 * arrow, formation zone, teaching label) compose all 20 illustrations, which is what
 * keeps them consistent and makes a geometry fix a data change.
 *
 * Two modes, because the two places this appears want opposite things:
 *
 * - `loop`: the grid. Driven by CSS classes from index.css, so 20 cards animate without
 *   20 JavaScript loops. Reduced-motion users see the finished chart.
 * - `player`: the detail view. Driven by the timeline, with replay / pause / speed and
 *   the label, retest and target toggles, because this is where the trader studies.
 */
export type PatternAnimationMode = 'loop' | 'player';

/**
 * Colour convention, shared with the rest of the playbook: green means upward pressure,
 * red means downward. The price line uses `currentColor` so the app's light/dark theme
 * (which is implemented as `.light` overrides on the zinc utilities) recolours it too.
 */
const BULL_COLOR = '#10b981';
const BEAR_COLOR = '#f43f5e';
const STRUCTURE_COLOR = '#3b82f6';
const INVALIDATION_COLOR = '#f59e0b';
const TARGET_COLOR = '#a1a1aa';
const ZONE_COLOR = '#a1a1aa';
const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** y is price in the data and inverted for SVG, so a helper beats repeating it. */
const sy = (y: number) => 100 - y;

const REVEAL_CLASS: Record<PatternPhase, string> = {
  priorTrend: '',
  formation: 'pattern-reveal-formation',
  trigger: 'pattern-reveal-trigger',
  breakout: 'pattern-reveal-breakout',
  retest: 'pattern-reveal-retest',
  target: 'pattern-reveal-target',
};

interface Reveal {
  kind: 'loop';
}

interface ProgressReveal {
  kind: 'progress';
  progress: number;
}

/**
 * How a primitive shows or hides itself.
 *
 * In loop mode the CSS animation owns both opacity and the draw, so the element's own
 * inline values describe the FINISHED state — which is exactly what a reduced-motion
 * user should see when the media query removes the animation.
 */
function revealProps(
  phase: PatternPhase,
  reveal: Reveal | ProgressReveal
): { className?: string; style?: React.CSSProperties } {
  if (reveal.kind === 'loop') {
    return { className: REVEAL_CLASS[phase] || undefined };
  }
  return { style: { opacity: isRevealed(phase, reveal.progress) ? 1 : 0 } };
}

function classNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/**
 * Read synchronously, not in an effect.
 *
 * The autoplay effect runs on mount, so an effect that only *later* discovers reduced
 * motion loses the race: the animation would already be running and starting it cannot be
 * taken back. Asking at initialisation means the first render already knows, and a
 * reduced-motion reader never sees the illustration move on its own.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const FormationZone: React.FC<{
  points: PatternPoint[];
  reveal: Reveal | ProgressReveal;
  phase: PatternPhase;
}> = ({ points, reveal, phase }) => (
  <polygon
    points={points.map((point) => `${point.x},${sy(point.y)}`).join(' ')}
    fill={ZONE_COLOR}
    fillOpacity={0.12}
    stroke="none"
    className={classNames('transition-opacity duration-200', revealProps(phase, reveal).className)}
    style={revealProps(phase, reveal).style}
  />
);

const StructureLine: React.FC<{
  from: PatternPoint;
  to: PatternPoint;
  reveal: Reveal | ProgressReveal;
  phase: PatternPhase;
  dashed?: boolean;
  color?: string;
  label?: string;
  labelAt?: 'start' | 'end';
}> = ({ from, to, reveal, phase, dashed, color = STRUCTURE_COLOR, label, labelAt = 'end' }) => {
  const props = revealProps(phase, reveal);
  const anchor = labelAt === 'end' ? to : from;
  return (
    <g
      className={classNames('transition-opacity duration-200', props.className)}
      style={props.style}
    >
      <line
        x1={from.x}
        y1={sy(from.y)}
        x2={to.x}
        y2={sy(to.y)}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={dashed ? '3 2.5' : undefined}
        strokeLinecap="round"
      />
      {label && (
        <text
          x={anchor.x}
          y={sy(anchor.y) + (labelAt === 'end' ? -2.6 : 5.4)}
          textAnchor={labelAt === 'end' ? 'end' : 'start'}
          fontSize={4}
          fill={color}
          fontFamily={MONO_FONT}
        >
          {label}
        </text>
      )}
    </g>
  );
};

const BreakoutMarker: React.FC<{
  at: PatternPoint;
  direction: 'up' | 'down';
  reveal: Reveal | ProgressReveal;
  phase: PatternPhase;
  markerId: string;
  label?: string;
}> = ({ at, direction, reveal, phase, markerId, label }) => {
  const props = revealProps(phase, reveal);
  const color = direction === 'up' ? BULL_COLOR : BEAR_COLOR;
  const tip = direction === 'up' ? at.y + 15 : at.y - 15;
  return (
    <g
      className={classNames('transition-opacity duration-200', props.className)}
      style={props.style}
    >
      {/* The breakout point: a bright dot with a ring, so the exact break is unmistakable. */}
      <circle cx={at.x} cy={sy(at.y)} r={3.4} fill="none" stroke={color} strokeWidth={1} opacity={0.45} />
      <circle cx={at.x} cy={sy(at.y)} r={1.7} fill={color} />
      <line
        x1={at.x}
        y1={sy(at.y)}
        x2={at.x + 7}
        y2={sy(tip)}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        markerEnd={`url(#${markerId})`}
      />
      {label && (
        <text
          x={at.x + 9}
          y={sy(direction === 'up' ? at.y + 4 : at.y - 4)}
          fontSize={4}
          fill={color}
          fontFamily={MONO_FONT}
        >
          {label}
        </text>
      )}
    </g>
  );
};

const RetestMarker: React.FC<{
  at: PatternPoint;
  reveal: Reveal | ProgressReveal;
  phase: PatternPhase;
  label?: string;
}> = ({ at, reveal, phase, label }) => {
  const props = revealProps(phase, reveal);
  return (
    <g className={classNames('transition-opacity duration-200', props.className)} style={props.style}>
      <circle
        cx={at.x}
        cy={sy(at.y)}
        r={3}
        fill="white"
        fillOpacity={0.9}
        stroke={STRUCTURE_COLOR}
        strokeWidth={1.1}
        strokeDasharray="1.6 1.4"
      />
      {label && (
        <text x={at.x + 5} y={sy(at.y) + 5} fontSize={3.8} fill={STRUCTURE_COLOR} fontFamily={MONO_FONT}>
          {label}
        </text>
      )}
    </g>
  );
};

const TargetArrow: React.FC<{
  from: PatternPoint;
  to: PatternPoint;
  reveal: Reveal | ProgressReveal;
  phase: PatternPhase;
  markerId: string;
  label?: string;
}> = ({ from, to, reveal, phase, markerId, label }) => {
  const props = revealProps(phase, reveal);
  return (
    <g className={classNames('transition-opacity duration-200', props.className)} style={props.style}>
      <line
        x1={from.x}
        y1={sy(from.y)}
        x2={to.x}
        y2={sy(to.y)}
        stroke={TARGET_COLOR}
        strokeWidth={1.1}
        strokeDasharray="2.5 2"
        markerEnd={`url(#${markerId})`}
      />
      {label && (
        <text
          x={to.x}
          y={sy(to.y) + (to.y > from.y ? -3 : 6)}
          textAnchor="end"
          fontSize={3.8}
          fill={TARGET_COLOR}
          fontFamily={MONO_FONT}
        >
          {label}
        </text>
      )}
    </g>
  );
};

const GhostArrow: React.FC<{
  at: PatternPoint;
  direction: 'up' | 'down';
  reveal: Reveal | ProgressReveal;
  phase: PatternPhase;
  markerId: string;
  label?: string;
}> = ({ at, direction, reveal, phase, markerId, label }) => {
  const props = revealProps(phase, reveal);
  const color = direction === 'up' ? BULL_COLOR : BEAR_COLOR;
  const tip = direction === 'up' ? at.y + 12 : at.y - 12;
  return (
    <g className={classNames('transition-opacity duration-200', props.className)} style={props.style}>
      {/* Faded on purpose and on an inner group: the reveal owns the outer opacity, and
          the source drawing for this pattern deliberately shows both outcomes. */}
      <g opacity={0.55}>
        <line
          x1={at.x}
          y1={sy(at.y)}
          x2={at.x + 5}
          y2={sy(tip)}
          stroke={color}
          strokeWidth={1.6}
          strokeDasharray="2.5 2"
          markerEnd={`url(#${markerId})`}
        />
        {label && (
          <text x={at.x + 7} y={sy(at.y)} fontSize={3.6} fill={color} fontFamily={MONO_FONT}>
            {label}
          </text>
        )}
      </g>
    </g>
  );
};

const TeachingLabel: React.FC<{
  at: PatternPoint;
  text: string;
  reveal: Reveal | ProgressReveal;
  phase: PatternPhase;
}> = ({ at, text, reveal, phase }) => {
  const props = revealProps(phase, reveal);
  return (
    <text
      x={at.x}
      y={sy(at.y)}
      textAnchor="middle"
      fontSize={4}
      fill="#a1a1aa"
      fontFamily={MONO_FONT}
      className={classNames('transition-opacity duration-200', props.className)}
      style={props.style}
    >
      {text}
    </text>
  );
};

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const Scene: React.FC<{
  spec: PatternAnimationSpec;
  reveal: Reveal | ProgressReveal;
  showLabels: boolean;
  showRetest: boolean;
  showTarget: boolean;
  /** Describes the illustration to a screen reader, since the drawing is data. */
  title: string;
}> = ({ spec, reveal, showLabels, showRetest, showTarget, title }) => {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  const pathData = useMemo(
    () =>
      spec.path
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${sy(point.y)}`)
        .join(' '),
    [spec]
  );

  const drawProps = revealProps('priorTrend', reveal);

  const visibleFeatures = spec.features.filter((feature) => {
    if (!showLabels && (feature.kind === 'label' || feature.kind === 'invalidation')) return false;
    if (!showRetest && feature.kind === 'retest') return false;
    if (!showTarget && feature.kind === 'target') return false;
    return true;
  });

  return (
    <svg
      viewBox="-4 -4 108 108"
      className="block h-auto w-full text-zinc-100"
      role="img"
      aria-label={title}
    >
      <defs>
        <marker
          id={`${uid}-bull`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="4"
          markerHeight="4"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill={BULL_COLOR} />
        </marker>
        <marker
          id={`${uid}-bear`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="4"
          markerHeight="4"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill={BEAR_COLOR} />
        </marker>
        <marker
          id={`${uid}-target`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="3.4"
          markerHeight="3.4"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill={TARGET_COLOR} />
        </marker>
      </defs>

      {/* The price path draws on, and everything else appears as the market reaches it.
          `pathLength=1` normalises the dash maths so one rule fits every pattern. */}
      <g
        className={classNames('pattern-fade', drawProps.className)}
        style={drawProps.style}
      >
        <path
          d={pathData}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          className="pattern-draw"
          style={{
            strokeDashoffset: reveal.kind === 'progress' ? 1 - reveal.progress : 0,
          }}
        />

        {visibleFeatures.map((feature, index) => {
          switch (feature.kind) {
            case 'zone':
              return (
                <FormationZone
                  key={index}
                  points={feature.points}
                  phase={feature.phase}
                  reveal={reveal}
                />
              );
            case 'level':
            case 'trendline':
              return (
                <StructureLine
                  key={index}
                  from={feature.from}
                  to={feature.to}
                  phase={feature.phase}
                  reveal={reveal}
                  label={feature.label}
                />
              );
            case 'invalidation':
              return (
                <StructureLine
                  key={index}
                  from={feature.from}
                  to={feature.to}
                  phase={feature.phase}
                  reveal={reveal}
                  color={INVALIDATION_COLOR}
                  dashed
                  label={feature.label}
                />
              );
            case 'target':
              return (
                <TargetArrow
                  key={index}
                  from={feature.from}
                  to={feature.to}
                  phase={feature.phase}
                  reveal={reveal}
                  markerId={`${uid}-target`}
                  label={feature.label}
                />
              );
            case 'breakout':
              return (
                <BreakoutMarker
                  key={index}
                  at={feature.at}
                  direction={feature.direction}
                  phase={feature.phase}
                  reveal={reveal}
                  markerId={`${uid}-${feature.direction === 'up' ? 'bull' : 'bear'}`}
                  label={feature.label}
                />
              );
            case 'ghost':
              return (
                <GhostArrow
                  key={index}
                  at={feature.at}
                  direction={feature.direction}
                  phase={feature.phase}
                  reveal={reveal}
                  markerId={`${uid}-${feature.direction === 'up' ? 'bull' : 'bear'}`}
                  label={feature.label}
                />
              );
            case 'retest':
              return (
                <RetestMarker
                  key={index}
                  at={feature.at}
                  phase={feature.phase}
                  reveal={reveal}
                  label={feature.label}
                />
              );
            case 'label':
              return (
                <TeachingLabel
                  key={index}
                  at={feature.at}
                  text={feature.text}
                  phase={feature.phase}
                  reveal={reveal}
                />
              );
            default:
              return null;
          }
        })}
      </g>
    </svg>
  );
};

// ---------------------------------------------------------------------------
// Legend, controls, player
// ---------------------------------------------------------------------------

const LEGEND: Array<{ label: string; color: string; dashed?: boolean }> = [
  { label: 'Price', color: '#a1a1aa' },
  { label: 'Structure (level / trend line)', color: STRUCTURE_COLOR },
  { label: 'Bullish break', color: BULL_COLOR },
  { label: 'Bearish break', color: BEAR_COLOR },
  { label: 'Invalidation', color: INVALIDATION_COLOR, dashed: true },
  { label: 'Measured move (reference)', color: TARGET_COLOR, dashed: true },
];

export const PatternLegend: React.FC<{ className?: string }> = ({ className = '' }) => (
  <ul className={`flex flex-wrap gap-x-4 gap-y-1.5 ${className}`}>
    {LEGEND.map((entry) => (
      <li key={entry.label} className="flex items-center gap-1.5 text-[10px] text-zinc-400">
        <span
          aria-hidden="true"
          className="inline-block h-0.5 w-5 rounded-full"
          style={{
            background: entry.dashed
              ? `repeating-linear-gradient(to right, ${entry.color} 0 4px, transparent 4px 7px)`
              : entry.color,
          }}
        />
        {entry.label}
      </li>
    ))}
  </ul>
);

/** Shared by the player and the card grid: the drawing plus its legend. */
export const PatternIllustration: React.FC<{
  patternId: string;
  title: string;
  mode?: PatternAnimationMode;
  /** Card position, used only to offset the CSS loop so cards are out of phase. */
  cardIndex?: number;
  showLegend?: boolean;
  showLabels?: boolean;
  showRetest?: boolean;
  showTarget?: boolean;
  className?: string;
}> = ({
  patternId,
  title,
  mode = 'loop',
  cardIndex = 0,
  showLegend = false,
  showLabels = true,
  showRetest = true,
  showTarget = true,
  className = '',
}) => {
  const spec = getPatternAnimation(patternId);

  if (!spec) {
    return (
      <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 text-[11px] text-zinc-500">
        No illustration is defined for this pattern yet.
      </p>
    );
  }

  if (mode === 'loop') {
    return (
      <div className={className}>
        <div className="pattern-loop" style={{ ['--pattern-offset' as string]: cardLoopOffset(cardIndex) }}>
          <Scene
            spec={spec}
            reveal={{ kind: 'loop' }}
            showLabels={showLabels}
            showRetest={showRetest}
            showTarget={showTarget}
            title={title}
          />
        </div>
        {showLegend && <PatternLegend className="mt-2" />}
      </div>
    );
  }

  return (
    <PatternPlayer
      spec={spec}
      patternId={patternId}
      title={title}
      showLegend={showLegend}
      showLabels={showLabels}
      showRetest={showRetest}
      showTarget={showTarget}
      className={className}
    />
  );
};

/**
 * The detail view's illustration: a real timeline the trader controls.
 *
 * Reduced-motion users get the finished chart and no autoplay, but the controls stay
 * usable — they asked for no unsolicited motion, not for the feature to be removed.
 */
const PatternPlayer: React.FC<{
  spec: PatternAnimationSpec;
  patternId: string;
  title: string;
  showLegend: boolean;
  showLabels: boolean;
  showRetest: boolean;
  showTarget: boolean;
  className: string;
}> = ({
  spec,
  patternId,
  title,
  showLegend,
  showLabels,
  showRetest,
  showTarget,
  className,
}) => {
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(1);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [labelsOn, setLabelsOn] = useState(showLabels);
  const [retestOn, setRetestOn] = useState(showRetest);
  const [targetOn, setTargetOn] = useState(showTarget);
  const startedAt = useRef(0);

  // The setting can change while the page is open, so keep listening.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  // Autoplay the first pass for everyone else, so the illustration teaches on open
  // instead of waiting to be discovered behind a button. Nothing here starts it for a
  // reduced-motion reader — that only ever happens from their own press of Play.
  useEffect(() => {
    setPlaying(!reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    if (!playing) return;
    startedAt.current = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const { progress: next } = progressAt(now - startedAt.current, speed);
      setProgress(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed]);

  const replay = () => {
    setProgress(0);
    setPlaying(true);
  };

  const phase = currentPhase(progress);

  const toggleClass = (active: boolean) =>
    `rounded-lg border px-2 py-1 text-[10px] font-mono transition-colors ${
      active
        ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
    }`;

  return (
    <div className={className}>
      <Scene
        spec={spec}
        reveal={{ kind: 'progress', progress }}
        showLabels={labelsOn}
        showRetest={retestOn}
        showTarget={targetOn}
        title={title}
      />

      {/* Progress track with a tick per phase, so the staging is visible and not a mystery. */}
      <div
        className="relative mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-label={`${title} animation progress`}
      >
        <div
          className="h-full rounded-full bg-zinc-400"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
        {PHASE_ORDER.map((entry) => (
          <span
            key={entry}
            aria-hidden="true"
            className="absolute top-0 h-full w-px bg-zinc-600"
            style={{ left: `${PHASE_START[entry] * 100}%` }}
          />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          id={`pattern-play-${patternId}`}
          onClick={() => setPlaying((current) => !current)}
          aria-label={playing ? 'Pause the illustration' : 'Play the illustration'}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[10px] font-semibold text-zinc-100 transition-colors hover:bg-zinc-700"
        >
          {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          onClick={replay}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[10px] font-semibold text-zinc-300 transition-colors hover:text-zinc-100"
        >
          <RotateCcw className="h-3 w-3" />
          Replay
        </button>

        <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          Speed
        </span>
        {SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSpeed(value)}
            aria-pressed={speed === value}
            className={toggleClass(speed === value)}
          >
            {value}x
          </button>
        ))}

        <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          Show
        </span>
        <button type="button" onClick={() => setLabelsOn((v) => !v)} aria-pressed={labelsOn} className={toggleClass(labelsOn)}>
          Labels
        </button>
        <button type="button" onClick={() => setRetestOn((v) => !v)} aria-pressed={retestOn} className={toggleClass(retestOn)}>
          Retest
        </button>
        <button type="button" onClick={() => setTargetOn((v) => !v)} aria-pressed={targetOn} className={toggleClass(targetOn)}>
          Target
        </button>
      </div>

      <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        {PHASE_CAPTIONS[phase]}
        {reducedMotion && (
          <span className="ml-2 text-zinc-600 normal-case">
            Reduced motion is on: the illustration stays still until you press play.
          </span>
        )}
      </p>

      {showLegend && <PatternLegend className="mt-3" />}
    </div>
  );
};

export default PatternIllustration;
