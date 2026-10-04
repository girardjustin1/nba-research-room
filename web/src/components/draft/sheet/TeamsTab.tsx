import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { ApiError } from '../../../api/client';
import type { Category, DraftTeam, PickInsight } from '../../../api/types';
import { CategoryOddsChart } from '../../foundations/charts/CategoryOddsChart';
import { categoryLabel, eligibleLabel, pct } from '../../../lib/format';
import { roundPick } from '../../../lib/picks';
import { POSITIONS } from '../../../lib/positions';
import { latestInsightByTeam, picksBeforeMe, strengths } from '../../../lib/draftHelpers';
import { EndpointNotice } from '../../app-shell/EndpointNotice';
import { PositionBadge } from '../../foundations/badges/PositionBadge';

export interface TeamsTabProps {
  teams: DraftTeam[] | null;
  error?: ApiError | null;
  categories: Category[];
  teamsCount: number;
  currentPick: number | null;
  myNextPick: number | null;
  /** Live reads after recent picks (GET /draft/insights); the latest per team is shown. */
  insights?: PickInsight[] | null;
  /** Open and scroll to this team (from the latest-pick card). */
  focusTeamId?: number | null;
}




/**
 * Strategize: every opponent's roster, positional counts, open starting slots, category
 * strengths and weaknesses, and when they pick next. Teams picking before my next pick come
 * first and are highlighted: their needs are what push players off the board before my turn
 * (the board's availability numbers already account for them).
 */
export function TeamsTab({ teams, error, categories, teamsCount, currentPick, myNextPick, insights, focusTeamId }: TeamsTabProps) {
  const byTeam = latestInsightByTeam(insights);
  if (!teams) {
    return (
      <Box sx={{ p: 2 }}>
        {error ? (
          <EndpointNotice error={error} endpoint="GET /draft/teams" what="Team rosters and needs" />
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Loading teams…</Typography>
        )}
      </Box>
    );
  }
  const before = teams.filter((t) => picksBeforeMe(t, currentPick, myNextPick)).sort((a, b) => (a.next_pick ?? 0) - (b.next_pick ?? 0));
  const rest = teams
    .filter((t) => !before.includes(t))
    .sort((a, b) => Number(b.is_me) - Number(a.is_me) || (a.next_pick ?? Infinity) - (b.next_pick ?? Infinity));

  return (
    <Stack spacing={1.25} sx={{ p: 2 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {myNextPick == null
          ? 'You have no picks left.'
          : before.length
            ? `${before.length} team${before.length === 1 ? '' : 's'} pick before your next pick (${roundPick(myNextPick, teamsCount)}). Their needs decide who is left; the board's availability already accounts for them.`
            : `Nobody picks before your next pick (${roundPick(myNextPick, teamsCount)}).`}
      </Typography>
      {before.map((t) => (
        <TeamCard key={t.team_id} team={t} categories={categories} teamsCount={teamsCount} insight={byTeam.get(t.team_id)} focused={focusTeamId === t.team_id} highlight />
      ))}
      {rest.length > 0 && before.length > 0 && (
        <Typography variant="overline" sx={{ color: 'text.secondary', pt: 1 }}>Everyone else</Typography>
      )}
      {rest.map((t) => (
        <TeamCard key={t.team_id} team={t} categories={categories} teamsCount={teamsCount} insight={byTeam.get(t.team_id)} focused={focusTeamId === t.team_id} />
      ))}
    </Stack>
  );
}

function TeamCard({
  team,
  categories,
  teamsCount,
  highlight,
  insight,
  focused,
}: {
  team: DraftTeam;
  categories: Category[];
  teamsCount: number;
  highlight?: boolean;
  insight?: PickInsight;
  focused?: boolean;
}) {
  // Open when focused from the latest-pick card, until the user toggles it.
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? focused === true;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focused]);
  // Prefer the engine's named strengths/weaknesses from the latest insight; else order z_balance.
  const fromZ = strengths(team.z_balance);
  const strong = insight?.strengths.length ? insight.strengths : fromZ.strong;
  const weak = insight?.weaknesses.length ? insight.weaknesses : fromZ.weak;
  const label = (keys: string[]) => (keys.length ? keys.map((k) => categoryLabel(k, categories)).join(', ') : '—');
  return (
    <Card ref={ref} sx={[{ p: 1.5, scrollMarginTop: 8 }, highlight === true && { borderColor: 'primary.main', borderWidth: 2 }]}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>
            {team.name}
            {team.is_me ? ' (you)' : ''}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }} className="tabular">
            Slot {team.team_id} · {team.roster.length} drafted ·{' '}
            {team.next_pick == null
              ? 'no picks left'
              : `next ${roundPick(team.next_pick, teamsCount)}${team.picks_until_next === 0 ? ' (on the clock)' : team.picks_until_next != null ? ` (in ${team.picks_until_next})` : ''}`}
          </Typography>
        </Box>
        {highlight && <Chip size="small" color="primary" icon={<BoltOutlinedIcon />} label="Before you" />}
      </Stack>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 1 }} aria-label="Players by position">
        {POSITIONS.map((p) => (
          <Box key={p} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
            <PositionBadge pos={p} />
            <Typography variant="caption" className="tabular" sx={{ fontWeight: 700, mr: 0.5 }}>
              {team.position_counts[p] ?? 0}
            </Typography>
          </Box>
        ))}
      </Stack>
      <Typography variant="body2" sx={{ mt: 1 }}>
        <Box component="span" sx={{ color: 'text.secondary' }}>Needs: </Box>
        {team.open_slots.length ? team.open_slots.join(', ') : 'starters filled'}
      </Typography>
      <Typography variant="body2">
        <Box component="span" sx={{ color: 'text.secondary' }}>Strong: </Box>
        {label(strong)}
        <Box component="span" sx={{ color: 'text.secondary' }}> · Weak: </Box>
        {label(weak)}
      </Typography>
      {insight?.vs_me?.p_win_week != null && (
        <Typography variant="body2" className="tabular">
          <Box component="span" sx={{ color: 'text.secondary' }}>Head-to-head: </Box>
          you win {pct(insight.vs_me.p_win_week)} of weeks
        </Typography>
      )}
      {(team.roster.length > 0 || insight) && (
        <>
          <Button size="small" color="inherit" onClick={() => setManual(!open)} aria-expanded={open} endIcon={<ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : 'none' }} />} sx={{ mt: 0.5, ml: -1, color: 'text.secondary' }}>
            Details
          </Button>
          <Collapse in={open} unmountOnExit>
            {insight && insight.notes.length > 0 && (
              <Box component="ul" sx={{ m: 0, mb: 1, pl: 2.5 }} aria-label="Engine notes">
                {insight.notes.map((n) => (
                  <Typography component="li" variant="body2" key={n}>{n}</Typography>
                ))}
              </Box>
            )}
            {insight?.vs_me && (
              <Box sx={{ mb: 1 }}>
                <CategoryOddsChart
                  pCat={insight.vs_me.p_cat}
                  categories={categories}
                  title="Head-to-head vs you"
                  subtitle={`P(you win each category) vs ${team.name}`}
                  valueWord="for you"
                />
              </Box>
            )}
            <Box component="ul" sx={{ m: 0, pl: 0, listStyle: 'none' }}>
              {team.roster.map((p) => (
                <Stack component="li" key={p.player_id} direction="row" sx={{ alignItems: 'center', gap: 0.75, py: 0.5 }}>
                  <PositionBadge pos={p.position} />
                  <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>{p.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                    {eligibleLabel(p.eligible, p.position)} · {p.team_abbr ?? '—'}
                  </Typography>
                </Stack>
              ))}
            </Box>
          </Collapse>
        </>
      )}
    </Card>
  );
}
