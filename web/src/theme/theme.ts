import { createTheme } from '@mui/material/styles';
import type {} from '@mui/material/themeCssVarsAugmentation';
import { STATUS, VIZ } from './viz';

/**
 * Calm, dense, readable theme. Light + dark via `colorSchemes` and CSS variables
 * (MUI v9: `cssVariables.colorSchemeSelector: 'class'` lets the toggle override the OS
 * preference; the default mode is `system`, so prefers-color-scheme is respected).
 *
 * Surfaces and ink come from the dataviz reference palette. Status colors
 * (success / warning / error) are reserved for status and always ship with an icon + text.
 * Mobile: inputs are 16px so iOS Safari never zooms; tap targets are >= 44px.
 */
const SYSTEM_SANS = 'system-ui, -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
const TAP = 44;

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#256abf', contrastText: '#ffffff' },
        secondary: { main: '#52514e' },
        success: { main: '#0ca30c', dark: '#006300' },
        warning: { main: '#fab219', dark: '#8a5a00' },
        // Deep crimson: normal-vision dE 20.5 from forMe bad (#d4513f), white text 9.5:1.
        error: { main: STATUS.light.error },
        info: { main: '#256abf' },
        background: { default: '#f4f4f1', paper: '#fcfcfb' },
        text: { primary: '#0b0b0b', secondary: '#52514e', disabled: '#898781' },
        divider: 'rgba(11, 11, 11, 0.10)',
        viz: VIZ.light,
      },
    },
    dark: {
      palette: {
        primary: { main: '#5598e7', contrastText: '#0b0b0b' },
        secondary: { main: '#c3c2b7' },
        success: { main: '#0ca30c' },
        warning: { main: '#fab219' },
        // Light rose: dE 18.7 from forMe bad (#e5604d), dark text 10.3:1 on it.
        error: { main: STATUS.dark.error },
        info: { main: '#5598e7' },
        background: { default: '#0d0d0d', paper: '#1a1a19' },
        text: { primary: '#ffffff', secondary: '#c3c2b7', disabled: '#898781' },
        divider: 'rgba(255, 255, 255, 0.10)',
        viz: VIZ.dark,
      },
    },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
    h6: { fontSize: '1.05rem', fontWeight: 600, lineHeight: 1.3 },
    subtitle1: { fontSize: '0.95rem', fontWeight: 600 },
    subtitle2: { fontSize: '0.85rem', fontWeight: 600 },
    body1: { fontSize: '0.95rem' },
    body2: { fontSize: '0.875rem' },
    caption: { fontSize: '0.78rem' },
    overline: { fontSize: '0.7rem', letterSpacing: '0.08em', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600, fontSize: '0.95rem' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { WebkitTextSizeAdjust: '100%', overscrollBehaviorY: 'none' },
        body: { overflowX: 'hidden', WebkitTapHighlightColor: 'transparent' },
        '.tabular': { fontVariantNumeric: 'tabular-nums' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { minHeight: TAP, borderRadius: 10 } },
    },
    MuiIconButton: { styleOverrides: { root: { minWidth: TAP, minHeight: TAP } } },
    MuiToggleButton: { styleOverrides: { root: { minHeight: TAP, textTransform: 'none' } } },
    MuiInputBase: {
      // >= 16px stops iOS Safari from zooming into a focused field.
      styleOverrides: { input: { fontSize: 16 } },
    },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiCard: { defaultProps: { variant: 'outlined' } },
    MuiBottomNavigationAction: {
      styleOverrides: { root: { minWidth: 0, paddingLeft: 4, paddingRight: 4 } },
    },
    MuiListItemButton: { styleOverrides: { root: { minHeight: TAP } } },
    MuiSnackbar: { defaultProps: { anchorOrigin: { vertical: 'top', horizontal: 'center' } } },
  },
});
