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
    <g className={animate ? 'setup-candle' : undefined} style={animate ? { animationDelay: `${index * 40}ms` } : undefined}>
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
      // The retrace level the guide tells the trader to work with: the midpoint of the
      // engulfing body is where a missed entry is usually given a second chance.
      level: { price: 57.5, label: 'Engulfing 50%' },
    },
    bearish: {
      // Uptrend, small green candle, big red body that engulfs it.
      candles: [
        [42, 54, 57, 40],
        [54, 60, 63, 52],
        [62, 44, 65, 41],
      ],
      level: { price: 53, label: 'Engulfing 50%' },
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
      // The turn is only a turn once the swing that failed is taken: this is the level
      // the confirmation candle has to close through.
      level: { price: 50, label: 'Swing high' },
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
      level: { price: 56, label: 'Swing low' },
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
      // The pullback low is the line the whole idea rests on: the trend is intact while
      // it holds, and the continuation entry sits just above it.
      level: { price: 40, label: 'Pullback low' },
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
      level: { price: 68, label: 'Pullback high' },
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
      // Even the placeholder shows the one line every structure idea shares: the last
      // higher low, which is what makes the next leg a continuation rather than a guess.
      level: { price: 34, label: 'Last higher low' },
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
      level: { price: 58, label: 'Last lower high' },
    },
  },

  'VWAP Reclaim': {
    bullish: {
      // Below VWAP, a flush through the low, then a close back above the average.
      candles: [
        [70, 58, 72, 55],
        [58, 45, 60, 42],
        [45, 38, 47, 34],
        [38, 52, 55, 36],
        [52, 60, 63, 50],
        [60, 68, 71, 58],
      ],
      level: { price: 45, label: 'VWAP' },
    },
    bearish: {
      // Rally into VWAP from below, rejection off it, then the slide resumes.
      candles: [
        [30, 42, 44, 28],
        [42, 54, 56, 40],
        [54, 60, 62, 52],
        [60, 48, 61, 45],
        [48, 38, 50, 35],
        [38, 28, 40, 24],
      ],
      level: { price: 50, label: 'VWAP' },
    },
  },

  'VWAP Rejection': {
    bullish: {
      // Trend above VWAP, pullback that taps the average, then continuation up.
      candles: [
        [70, 58, 72, 56],
        [58, 48, 60, 46],
        [48, 44, 50, 43],
        [44, 52, 55, 43],
        [52, 60, 63, 50],
        [60, 70, 73, 58],
      ],
      level: { price: 44, label: 'VWAP' },
    },
    bearish: {
      // Trend below VWAP, a wick into it that gets sold, then continuation down.
      candles: [
        [30, 44, 46, 28],
        [44, 56, 58, 42],
        [56, 52, 57, 50],
        [52, 54, 56, 51],
        [54, 44, 56, 42],
        [44, 34, 46, 31],
      ],
      level: { price: 56, label: 'VWAP' },
    },
  },

  'Opening Range Breakout': {
    bullish: {
      // A tight opening band, then an expansion candle closing above its high.
      candles: [
        [50, 54, 56, 48],
        [54, 52, 55, 50],
        [52, 56, 57, 51],
        [56, 54, 57, 53],
        [54, 72, 76, 53],
        [72, 82, 85, 70],
      ],
      level: { price: 57, label: 'Opening range high' },
    },
    bearish: {
      // The same band, broken downward with follow-through.
      candles: [
        [50, 46, 52, 44],
        [46, 48, 49, 45],
        [48, 44, 49, 43],
        [44, 46, 47, 43],
        [46, 28, 47, 25],
        [28, 18, 30, 15],
      ],
      level: { price: 43, label: 'Opening range low' },
    },
  },

  'Failed Breakout': {
    bullish: {
      // A breakdown through the range low that is reclaimed — shorts are trapped.
      candles: [
        [55, 50, 57, 47],
        [50, 46, 52, 44],
        [46, 38, 47, 34],
        [38, 48, 50, 36],
        [48, 58, 61, 46],
        [58, 68, 71, 56],
      ],
      level: { price: 43, label: 'Range low' },
    },
    bearish: {
      // A break above the range high that closes back inside — longs are trapped.
      candles: [
        [45, 50, 52, 43],
        [50, 54, 56, 48],
        [54, 62, 64, 52],
        [62, 52, 63, 49],
        [52, 42, 54, 40],
        [42, 32, 44, 29],
      ],
      level: { price: 60, label: 'Range high' },
    },
  },

  'Retest of Broken Level': {
    bullish: {
      // Break above the level, pull back into it, hold, then continue up.
      candles: [
        [40, 48, 50, 38],
        [48, 58, 62, 46],
        [58, 54, 59, 52],
        [54, 52, 56, 50],
        [52, 62, 65, 50],
        [62, 72, 75, 60],
      ],
      level: { price: 54, label: 'Broken level' },
    },
    bearish: {
      // Break below the level, retest it from underneath, rejection, then down.
      candles: [
        [60, 52, 62, 50],
        [52, 42, 54, 40],
        [42, 46, 48, 41],
        [46, 48, 50, 44],
        [48, 38, 50, 35],
        [38, 28, 40, 25],
      ],
      level: { price: 46, label: 'Broken level' },
    },
  },

  'Trendline Break': {
    bullish: {
      // A downtrend breaks its own line, then structure, and turns up.
      candles: [
        [70, 60, 72, 58],
        [60, 52, 62, 50],
        [52, 56, 58, 50],
        [56, 46, 58, 44],
        [46, 56, 60, 44],
        [56, 66, 70, 54],
      ],
      level: { price: 56, label: 'Broken trendline' },
    },
    bearish: {
      // An uptrend loses its line, fails the reclaim, and rolls over.
      candles: [
        [30, 40, 42, 28],
        [40, 48, 50, 38],
        [48, 44, 50, 42],
        [44, 54, 56, 42],
        [54, 46, 56, 44],
        [46, 34, 48, 31],
      ],
      level: { price: 46, label: 'Broken trendline' },
    },
  },

  'Liquidity Sweep': {
    bullish: {
      // A wick through the obvious low that closes back above it, then a rally.
      candles: [
        [60, 52, 62, 50],
        [52, 44, 54, 42],
        [44, 46, 47, 32],
        [46, 56, 59, 44],
        [56, 66, 69, 54],
        [66, 74, 77, 64],
      ],
      level: { price: 38, label: 'Swept low' },
    },
    bearish: {
      // A wick through the obvious high that closes back below it, then a slide.
      candles: [
        [40, 48, 50, 38],
        [48, 56, 58, 46],
        [58, 48, 70, 46],
        [48, 38, 50, 35],
        [38, 28, 40, 25],
        [28, 20, 30, 17],
      ],
      level: { price: 62, label: 'Swept high' },
    },
  },

  'Opening Gap Fill': {
    bullish: {
      // A gap down at the open, then price works all the way back to the prior close.
      candles: [
        [60, 52, 62, 50],
        [52, 44, 54, 42],
        [38, 32, 40, 28],
        [32, 42, 44, 30],
        [42, 50, 53, 40],
        [50, 58, 61, 48],
      ],
      level: { price: 44, label: 'Prior close' },
    },
    bearish: {
      // A gap up at the open, then the fill back down to the prior close.
      candles: [
        [40, 48, 50, 38],
        [48, 56, 58, 46],
        [62, 54, 64, 50],
        [54, 48, 56, 46],
        [48, 44, 50, 42],
        [44, 38, 46, 36],
      ],
      level: { price: 56, label: 'Prior close' },
    },
  },

  'Range Fade': {
    bullish: {
      // Repeated holds at the range low, then a break up out of the balance.
      candles: [
        [60, 50, 62, 48],
        [50, 58, 60, 46],
        [58, 50, 62, 46],
        [50, 60, 64, 48],
        [60, 52, 62, 50],
        [52, 66, 70, 50],
      ],
      level: { price: 46, label: 'Range low' },
    },
    bearish: {
      // Repeated rejections at the range high, then a break down.
      candles: [
        [60, 50, 62, 48],
        [50, 58, 60, 46],
        [58, 50, 62, 46],
        [50, 58, 62, 46],
        [58, 50, 62, 46],
        [50, 36, 52, 32],
      ],
      level: { price: 62, label: 'Range high' },
    },
  },

  'Fair Value Gap': {
    bullish: {
      // Displacement up leaves a gap, price retraces into it, then continues. The
      // displacement candle opens above the previous high, so the hole between the
      // two candles is the gap being marked.
      candles: [
        [40, 44, 46, 38],
        [44, 52, 54, 42],
        [58, 70, 74, 56],
        [70, 64, 72, 62],
        [64, 58, 66, 55],
        [58, 68, 71, 56],
        [68, 78, 81, 66],
      ],
      level: { price: 56, label: 'Fair value gap' },
    },
    bearish: {
      // Displacement down leaves a gap, price retraces up into it, then continues down.
      candles: [
        [65, 60, 67, 58],
        [60, 52, 62, 50],
        [52, 34, 54, 30],
        [34, 40, 44, 32],
        [40, 46, 48, 38],
        [46, 36, 48, 33],
        [36, 26, 38, 23],
      ],
      level: { price: 44, label: 'Fair value gap' },
    },
  },

  'Order Block': {
    bullish: {
      // A down candle origins the displacement up, and the retest into it holds.
      candles: [
        [50, 44, 52, 42],
        [44, 40, 48, 38],
        [40, 58, 62, 38],
        [58, 52, 60, 49],
        [52, 50, 55, 47],
        [50, 62, 66, 48],
        [62, 72, 75, 60],
      ],
      level: { price: 43, label: 'Order block' },
    },
    bearish: {
      // The last up candle before the drop is the block, and its retest is sold.
      candles: [
        [50, 56, 58, 48],
        [56, 60, 62, 52],
        [60, 42, 62, 40],
        [42, 48, 50, 40],
        [48, 50, 53, 45],
        [50, 38, 52, 35],
        [38, 28, 40, 25],
      ],
      level: { price: 57, label: 'Order block' },
    },
  },

  'Pullback to EMA': {
    bullish: {
      // Uptrend, a pullback into the average, then the trend resumes.
      candles: [
        [30, 42, 44, 28],
        [42, 54, 57, 40],
        [54, 46, 56, 44],
        [46, 50, 52, 44],
        [50, 62, 65, 48],
        [62, 72, 75, 60],
      ],
      level: { price: 46, label: 'EMA 21' },
    },
    bearish: {
      // Downtrend, a bounce into the average, then the decline resumes.
      candles: [
        [70, 58, 72, 56],
        [58, 46, 60, 44],
        [46, 54, 56, 44],
        [54, 50, 56, 48],
        [50, 38, 52, 35],
        [38, 28, 40, 25],
      ],
      level: { price: 54, label: 'EMA 21' },
    },
  },

  'Double Top': {
    bullish: {
      // The double top fails: the second test gives way and the level breaks upward.
      candles: [
        [30, 42, 44, 28],
        [42, 54, 58, 40],
        [54, 44, 56, 42],
        [44, 52, 58, 42],
        [52, 62, 66, 50],
        [62, 72, 75, 60],
      ],
      level: { price: 58, label: 'Double top' },
    },
    bearish: {
      // Two rejections at the same high, then the neckline breaks.
      candles: [
        [30, 44, 46, 28],
        [44, 56, 60, 42],
        [56, 44, 58, 40],
        [44, 54, 58, 42],
        [54, 40, 56, 38],
        [40, 28, 42, 25],
      ],
      level: { price: 58, label: 'Double top' },
    },
  },

  'Double Bottom': {
    bullish: {
      // Two buys at the same low, then the neckline breaks upward.
      candles: [
        [70, 58, 72, 56],
        [58, 46, 60, 44],
        [46, 56, 58, 42],
        [56, 48, 58, 44],
        [48, 60, 64, 46],
        [60, 70, 73, 58],
      ],
      level: { price: 44, label: 'Double bottom' },
    },
    bearish: {
      // The double bottom fails and the level gives way to the downside.
      candles: [
        [70, 58, 72, 56],
        [58, 46, 60, 44],
        [46, 54, 58, 42],
        [54, 46, 58, 44],
        [46, 36, 48, 34],
        [36, 26, 38, 23],
      ],
      level: { price: 44, label: 'Double bottom' },
    },
  },

  'Head and Shoulders': {
    bullish: {
      // Inverse: two shoulders with a lower head, then the neckline breaks up.
      candles: [
        [60, 48, 62, 46],
        [48, 34, 50, 30],
        [34, 46, 48, 32],
        [46, 26, 48, 22],
        [26, 40, 44, 24],
        [40, 52, 56, 38],
      ],
      level: { price: 48, label: 'Neckline' },
    },
    bearish: {
      // Left shoulder, head, lower right shoulder, then the neckline breaks down.
      candles: [
        [40, 52, 54, 38],
        [52, 66, 70, 50],
        [66, 54, 68, 52],
        [54, 74, 78, 52],
        [74, 60, 76, 58],
        [60, 66, 68, 58],
        [66, 52, 68, 49],
      ],
      level: { price: 52, label: 'Neckline' },
    },
  },

  'Bull Flag': {
    bullish: {
      // Impulse up, tight drift lower, then the flag breaks upward.
      candles: [
        [30, 50, 54, 28],
        [50, 46, 52, 44],
        [46, 48, 50, 44],
        [48, 46, 50, 44],
        [46, 58, 62, 44],
        [58, 70, 73, 56],
      ],
      level: { price: 52, label: 'Flag high' },
    },
    bearish: {
      // The flag fails: its floor gives way and the impulse is undone.
      candles: [
        [30, 50, 54, 28],
        [50, 46, 52, 44],
        [46, 48, 50, 44],
        [48, 40, 49, 36],
        [40, 30, 42, 27],
        [30, 22, 32, 19],
      ],
      level: { price: 48, label: 'Flag high' },
    },
  },

  'Bear Flag': {
    bullish: {
      // The flag is reclaimed: price takes the drift high and reverses the drop.
      candles: [
        [70, 50, 72, 46],
        [50, 54, 56, 48],
        [54, 52, 56, 50],
        [52, 60, 64, 50],
        [60, 70, 73, 58],
        [70, 78, 81, 68],
      ],
      level: { price: 56, label: 'Flag high' },
    },
    bearish: {
      // Impulse down, tight drift higher, then the flag breaks downward.
      candles: [
        [70, 50, 72, 46],
        [50, 54, 56, 48],
        [54, 52, 56, 50],
        [52, 54, 56, 50],
        [54, 42, 55, 38],
        [42, 30, 44, 27],
      ],
      level: { price: 48, label: 'Flag low' },
    },
  },

  'Inside Bar Break': {
    bullish: {
      // A mother bar, an inside bar, then the break of the mother bar high.
      candles: [
        [40, 50, 52, 38],
        [50, 44, 53, 42],
        [44, 60, 63, 43],
        [60, 68, 71, 58],
        [68, 76, 79, 66],
      ],
      level: { price: 53, label: 'Mother bar high' },
    },
    bearish: {
      // The same compression, resolved through the mother bar low.
      candles: [
        [60, 50, 62, 48],
        [50, 54, 55, 49],
        [54, 42, 55, 39],
        [42, 34, 44, 31],
        [34, 26, 36, 23],
      ],
      level: { price: 48, label: 'Mother bar low' },
    },
  },

  'Three-Bar Reversal': {
    bullish: {
      // Morning star: a push down, a stall, then a full-bodied reversal up.
      candles: [
        [66, 54, 68, 52],
        [54, 44, 56, 42],
        [44, 42, 46, 36],
        [42, 58, 62, 40],
        [58, 66, 69, 56],
        [66, 74, 77, 64],
      ],
      // The star's high: the middle candle's own extreme, which the third candle has to
      // clear for the three-bar pattern to be complete.
      level: { price: 46, label: 'Star high' },
    },
    bearish: {
      // Evening star: a push up, a stall, then a full-bodied reversal down.
      candles: [
        [34, 46, 48, 32],
        [46, 58, 60, 44],
        [58, 62, 66, 54],
        [62, 48, 64, 45],
        [48, 38, 50, 35],
        [38, 28, 40, 25],
      ],
      level: { price: 54, label: 'Star low' },
    },
  },

  'Pin Bar': {
    bullish: {
      // Downtrend into a hammer: a long lower wick is rejected and price turns up.
      candles: [
        [70, 58, 73, 55],
        [58, 48, 60, 45],
        [50, 54, 56, 36],
        [54, 66, 69, 52],
        [66, 76, 79, 64],
      ],
      level: { price: 56, label: 'Pin high' },
    },
    bearish: {
      // Uptrend into a shooting star: a long upper wick is rejected and price turns down.
      candles: [
        [30, 42, 45, 28],
        [42, 52, 54, 40],
        [52, 48, 66, 46],
        [48, 36, 50, 34],
        [36, 26, 38, 23],
      ],
      level: { price: 46, label: 'Pin low' },
    },
  },

  'Prior Day High Break': {
    bullish: {
      // Coils under the prior session's high, breaks it, then holds it on the retest.
      candles: [
        [40, 48, 50, 38],
        [48, 46, 54, 42],
        [44, 52, 54, 43],
        [52, 62, 65, 50],
        [62, 58, 64, 55],
        [58, 70, 73, 56],
      ],
      level: { price: 54, label: 'Prior day high' },
    },
    bearish: {
      // Coils over the prior session's low, breaks it, then rejects it on the retest.
      candles: [
        [64, 56, 66, 52],
        [56, 52, 58, 46],
        [52, 54, 56, 46],
        [54, 44, 55, 42],
        [44, 45, 48, 43],
        [45, 34, 46, 31],
      ],
      level: { price: 46, label: 'Prior day low' },
    },
  },

  'Gap and Go': {
    bullish: {
      // Opens above the prior close and never trades back into the gap: continuation.
      candles: [
        [30, 44, 46, 28],
        [44, 42, 46, 40],
        [52, 64, 66, 52],
        [64, 60, 66, 58],
        [60, 74, 78, 58],
      ],
      // The gap edge is the line: while price holds above it the gap is unfilled, and a
      // close back through it is the reason to stop calling it a gap and go.
      level: { price: 52, label: 'Gap edge' },
    },
    bearish: {
      // Opens below the prior close and holds under the gap: continuation down.
      candles: [
        [70, 56, 72, 54],
        [56, 58, 60, 54],
        [48, 36, 48, 34],
        [36, 40, 42, 34],
        [40, 26, 42, 23],
      ],
      level: { price: 48, label: 'Gap edge' },
    },
  },

  'Fib Retracement': {
    bullish: {
      // Impulse up, then a controlled retrace into the 50–61.8% zone, then continuation.
      candles: [
        [30, 50, 52, 28],
        [50, 44, 52, 42],
        [44, 40, 46, 38],
        [40, 52, 56, 39],
        [52, 64, 68, 50],
        [64, 74, 77, 62],
      ],
      // The zone floor: below here the impulse is being undone rather than retraced.
      level: { price: 38, label: '61.8% retrace' },
    },
    bearish: {
      // Impulse down, then a retrace up into the zone, then continuation lower.
      candles: [
        [72, 52, 74, 50],
        [52, 60, 62, 50],
        [60, 62, 64, 58],
        [62, 50, 64, 48],
        [50, 40, 52, 38],
        [40, 28, 42, 25],
      ],
      level: { price: 64, label: '61.8% retrace' },
    },
  },

  'Triangle Breakout': {
    bullish: {
      // Ascending triangle: a flat top tested twice while the lows keep rising.
      candles: [
        [36, 48, 54, 34],
        [48, 42, 52, 40],
        [42, 52, 54, 46],
        [52, 58, 60, 50],
        [58, 68, 72, 56],
      ],
      level: { price: 54, label: 'Flat top' },
    },
    bearish: {
      // Descending triangle: a flat bottom tested twice while the highs keep falling.
      candles: [
        [64, 52, 66, 46],
        [52, 56, 58, 48],
        [56, 50, 54, 46],
        [50, 38, 52, 36],
        [38, 28, 40, 25],
      ],
      level: { price: 46, label: 'Flat bottom' },
    },
  },

  'Breaker Block': {
    bullish: {
      // The block that failed to hold price down becomes the support price returns to.
      candles: [
        [68, 56, 70, 54],
        [56, 46, 58, 44],
        [46, 58, 60, 44],
        [58, 52, 60, 50],
        [52, 66, 70, 50],
        [66, 78, 81, 64],
      ],
      level: { price: 52, label: 'Breaker block' },
    },
    bearish: {
      // The block that failed to hold price up becomes the resistance price returns to.
      candles: [
        [32, 44, 46, 30],
        [44, 54, 56, 42],
        [54, 42, 56, 40],
        [42, 48, 50, 42],
        [48, 34, 50, 32],
        [34, 22, 36, 19],
      ],
      level: { price: 48, label: 'Breaker block' },
    },
  },
};

/**
 * Resolve a setup name to its diagrams.
 *
 * The exact catalog name is checked first, and the loose substring matchers after it
 * are only a courtesy for setups the trader typed themselves. Without that order the
 * fuzzy rules would hand 'Failed Breakout' the breakout chart, 'Bull Flag' the bearish
 * flag, and 'Double Bottom' whatever contained "bottom" — each showing a chart that
 * actively teaches the wrong thing.
 */
export function resolveSetupDiagrams(setupName: string): Record<Direction, DiagramSpec> {
  const cleaned = setupName.trim().toLowerCase();

  const exact = Object.entries(SETUP_DIAGRAMS).find(([name]) => name.toLowerCase() === cleaned);
  if (exact) return exact[1];

  if (cleaned.includes('engulf')) return SETUP_DIAGRAMS.Engulfing;
  if (cleaned.includes('support')) return SETUP_DIAGRAMS.Support;
  if (cleaned.includes('resistance')) return SETUP_DIAGRAMS.Resistance;
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
