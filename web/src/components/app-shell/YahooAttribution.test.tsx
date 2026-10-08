import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { YAHOO_FANTASY_LOGO, YAHOO_FANTASY_URL, YahooAttribution } from './YahooAttribution';

describe('Yahoo attribution', () => {
  it('shows the required wording, the official logo and a link to Yahoo Fantasy', () => {
    render(<YahooAttribution />);
    const link = screen.getByRole('link', { name: /Fantasy data provided by Yahoo Fantasy/ });
    expect(link.getAttribute('href')).toBe(YAHOO_FANTASY_URL);
    expect(screen.getByAltText('Yahoo Fantasy').getAttribute('src')).toBe(YAHOO_FANTASY_LOGO);
  });
});
