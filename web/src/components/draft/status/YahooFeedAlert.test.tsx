import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { waitingSession } from '../../../mocks/draft/fixtures';
import { feedError, feedLive, feedNeedsYou, feedWaiting, withFeed } from '../../../mocks/draft/yahooFeed';
import { feedLine } from './yahooFeed';
import { YahooFeedAlert } from './YahooFeedAlert';

describe('Yahoo picks feed', () => {
  it('says what the feed is doing, and nothing when it is off', () => {
    expect(feedLine(feedLive)).toBe('Yahoo picks: live · 3 added · Yahoo lists 29');
    expect(feedLine(feedWaiting)).toMatch(/from 30 min before the draft/);
    expect(feedLine(feedError)).toMatch(/throttled.*retrying/);
    expect(feedLine({ ...feedLive, state: 'off' })).toBeNull();
    expect(feedLine(null)).toBeNull();
  });

  it('asks the owner to fix what it could not, and stays quiet otherwise', () => {
    const { rerender } = render(<YahooFeedAlert session={withFeed(waitingSession, feedNeedsYou)} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Sample Rookie Z.*enter it with Enter pick/);
    expect(screen.getByRole('alert').textContent).toMatch(/different player at pick 2\.13/);
    rerender(<YahooFeedAlert session={withFeed(waitingSession, feedLive)} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
