import { useColorScheme } from '@mui/material/styles';

/**
 * Chart color tokens, from the dataviz reference palette. Validated with the dataviz
 * skill's `validate_palette.js` (all checks PASS):
 *   diverging poles  light  #e34948,#2a78d6  (CVD dE 21.6, normal dE 32.3, both >= 3:1)
 *                    dark   #e66767,#3987e5  (CVD dE 19.2, normal dE 29.0, both >= 3:1)
 *   ordinal meter    light  #86b6ef -> #2a78d6 ; dark #184f95 -> #5598e7 (monotone, single hue)
 *   meter tracks are the far step of the same ramp: light #cde2fb, dark #0d366b (recedes to the surface)
 * The neutral midpoint is gray (never a hue). Text never wears these colors.
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
