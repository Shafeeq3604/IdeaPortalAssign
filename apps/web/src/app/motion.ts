import * as React from "react";

/**
 * P20 — the few motion helpers the experience layer shares (SPEC §14 M4, D-25).
 *
 * Every one of them does nothing under `prefers-reduced-motion`. tokens.css already
 * shrinks CSS durations to ~0 there; these are the JavaScript-driven motions (Web
 * Animations, the celebration burst), which a media query in a stylesheet cannot reach.
 */

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** A motion token's value, so a JS animation runs on the same clock as the CSS ones. */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function durationMs(name: string, fallback: number): number {
  const raw = token(name, `${fallback}ms`);
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return raw.endsWith("ms") ? n : raw.endsWith("s") ? n * 1000 : n;
}

/**
 * settle-rank (SPEC §8.3) — FLIP: when `order` changes, every element carrying
 * `data-flip-key` inside `container` glides from where it was to where it now is.
 *
 * Elements that were not on screen before simply appear; nothing is invented for them.
 * Positions are measured relative to the container, so scrolling between two renders
 * does not read as movement.
 */
export function useFlip(container: React.RefObject<HTMLElement | null>, order: string) {
  const previous = React.useRef<Map<string, { x: number; y: number }>>(new Map());

  React.useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const base = root.getBoundingClientRect();
    const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-flip-key]"));
    const next = new Map<string, { x: number; y: number }>();
    for (const el of elements) {
      const key = el.dataset.flipKey;
      if (!key) continue;
      const r = el.getBoundingClientRect();
      next.set(key, { x: r.left - base.left, y: r.top - base.top });
    }

    const before = previous.current;
    previous.current = next;
    if (before.size === 0 || prefersReducedMotion() || typeof root.animate !== "function") return;

    const duration = durationMs("--dur-settle", 420);
    const easing = token("--ease-settle", "ease-out");
    for (const el of elements) {
      const key = el.dataset.flipKey;
      if (!key) continue;
      const from = before.get(key);
      const to = next.get(key);
      if (!from || !to) continue;
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration, easing },
      );
    }
    // Deliberately keyed on `order` alone: a re-render that moves nothing must not
    // re-measure against a stale layout and "animate" a resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);
}

/**
 * A short celebratory burst from a point on screen (P20 "celebrations", pulled forward
 * from P19's milestone moments). Purely decorative — `aria-hidden`, pointer-events off,
 * removed from the DOM when it finishes. The words that matter go in a toast beside it.
 */
const BIT_TONES = ["bg-accent-600", "bg-grad-highlight", "bg-state-ok", "bg-ramp-3", "bg-state-info"] as const;

export function celebrate(origin?: { x: number; y: number }): void {
  if (typeof document === "undefined" || prefersReducedMotion()) return;
  const layer = document.createElement("div");
  layer.className = "celebrate";
  layer.setAttribute("aria-hidden", "true");
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 3;

  const count = 28;
  for (let i = 0; i < count; i++) {
    const bit = document.createElement("span");
    bit.className = `celebrate-bit ${BIT_TONES[i % BIT_TONES.length] ?? ""}`;
    // Spread evenly round a circle with a little jitter, biased upward so it reads as a
    // burst rather than a spill.
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const reach = 70 + Math.random() * 90;
    bit.style.setProperty("--x", `${x}px`);
    bit.style.setProperty("--y", `${y}px`);
    bit.style.setProperty("--dx", `${Math.cos(angle) * reach}px`);
    bit.style.setProperty("--dy", `${Math.sin(angle) * reach - 50}px`);
    bit.style.setProperty("--fall", `${60 + Math.random() * 60}px`);
    bit.style.setProperty("--rot", `${Math.round(Math.random() * 540 - 270)}deg`);
    layer.appendChild(bit);
  }
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), durationMs("--dur-celebrate", 1200) + 200);
}

/** Where a clicked control is, as a burst origin. */
export function originOf(el: Element | null): { x: number; y: number } | undefined {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
