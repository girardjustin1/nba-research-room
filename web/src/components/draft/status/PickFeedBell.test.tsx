import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeInsights, makeSession } from '../../../mocks/draft/fixtures';
import { PickFeedBell } from './PickFeedBell';

const session = makeSession({ mySlot: 5, currentPick: 30 });
const insights = makeInsights(session);
const newest = insights[insights.length - 1]!.pick_no;

describe('latest-picks bell', () => {
  it('counts new picks, lists them newest first, and marks them seen when opened', () => {
    const onSeen = vi.fn();
    const onOpenTeam = vi.fn();
    render(<PickFeedBell insights={insights} teams={session.teams} seenPick={newest - 3} onSeen={onSeen} onOpenTeam={onOpenTeam} />);
    const bell = screen.getByRole('button', { name: 'Latest picks, 3 new' });
    fireEvent.click(bell);
    expect(onSeen).toHaveBeenCalledWith(newest);
    const items = screen.getAllByRole('button', { name: /^Latest pick/ });
    expect(items[0]!.getAttribute('aria-label')).toContain(insights[insights.length - 1]!.player.name);
    fireEvent.click(items[0]!);
    expect(onOpenTeam).toHaveBeenCalledWith(insights[insights.length - 1]!.team_id);
  });

  it('shows no count when everything is seen', () => {
    render(<PickFeedBell insights={insights} teams={session.teams} seenPick={newest} onSeen={() => {}} onOpenTeam={() => {}} />);
    expect(screen.getByRole('button', { name: 'Latest picks' })).toBeTruthy();
  });
});
