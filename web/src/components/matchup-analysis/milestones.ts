import type { GameCenterMoment, GameCenterResponse, MilestoneKind } from '../../api/season';
import type { SheetContent } from '../foundations/DetailSheet';
import { catLabel, etClock, etDate, ptsDelta, weekdayOf } from '../foundations/seasonFormat';
import { forMeSymbol, forMeWord } from '../../theme/viz';

export interface Milestone {
  id: string;
  ts: string;
  kind: MilestoneKind;
  label: string;
  delta_p_win: number | null;
}

/** One glyph per milestone kind; the fill is green / red / gray by its effect on me, so the glyph carries the kind. */
export const MILESTONE_GLYPH: Record<MilestoneKind, { glyph: string; label: string }> = {
  my_pickup: { glyph: '+', label: 'Your pickup' },
  opp_pickup: { glyph: '+', label: 'Their pickup' },
  injury: { glyph: '!', label: 'Injury news' },
  lineup_lock: { glyph: 'L', label: 'Lineup lock' },
  missed_lock: { glyph: '×', label: 'Missed lock' },
  flip_mine: { glyph: '↑', label: 'Category flipped to you' },
  flip_theirs: { glyph: '↓', label: 'Category flipped to them' },
  big_night: { glyph: '★', label: 'Big game night' },
  clinched: { glyph: '✓', label: 'Clinched (>95%)' },
  out_of_reach: { glyph: '–', label: 'Out of reach (<5%)' },
};


/** Bottom-sheet text for a moment (engine numbers only). */
export function momentSheet(m: GameCenterMoment, gc: GameCenterResponse): SheetContent {
  const cats = gc.week.categories;
  return {
    title: `${weekdayOf(etDate(m.ts))} ${etClock(m.ts)} · ${MILESTONE_GLYPH[m.kind].label}`,
    subtitle: m.headline,
    effect: m.delta_p_win == null ? null : `${forMeSymbol(m.delta_p_win, 0.002)} P(win week) ${ptsDelta(m.delta_p_win)} · ${forMeWord(m.delta_p_win, 0.002)}`,
    sections: [
      ...(m.detail ? [{ heading: 'What happened', lines: [m.detail] }] : []),
      ...(m.category ? [{ heading: 'Category affected', lines: [catLabel(m.category, cats)] }] : []),
      { heading: 'Category score after', lines: [`You ${m.score_after.me} – ${m.score_after.opp} ${gc.opponent.name}`] },
    ],
  };
}

