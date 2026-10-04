import { useColorScheme } from '@mui/material/styles';

/**
 * Chart color tokens, from the dataviz reference palette. Validated with the dataviz
 * skill's `validate_palette.js` (all checks PASS):
 *   diverging poles  light  #e34948,#2a78d6  (CVD dE 21.6, normal dE 32.3, both >= 3:1)
 *                    dark   #e66767,#3987e5  (CVD dE 19.2, normal dE 29.0, both >= 3:1)
 *   ordinal meter    light  #86b6ef -> #2a78d6 ; dark #184f95 -> #5598e7 (monotone, single hue)
 *   meter tracks are the far step of the same ramp: light #cde2fb, dark #0d366b (recedes to the surface)
 * The neutral midpoint is gray (never a hue). Text never wears these colors.
 * pos/neg are neutral-polarity (blue emphasis). For anything good/bad FOR ME use FOR_ME below.
 */
export interface VizTokens {
  /** Diverging pole: above 50% / positive gain. */
  pos: string;
  /** Diverging pole: below 50% / negative gain. */
  neg: string;
  /** Neutral midpoint (about even) and punted categories. */
  neutral: string;
  /** Meter fill and track (same ramp, track is the lighter step). */
  meterFill: string;
  meterTrack: string;
  grid: string;
  axis: string;
  muted: string;
  surface: string;
}

export const VIZ: { light: VizTokens; dark: VizTokens } = {
  light: {
    pos: '#2a78d6',
    neg: '#e34948',
    neutral: '#b5b3ab',
    meterFill: '#2a78d6',
    meterTrack: '#cde2fb',
    grid: '#e1e0d9',
    axis: '#c3c2b7',
    muted: '#898781',
    surface: '#fcfcfb',
  },
  dark: {
    pos: '#3987e5',
    neg: '#e66767',
    neutral: '#6b6a64',
    meterFill: '#5598e7',
    meterTrack: '#0d366b',
    grid: '#2c2c2a',
    axis: '#383835',
    muted: '#898781',
    surface: '#1a1a19',
  },
};

declare module '@mui/material/styles' {
  interface Palette {
    viz: VizTokens;
  }
  interface PaletteOptions {
    viz?: VizTokens;
  }
}

/** Resolved light/dark mode (handles `system`). SVG fills get concrete hex values. */
export function useResolvedMode(): 'light' | 'dark' {
  const { mode, systemMode } = useColorScheme();
  const resolved = mode === 'system' ? systemMode : mode;
  return resolved === 'dark' ? 'dark' : 'light';
}

export function useVizColors(): VizTokens {
  return VIZ[useResolvedMode()];
}

/**
 * "For me" semantic diverging pair: GREEN = helps me win / good decision, RED = hurts me /
 * bad decision, GRAY = no effect, always from my perspective (an opponent's extra game is red).
 * Validated with the dataviz validator:
 *   poles   light #0f8a6a / #d4513f  CVD dE 8.0, normal 26.5, both >= 3:1 on #fcfcfb   PASS
 *           dark  #21a07c / #e5604d  CVD dE 9.1, normal 27.1, both >= 3:1 on #1a1a19   PASS
 *   ramps (weak -> strong, each arm --ordinal, monotone L, dE L >= 0.06, single hue)  PASS
 *     light good #94b6a8 #6ca28d #0f8a6a (light end 2.15:1)  bad #e1a09a #db8078 #d4513f (2.11:1)
 *     dark  good #1d7157 #1f8b6c #21a07c (dark end 2.95:1)   bad #a14437 #c75443 #e5604d (2.82:1)
 * Never color alone: pair every mark with a sign or ▲/▼ (forMeSymbol) and say it in words.
 * These are different steps from the status palette (success/warning/error), which stays
 * reserved for status; bad red sits near status red (dE 4), so status keeps its icon + label.
 */
export interface ForMeTokens {
  good: string;
  bad: string;
  neutral: string;
  /** Weak -> strong, three steps per arm (index 2 is the pole). */
  goodRamp: [string, string, string];
  badRamp: [string, string, string];
}

export const FOR_ME: { light: ForMeTokens; dark: ForMeTokens } = {
  light: {
    good: '#0f8a6a',
    bad: '#d4513f',
    neutral: '#b5b3ab',
    goodRamp: ['#94b6a8', '#6ca28d', '#0f8a6a'],
    badRamp: ['#e1a09a', '#db8078', '#d4513f'],
  },
  dark: {
    good: '#21a07c',
    bad: '#e5604d',
    neutral: '#6b6a64',
    goodRamp: ['#1d7157', '#1f8b6c', '#21a07c'],
    badRamp: ['#a14437', '#c75443', '#e5604d'],
  },
};

export interface ForMeScale {
  /** Most negative value on the scale (<= 0): maps to the strongest red. */
  min: number;
  /** Most positive value (>= 0): maps to the strongest green. */
  max: number;
  /** |value| at or below this is "no effect" (gray). Default 0. */
  deadband?: number;
}

/** Color for a signed "good for me" value: gray at 0, stepping to green (+) or red (−). */
export function forMeColor(value: number | null | undefined, scale: ForMeScale, mode: 'light' | 'dark' = 'light'): string {
  const t = FOR_ME[mode];
  if (value == null || !Number.isFinite(value) || Math.abs(value) <= (scale.deadband ?? 0)) return t.neutral;
  const end = value > 0 ? scale.max : scale.min;
  const frac = end === 0 ? 1 : Math.min(1, Math.abs(value / end));
  const step = Math.max(0, Math.min(2, Math.ceil(frac * 3) - 1));
  return (value > 0 ? t.goodRamp : t.badRamp)[step] ?? t.neutral;
}

/** The non-color cue that must accompany every "for me" mark. */
export function forMeSymbol(value: number | null | undefined, deadband = 0): '▲' | '▼' | '●' {
  if (value == null || !Number.isFinite(value) || Math.abs(value) <= deadband) return '●';
  return value > 0 ? '▲' : '▼';
}

export function forMeWord(value: number | null | undefined, deadband = 0): 'helps you' | 'hurts you' | 'no effect' {
  const s = forMeSymbol(value, deadband);
  return s === '▲' ? 'helps you' : s === '▼' ? 'hurts you' : 'no effect';
}

/**
 * Status error, moved off forMe bad so a red cell is never read as an alert (validator,
 * normal-vision dE): light #87163b vs bad #d4513f 20.5, vs good 29.7, vs warning 43.8,
 * vs success 38.9, 9.26:1 on the surface; dark #f5a3c7 vs bad #e5604d 18.7, vs good 28.5,
 * vs warning 19.1, vs success 35.6, 9.08:1 on the surface. (Old #d03b3b vs bad: 4.0.)
 */
export const STATUS = {
  light: { success: '#0ca30c', warning: '#fab219', error: '#87163b' },
  dark: { success: '#0ca30c', warning: '#fab219', error: '#f5a3c7' },
};

export const STATUS_VS_FORME = {
  light: { errorVsBad: 20.5, errorVsGood: 29.7, errorVsWarning: 43.8, errorVsSuccess: 38.9, oldErrorVsBad: 4.0 },
  dark: { errorVsBad: 18.7, errorVsGood: 28.5, errorVsWarning: 19.1, errorVsSuccess: 35.6 },
};

export function useForMe(): ForMeTokens {
  return FOR_ME[useResolvedMode()];
}
