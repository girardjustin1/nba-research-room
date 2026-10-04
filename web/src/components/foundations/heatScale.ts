import { FOR_ME, forMeColor } from '../../theme/viz';

/**
 * Color scales for the heat calendar and schedule grids.
 * - Sequential (magnitude with no for-me meaning, e.g. PTS or minutes): the dataviz blue
 *   ramp, validated with validate_palette.js --ordinal (all PASS):
 *     light #86b6ef,#5598e7,#2a78d6,#1c5cab,#104281 (light end 2.06:1)
 *     dark  #184f95,#256abf,#3987e5,#6da7ec,#9ec5f4 (dark end 2.15:1)
 * - Diverging ("good / bad for me", e.g. Value): theme/viz.ts `forMe` green / gray / red,
 *   validated there. Gray is the midpoint, never a hue.
 * Binning is a display mapping only; the engine supplies the value and the domain.
 */

export type ScaleKind = 'sequential' | 'diverging' | 'binary';
export type Mode = 'light' | 'dark';

export const SEQUENTIAL: Record<Mode, string[]> = {
  light: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'],
  dark: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4'],
};

/** Legend steps for the for-me scale, most negative first: strong bad … neutral … strong good. */
export function divergingSteps(mode: Mode): string[] {
  const t = FOR_ME[mode];
  return [t.badRamp[2], t.badRamp[1], t.badRamp[0], t.neutral, t.goodRamp[0], t.goodRamp[1], t.goodRamp[2]];
}

/** Index 0..4 for a value. Sequential: equal fifths of [min, max]. Diverging: symmetric about 0. */
export function binIndex(value: number, kind: ScaleKind, min: number, max: number): number {
  if (kind === 'binary') return 2;
  if (kind === 'sequential') {
    const span = max - min;
    if (!(span > 0)) return 2;
    const t = Math.min(1, Math.max(0, (value - min) / span));
    return Math.min(4, Math.floor(t * 5));
  }
  const m = Math.max(Math.abs(min), Math.abs(max));
  if (!(m > 0)) return 2;
  const t = value / m;
  if (t <= -0.6) return 0;
  if (t < -0.2) return 1;
  if (t <= 0.2) return 2;
  if (t < 0.6) return 3;
  return 4;
}

export function binColor(value: number, kind: ScaleKind, min: number, max: number, mode: Mode): string {
  if (kind === 'diverging') return forMeColor(value, { min: Math.min(0, min), max: Math.max(0, max), deadband: 0.2 * Math.max(Math.abs(min), Math.abs(max)) }, mode);
  return SEQUENTIAL[mode][binIndex(value, kind, min, max)]!;
}

/** Relative luminance (WCAG) of a #rrggbb color. */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ink for text set inside a filled cell: whichever of near-black or white contrasts more. */
export function inkOn(hex: string): string {
  const l = luminance(hex);
  const onWhite = 1.05 / (l + 0.05);
  const onInk = (l + 0.05) / (luminance('#0b0b0b') + 0.05);
  return onInk >= onWhite ? '#0b0b0b' : '#ffffff';
}

/** Bin edges for the legend, as values (sequential: 6 edges; diverging: 4 inner edges). */
export function legendEdges(kind: ScaleKind, min: number, max: number): number[] {
  if (kind === 'sequential') return [0, 1, 2, 3, 4, 5].map((i) => min + ((max - min) * i) / 5);
  const m = Math.max(Math.abs(min), Math.abs(max));
  return [-0.6, -0.2, 0.2, 0.6].map((t) => t * m);
}
