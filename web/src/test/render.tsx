import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from '../theme/theme';

export function renderWithTheme(ui: ReactElement) {
  return render(
    <ThemeProvider theme={theme} storageManager={null} noSsr>
      {ui}
    </ThemeProvider>,
  );
}
