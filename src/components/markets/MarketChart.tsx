import React, { useEffect, useRef, useState } from 'react';
import type { ChartSymbol } from '../../lib/trading/chart-symbols';

/**
 * The TradingView Advanced Chart, wrapped so the rest of the app never touches the
 * provider's script or global.
 *
 * Loading the script per component instance (not per app boot) keeps the widget out of
 * the Today tab's bundle path entirely: a trader who never opens Markets never downloads
 * the provider's library. The widget is recreated when the symbol or theme changes —
 * the provider's own widget supports symbol changes in place, but recreating keeps the
 * studies, interval and theme state predictable for one small symbol set.
 */
declare global {
  interface Window {
    TradingView?: {
      widget: new (config: Record<string, unknown>) => unknown;
    };
  }
}

/** Loads the provider script once per page; resolves when it is usable. */
let tvScriptPromise: Promise<void> | null = null;

function loadTradingViewScript(): Promise<void> {
  if (window.TradingView?.widget) return Promise.resolve();
  if (tvScriptPromise) return tvScriptPromise;

  tvScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-tradingview]');
    if (existing) {
      // Another instance is already loading it; piggyback on that load.
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('TradingView script failed to load.')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.dataset.tradingview = 'true';
    script.onload = () => resolve();
    script.onerror = () => {
      tvScriptPromise = null;
      reject(new Error('TradingView script failed to load.'));
    };
    document.head.appendChild(script);
  });
  return tvScriptPromise;
}

interface MarketChartProps {
  symbol: ChartSymbol;
  theme: 'dark' | 'light';
  height?: string;
}

export const MarketChart: React.FC<MarketChartProps> = ({ symbol, theme, height = '440px' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  // Stable per-mount id for the library's `getElementById` lookup.
  const [targetId] = useState(() => `tv-widget-host-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    loadTradingViewScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.TradingView) return;
        // A fresh inner div per recreation, because the widget takes ownership of the
        // div it is mounted into and reusing one can leave stale iframe state behind.
        const host = containerRef.current;
        host.innerHTML = '';
        const target = document.createElement('div');
        // The iframe is sized 100%/100% up the chain, so the host div needs definite
        // dimensions of its own rather than content-driven ones.
        target.style.width = '100%';
        target.style.height = '100%';
        host.appendChild(target);

        // The provider's library resolves its mount point with
        // `document.getElementById(options.container)` — a string id, never a DOM node,
        // and it reads that id from `container_id` only. Handing it a node (or leaving
        // `container_id` unset) makes it fall back to inserting beside
        // `document.currentScript`, which is null when invoked from a module — the
        // library throws and the chart reports "could not be loaded".
        target.id = targetId;

        new window.TradingView.widget({
          container_id: targetId,
          // Routes the embed through the provider's CME-licensed path
          // (/cmewidgetembed/). Without it every CME-group contract — MES, MNQ,
          // ES, NQ, MYM, gold, WTI — first shows a "This symbol is only available
          // on TradingView" dialog that must be dismissed before the chart draws.
          // Verified across the whole symbol set in scripts/probe-tv-dialog.mjs.
          cme: true,
          autosize: true,
          symbol: symbol.tvSymbol,
          interval: '60',
          timezone: 'Etc/UTC',
          theme,
          style: '1',
          locale: 'en',
          enable_publishing: false,
          hide_top_toolbar: false,
          hide_legend: false,
          allow_symbol_change: true,
          save_image: false,
          calendar: false,
          withdateranges: true,
          details: false,
          studies: ['RSI@tv-basicstudies', 'MASimple@tv-basicstudies'],
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [symbol.tvSymbol, theme]);

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40">
      <div ref={containerRef} style={{ height }} className="w-full" />
      {failed && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900/80 p-6 text-center"
          data-testid="chart-load-failure"
        >
          <p className="text-sm font-medium text-zinc-200">The chart could not be loaded.</p>
          <p className="max-w-sm text-xs text-zinc-400">
            The chart provider may be blocked by your network or an extension. Everything else in
            the journal is unaffected.
          </p>
        </div>
      )}
    </div>
  );
};
