import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import type { CategoryLine, IsoDate, Move, SeasonCategory, WeekResponse, WinProbPoint } from '../../api/season';
import type { PlanState } from '../../api/useScenarioPlan';
import { pct } from '../../lib/format';
import { FOR_ME, forMeSymbol, useResolvedMode, useVizColors } from '../../theme/viz';
import { AcquisitionsMeter } from '../foundations/AcquisitionsMeter';
import { ConfidenceChip } from '../foundations/Confidence';
import { DetailSheet, type SheetContent } from '../foundations/DetailSheet';
import { inkOn } from '../foundations/heatScale';
import { MOVE_KIND_LABEL, catLabel, deadlineLabel, etClock, etDate, moveTitle, ptsDelta, statValue, weekdayOf } from '../foundations/seasonFormat';

/* ---------------------------------------------------------------- progress */

const STATUS = { winning: { sym: '▲', word: 'leading' }, losing: { sym: '▼', word: 'trailing' }, tied: { sym: '●', word: 'tied' } } as const;

function catSheet(l: CategoryLine, cats: SeasonCategory[], opp: string): SheetContent {
  const c = cats.find((x) => x.key === l.key);
  const r = c?.is_ratio ?? false;
  const e = (x: CategoryLine['mine_final']) => (x ? `${statValue(x.mean, r)} ± ${statValue(x.sd, r)}` : '—');
  return {
    title: catLabel(l.key, cats),
    subtitle: l.punted ? 'Punted' : l.swing ? 'A close category the moves can swing' : undefined,
    effect: `${STATUS[l.status_now].sym} You are ${STATUS[l.status_now].word} right now`,
    sections: [
      { heading: 'So far this week', lines: [`You ${statValue(l.mine_to_date, r)} · ${opp} ${statValue(l.theirs_to_date, r)}${c && !c.higher_is_better ? ' (fewer wins)' : ''}`] },
      { heading: 'Projected by Sunday', lines: [`You ${e(l.mine_final)} · ${opp} ${e(l.theirs_final)}`, `P(you win it): ${pct(l.p_win)}`] },
    ],
  };
}

/** Live category score, the 9 categories (leading / trailing / tied, close ones marked), games and acquisitions. */
export function ProgressCard({ week, now }: { week: WeekResponse; now: WinProbPoint | null }) {
  const mode = useResolvedMode();
  const viz = useVizColors();
  const fm = FOR_ME[mode];
  const [open, setOpen] = useState<CategoryLine | null>(null);
  const cats = week.week.categories;
  const opp = week.opponent.name;
  const g = week.games;
  return (
    <Card sx={{ p: 1.5 }}>
      <Typography variant="subtitle2" component="h2">
        Progress
      </Typography>
      {now && (
        <Typography sx={{ fontSize: 22, fontWeight: 600 }} className="tabular">
          You {now.cats_lead.me} – {now.cats_lead.opp} <Box component="span" sx={{ fontSize: 15, fontWeight: 500 }}>{opp}</Box>
        </Typography>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '4px', mt: 0.75 }} role="list" aria-label="Categories right now">
        {week.categories.map((l) => {
          const bg = l.punted ? null : l.status_now === 'winning' ? fm.goodRamp[1] : l.status_now === 'losing' ? fm.badRamp[1] : fm.neutral;
          return (
            <ButtonBase
              key={l.key}
              role="listitem"
              aria-haspopup="dialog"
              aria-label={`${catLabel(l.key, cats)}: ${STATUS[l.status_now].word}${l.swing ? ', close' : ''}${l.punted ? ', punted' : ''}`}
              onClick={() => setOpen(l)}
              sx={{
                height: 48,
                borderRadius: 1.5,
                flexDirection: 'column',
                bgcolor: bg ?? 'transparent',
                color: bg ? inkOn(bg) : 'text.secondary',
                border: bg ? 'none' : `1px dashed ${viz.axis}`,
                outline: l.swing ? '2px dashed' : 'none',
                outlineColor: 'var(--mui-palette-text-primary)',
                outlineOffset: -4,
              }}
            >
              <Typography component="span" sx={{ fontSize: 13, fontWeight: 700, color: 'inherit' }}>
                {catLabel(l.key, cats)}
              </Typography>
              <Typography component="span" aria-hidden sx={{ fontSize: 11, color: 'inherit' }}>
                {l.punted ? 'punt' : `${STATUS[l.status_now].sym}${l.swing ? ' close' : ''}`}
              </Typography>
            </ButtonBase>
          );
        })}
      </Box>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
        Green ▲ leading, red ▼ trailing, gray ● tied on totals so far; dashed ring = close. Tap a category for totals.
      </Typography>
      <Typography variant="body2" className="tabular" sx={{ mt: 1 }}>
        Games played: you {g.mine_played}, them {g.theirs_played} · left: you {g.mine_remaining} ({g.mine_usable_remaining} fit your slots), them {g.theirs_remaining}
      </Typography>
      <Box sx={{ mt: 1 }}>
        <AcquisitionsMeter acquisitions={week.acquisitions} compact />
      </Box>
      <DetailSheet open={open != null} onClose={() => setOpen(null)} content={open ? catSheet(open, cats, opp) : null} />
    </Card>
  );
}

/* --------------------------------------------------------------- decisions */

export interface DecisionsCardProps {
  moves: Move[];
  plan: PlanState;
  today: IsoDate;
  categories: SeasonCategory[];
  onToggle?: (moveId: string) => void;
  onRetry?: () => void;
  onOpenMove?: (moveId: string) => void;
  onSeeAllMoves?: () => void;
}

/** Move cards with on/off toggles. Toggling asks the engine to redraw the "With moves" line. */
export function DecisionsCard({ moves, plan, today, categories, onToggle, onRetry, onOpenMove, onSeeAllMoves }: DecisionsCardProps) {
  const mode = useResolvedMode();
  const fm = FOR_ME[mode];
  return (
    <Card sx={{ p: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="subtitle2" component="h2">
            Decisions
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Turn moves on or off; the engine redraws the plan line
          </Typography>
        </Box>
        {onSeeAllMoves && (
          <Button onClick={onSeeAllMoves} sx={{ mr: -1 }}>
            Details
          </Button>
        )}
      </Stack>
      {plan.error && (
        <Alert
          severity="error"
          sx={{ mt: 1 }}
          action={
            onRetry && (
              <Button color="inherit" onClick={onRetry}>
                Retry
              </Button>
            )
          }
        >
          The engine could not recompute: {plan.error}. The line shows the last good plan.
        </Alert>
      )}
      {plan.infeasible && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          Not allowed: {plan.infeasible}. Turn a move off.
        </Alert>
      )}
      {moves.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          Do nothing: no move raises P(win week).
        </Typography>
      ) : (
        <Box component="ol" sx={{ m: 0, p: 0 }}>
          {moves.map((m) => {
            const on = plan.selected.includes(m.move_id);
            const blocked = !on ? plan.incompatible[m.move_id] : undefined;
            return (
              <Box component="li" key={m.move_id} sx={{ listStyle: 'none', py: 1, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 }, opacity: on ? 1 : 0.7 }}>
                <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Chip size="small" variant="outlined" label={MOVE_KIND_LABEL[m.kind]} sx={{ fontWeight: 700 }} />
                      <Typography sx={{ fontWeight: 700 }} className="tabular">
                        {ptsDelta(m.delta_p_win.mean)}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        vs do nothing
                      </Typography>
                    </Stack>
                    <ButtonBase onClick={() => onOpenMove?.(m.move_id)} disabled={!onOpenMove} sx={{ display: 'block', textAlign: 'left', mt: 0.25, borderRadius: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {moveTitle(m)}
                        {m.slot ? ` at ${m.slot}` : ''}
                      </Typography>
                    </ButtonBase>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                      {m.cat_deltas.slice(0, 4).map((d) => {
                        const c = d.delta_p > 0 ? fm.goodRamp[0] : fm.badRamp[0];
                        return (
                          <Box key={d.key} component="span" className="tabular" sx={{ px: 0.75, borderRadius: 1, fontSize: 12, fontWeight: 700, bgcolor: c, color: inkOn(c) }}>
                            {forMeSymbol(d.delta_p)} {catLabel(d.key, categories)} {ptsDelta(d.delta_p, 0, '')}
                          </Box>
                        );
                      })}
                    </Box>
                    <Stack direction="row" sx={{ gap: 0.75, mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                        <ScheduleOutlinedIcon sx={{ fontSize: 14 }} aria-hidden />
                        {deadlineLabel(m.deadline, today)}
                      </Typography>
                      <ConfidenceChip confidence={m.confidence} compact />
                    </Stack>
                    {blocked && (
                      <Typography variant="caption" component="p" sx={{ color: 'warning.dark', fontWeight: 600, mt: 0.25 }}>
                        Can’t add: {blocked}
                      </Typography>
                    )}
                  </Box>
                  <Switch
                    checked={on}
                    disabled={!onToggle || !!blocked || plan.recomputing}
                    onChange={() => onToggle?.(m.move_id)}
                    slotProps={{ input: { 'aria-label': `${on ? 'Turn off' : 'Turn on'}: ${moveTitle(m)}` } }}
                    sx={{ mt: -0.5, mr: -1 }}
                  />
                </Stack>
              </Box>
            );
          })}
        </Box>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------- updates & news */

/** Chronological updates (newest first), each with its effect on P(win week); tapping opens the matching dot's sheet. */
export function UpdatesCard({ history, onOpen }: { history: WinProbPoint[]; onOpen: (ts: string) => void }) {
  const items = history.filter((h) => h.event && h.event.kind !== 'nightly').reverse();
  return (
    <Card sx={{ p: 1.5 }}>
      <Typography variant="subtitle2" component="h2">
        Updates & news
      </Typography>
      {items.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          Nothing yet this week.
        </Typography>
      ) : (
        <Box component="ol" sx={{ m: 0, p: 0 }}>
          {items.map((h) => (
            <Box component="li" key={h.ts} sx={{ listStyle: 'none', borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
              <ButtonBase onClick={() => onOpen(h.ts)} aria-haspopup="dialog" sx={{ display: 'flex', width: '100%', textAlign: 'left', py: 0.75, gap: 1, alignItems: 'flex-start', minHeight: 44, justifyContent: 'flex-start' }}>
                <Typography variant="caption" className="tabular" sx={{ color: 'text.secondary', width: 72, flexShrink: 0, pt: '2px' }}>
                  {weekdayOf(etDate(h.ts))} {etClock(h.ts)}
                </Typography>
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                  {h.event!.label}
                </Typography>
                <Typography variant="body2" className="tabular" sx={{ fontWeight: 700, flexShrink: 0 }}>
                  {forMeSymbol(h.event!.delta_p, 0.002)} {ptsDelta(h.event!.delta_p)}
                </Typography>
              </ButtonBase>
            </Box>
          ))}
        </Box>
      )}
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
        Each item is a dot on the chart’s past line; tap it to see that moment.
      </Typography>
    </Card>
  );
}
