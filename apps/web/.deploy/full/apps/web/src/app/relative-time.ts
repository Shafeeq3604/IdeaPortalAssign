/**
 * "31 min ago" — a plain, real relative time from an ISO timestamp.
 *
 * Split out of `DashboardHero.tsx` (its original home) once a second component
 * (`DashboardPage`'s Activity section) needed the exact same handful of divisions:
 * `react-refresh/only-export-components` refuses a plain function living alongside
 * components in the same file, and duplicating this was the wrong fix for the same
 * reason two independent copies of anything time-related always are.
 */
export function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
