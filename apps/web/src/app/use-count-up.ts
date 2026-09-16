import * as React from "react";

/**
 * Counts from whatever was last displayed to `value` over `durationMs` — 0 → value on
 * first mount, previous → new on a later change (a recompute changing a KPI, say), never
 * a reset back to 0. Reserved for the handful of figures that should feel like they
 * "arrive" (visual-richness pass — Dashboard KPI counts, a primary/highlighted score),
 * not applied broadly: animating twenty score rings in a grid at once is the "looks like
 * an AI demo" failure mode the pass was explicitly asked to avoid.
 *
 * Respects `prefers-reduced-motion` by jumping straight to the final value, same as
 * every other motion token in `tokens.css`.
 */
export function useCountUp(value: number, durationMs = 600): number {
  // Read once, lazily — a pure environment read at first render, not a side effect, so
  // there is nothing to set state in response to (react-hooks/set-state-in-effect).
  const [reduced] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [display, setDisplay] = React.useState(reduced ? value : 0);
  const fromRef = React.useRef(reduced ? value : 0);
  const mountedRef = React.useRef(reduced);

  React.useEffect(() => {
    if (reduced) return;

    const from = mountedRef.current ? fromRef.current : 0;
    if (from === value) {
      mountedRef.current = true;
      return;
    }

    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setDisplay(from + (value - from) * t);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
        mountedRef.current = true;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs, reduced]);

  return display;
}
