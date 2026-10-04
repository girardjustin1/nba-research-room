import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithTheme } from '../test/render';
import { CATEGORIES, SAMPLE_P_CAT, onTheClockBoard, waitingSession, makeSession } from '../mocks/fixtures';
import { CategoryOddsChart } from './charts/CategoryOddsChart';
import { buildRows, standing } from './charts/categoryOdds';
import { DraftLog } from './DraftLog';
import { DriftAlert } from './DriftAlert';
import { upcomingPicks } from '../lib/session';
import { initials } from '../lib/assets';
import { RecommendationsList } from './RecommendationsList';

describe('DriftAlert', () => {
  it('names drifting categories by label and renders nothing when empty', () => {
    const { container, rerender } = renderWithTheme(<DriftAlert drift={['ft_pct', 'tov']} categories={CATEGORIES} />);
    expect(screen.getByText('Punt drift: FT% and TO')).toBeInTheDocument();
    rerender(<DriftAlert drift={[]} categories={CATEGORIES} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('RecommendationsList', () => {
  it('fires onDraft with the recommendation when Draft is tapped', () => {
    const onDraft = vi.fn();
    renderWithTheme(
      <RecommendationsList
        recommendations={onTheClockBoard.recommendations}
        mode="onTheClock"
        decisionPick={5}
        followingPick={24}
        onTheClock={5}
        onDraft={onDraft}
      />,
    );
    const first = onTheClockBoard.recommendations[0]!;
    fireEvent.click(screen.getByRole('button', { name: `Draft ${first.name}` }));
    expect(onDraft).toHaveBeenCalledWith(first);
  });

  it('shows an error with retry', () => {
    const onRetry = vi.fn();
    renderWithTheme(
      <RecommendationsList recommendations={[]} mode="waiting" decisionPick={null} followingPick={null} onTheClock={2} error="boom" onRetry={onRetry} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('CategoryOddsChart', () => {
  it('keeps the fixed category order and labels standing in text', () => {
    const rows = buildRows(SAMPLE_P_CAT, [...CATEGORIES].reverse(), ['ft_pct']);
    expect(rows.map((r) => r.label)).toEqual(['FG%', 'FT%', '3PTM', 'PTS', 'REB', 'AST', 'ST', 'BLK', 'TO']);
    expect(standing(rows[1]!)).toBe('punted');
    expect(standing({ key: 'x', label: 'X', p: 0.51, punted: false })).toBe('about even');
    expect(standing({ key: 'x', label: 'X', p: null, punted: false })).toBe('no estimate');
  });

  it('table view lists every value', () => {
    renderWithTheme(<CategoryOddsChart pCat={SAMPLE_P_CAT} categories={CATEGORIES} initialView="table" />);
    expect(screen.getByRole('table', { name: 'My category odds' })).toBeInTheDocument();
    expect(screen.getByText('83%')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(10);
  });
});

describe('DraftLog', () => {
  it('marks my picks with a You chip', () => {
    renderWithTheme(<DraftLog picks={waitingSession.picks} mySlot={5} />);
    // slot 5 picks before pick 30: 5 and 24
    expect(screen.getAllByText('You')).toHaveLength(2);
  });
});

describe('small helpers', () => {
  it('upcomingPicks reads my next two picks from my_picks', () => {
    expect(upcomingPicks(makeSession({ mySlot: 5, currentPick: 30 }))).toEqual([33, 52]);
    expect(upcomingPicks(makeSession({ mySlot: 5, currentPick: 5 }))).toEqual([5, 24]);
    expect(upcomingPicks(makeSession({ mySlot: 5, currentPick: null }))).toEqual([]);
  });
  it('initials', () => {
    expect(initials('Sample Guard A')).toBe('SA');
    expect(initials('Solo')).toBe('S');
    expect(initials('  ')).toBe('?');
  });
});
