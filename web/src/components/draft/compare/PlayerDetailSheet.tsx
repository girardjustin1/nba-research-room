import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import type { ApiError } from '../../../api/client';
import type { Category, PoolPlayer, Recommendation, TeamDay, TeamWeeksResponse } from '../../../api/types';
import { eligibleLabel, fixed, pct, signed, splitReasons } from '../../../lib/format';
import { SAFE_BOTTOM } from '../../../lib/layout';
import { DpChart } from '../charts/DpChart';
import { TeamVolumeStrip } from '../../foundations/charts/TeamVolumeStrip';
import { PlayerAvatar, TeamBadge } from '../../foundations/avatars/PlayerAvatar';
import { PositionBadge } from '../../foundations/badges/PositionBadge';

export interface PlayerDetailSheetProps {
  player: PoolPlayer | null;
  /** The board's row for him, when he is in the top recommendations. */
  rec?: Recommendation;
  categories: Category[];
  schedule: TeamWeeksResponse | null;
  scheduleError?: ApiError | null;
  loadDays?: (team: string, start: string, end: string) => Promise<TeamDay[]>;
  favorite: boolean;
  inCompare: boolean;
  compareFull: boolean;
  canDraft: boolean;
  draftLabel: string;
  onToggleFavorite: () => void;
  onToggleCompare: () => void;
  onDraft: () => void;
  onClose: () => void;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }} noWrap>{label}</Typography>
      <Typography variant="body2" component="p" className="tabular" sx={{ fontWeight: 700 }}>{value}</Typography>
    </Box>
  );
}

/** One player's draft card: engine numbers, schedule volume, and (if ranked) the per-category effect. */
export function PlayerDetailSheet(props: PlayerDetailSheetProps) {
  const { player: p, rec } = props;
  return (
    <Drawer
      anchor="bottom"
      open={p != null}
      onClose={props.onClose}
      slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '90dvh', pb: SAFE_BOTTOM } } }}
    >
      {p && (
        <Box sx={{ overflowY: 'auto' }}>
          <Box sx={{ width: 40, height: 5, borderRadius: 3, bgcolor: 'text.disabled', mx: 'auto', mt: 1 }} aria-hidden />
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25, px: 2, pt: 1 }}>
            <PlayerAvatar name={p.name} headshotUrl={p.headshot_url} size={48} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" component="h2" noWrap>{p.name}</Typography>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                <PositionBadge pos={p.position} />
                <Typography variant="body2" component="span" noWrap>
                  {eligibleLabel(p.eligible, p.position)} · <TeamBadge abbr={p.team_abbr} logoUrl={p.team_logo_url} size={14} />
                </Typography>
              </Stack>
            </Box>
            <IconButton aria-label={props.favorite ? `Unstar ${p.name}` : `Star ${p.name}`} aria-pressed={props.favorite} onClick={props.onToggleFavorite}>
              {props.favorite ? <StarIcon /> : <StarBorderIcon />}
            </IconButton>
          </Stack>

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1, px: 2, pt: 1.5 }}>
            <Stat label="ADP" value={`${fixed(p.expected_pick, 1)}${p.adp_pos_rank != null ? ` / ${p.position ?? ''}${p.adp_pos_rank}` : ''}`} />
            <Stat label="Our rank" value={`${p.rank ?? '—'}${p.pos_rank != null ? ` / ${p.position ?? ''}${p.pos_rank}` : ''}`} />
            <Stat label="Tier" value={p.tier == null ? '—' : String(p.tier)} />
            <Stat label="Injury risk" value={p.injury_risk ?? '—'} />
            {rec && (
              <>
                <Stat label="Gain" value={signed(rec.gain)} />
                <Stat label="P(win week)" value={pct(rec.p_win_week_mc ?? rec.p_win_week)} />
                <Stat label="At my pick" value={pct(rec.p_available_at_decision)} />
                <Stat label="To next pick" value={pct(rec.p_available_next)} />
              </>
            )}
          </Box>
          {(p.sources === 'bbm_only' || p.adp_source === 'bbm_rank') && (
            <Typography variant="caption" component="p" sx={{ color: 'text.secondary', px: 2, pt: 0.5 }}>
              Lower confidence: {[p.sources === 'bbm_only' ? 'BBM-only projection' : null, p.adp_source === 'bbm_rank' ? 'no ADP' : null].filter(Boolean).join(', ')}.
            </Typography>
          )}

          <Box sx={{ px: 2, pt: 2 }}>
            <TeamVolumeStrip teamAbbr={p.team_abbr} schedule={props.schedule} scheduleError={props.scheduleError} loadDays={props.loadDays} />
          </Box>

          {rec && (
            <Box sx={{ px: 2, pt: 2 }}>
              <DpChart rec={rec} categories={props.categories} scaleMax={0.03} />
              {splitReasons(rec.reasons).length > 0 && (
                <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5, color: 'text.secondary' }}>
                  {splitReasons(rec.reasons).map((r) => (
                    <Typography component="li" variant="body2" key={r}>{r}</Typography>
                  ))}
                </Box>
              )}
            </Box>
          )}

          <Stack direction="row" spacing={1} sx={{ p: 2 }}>
            <Button
              size="large"
              variant="outlined"
              startIcon={<CompareArrowsIcon />}
              onClick={props.onToggleCompare}
              disabled={!props.inCompare && props.compareFull}
              aria-pressed={props.inCompare}
            >
              {props.inCompare ? 'In compare' : 'Compare'}
            </Button>
            <Button size="large" variant="contained" fullWidth disabled={!props.canDraft} onClick={props.onDraft}>
              {props.draftLabel}
            </Button>
          </Stack>
        </Box>
      )}
    </Drawer>
  );
}
