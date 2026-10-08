import { describe, expect, it } from 'vitest';
import { createDemoApis, createDemoTransport } from '../api/demoTransport';
import { notificationsNormal } from '../mocks/notifications/notifications';
import { actionPath } from './notificationActions';

describe('notification actions', () => {
  it('sends each action to its screen', () => {
    const base = notificationsNormal.items[0];
    const at = (target: 'move' | 'lineup' | 'pickups' | 'player' | 'feed') => actionPath({ ...base, action: { label: 'x', target, ref: null } });
    expect(at('move')).toBe('#/league/team/moves');
    expect(at('lineup')).toBe('#/league/team');
    expect(at('pickups')).toBe('#/league/team/pickups');
    expect(at('feed')).toBe('#/league/matchup');
    if (base.player) expect(at('player')).toBe(`#/league/players/profile?id=${base.player.player_id}`);
  });
});

describe('demo notifications', () => {
  it('remembers mark-all-read until the demo is reset', async () => {
    const t = createDemoTransport('/api');
    const apis = createDemoApis(t);
    const before = await apis.season.notifications();
    expect(before.unread).toBeGreaterThan(0);
    expect(await apis.season.markNotificationsRead()).toEqual({ unread: 0 });
    expect((await apis.season.notifications()).unread).toBe(0);
    t.reset();
    expect((await apis.season.notifications()).unread).toBe(before.unread);
  });

  it('marks single items read', async () => {
    const apis = createDemoApis(createDemoTransport('/api'));
    const before = await apis.season.notifications();
    const id = before.items.find((n) => !n.read)!.id;
    expect((await apis.season.markNotificationsRead([id])).unread).toBe(before.unread - 1);
  });
});
