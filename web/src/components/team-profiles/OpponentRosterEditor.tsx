import { useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { OpponentRoster, OpponentRosterRequest, PlayerRef } from '../../api/season';
import { PlayerLine } from '../foundations/PlayerLine';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { ErrorState, LoadingState } from '../foundations/ScreenStates';

export interface OpponentRosterEditorProps {
  data: OpponentRoster | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** NBA players matching the text (the server's player search). */
  onSearch: (q: string) => Promise<PlayerRef[]>;
  /** Replace this week's entry; resolves with the saved entry (unmatched names included). */
  onSave: (body: OpponentRosterRequest) => Promise<OpponentRoster>;
  onOpenPlayer?: (p: PlayerRef) => void;
  onTabChange?: (tab: SeasonTab) => void;
}

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtSaved = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * This week's opponent, entered by hand: which team I play and who is on it. Players are picked
 * from the NBA list (search) or pasted one name per line; names that match no player come back
 * with suggestions. One opponent at a time, replaced each week, kept on this computer only.
 */
export function OpponentRosterEditor({ data, loading, error, onRetry, onSearch, onSave, onOpenPlayer, onTabChange }: OpponentRosterEditorProps) {
  const [teamId, setTeamId] = useState<number | ''>('');
  const [players, setPlayers] = useState<PlayerRef[]>([]);
  const [paste, setPaste] = useState('');
  const [pasting, setPasting] = useState(false);
  const [options, setOptions] = useState<PlayerRef[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<OpponentRoster | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A saved entry from the server resets the form (on load and after each save).
  const shown = result ?? data;
  const [seen, setSeen] = useState<OpponentRoster | null>(null);
  if (shown !== seen) {
    setSeen(shown);
    if (shown) {
      setTeamId(shown.opponent_team_id ?? '');
      setPlayers(shown.players);
    }
  }

  const searching = query.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    timer.current = setTimeout(() => {
      onSearch(query).then(setOptions, () => setOptions([]));
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, searching, onSearch]);

  const names = useMemo(() => paste.split('\n').map((s) => s.trim()).filter(Boolean), [paste]);
  const changed =
    shown != null &&
    (teamId !== (shown.opponent_team_id ?? '') ||
      names.length > 0 ||
      players.map((p) => p.player_id).join() !== shown.players.map((p) => p.player_id).join());

  const save = () => {
    if (teamId === '') return;
    setSaving(true);
    setSaveError(null);
    onSave({ team_id: teamId, player_ids: players.map((p) => p.player_id), names }).then(
      (r) => {
        setResult(r);
        setPaste('');
        setPasting(false);
        setSaving(false);
      },
      (e: unknown) => {
        setSaveError(e instanceof Error ? e.message : 'Saving failed');
        setSaving(false);
      },
    );
  };

  const week = shown?.week;
  const header = (
    <ScreenHeader
      title="This week's opponent"
      subtitle={week ? `Week ${week.week} · ${fmtDay(week.start)} – ${fmtDay(week.end)}` : undefined}
    />
  );
  let body;
  if (error && !shown) body = <ErrorState message={error} onRetry={onRetry} what="the opponent" />;
  else if (!shown) body = <LoadingState blocks={[80, 300, 120]} label={loading ? "Loading this week's opponent" : 'Loading'} />;
  else {
    body = (
      <Stack spacing={1.5}>
        {shown.unmatched.length > 0 && (
          <Alert severity="warning">
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {shown.unmatched.length === 1 ? "1 name didn't match an NBA player" : `${shown.unmatched.length} names didn't match an NBA player`}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {shown.unmatched.map((u) => (
                <Typography component="li" variant="body2" key={u.name}>
                  {u.name}
                  {u.suggestions.length > 0 ? ` (did you mean ${u.suggestions.join(', ')}?)` : ''}
                </Typography>
              ))}
            </Box>
          </Alert>
        )}
        {saveError && <Alert severity="error">{saveError}</Alert>}
        <Card sx={{ p: 1.5 }}>
          <TextField
            select
            fullWidth
            label="Who are you playing this week?"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            {shown.teams.map((t) => (
              <MenuItem key={t.team_id} value={t.team_id}>
                {t.label}
              </MenuItem>
            ))}
          </TextField>
        </Card>

        <Card sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" component="h2" sx={{ mb: 1 }}>
            Their players ({players.length})
          </Typography>
          <Autocomplete<PlayerRef, false, false, false>
            options={searching ? options.filter((o) => !players.some((p) => p.player_id === o.player_id)) : []}
            getOptionLabel={(o) => `${o.name} · ${o.team_abbr ?? '—'}`}
            filterOptions={(x) => x}
            inputValue={query}
            onInputChange={(_e, v, reason) => setQuery(reason === 'reset' || reason === 'selectOption' ? '' : v)}
            value={null}
            onChange={(_e, v) => {
              if (v) setPlayers((ps) => [...ps, { ...v, owner: 'opponent' }]);
            }}
            noOptionsText={query.trim().length < 2 ? 'Type at least 2 letters' : 'No NBA player by that name'}
            renderInput={(params) => <TextField {...params} label="Add a player" placeholder="Search the NBA list" />}
          />
          <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', m: 0, mt: 1, p: 0 }}>
            {players.map((p) => (
              <Box component="li" key={p.player_id}>
                <PlayerLine
                  player={p}
                  onOpen={onOpenPlayer}
                  trailing={
                    <IconButton
                      aria-label={`Remove ${p.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPlayers((ps) => ps.filter((x) => x.player_id !== p.player_id));
                      }}
                      sx={{ width: 44, height: 44 }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  }
                />
              </Box>
            ))}
          </Stack>
          {players.length === 0 && (
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
              No players yet. Search above, or paste their names.
            </Typography>
          )}
          {pasting ? (
            <TextField
              multiline
              minRows={4}
              fullWidth
              label="Paste names, one per line"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              sx={{ mt: 1.5 }}
            />
          ) : (
            <Button onClick={() => setPasting(true)} sx={{ mt: 1 }}>
              Paste a list of names
            </Button>
          )}
        </Card>


        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', color: 'text.secondary' }}>
          <InfoOutlinedIcon fontSize="small" sx={{ mt: 0.25 }} aria-hidden />
          <Typography variant="caption">{shown.policy}</Typography>
        </Box>
      </Stack>
    );
  }
  const footer =
    shown != null ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1 }}>
        <Typography variant="caption" sx={{ flex: 1, color: 'text.secondary' }}>
          {shown.saved_at ? `Saved ${fmtSaved(shown.saved_at)}` : 'Not saved for this week yet'}
        </Typography>
        <Button variant="contained" onClick={save} disabled={teamId === '' || !changed || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Box>
    ) : undefined;
  return (
    <SeasonShell tab="research" onTabChange={onTabChange} header={header} footer={footer}>
      {body}
    </SeasonShell>
  );
}
