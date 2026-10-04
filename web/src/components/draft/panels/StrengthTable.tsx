import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { ApiError } from '../../../api/client';
import type { StrengthResponse, StrengthRow } from '../../../api/types';
import { fixed, ordinal, pct } from '../../../lib/format';
import { forMeSymbol, forMeWord, useForMe } from '../../../theme/viz';
import { EndpointNotice } from '../../app-shell/EndpointNotice';

export interface StrengthTableProps {
  strength: StrengthResponse | null;
  error?: ApiError | null;
  loading?: boolean;
}

/** Above or below the league average by less than this reads as even (display only). */
const EVEN_P = 0.01;
const EVEN_CATS = 0.05;

function MeCell({ row, even, format, punted }: { row: StrengthRow; even: number; format: (v: number | null) => string; punted?: boolean }) {
  const fm = useForMe();
  const diff = row.me == null ? null : row.me - row.league_avg;
  const sym = punted ? '●' : forMeSymbol(diff, even);
  const color = punted || sym === '●' ? fm.neutral : sym === '▲' ? fm.good : fm.bad;
  return (
    <TableCell align="right" className="tabular" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }} aria-label={`${format(row.me)}, ${punted ? 'punted' : forMeWord(diff, even)} vs the league average`}>
      <Box component="span" aria-hidden sx={{ color, fontSize: 11, mr: 0.5 }}>
        {sym}
      </Box>
      {format(row.me)}
    </TableCell>
  );
}

function BestCell({ row, format, mySlot }: { row: StrengthRow; format: (v: number | null) => string; mySlot: number | null }) {
  const mine = row.best_team_id === mySlot;
  return (
    <TableCell align="right" sx={{ maxWidth: 96 }}>
      <Typography variant="body2" component="span" className="tabular" sx={{ display: 'block' }}>
        {format(row.best)}
      </Typography>
      <Typography variant="caption" component="span" noWrap sx={{ display: 'block', color: 'text.secondary', fontWeight: mine ? 700 : 400 }}>
        {mine ? 'You' : (row.best_team_name ?? `Team ${row.best_team_id}`)}
      </Typography>
    </TableCell>
  );
}

/**
 * Me vs the league, side by side: for each category my chance of winning it against an
 * average team, the league average, the best team and my rank (engine numbers, every team on
 * its projected final roster). The mark beside my value says whether I'm above (▲) or below (▼)
 * the league average; punted categories are gray.
 */
export function StrengthTable({ strength: s, error, loading }: StrengthTableProps) {
  if (!s) {
    return (
      <Card sx={{ p: 1.5 }}>
        <Typography variant="subtitle2" component="h2">
          Me vs league
        </Typography>
        {error ? (
          <EndpointNotice error={error} endpoint="GET /draft/strength" what="Me vs league" />
        ) : (
          <Stack spacing={0.75} aria-busy={loading ? 'true' : undefined} sx={{ mt: 1 }}>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} height={22} />
            ))}
          </Stack>
        )}
      </Card>
    );
  }
  const punts = new Set(s.punts);
  const cats = (v: number | null) => fixed(v, 1);
  const rank = (r: StrengthRow) => (r.rank == null ? '—' : ordinal(r.rank));
  const head = { py: 0.5, px: 0.75, fontSize: 12, color: 'text.secondary', fontWeight: 600 };
  return (
    <Card sx={{ px: 1.5, pt: 1.25, pb: 0.5 }}>
      <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="subtitle2" component="h2">
          Me vs league
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Chance to win vs an average team
        </Typography>
      </Stack>
      <Table size="small" aria-label="My team compared with the league, by category" sx={{ '& td, & th': { px: 0.75 }, '& td': { py: 0.5 }, tableLayout: 'fixed' }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ ...head, width: '24%' }}>Cat</TableCell>
            <TableCell align="right" sx={{ ...head, width: '19%' }}>Me</TableCell>
            <TableCell align="right" sx={{ ...head, width: '17%' }}>Avg</TableCell>
            <TableCell align="right" sx={{ ...head, width: '26%' }}>Best</TableCell>
            <TableCell align="right" sx={{ ...head, width: '14%' }}>Rank</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow sx={{ bgcolor: 'action.hover' }}>
            <TableCell sx={{ fontWeight: 700 }}>
              Cats won
              <Typography variant="caption" component="span" sx={{ display: 'block', color: 'text.secondary' }}>
                of {s.categories.length}
              </Typography>
            </TableCell>
            <MeCell row={s.expected_cats} even={EVEN_CATS} format={cats} />
            <TableCell align="right" className="tabular">{cats(s.expected_cats.league_avg)}</TableCell>
            <BestCell row={s.expected_cats} format={cats} mySlot={s.my_slot} />
            <TableCell align="right" className="tabular" sx={{ fontWeight: 700 }}>{rank(s.expected_cats)}</TableCell>
          </TableRow>
          {s.categories.map((c) => {
            const punted = punts.has(c.key);
            return (
              <TableRow key={c.key} sx={punted ? { '& td': { color: 'text.disabled' } } : undefined}>
                <TableCell>
                  {c.label}
                  {punted && (
                    <Typography variant="caption" component="span" sx={{ ml: 0.5, color: 'text.secondary' }}>
                      punt
                    </Typography>
                  )}
                </TableCell>
                <MeCell row={c} even={EVEN_P} format={pct} punted={punted} />
                <TableCell align="right" className="tabular">{pct(c.league_avg)}</TableCell>
                <BestCell row={c} format={pct} mySlot={s.my_slot} />
                <TableCell align="right" className="tabular">{rank(c)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', py: 0.75 }}>
        ▲ above the league average · ▼ below · rank of {s.teams}. Every team is projected to the end of the draft.
      </Typography>
    </Card>
  );
}
