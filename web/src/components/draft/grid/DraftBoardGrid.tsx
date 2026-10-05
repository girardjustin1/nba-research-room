import { useCallback, useEffect, useMemo, useRef } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DriveFileRenameOutlineOutlinedIcon from '@mui/icons-material/DriveFileRenameOutlineOutlined';
import EastIcon from '@mui/icons-material/East';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import WestIcon from '@mui/icons-material/West';
import type { PickRecord, PoolPlayer, Session } from '../../../api/types';
import { gridMatchesApi, roundOf, roundPick, snakePick, snakeSlot, teamName } from '../../../lib/picks';
import { GROUP_COLORS, GROUP_LABEL, positionGroup, type PositionGroup } from '../../../lib/positions';
import { useResolvedMode } from '../../../theme/viz';

export interface GridCell {
  pickNo: number;
  round: number;
  /** Column (draft slot) the snake puts this pick in; the API checks it on POST. */
  slot: number;
  made: PickRecord | null;
}

export interface TeamMeta {
  /** Open starting positions (labels as the API names them). */
  needs: string[];
  /** Label of the weakest category, e.g. "FT%". */
  weakest: string | null;
}

export interface DraftBoardGridProps {
  session: Session;
  /** Every player (drafted included), for each made pick's position and NBA team. */
  pool: Map<number, PoolPlayer>;
  onCellTap: (cell: GridCell) => void;
  onEditNames?: () => void;
  /** Per-team need chips and weakest category for the column headers (from /draft/teams and insights). */
  teamMeta?: Map<number, TeamMeta>;
  /** Cell size, px. */
  cellWidth?: number;
  cellHeight?: number;
  /** The grid's own scroll position (the room collapses its header once you scroll). */
  onScroll?: (scrollTop: number) => void;
}

/** Text on a filled cell. Black on every group fill measures >= 4.76:1 (light blue, the
 * lowest; white would be 4.42) in both modes, so the fills can stay the exact bar colors. */
const FILL_INK = '#000';

const ROUND_COL = 40;
const HEADER_H = 62;

/**
 * The draft board: columns are teams (draft slots), rows are rounds, in snake order (the
 * arrow shows each round's direction). Made picks are filled with their position group's
 * color (the positional value bars' blue / orange / green, legend above) and print
 * position, NBA team, the player's name and round.pick; empty cells show the overall pick and
 * round.pick. Every cell is a button: empty cells assign a player, made ones change or remove.
 * The grid scrolls inside its own box (both ways); the page never scrolls sideways.
 */
export function DraftBoardGrid({ session, pool, onCellTap, onEditNames, teamMeta, cellWidth = 96, cellHeight = 80, onScroll }: DraftBoardGridProps) {
  const mode = useResolvedMode();
  const scroller = useRef<HTMLDivElement>(null);
  const { teams, rounds, current_pick: current, my_slot: mySlot } = session;
  const byPick = useMemo(() => new Map(session.picks.map((p) => [p.pick_no, p])), [session.picks]);
  const slots = Array.from({ length: teams }, (_, i) => i + 1);
  const snakeOk = gridMatchesApi(session);

  const jumpToCurrent = useCallback(
    (smooth = true) => {
      const el = scroller.current;
      if (!el || current == null) return;
      const round = roundOf(current, teams);
      const slot = snakeSlot(current, teams);
      const left = ROUND_COL + (slot - 1) * cellWidth - (el.clientWidth - ROUND_COL - cellWidth) / 2;
      const top = HEADER_H + (round - 1) * cellHeight - (el.clientHeight - HEADER_H - cellHeight) / 2;
      const to = { left: Math.max(0, left - ROUND_COL), top: Math.max(0, top - HEADER_H) };
      if (typeof el.scrollTo === 'function') el.scrollTo({ ...to, behavior: smooth ? 'smooth' : 'auto' });
      else {
        el.scrollLeft = to.left;
        el.scrollTop = to.top;
      }
    },
    [current, teams, cellWidth, cellHeight],
  );

  // Keep the current pick in view as picks come in.
  useEffect(() => {
    jumpToCurrent(false);
  }, [jumpToCurrent]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Stack direction="row" sx={{ alignItems: 'center', px: 2, gap: 0.5 }}>
        <Typography variant="subtitle2" component="h2">
          Draft board
        </Typography>
        <Stack direction="row" component="ul" aria-label="Cell colors" sx={{ flex: 1, m: 0, pl: 1.5, gap: 1.25, listStyle: 'none', minWidth: 0 }}>
          {(['G', 'F', 'C'] as PositionGroup[]).map((g) => (
            <Stack key={g} component="li" direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
              <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: GROUP_COLORS[mode][g] }} />
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {GROUP_LABEL[g]}
              </Typography>
            </Stack>
          ))}
        </Stack>
        {onEditNames && (
          <Tooltip title="Edit team names">
            <IconButton aria-label="Edit team names" onClick={onEditNames}>
              <DriveFileRenameOutlineOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Jump to the current pick">
          <span>
            <IconButton aria-label="Jump to the current pick" onClick={() => jumpToCurrent()} disabled={current == null} sx={{ mr: -1 }}>
              <GpsFixedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      {!snakeOk && (
        <Alert severity="warning" sx={{ mx: 2, mb: 1, py: 0 }}>
          The API's pick order is not a plain snake (keepers or traded picks?). Cells are laid out as a snake; picks still record with the API's order.
        </Alert>
      )}
      <Box
        ref={scroller}
        onScroll={onScroll ? (e) => onScroll(e.currentTarget.scrollTop) : undefined}
        role="grid"
        aria-label="Draft board"
        aria-rowcount={rounds + 1}
        aria-colcount={teams + 1}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
          borderTop: 1,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.default',
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: `${ROUND_COL}px repeat(${teams}, ${cellWidth}px)`,
            gridTemplateRows: `${HEADER_H}px repeat(${rounds}, ${cellHeight}px)`,
            width: ROUND_COL + teams * cellWidth,
          }}
        >
          {/* corner */}
          <Box sx={{ position: 'sticky', top: 0, left: 0, zIndex: 3, bgcolor: 'background.paper', borderRight: 1, borderBottom: 1, borderColor: 'divider' }} />
          {slots.map((slot) => {
            const mine = slot === mySlot;
            const meta = teamMeta?.get(slot);
            return (
              <Box
                key={`h${slot}`}
                role="columnheader"
                sx={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  px: 0.75,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 0.25,
                  borderBottom: 1,
                  borderRight: 1,
                  borderColor: 'divider',
                  bgcolor: mine ? 'primary.main' : 'background.paper',
                  color: mine ? 'primary.contrastText' : 'text.primary',
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 700, lineHeight: 1.1, textAlign: 'center', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: meta ? 1 : 2, WebkitBoxOrient: 'vertical', maxWidth: '100%' }}>
                  {teamName(session, slot)}
                </Typography>
                {meta && (meta.needs.length > 0 || meta.weakest) && (
                  <Typography
                    variant="caption"
                    noWrap
                    aria-label={`Needs ${meta.needs.join(', ') || 'nothing'}${meta.weakest ? `; weakest ${meta.weakest}` : ''}`}
                    sx={{ fontSize: 10.5, lineHeight: 1.1, opacity: 0.85, maxWidth: '100%' }}
                    className="tabular"
                  >
                    {meta.needs.slice(0, 3).join(' ')}
                    {meta.weakest ? ` · ↓${meta.weakest}` : ''}
                  </Typography>
                )}
              </Box>
            );
          })}
          {Array.from({ length: rounds }, (_, r) => r + 1).map((round) => (
            <RoundRow
              key={round}
              round={round}
              slots={slots}
              session={session}
              byPick={byPick}
              pool={pool}
              mode={mode}
              onCellTap={onCellTap}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function RoundRow({
  round,
  slots,
  session,
  byPick,
  pool,
  mode,
  onCellTap,
}: {
  round: number;
  slots: number[];
  session: Session;
  byPick: Map<number, PickRecord>;
  pool: Map<number, PoolPlayer>;
  mode: 'light' | 'dark';
  onCellTap: (cell: GridCell) => void;
}) {
  const rightward = round % 2 === 1;
  return (
    <>
      <Box
        role="rowheader"
        sx={{
          position: 'sticky',
          left: 0,
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.paper',
          borderRight: 1,
          borderBottom: 1,
          borderColor: 'divider',
          color: 'text.secondary',
        }}
        aria-label={`Round ${round}, picks go ${rightward ? 'left to right' : 'right to left'}`}
      >
        <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
          {round}
        </Typography>
        {rightward ? <EastIcon sx={{ fontSize: 16 }} /> : <WestIcon sx={{ fontSize: 16 }} />}
      </Box>
      {slots.map((slot) => {
        const pickNo = snakePick(round, slot, session.teams);
        const made = byPick.get(pickNo) ?? null;
        return (
          <Cell
            key={pickNo}
            cell={{ pickNo, round, slot, made }}
            session={session}
            player={made?.player_id != null ? (pool.get(made.player_id) ?? null) : null}
            mode={mode}
            onTap={onCellTap}
          />
        );
      })}
    </>
  );
}

function Cell({
  cell,
  session,
  player,
  mode,
  onTap,
}: {
  cell: GridCell;
  session: Session;
  player: PoolPlayer | null;
  mode: 'light' | 'dark';
  onTap: (cell: GridCell) => void;
}) {
  const { pickNo, slot, made } = cell;
  const isCurrent = pickNo === session.current_pick;
  const mine = slot === session.my_slot;
  const g = positionGroup(player?.position);
  const hue = g ? GROUP_COLORS[mode][g] : null;
  const label = roundPick(pickNo, session.teams);
  const otherTeam = made && made.team_id !== slot ? made.team_id : null;
  const aria = made
    ? `${label}, ${teamName(session, made.team_id)}: ${made.player_name}${player?.position ? `, ${player.position}` : ''}. Tap to change or remove.`
    : `${label}, pick ${pickNo}, ${teamName(session, slot)}${isCurrent ? ', on the clock' : ''}. Tap to assign a player.`;

  return (
    <ButtonBase
      role="gridcell"
      aria-label={aria}
      onClick={() => onTap(cell)}
      sx={[
        {
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          justifyContent: 'space-between',
          textAlign: 'left',
          p: 0.75,
          borderRight: 1,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          color: 'text.primary',
          overflow: 'hidden',
        },
        mine && ((theme) => ({ bgcolor: `rgba(${theme.vars.palette.primary.mainChannel} / 0.08)` })),
        hue != null && { bgcolor: hue, color: FILL_INK, borderColor: 'background.paper' },
        made != null && hue == null && { borderTop: '3px solid', borderTopColor: 'text.disabled' },
        isCurrent && ((theme) => ({ outline: `3px solid ${theme.vars.palette.primary.main}`, outlineOffset: -3, zIndex: 0 })),
      ]}
    >
      {made ? (
        <>
          <Typography variant="caption" sx={{ fontWeight: 700, lineHeight: 1.1 }} noWrap>
            {player?.position ?? '—'} · {player?.team_abbr ?? '—'}
          </Typography>
          <Typography
            variant="caption"
            sx={{ fontWeight: 600, fontSize: 12.5, lineHeight: 1.15, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
          >
            {made.player_name}
          </Typography>
          <Typography variant="caption" className="tabular" sx={{ color: hue != null ? FILL_INK : 'text.secondary', lineHeight: 1.1 }} noWrap>
            {label}
            {otherTeam != null ? ` · by ${teamName(session, otherTeam)}` : ''}
            {made.is_keeper ? ' · K' : ''}
          </Typography>
        </>
      ) : (
        <>
          <Typography variant="caption" sx={{ color: isCurrent ? 'primary.main' : 'text.secondary', fontWeight: isCurrent ? 700 : 400 }}>
            {isCurrent ? 'On the clock' : ''}
          </Typography>
          <Typography variant="body2" className="tabular" sx={{ color: 'text.secondary', fontWeight: 600 }}>
            Pick {pickNo}
          </Typography>
          <Typography variant="caption" className="tabular" sx={{ color: 'text.secondary', lineHeight: 1.1 }}>
            {label}
          </Typography>
        </>
      )}
    </ButtonBase>
  );
}
