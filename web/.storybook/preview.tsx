import { useEffect, type CSSProperties } from 'react';
import type { Decorator, Preview } from '@storybook/react-vite';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, useColorScheme } from '@mui/material/styles';
import { theme } from '../src/theme/theme';

/** iPhone 17, portrait: 402 x 874 CSS px. Safe areas: 62px top (Dynamic Island), 34px bottom. */
const IPHONE_17 = {
  iphone17: { name: 'iPhone 17', styles: { width: '402px', height: '874px' }, type: 'mobile' as const },
  iphone17landscape: { name: 'iPhone 17 (landscape)', styles: { width: '874px', height: '402px' }, type: 'mobile' as const },
};

function ModeSync({ mode }: { mode: 'light' | 'dark' | 'system' }) {
  const { setMode } = useColorScheme();
  useEffect(() => setMode(mode), [mode, setMode]);
  return null;
}

/**
 * Pads like the device: env(safe-area-inset-*) is 0 in a desktop browser, so the app's
 * `max(env(...), var(--sim-safe-*))` picks up these simulated insets instead, and the
 * Dynamic Island / home indicator are drawn on top so overlap is visible.
 */
const withDevice: Decorator = (Story, ctx) => {
  const device = ctx.globals.device !== 'off' && ctx.parameters.device !== false;
  const vp = ctx.globals.viewport as { value?: string; isRotated?: boolean } | string | undefined;
  const vpValue = typeof vp === 'object' ? vp?.value : vp;
  const landscape = String(vpValue ?? '').includes('landscape') || (typeof vp === 'object' && vp?.isRotated === true);
  const vars = device
    ? landscape
      ? { '--sim-safe-top': '0px', '--sim-safe-bottom': '21px' }
      : { '--sim-safe-top': '62px', '--sim-safe-bottom': '34px' }
    : {};
  return (
    <ThemeProvider theme={theme} disableTransitionOnChange>
      <CssBaseline />
      <ModeSync mode={(ctx.globals.colorMode as 'light' | 'dark' | 'system') ?? 'system'} />
      <div style={{ ...(vars as CSSProperties), minHeight: '100dvh' }}>
        <Story />
      </div>
      {device && !landscape && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            top: 11,
            left: '50%',
            width: 124,
            height: 36,
            marginLeft: -62,
            borderRadius: 18,
            background: '#000',
            zIndex: 2000,
            pointerEvents: 'none',
          }}
        />
      )}
      {device && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            bottom: 8,
            left: '50%',
            width: 140,
            height: 5,
            marginLeft: -70,
            borderRadius: 3,
            background: 'rgba(128,128,128,0.6)',
            zIndex: 2000,
            pointerEvents: 'none',
          }}
        />
      )}
    </ThemeProvider>
  );
};

const preview: Preview = {
  decorators: [withDevice],
  globalTypes: {
    colorMode: {
      description: 'Color scheme',
      toolbar: {
        title: 'Mode',
        icon: 'mirror',
        items: [
          { value: 'system', title: 'System' },
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
    device: {
      description: 'Simulated safe areas',
      toolbar: {
        title: 'Safe areas',
        icon: 'mobile',
        items: [
          { value: 'on', title: 'Safe areas on' },
          { value: 'off', title: 'Safe areas off' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    colorMode: 'system',
    device: 'on',
    viewport: { value: 'iphone17', isRotated: false },
  },
  parameters: {
    layout: 'fullscreen',
    viewport: { options: IPHONE_17 },
    controls: { matchers: { color: /(background|color)$/i } },
    a11y: { test: 'todo' },
  },
};

export default preview;
