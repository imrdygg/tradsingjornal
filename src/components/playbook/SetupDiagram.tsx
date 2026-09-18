import React from 'react';

/**
 * Tiny candlestick diagrams used by the Playbook to show how each setup forms.
 *
 * Everything is inline SVG so there are no image assets to keep in sync, and
 * the diagrams inherit the app's dark/light look. Colour convention across
 * every diagram:
 *   - green candles = bullish / upward pressure
 *   - red candles   = bearish / downward pressure
 *
 * Each setup ships with a bullish variant (green: the up-direction example)
 * and a bearish variant (red: the down-direction example) so the pattern can
 * be recognised and traded in both directions.
 */

type Direction = 'bullish' | 'bearish';

/** [open, close, high, low] in diagram units (0-100, higher = higher price). */
type CandleSpec = [number, number, number, number];

interface DiagramSpec {
  candles: CandleSpec[];
  /** Optional dashed horizontal level (support / resistance / range edge). */
  level?: { price: number; label: string };
}

const BULL_COLOR = '#10b981'; // emerald-500
const BEAR_COLOR = '#f43f5e'; // rose-500
const LEVEL_COLOR = '#a1a1aa'; // zinc-400

const CANDLE_W = 12;
const CANDLE_GAP = 21;
const X0 = 10;
const VIEW_W = 160;
const VIEW_H = 100;

const y = (v: number) => VIEW_H - v;

const Candle: React.FC<{
  x: number;
  o: number;
  c: number;
  h: number;
  l: number;
  /** Position in the sequence, used to stagger the draw-in. */
  index: number;
  /** True while the guide is open: the candles print one after another. */
  animate: boolean;
}> = ({ x, o, c, h, l, index, animate }) => {
  const color = c >= o ? BULL_COLOR : BEAR_COLOR;
  const bodyTop = y(Math.max(o, c));
  const bodyBottom = y(Math.min(o, c));
  const bodyHeight = Math.max(bodyBottom - bodyTop, 1.5);
  const wickX = x + CANDLE_W / 2;

  return (
    // The class is what starts the animation, so it replays every time the guide is
    // opened rather than only on the first render. Reduced-motion users get the
    // finished chart immediately, because the animation lives behind a media query.
    <g className={animate ? 'setup-candle' : undefined} style={animate ? { animationDelay: `${index * 55}ms` } : undefined}>
      <line x1={wickX} y1={y(h)} x2={wickX} y2={y(l)} stroke={color} strokeWidth={1.4} />
      <rect x={x} y={bodyTop} width={CANDLE_W} height={bodyHeight} rx={1} fill={color} />
    </g>
  );
};

const LevelLine: React.FC<{ price: number; label?: string }> = ({ price, label }) => {
  const ly = y(price);
  return (
    <g>
      <line
        x1={4}
        y1={ly}
        x2={VIEW_W - 4}
        y2={ly}
        stroke={LEVEL_COLOR}
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      {label && (
        <text
          x={VIEW_W - 6}
          y={ly - 2.5}
          textAnchor="end"
          fontSize={7}
          fill={LEVEL_COLOR}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        >
          {label}
        </text>
      )}
    </g>
  );
};

/**
 * Diagram library keyed by setup name. Values were chosen so the story of
 * each pattern is readable at a glance: the engulfing candle really engulfs
 * the prior body, breakouts close beyond the dashed level, etc.
 */
const SETUP_DIAGRAMS: Record<string, Record<Direction, DiagramSpec>> = {
  Engulfing: {
    bullish: {
      // Downtrend, small red candle, big green body that engulfs it.
      candles: [
        [70, 58, 73, 55],
        [58, 51, 60, 49],
        [49, 66, 70, 46],
      ],
    },
    bearish: {
      // Uptrend, small green candle, big red body that engulfs it.
      candles: [
        [42, 54, 57, 40],
        [54, 60, 63, 52],
        [62, 44, 65, 41],
      ],
    },
  },

  Support: {
    bullish: {
      // Price falls into support, bounces, retests, holds and rallies.
      candles: [
        [58, 46, 60, 43],
        [46, 33, 48, 30],
        [33, 47, 50, 31],
        [47, 39, 49, 29],
        [31, 45, 47, 28],
        [45, 58, 61, 43],
      ],
      level: { price: 30, label: 'Support' },
    },
    bearish: {
      // Weak bounce, then support breaks and price accelerates down.
      candles: [
        [70, 58, 72, 55],
        [58, 45, 60, 42],
        [45, 32, 47, 30],
        [32, 44, 46, 31],
        [44, 27, 46, 22],
        [27, 16, 29, 13],
      ],
      level: { price: 30, label: 'Support' },
    },
  },

  Resistance: {
    bullish: {
      // Range under resistance, retests, then closes through and extends.
      candles: [
        [40, 52, 54, 38],
        [52, 44, 55, 42],
        [44, 54, 55, 42],
        [54, 68, 72, 52],
        [68, 78, 82, 66],
      ],
      level: { price: 55, label: 'Resistance' },
    },
    bearish: {
      // Two rejections at resistance, then price rolls over and falls.
      candles: [
        [30, 44, 46, 28],
        [44, 54, 55, 42],
        [54, 46, 55, 44],
        [46, 34, 48, 31],
        [34, 22, 36, 19],
      ],
      level: { price: 55, label: 'Resistance' },
    },
  },

  Breakout: {
    bullish: {
      // Tight coil under the range high, expansion candle closes above it.
      candles: [
        [50, 58, 60, 48],
        [58, 51, 59, 49],
        [51, 57, 58, 50],
        [57, 50, 58, 49],
        [50, 70, 74, 49],
        [70, 82, 86, 68],
      ],
      level: { price: 60, label: 'Range high' },
    },
    bearish: {
      // Coil over the range low, expansion candle closes below it.
      candles: [
        [62, 52, 64, 50],
        [52, 59, 61, 51],
        [59, 53, 60, 52],
        [53, 60, 61, 52],
        [60, 40, 62, 37],
        [40, 26, 42, 23],
      ],
      level: { price: 50, label: 'Range low' },
    },
  },

  Reversal: {
    bullish: {
      // Downtrend, long-wick hammer at the low, then structure flips up.
      candles: [
        [72, 60, 74, 57],
        [60, 48, 62, 45],
        [48, 36, 50, 33],
        [40, 44, 46, 30],
        [44, 58, 60, 42],
        [58, 72, 75, 56],
      ],
    },
    bearish: {
      // Uptrend, long-wick shooting star at the high, then structure flips down.
      candles: [
        [36, 48, 50, 34],
        [48, 58, 60, 46],
        [58, 70, 72, 56],
        [68, 62, 78, 60],
        [62, 48, 64, 46],
        [48, 32, 50, 29],
      ],
    },
  },

  'Trend Continuation': {
    bullish: {
      // Uptrend, shallow pullback that bases, then trend resumes.
      candles: [
        [30, 44, 46, 28],
        [44, 56, 58, 42],
        [56, 48, 58, 46],
        [48, 42, 50, 40],
        [42, 50, 52, 40],
        [50, 64, 67, 48],
        [64, 76, 79, 62],
      ],
    },
    bearish: {
      // Downtrend, weak pullback that stalls, then downtrend resumes.
      candles: [
        [78, 64, 80, 62],
        [64, 52, 66, 50],
        [52, 60, 62, 50],
        [60, 66, 68, 58],
        [66, 56, 68, 54],
        [56, 42, 58, 40],
        [42, 28, 44, 25],
      ],
    },
  },

  Other: {
    bullish: {
      // No fixed shape: a generic constructive uptrend as a placeholder.
      candles: [
        [30, 40, 42, 28],
        [40, 36, 44, 34],
        [36, 48, 50, 34],
        [48, 44, 52, 42],
        [44, 58, 60, 42],
        [58, 68, 71, 56],
      ],
    },
    bearish: {
      // No fixed shape: a generic breakdown as a placeholder.
      candles: [
        [70, 60, 72, 58],
        [60, 64, 66, 58],
        [64, 52, 66, 50],
        [52, 56, 58, 50],
        [56, 42, 58, 40],
        [42, 32, 44, 29],
      ],
    },
  },
};

/** Resolve a setup name to its diagrams, tolerating casing/spelling variants. */
export function resolveSetupDiagrams(setupName: string): Record<Direction, DiagramSpec> {
  const cleaned = setupName.trim().toLowerCase();
  if (cleaned.includes('engulf')) return SETUP_DIAGRAMS.Engulfing;
  if (cleaned === 'support') return SETUP_DIAGRAMS.Support;
  if (cleaned === 'resistance') return SETUP_DIAGRAMS.Resistance;
  if (cleaned.includes('breakout')) return SETUP_DIAGRAMS.Breakout;
  if (cleaned.includes('reversal')) return SETUP_DIAGRAMS.Reversal;
  if (cleaned.includes('continuation')) return SETUP_DIAGRAMS['Trend Continuation'];
  return SETUP_DIAGRAMS.Other;
}

interface SetupDiagramProps {
  setupName: string;
  direction: Direction;
  className?: string;
  /** Draw the candles in one after another, left to right. */
  animate?: boolean;
}

/**
 * One example chart for a setup. `direction` selects the green (bullish) or
 * red (bearish) variant; the caption underneath names the convention so the
 * colour always teaches something.
 */
export const SetupDiagram: React.FC<SetupDiagramProps> = ({
  setupName,
  direction,
  className = '',
  animate = false,
}) => {
  const spec = resolveSetupDiagrams(setupName)[direction];
  const isBullish = direction === 'bullish';

  return (
    <figure className={className}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`${setupName} ${direction} example chart`}
      >
        {spec.level && <LevelLine price={spec.level.price} label={spec.level.label} />}
        {spec.candles.map(([o, c, h, l], i) => (
          <Candle key={i} x={X0 + i * CANDLE_GAP} o={o} c={c} h={h} l={l} index={i} animate={animate} />
        ))}
      </svg>
      <figcaption
        className={`mt-1 text-center text-[10px] font-mono uppercase tracking-wider ${
          isBullish ? 'text-emerald-400' : 'text-rose-400'
        }`}
      >
        {isBullish ? 'Green — bullish example' : 'Red — bearish example'}
      </figcaption>
    </figure>
  );
};
