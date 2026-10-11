import type { YahooPositions } from '../../api/types';

/** Yahoo positions read from pastes, for the draft room's paste panel. Invented counts. */
const POLICY =
  'Yahoo positions read from your pastes, kept on this computer only and never in the database: player ids and positions, not the text. Each paste adds to the list.';

export const yahooPositionsNone: YahooPositions = { players: 0, saved_at: null, found: null, ambiguous: [], policy: POLICY };

export const yahooPositionsSome: YahooPositions = { ...yahooPositionsNone, players: 150, saved_at: '2026-10-17T20:15:00-04:00' };

/** A sample paste of Yahoo's Players page (All players): names with their "TEAM - POS" tags. */
export const SAMPLE_POSITIONS_PASTE = [
  'Players',
  'Pos  Player  Owner  GP*  Pre-Season  Current  % Ros',
  'Sample Guard A  BOS - PG,SG  FA  0  —  —  99%',
  'Sample Wing B  MIA - SG,SF  FA  0  —  —  97%',
  'Sample Big C  DEN - C  FA  0  —  —  99%',
  'Twin Name  NY - SF',
].join('\n');

const TAG = /\b[A-Z]{2,4}\s+-\s+(?:PG|SG|SF|PF|C|G|F)(?:\s*,\s*(?:PG|SG|SF|PF|C|G|F))*\b/g;

/** The sample save: every "TEAM - POS" tag counts as one player (the engine matches names too). */
export function sampleSavePositions(prev: YahooPositions, text: string, now = new Date().toISOString()): YahooPositions {
  const found = (text.match(TAG) ?? []).length;
  if (found === 0) throw new Error("no Yahoo positions found: paste Yahoo's Players page (names with 'TEAM - PG,SG')");
  return { ...prev, players: prev.players + found, saved_at: now, found, ambiguous: text.includes('Twin Name') ? ['twin name'] : [] };
}
