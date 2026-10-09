import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { yahooLive, yahooNoAccess, yahooOff, yahooSlow } from '../../mocks/app-shell/yahooStatus';
import { YahooStatusBanner } from './YahooStatusBanner';

describe('Yahoo status banner', () => {
  it("shows the engine's words when Yahoo couldn't be read, and can be dismissed", () => {
    const onDismiss = vi.fn();
    render(<YahooStatusBanner status={yahooSlow} onDismiss={onDismiss} />);
    expect(screen.getByRole('status').textContent).toContain("Yahoo didn't answer in time");
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('is quiet when Yahoo was read fine or the app is not signed in', () => {
    const { container, rerender } = render(<YahooStatusBanner status={yahooLive} />);
    expect(container.textContent).toBe('');
    rerender(<YahooStatusBanner status={yahooOff} />);
    expect(container.textContent).toBe('');
    rerender(<YahooStatusBanner status={null} />);
    expect(container.textContent).toBe('');
  });

  it('says access is pending, as information rather than a warning', () => {
    render(<YahooStatusBanner status={yahooNoAccess} />);
    expect(screen.getByRole('status').textContent).toContain("isn't letting the app read the league yet");
  });
});
