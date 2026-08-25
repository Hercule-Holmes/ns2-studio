/**
 * Time / ruler helpers for the timeline editor (S5). Pure functions so they
 * can be unit-tested without a DOM.
 */

export function msToPx(ms: number, zoom: number): number {
  return (ms / 1000) * zoom;
}

export function pxToMs(px: number, zoom: number): number {
  return (px / zoom) * 1000;
}

/** Compact label: `12.5s`, or `M:SS` once past a minute. */
export function formatTime(ms: number): string {
  const s = ms / 1000;
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rem = s - m * 60;
    return `${m}:${rem.toFixed(0).padStart(2, "0")}`;
  }
  return `${s.toFixed(2).replace(/\.?0+$/, "")}s`;
}

/** Transport-style clock: `M:SS.mmm`. */
export function formatClock(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(3).padStart(6, "0")}`;
}

const MAJOR_STEP_CANDIDATES = [
  100, 200, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000,
  120000, 300000, 600000,
];

/** Smallest major step (ms) whose label spacing stays >= minPx. */
export function niceStep(zoom: number, minPx = 70): number {
  for (const step of MAJOR_STEP_CANDIDATES) {
    if ((step / 1000) * zoom >= minPx) return step;
  }
  return MAJOR_STEP_CANDIDATES[MAJOR_STEP_CANDIDATES.length - 1] ?? 600000;
}

export interface RulerTick {
  ms: number;
  label: string;
}

export interface TickLayout {
  major: RulerTick[];
  minorStepMs: number;
  majorStepMs: number;
}

/** Ruler ticks for the visible [scrollMs, scrollMs + viewportMs) window. */
export function computeTicks(
  scrollMs: number,
  viewportMs: number,
  zoom: number,
): TickLayout {
  const majorStepMs = niceStep(zoom);
  const minorStepMs = majorStepMs / 5;
  const from = Math.max(0, Math.floor(scrollMs / majorStepMs) * majorStepMs);
  const to = scrollMs + viewportMs;
  const major: RulerTick[] = [];
  for (let ms = from; ms <= to; ms += majorStepMs) {
    major.push({ ms, label: formatTime(ms) });
  }
  return { major, minorStepMs, majorStepMs };
}