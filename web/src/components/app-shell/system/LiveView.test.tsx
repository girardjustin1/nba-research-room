import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithTheme } from '../../../test/render';
import { liveScoreboardEarly, liveScoreboardEmpty, liveScoreboardNormal } from '../../../mocks/app-shell/system';
import { LiveView } from './LiveView';

describe('LiveView', () => {
  it('waits for opening night before showing any grades', () => {
    renderWithTheme(<LiveView scoreboard={liveScoreboardEmpty} />);
    expect(screen.getByText('Grading starts after opening night')).toBeInTheDocument();
    expect(screen.queryByText('Projections by stat')).not.toBeInTheDocument();
  });

  it('shows every section mid-season and switches to the last 7 days', () => {
    renderWithTheme(<LiveView scoreboard={liveScoreboardNormal} />);
    for (const title of ['Projections by stat', 'Betting market vs our model', 'Chance of playing', 'Did listed players play?', 'Win-the-week odds']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByText(/34 game days graded since Oct 20/)).toBeInTheDocument();
    expect(screen.getAllByText('Market closer').length).toBeGreaterThan(0);   // points: 4.20 vs 4.70
    expect(screen.getByText('Ours closer')).toBeInTheDocument();             // assists: 1.47 vs 1.49
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    expect(screen.getByText(/^7 game days graded/)).toBeInTheDocument();
  });

  it('hides the market and says when weekly odds will be graded, early in the season', () => {
    renderWithTheme(<LiveView scoreboard={liveScoreboardEarly} />);
    expect(screen.queryByText('Betting market vs our model')).not.toBeInTheDocument();
    expect(screen.getByText(/Graded once a week finishes/)).toBeInTheDocument();
  });
});
