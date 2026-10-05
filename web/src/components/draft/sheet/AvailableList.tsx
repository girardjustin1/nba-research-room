import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import SearchIcon from '@mui/icons-material/Search';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import type { PoolPlayer } from '../../../api/types';
import { fixed } from '../../../lib/format';
import { roundPick } from '../../../lib/picks';
import { matchesFilter, POS_FILTERS, type PosFilter } from '../../../lib/positions';
import { MAX_COMPARE, projPickIndex } from '../../../lib/draftHelpers';
import { TeamBadge } from '../../foundations/avatars/PlayerAvatar';
import { PositionBadge } from '../../foundations/badges/PositionBadge';

export type SortKey = 'adp' | 'rank' | 'playoff';

export interface AvailableListProps {
  players: PoolPlayer[];
  teams: number;
  /** The pick the Draft button records (the current pick), and who it is for. */
  currentPick: number | null;
  onTheClockLabel: string;
  mineOnTheClock: boolean;
  /** My next pick, for the PROJ. PICK divider (ADP sort only). */
  myNextPick: number | null;
  favorites: Set<number>;
  onToggleFavorite: (playerId: number) => void;
  compare: number[];
  onToggleCompare: (playerId: number) => void;
  onOpenCompare: () => void;
  onDraft: (player: PoolPlayer) => void;
  /** Tap a player's name: open his detail sheet. */
  onOpenPlayer?: (player: PoolPlayer) => void;
  pendingId?: number | null;
  /** Favorites tab: only starred players. */
  favoritesOnly?: boolean;
  /** Rendered at the top of the pinned toolbar (the room's Available / Favorites tabs). */
  toolbarLead?: React.ReactNode;
  /** Pin the toolbar to the top of the scrolling parent. */
  stickyToolbar?: boolean;
}

const PAGE = 120;

function adpText(p: PoolPlayer): string {
  if (p.expected_pick == null) return '—';
  const approx = p.adp_source && p.adp_source !== 'yahoo' ? '~' : '';
  return `${approx}${fixed(p.expected_pick, 1)}`;
}


/**
 * The available-player list. A compact toolbar (pinned while the list scrolls) with search and
 * sort on one row and the position chips below. Sort:
 * ADP (the engine's expected pick, "~" when it falls back from Yahoo ADP) or Our Rank. In ADP
 * order a divider marks where my next pick falls. Each row: Draft (records the current pick
 * for the team on the clock), name, position, NBA team, fantasy-playoff games (weeks 20-22),
 * ADP / positional ADP rank, our rank / positional rank, Compare, and a favorite star.
 */
export function AvailableList(props: AvailableListProps) {
  const { players, teams, favorites, compare, favoritesOnly } = props;
  const [filter, setFilter] = useState<PosFilter>('ALL');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('adp');
  const [shown, setShown] = useState(PAGE);
  const hasRookieFlag = players.some((p) => p.rookie != null);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = players.filter(
      (p) => (!favoritesOnly || favorites.has(p.player_id)) && matchesFilter(p, filter) && (!needle || p.name.toLowerCase().includes(needle)),
    );
    if (sort === 'playoff') {
      // Most fantasy-playoff games first; ties by our rank.
      return out.sort((a, b) => (b.playoff_games ?? -1) - (a.playoff_games ?? -1) || (a.rank ?? Infinity) - (b.rank ?? Infinity));
    }
    const key = (p: PoolPlayer) => (sort === 'adp' ? (p.expected_pick ?? Infinity) : (p.rank ?? Infinity));
    return out.sort((a, b) => key(a) - key(b));
  }, [players, favoritesOnly, favorites, filter, q, sort]);

  const divider = sort === 'adp' && !q && filter === 'ALL' ? projPickIndex(list, props.myNextPick) : null;
  const visible = list.slice(0, Math.max(shown, divider != null ? divider + 5 : 0));

  return (
    <Box sx={{ pb: compare.length >= 2 ? 9 : 2 }}>
      <Box
        sx={[
          { bgcolor: 'background.default', zIndex: 2 },
          !!props.stickyToolbar && { position: 'sticky', top: 0, boxShadow: (t) => `0 1px 0 ${t.vars.palette.divider}` },
        ]}
      >
        {props.toolbarLead}
        <Stack direction="row" sx={{ gap: 1, px: 2, pt: 1 }}>
          <TextField
            size="small"
            placeholder="Search players"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            sx={{ flex: 1, minWidth: 0 }}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
              htmlInput: { 'aria-label': 'Search players', autoCorrect: 'off', enterKeyHint: 'search' },
            }}
          />
          <TextField
            select
            size="small"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            sx={{ width: 128, flexShrink: 0 }}
            slotProps={{ select: { SelectDisplayProps: { 'aria-label': 'Sort players' } as React.HTMLAttributes<HTMLDivElement> } }}
          >
            <MenuItem value="adp">ADP</MenuItem>
            <MenuItem value="rank">Our rank</MenuItem>
            <MenuItem value="playoff" disabled={!players.some((p) => p.playoff_games != null)}>
              Playoff games
            </MenuItem>
          </TextField>
        </Stack>
        <Box
          role="group"
          aria-label="Position filter"
          sx={{
            display: 'flex',
            gap: 0.75,
            overflowX: 'auto',
            px: 2,
            py: 1,
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
            maskImage: 'linear-gradient(to right, #000 calc(100% - 28px), transparent)',
          }}
        >
          {POS_FILTERS.map((f) => (
            <Chip
              key={f}
              label={f === 'ROOKIE' ? 'Rookies' : f}
              size="small"
              onClick={() => setFilter(f)}
              color={filter === f ? 'primary' : 'default'}
              variant={filter === f ? 'filled' : 'outlined'}
              aria-pressed={filter === f}
              disabled={f === 'ROOKIE' && !hasRookieFlag}
              sx={{ height: 32, minWidth: 44, fontWeight: 700, flexShrink: 0 }}
            />
          ))}
        </Box>
      <Stack direction="row" sx={{ pl: 1.5, pr: 0.25, py: 0.25, gap: 0.75, color: 'text.secondary', borderTop: 1, borderColor: 'divider' }} aria-hidden>
        <Box sx={{ width: 52, flexShrink: 0 }} />
        <Typography variant="overline" sx={{ flex: 1 }}>Player</Typography>
        <Typography variant="overline" sx={{ width: 56, textAlign: 'right', flexShrink: 0 }}>ADP</Typography>
        <Typography variant="overline" sx={{ width: 42, textAlign: 'right', flexShrink: 0 }}>Rank</Typography>
        <Typography variant="overline" sx={{ width: 76, textAlign: 'center', flexShrink: 0 }}>Cmp · ★</Typography>
      </Stack>
      </Box>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
        {props.currentPick == null
          ? 'The draft is complete.'
          : `Draft records ${roundPick(props.currentPick, teams)} for ${props.onTheClockLabel}.`}{' '}
        ( ) = games in fantasy playoff weeks 20–22.
      </Typography>

      {list.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>
          {favoritesOnly ? 'No favorites yet. Tap the star on a player to keep him here.' : 'No available player matches.'}
        </Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {visible.map((p, i) => (
            <Box component="li" key={p.player_id}>
              {divider === i && <ProjDivider pick={props.myNextPick} teams={teams} />}
              <Row p={p} {...props} />
            </Box>
          ))}
          {divider != null && divider >= visible.length && divider === list.length && <ProjDivider pick={props.myNextPick} teams={teams} />}
        </Box>
      )}
      {list.length > visible.length && (
        <Box sx={{ px: 2, pt: 1 }}>
          <Button fullWidth onClick={() => setShown((n) => n + PAGE)}>
            Show more ({list.length - visible.length} left)
          </Button>
        </Box>
      )}

      {compare.length >= 2 && (
        <Box sx={{ position: 'sticky', bottom: 8, px: 2, mt: 1 }}>
          <Button variant="contained" fullWidth size="large" startIcon={<CompareArrowsIcon />} onClick={props.onOpenCompare} sx={{ boxShadow: 4 }}>
            Compare Players ({compare.length})
          </Button>
        </Box>
      )}
    </Box>
  );
}

function ProjDivider({ pick, teams }: { pick: number | null; teams: number }) {
  if (pick == null) return null;
  return (
    <Box role="separator" sx={{ px: 2, py: 0.5, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
      <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: '0.04em' }} className="tabular">
        PROJ. PICK: {roundPick(pick, teams)} ({pick} OVR)
      </Typography>
    </Box>
  );
}

function Row({ p, ...props }: { p: PoolPlayer } & AvailableListProps) {
  const fav = props.favorites.has(p.player_id);
  const checked = props.compare.includes(p.player_id);
  const full = !checked && props.compare.length >= MAX_COMPARE;
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, pl: 1.5, pr: 0.25, minHeight: 56, borderBottom: 1, borderColor: 'divider' }}>
      <Button
        size="small"
        variant={props.mineOnTheClock ? 'contained' : 'outlined'}
        disabled={props.currentPick == null || props.pendingId != null}
        onClick={() => props.onDraft(p)}
        aria-label={`Draft ${p.name} for ${props.onTheClockLabel}`}
        sx={{ minWidth: 52, width: 52, minHeight: 40, px: 0, fontSize: 13 }}
      >
        {props.pendingId === p.player_id ? '…' : 'Draft'}
      </Button>
      <ButtonBase
        onClick={() => props.onOpenPlayer?.(p)}
        disabled={!props.onOpenPlayer}
        aria-label={`${p.name}: details`}
        sx={{ flex: 1, minWidth: 0, display: 'block', textAlign: 'left', minHeight: 44, borderRadius: 1 }}
      >
        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
          {p.name}
        </Typography>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, color: 'text.secondary', minWidth: 0 }}>
          <PositionBadge pos={p.position} />
          <Typography variant="caption" component="span" noWrap>
            <TeamBadge abbr={p.team_abbr} logoUrl={p.team_logo_url} size={12} />
            {p.playoff_games != null ? ` (${p.playoff_games})` : ''}
          </Typography>
        </Stack>
      </ButtonBase>
      <Box sx={{ width: 56, textAlign: 'right', flexShrink: 0 }} className="tabular">
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{adpText(p)}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {p.adp_pos_rank != null ? `${p.position ?? ''}${p.adp_pos_rank}` : '—'}
        </Typography>
      </Box>
      <Box sx={{ width: 42, textAlign: 'right', flexShrink: 0 }} className="tabular">
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{p.rank ?? '—'}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {p.pos_rank != null ? `${p.position ?? ''}${p.pos_rank}` : '—'}
        </Typography>
      </Box>
      <Stack direction="row" sx={{ width: 76, justifyContent: 'flex-end', flexShrink: 0 }}>
        <Checkbox
          checked={checked}
          disabled={full}
          onChange={() => props.onToggleCompare(p.player_id)}
          slotProps={{ input: { 'aria-label': `Compare ${p.name}${full ? ` (up to ${MAX_COMPARE})` : ''}` } }}
          sx={{ width: 38, height: 44, p: 0 }}
          size="small"
        />
        <IconButton
          aria-label={fav ? `Unstar ${p.name}` : `Star ${p.name}`}
          aria-pressed={fav}
          onClick={() => props.onToggleFavorite(p.player_id)}
          sx={{ minWidth: 38, width: 38, p: 0, color: fav ? 'text.primary' : 'text.secondary' }}
        >
          {fav ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
        </IconButton>
      </Stack>
    </Stack>
  );
}
