/**
 * Display formatting only. These never compute a projection, probability or value;
 * they render numbers the engine already produced. Missing values render as an em dash
 * so a gap is visible rather than disguised as zero.
 */

export const MISSING = '—';

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** 0.734 -> "73%". Values within 0.5% of the ends show "<1%" / ">99%" so 0/100 are never implied. */
export function pct(p: number | null | undefined): string {
  if (!isNum(p)) return MISSING;
  if (p > 0 && p < 0.005) return '<1%';
  if (p < 1 && p > 0.995) return '>99%';
  return `${Math.round(p * 100)}%`;
}

/** Signed expected-categories gain: 0.123 -> "+0.12", -0.04 -> "−0.04". */
export function signed(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return MISSING;
  const s = Math.abs(v).toFixed(digits);
  if (Number(s) === 0) return `±${s}`;
  return v > 0 ? `+${s}` : `−${s}`;
}

export function fixed(v: number | null | undefined, digits = 1): string {
  return isNum(v) ? v.toFixed(digits) : MISSING;
}

/** Seconds -> "0:07" / "1:00". Negative clamps to 0. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** "PG, G, Util" from eligible; falls back to the primary position. */
export function eligibleLabel(eligible: string[] | null | undefined, position?: string | null): string {
  const slots = (eligible ?? []).filter((s) => s !== 'Util');
  if (slots.length) return slots.join(', ');
  return position ?? MISSING;
}

/** The engine joins reasons with "; ". */
export function splitReasons(reasons: string | null | undefined): string[] {
  if (!reasons) return [];
  return reasons
    .split(';')
    .map((r) => r.trim())
    .filter(Boolean);
}

export function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** Label for a category key from the session's category list, falling back to the key. */
export function categoryLabel(key: string, categories: { key: string; label: string }[]): string {
  return categories.find((c) => c.key === key)?.label ?? key;
}

export function teamLabel(slot: number | null | undefined, mySlot: number | null | undefined): string {
  if (slot == null) return MISSING;
  return slot === mySlot ? `You (team ${slot})` : `Team ${slot}`;
}
