// ── VT warning suppression ──────────────────────────────────────────
// Must intercept before React's first commit — useEffect is too late
// because trackNamedViewTransition fires during layout effects.

import { useEffect, useState, useSyncExternalStore } from 'react';

const ORIGINAL_CONSOLE_ERROR = console.error;
let vtDuplicateWarnings = 0;
const vtWarningListeners = new Set<() => void>();

console.error = (...args: unknown[]) => {
  if (
    args.some(
      (a) =>
        typeof a === 'string'
        && (a.includes('same name mounted at the same time')
          || a.includes('duplicate has this stack trace')
          || a.includes('ViewTransition name=')),
    )
  ) {
    vtDuplicateWarnings++;
    for (const listener of vtWarningListeners) listener();
    return;
  }
  ORIGINAL_CONSOLE_ERROR.apply(console, args);
};

// ── Debug stats hook ────────────────────────────────────────────────

export function useAnimationDebugStats() {
  const duplicateNameWarnings = useSyncExternalStore(
    (cb) => {
      vtWarningListeners.add(cb);
      return () => {
        vtWarningListeners.delete(cb);
      };
    },
    () => vtDuplicateWarnings,
  );

  const [startCalls, setStartCalls] = useState(0);

  useEffect(() => {
    const originalStart = document.startViewTransition;
    if (originalStart) {
      document.startViewTransition = function(...args) {
        setStartCalls((c) => c + 1);
        return originalStart.apply(this, args);
      };
    }
    return () => {
      if (originalStart) {
        document.startViewTransition = originalStart;
      }
    };
  }, []);

  return { startCalls, duplicateNameWarnings };
}
