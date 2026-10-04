import { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import type { Acquisitions, PlayableDay, PlayableWeek } from '../../api/season';
import { FOR_ME, forMeSymbol, forMeWord, useResolvedMode, useVizColors } from '../../theme/viz';
import { DetailSheet, type SheetContent } from '../foundations/DetailSheet';
import { inkOn } from '../foundations/heatScale';
import { signedNum } from '../foundations/seasonFormat';

export interface PlayableStripProps {
  playable: PlayableWeek;
  addName: string;
  dropName: string | null;
  acquisitions: Acquisitions;
  /** Open this cell's sheet on mount (stories). */
  initialOpen?: { row: 'add' | 'drop'; i: number } | null;
}

type Row = 'add' | 'drop';

/** +1 = a playable game I gain, −1 = a playable game I give up, 0 = no effect. */
function effectOf(d: PlayableDay, row: Row): number {
  if (d.is_past || !d.has_game || !d.playable) return 0;
  return row === 'add' ? 1 : -1;
}

/**
 * A pickup's week (and the paired drop's) Mon–Sun, laid against MY open lineup slots that
 * day: a game only counts if a slot he is eligible for is open. Green ▲ = a playable game
 * you gain, red ▼ = a playable game you give up, gray "full" = he plays but your slots are
 * full, – = no game. Built from layout (not a chart). Counts are the optimizer's.
 */
export function PlayableStrip({ playable, addName, dropName, acquisitions, initialOpen = null }: PlayableStripProps) {
  const mode = useResolvedMode();
  const viz = useVizColors();
  const fm = FOR_ME[mode];
  const [sel, setSel] = useState<{ row: Row; i: number } | null>(initialOpen);
  const rows: { row: Row; label: string; days: PlayableDay[] }[] = [
    { row: 'add', label: 'Add', days: playable.add },
    ...(playable.drop ? [{ row: 'drop' as Row, label: 'Drop', days: playable.drop }] : []),
  ];
  const left = Math.max(0, acquisitions.max - acquisitions.used);
  const selDay = sel ? rows.find((r) => r.row === sel.row)?.days[sel.i] : null;
  const selName = sel?.row === 'drop' ? (dropName ?? 'the drop') : addName;
  const sheet: SheetContent | null =
    selDay && sel
      ? {
          title: `${selDay.weekday} · ${selName}`,
          subtitle: selDay.has_game ? `${selDay.home ? 'vs' : '@'} ${selDay.opp_abbr}` : 'No game',
          effect: effectOf(selDay, sel.row) !== 0 ? `${forMeSymbol(effectOf(selDay, sel.row))} ${forMeWord(effectOf(selDay, sel.row)).replace(/^./, (c) => c.toUpperCase())}` : null,
          sections: [
            {
              heading: sel.row === 'add' ? 'If you add him' : 'If you drop him',
              lines: !selDay.has_game
                ? ['No game this day: nothing changes.']
                : selDay.is_past
                  ? ['This game is before the move takes effect, so it does not count.']
                  : [
                      `Your open slots he is eligible for: ${selDay.open_slots}.`,
                      selDay.playable
                        ? sel.row === 'add'
                          ? 'His game fits an open slot: a playable game you gain.'
                          : 'His game would have started for you: a playable game you give up.'
                        : 'Your eligible slots are full that day, so this game adds nothing.',
                    ],
            },
            {
              heading: 'This move, whole week',
              lines: [
                `Playable games added: ${signedNum(playable.playable_games_added, 0)} (raw games ${signedNum(playable.raw_games_added, 0)}).`,
                `Acquisitions left after it: ${Math.max(0, left - 1)} of ${acquisitions.max}.`,
              ],
            },
          ],
        }
      : null;

  return (
    <Box>
      <Box role="grid" aria-label="Playable games by day" sx={{ display: 'grid', gridTemplateColumns: '40px repeat(7, minmax(0, 1fr))', gap: '3px' }}>
        <span />
        {playable.add.map((d) => (
          <Typography key={d.date} variant="caption" role="columnheader" sx={{ textAlign: 'center', fontWeight: 700, color: d.is_past ? 'text.disabled' : 'text.secondary' }}>
            {d.weekday}
          </Typography>
        ))}
        {rows.map((r) => (
          <Box key={r.row} role="row" sx={{ display: 'contents' }}>
            <Typography role="rowheader" variant="caption" sx={{ alignSelf: 'center', fontWeight: 700 }}>
              {r.label}
            </Typography>
            {r.days.map((d, i) => {
              const e = effectOf(d, r.row);
              const fill = e > 0 ? fm.goodRamp[1] : e < 0 ? fm.badRamp[1] : null;
              const label = !d.has_game ? '–' : d.playable && !d.is_past ? `${forMeSymbol(e)}${d.opp_abbr}` : d.is_past ? d.opp_abbr : 'full';
              return (
                <ButtonBase
                  key={d.date}
                  role="gridcell"
                  onClick={() => setSel({ row: r.row, i })}
                  aria-haspopup="dialog"
                  aria-pressed={sel?.row === r.row && sel.i === i}
                  aria-label={`${r.label} ${d.weekday}: ${!d.has_game ? 'no game' : d.playable ? `playable, ${forMeWord(e)}` : d.is_past ? 'already played' : 'slots full'}`}
                  sx={[
                    { height: 44, borderRadius: 1, fontSize: 11, fontWeight: 700, minWidth: 0, px: 0.25, border: `1px solid ${viz.grid}`, color: 'text.disabled' },
                    fill != null && { bgcolor: fill, color: inkOn(fill), borderColor: fill },
                    d.has_game && !d.playable && !d.is_past && { color: 'text.secondary', borderStyle: 'dashed', borderColor: viz.axis },
                    d.is_past && { opacity: 0.45 },
                    sel?.row === r.row && sel.i === i && { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 1 },
                  ]}
                >
                  {label}
                </ButtonBase>
              );
            })}
          </Box>
        ))}
      </Box>
      <Typography variant="body2" className="tabular" sx={{ mt: 0.75, fontWeight: 700 }}>
        Playable games added: {forMeSymbol(playable.playable_games_added)} {signedNum(playable.playable_games_added, 0)}{' '}
        <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
          (raw {signedNum(playable.raw_games_added, 0)}) · {left} of {acquisitions.max} acquisitions left
        </Box>
      </Typography>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
        Green ▲ = playable game gained, red ▼ = playable game given up, dashed “full” = he plays but your slots are full. Tap a day for details.
      </Typography>
      <DetailSheet open={sheet != null} onClose={() => setSel(null)} content={sheet} />
    </Box>
  );
}
