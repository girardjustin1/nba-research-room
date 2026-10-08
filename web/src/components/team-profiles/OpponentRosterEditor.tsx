import { useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { OpponentRoster, OpponentRosterRequest, PlayerRef, TeamNamesRequest } from '../../api/season';
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
  /** Register or rename league teams; resolves with the updated entry. */
  onSaveNames: (body: TeamNamesRequest) => Promise<OpponentRoster>;
  onOpenPlayer?: (p: PlayerRef) => void;
  /** Stories: open with the "Name all teams" dialog showing. */
  initialNamesOpen?: boolean;
  onTabChange?: (tab: SeasonTab) => void;
}

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtSaved = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * This week's opponent, entered by hand: which team I play (registered by name) and who is on
 * it. Players are picked from the NBA list (search) or pasted one name per line; names that match
 * no player come back with suggestions. Team names, and one opponent's roster at a time, replaced
 * each week, kept on this computer only.
 */
export function OpponentRosterEditor({
  data,
  loading,
  error,
  onRetry,
  onSearch,
  onSave,
  onSaveNames,
  onOpenPlayer,
  onTabChange,
  initialNamesOpen = false,
}: OpponentRosterEditorProps) {
  const [teamId, setTeamId] = useState<number | ''>('');
  const [teamName, setTeamName] = useState('');
  const [namesOpen, setNamesOpen] = useState(initialNamesOpen);
  const [draftNames, setDraftNames] = useState<Record<number, string>>({});
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
      setTeamName(shown.teams.find((t) => t.team_id === shown.opponent_team_id)?.name ?? '');
      setPlayers(shown.players);
      setDraftNames(Object.fromEntries(shown.teams.map((t) => [t.team_id, t.name ?? ''])));
    }
  }
  const nameOf = (id: number | '') => (id === '' ? '' : (shown?.teams.find((t) => t.team_id === id)?.name ?? ''));

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
      teamName.trim() !== nameOf(teamId) ||
      names.length > 0 ||
      players.map((p) => p.player_id).join() !== shown.players.map((p) => p.player_id).join());

  const save = () => {
    if (teamId === '') return;
    setSaving(true);
    setSaveError(null);
    const renamed = teamName.trim() !== nameOf(teamId);
    onSave({ team_id: teamId, player_ids: players.map((p) => p.player_id), names, ...(renamed ? { team_name: teamName.trim() } : {}) }).then(
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
            onChange={(e) => {
              const id = e.target.value === '' ? '' : Number(e.target.value);
              setTeamId(id);
              setTeamName(nameOf(id));
            }}
          >
            {shown.teams.map((t) => (
              <MenuItem key={t.team_id} value={t.team_id}>
                {t.label}
              </MenuItem>
            ))}
          </TextField>
          {teamId !== '' && (
            <TextField
              fullWidth
              label="Team name"
              placeholder={`Team ${teamId}`}
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 40 } }}
              helperText="Register or rename this team; saved with the roster."
              sx={{ mt: 1.5 }}
            />
          )}
          <Button onClick={() => setNamesOpen(true)} sx={{ mt: 1 }}>
            Name all teams
          </Button>
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
  const saveNames = () => {
    if (!shown) return;
    const teams = shown.teams
      .filter((t) => (draftNames[t.team_id] ?? '').trim() !== (t.name ?? ''))
      .map((t) => ({ team_id: t.team_id, name: (draftNames[t.team_id] ?? '').trim() || null }));
    if (teams.length === 0) {
      setNamesOpen(false);
      return;
    }
    setSaving(true);
    setSaveError(null);
    onSaveNames({ teams }).then(
      (r) => {
        setResult({ ...r, players: shown.players, unmatched: [] });
        setNamesOpen(false);
        setSaving(false);
      },
      (e: unknown) => {
        setSaveError(e instanceof Error ? e.message : 'Saving the names failed');
        setSaving(false);
      },
    );
  };
  return (
    <>
      <SeasonShell tab="research" onTabChange={onTabChange} header={header} footer={footer}>
        {body}
      </SeasonShell>
      {shown && (
        <Dialog open={namesOpen} onClose={() => setNamesOpen(false)} fullWidth maxWidth="xs" scroll="paper">
          <DialogTitle>Name the teams in your league</DialogTitle>
          <DialogContent dividers>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
              Names only, so you can pick opponents by name. Leave one blank to clear it.
            </Typography>
            <Stack spacing={1.25}>
              {shown.teams.map((t) => (
                <TextField
                  key={t.team_id}
                  size="small"
                  label={`Team ${t.team_id}`}
                  value={draftNames[t.team_id] ?? ''}
                  onChange={(e) => setDraftNames((d) => ({ ...d, [t.team_id]: e.target.value }))}
                  slotProps={{ htmlInput: { maxLength: 40 } }}
                />
              ))}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setNamesOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={saveNames} disabled={saving}>
              Save names
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
