import type { StorybookConfig } from '@storybook/react-vite';

// Local only: `pnpm storybook` serves on 127.0.0.1:6006. No deployment, no Chromatic,
// no telemetry. Stories use invented players from src/mocks only.
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true, disableWhatsNewNotifications: true, enableCrashReports: false },
};

export default config;
