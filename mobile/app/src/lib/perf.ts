/**
 * Tiny performance logger for instrumenting key UI paths on a real device.
 *
 * Why not just react-devtools / Hermes profiler? Those give per-render
 * breakdowns but you have to wire up a profiling session for each measurement
 * run. This module lets you sprinkle named checkpoints in code, look at the
 * Metro terminal, and read elapsed-ms numbers directly.
 *
 * Usage:
 *   import { perf } from '~/lib/perf';
 *   perf.mark('taxonomy:mount');
 *   // ...later
 *   perf.measure('taxonomy:first-paint', 'taxonomy:mount');
 *
 *   // Or wrap a function:
 *   const rows = perf.time('taxonomy:cascade-batch', () => runBatch());
 *
 * Output is gated on __DEV__ + the PERF_ENABLED flag below so the same code
 * compiles into release builds with zero overhead (Hermes DCE strips the
 * `if (__DEV__ && ...)` branch).
 *
 * View logs:
 *   - Metro terminal (where `npx expo start` runs)
 *   - `npx react-native log-ios` / `log-android`
 *   - Filter with: grep '\[perf\]'
 */

const PERF_ENABLED = true;

const marks = new Map<string, number>();

function now(): number {
  // global.performance.now() is provided by Hermes / RN runtime.
  // Date.now() fallback covers any edge case where the polyfill isn't loaded.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (globalThis as any).performance;
  return p?.now ? p.now() : Date.now();
}

function fmt(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 10) return `${ms.toFixed(1)}ms`;
  return `${ms.toFixed(0)}ms`;
}

export const perf = {
  /** Record a named timestamp. Overwrites any previous mark with the same name. */
  mark(name: string): void {
    if (!__DEV__ || !PERF_ENABLED) return;
    marks.set(name, now());
    console.log(`[perf] mark ${name}`);
  },

  /** Print elapsed time from `fromMark` (or app start if omitted) and store
   *  `name` as a new mark so it can chain into the next measure. */
  measure(name: string, fromMark?: string): number | null {
    if (!__DEV__ || !PERF_ENABLED) return null;
    const end = now();
    const start = fromMark ? marks.get(fromMark) : 0;
    if (fromMark != null && start == null) {
      console.log(`[perf] measure ${name}: missing fromMark "${fromMark}"`);
      marks.set(name, end);
      return null;
    }
    const elapsed = end - (start ?? 0);
    const label = fromMark ? `${fromMark} → ${name}` : name;
    console.log(`[perf] ${label}: ${fmt(elapsed)}`);
    marks.set(name, end);
    return elapsed;
  },

  /** Synchronous time-this-function helper. Returns the function's value. */
  time<T>(name: string, fn: () => T): T {
    if (!__DEV__ || !PERF_ENABLED) return fn();
    const t0 = now();
    try {
      return fn();
    } finally {
      const elapsed = now() - t0;
      console.log(`[perf] ${name}: ${fmt(elapsed)}`);
    }
  },

  /** Async version of time(). */
  async timeAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (!__DEV__ || !PERF_ENABLED) return fn();
    const t0 = now();
    try {
      return await fn();
    } finally {
      const elapsed = now() - t0;
      console.log(`[perf] ${name}: ${fmt(elapsed)}`);
    }
  },
};
