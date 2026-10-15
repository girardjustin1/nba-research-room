/** The last stretch before the draft, shown in amber. */
export const SOON_MS = 15 * 60_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Time left as "2d 21h 14m" (a day or more), "21:14:05" or "4:05" (under an hour). */
export function countdownLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/** "Sun Oct 18, 8:00 pm ET": the draft's start in league time. */
export function draftStartLabel(iso: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(date);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
    .format(date)
    .replace(' AM', ' am')
    .replace(' PM', ' pm');
  return `${day}, ${time} ET`;
}
