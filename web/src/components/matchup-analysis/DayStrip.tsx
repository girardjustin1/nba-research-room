import { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import type { GamesSummary } from '../../api/season';
import { shortDate } from '../foundations/seasonFormat';
import { forMeColor, forMeSymbol, forMeWord, useResolvedMode } from '../../theme/viz';
import { inkOn } from '../foundations/heatScale';

export interface DayStripProps {
  games: GamesSummary;
  opponentName: string;
}

/**
 * Games by day, Mon–Sun, me vs them: a compact grid built from layout (not a chart). Each
 * day column is a 44px+ tap target that fills in a readout. Light days (5 or fewer NBA
 * games) and back-to-backs are labelled in words; past days are dimmed; today is outlined.
 */
export function DayStrip({ games, opponentName }: DayStripProps) {
  const [selected, setSelected] = useState<number | null>(() => {
    const i = games.days.findIndex((d) => d.is_today);
    return i >= 0 ? i : null;
  });
  const sel = selected == null ? null : games.days[selected];
  const mode = useResolvedMode();

  return (
    <Box>
      <Typography variant="subtitle2" component="h3">
        Games left
      </Typography>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
        You {games.mine_remaining} ({games.mine_usable_remaining} fit your slots) · Them {games.theirs_remaining} (
        {games.theirs_usable_remaining} fit)
      </Typography>
      <Box
        role="table"
        aria-label="Games by day"
        sx={{ display: 'grid', gridTemplateColumns: '34px repeat(7, minmax(0, 1fr))', mt: 1, columnGap: '2px' }}
      >
        <Box role="rowheader" sx={{ display: 'grid', gridTemplateRows: '30px 26px 26px 24px 18px', alignItems: 'center' }}>
          <span />
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
            You
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
            Opp
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
            Edge
          </Typography>
          <span />
        </Box>
        {games.days.map((d, i) => {
          const sits = d.mine - d.mine_usable;
          return (
            <ButtonBase
              key={d.date}
              role="row"
              onClick={() => setSelected(i)}
              aria-pressed={selected === i}
              aria-label={`${d.weekday}: you ${d.mine} games, them ${d.theirs}`}
              sx={[
                {
                  display: 'grid',
                  gridTemplateRows: '30px 26px 26px 24px 18px',
                  alignItems: 'center',
                  justifyItems: 'center',
                  borderRadius: 1.5,
                  border: 1,
                  borderColor: 'transparent',
                  minWidth: 0,
                  minHeight: 126,
                },
                d.is_past && { opacity: 0.5 },
                d.is_today && { borderColor: 'primary.main' },
                selected === i && { bgcolor: 'action.selected' },
              ]}
            >
              <Box sx={{ textAlign: 'center', lineHeight: 1 }}>
                <Typography variant="caption" component="span" sx={{ display: 'block', fontWeight: 700, lineHeight: 1.2 }}>
                  {d.weekday}
                </Typography>
                <Typography variant="caption" component="span" sx={{ display: 'block', color: 'text.secondary', fontSize: 11, lineHeight: 1.2 }}>
                  {d.is_today ? 'today' : shortDate(d.date).split(' ')[1]}
                </Typography>
              </Box>
              <Typography className="tabular" sx={{ fontWeight: 700, fontSize: 16 }}>
                {d.mine}
                {sits > 0 && (
                  <Box component="sup" sx={{ fontSize: 10, fontWeight: 600, color: 'text.secondary', ml: '1px' }}>
                    −{sits}
                  </Box>
                )}
              </Typography>
              <Typography className="tabular" sx={{ fontSize: 16, color: 'text.secondary' }}>
                {d.theirs}
              </Typography>
              {(() => {
                const bg = forMeColor(d.usable_edge, { min: -4, max: 4 }, mode);
                return (
                  <Box
                    component="span"
                    className="tabular"
                    sx={{ px: 0.5, minWidth: 32, textAlign: 'center', borderRadius: 1, fontSize: 11.5, fontWeight: 700, lineHeight: '20px', bgcolor: bg, color: inkOn(bg) }}
                  >
                    {forMeSymbol(d.usable_edge)}
                    {d.usable_edge === 0 ? '' : Math.abs(d.usable_edge)}
                  </Box>
                );
              })()}
              <Typography variant="caption" sx={{ fontSize: 10.5, color: 'text.secondary', lineHeight: 1 }}>
                {d.light_day ? 'light' : ''}
              </Typography>
            </ButtonBase>
          );
        })}
      </Box>
      <Typography variant="body2" role="status" aria-live="polite" sx={{ mt: 0.75, minHeight: 40 }}>
        {sel
          ? `${sel.weekday}${sel.is_today ? ' (today)' : sel.is_past ? ' (played)' : ''}: you ${sel.mine} game${sel.mine === 1 ? '' : 's'}` +
            `${sel.mine > sel.mine_usable ? `, ${sel.mine - sel.mine_usable} won’t fit your slots` : ''}; ${opponentName} ${sel.theirs}. ` +
            `Playable-game edge ${forMeSymbol(sel.usable_edge)} ${sel.usable_edge > 0 ? '+' : ''}${sel.usable_edge} (${forMeWord(sel.usable_edge)}). ` +
            `${sel.league_games} NBA games${sel.light_day ? ' (light day)' : ''}. Back-to-backs: you ${sel.mine_b2b}, them ${sel.theirs_b2b}.`
          : 'Tap a day for details.'}
      </Typography>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
        Edge = your playable games minus theirs: green ▲ helps you, red ▼ hurts you, gray ● even. −N = games that won’t fit your slots. “light” = 5 or fewer NBA games.
      </Typography>
    </Box>
  );
}
