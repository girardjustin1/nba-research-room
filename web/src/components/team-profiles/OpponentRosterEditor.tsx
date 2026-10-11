import { useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import type { OpponentRoster, OpponentRosterRequest, OpponentScreenshot, PlayerRef, TeamNamesRequest } from '../../api/season';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { RosterPicker, UnmatchedNames } from './RosterPicker';
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
  /** Read a screenshot of his roster (a data: URL); fills the form to check, saves nothing. Without
   * it, the screenshot card is hidden. */
  onScreenshot?: (imageBase64: string) => Promise<OpponentScreenshot>;
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
  onScreenshot,
}: OpponentRosterEditorProps) {
  const [teamId, setTeamId] = useState<number | ''>('');
  const [teamName, setTeamName] = useState('');
  const [namesOpen, setNamesOpen] = useState(initialNamesOpen);
  const [draftNames, setDraftNames] = useState<Record<number, string>>({});
  const [players, setPlayers] = useState<PlayerRef[]>([]);
  const [paste, setPaste] = useState('');
  const [pasting, setPasting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<OpponentRoster | null>(null);

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
  // A screenshot of his roster, read on this Mac: fills the team and players for a check.
  const [reading, setReading] = useState(false);
  const [shot, setShot] = useState<{ ok: OpponentScreenshot | null; error: string | null }>({ ok: null, error: null });
  const fileInput = useRef<HTMLInputElement>(null);
  const readShot = (file: File) => {
    if (!onScreenshot) return;
    if (!file.type.startsWith('image/')) {
      setShot({ ok: null, error: "That file isn't an image." });
      return;
    }
    setReading(true);
    setShot({ ok: null, error: null });
    const reader = new FileReader();
    reader.onload = () => {
      onScreenshot(String(reader.result)).then(
        (r) => {
          if (r.team_id != null) {
            setTeamId(r.team_id);
            setTeamName(r.team_name ?? '');
          }
          setPlayers(r.players);
          setShot({ ok: r, error: null });
          setReading(false);
        },
        (e: unknown) => {
          setShot({ ok: null, error: e instanceof Error ? e.message : 'Reading the screenshot failed' });
          setReading(false);
        },
      );
    };
    reader.onerror = () => {
      setShot({ ok: null, error: "That image couldn't be opened." });
      setReading(false);
    };
    reader.readAsDataURL(file);
  };
  // ⌘V with a screenshot on the clipboard reads it, anywhere on this screen.
  const readShotRef = useRef(readShot);
  useEffect(() => {
    readShotRef.current = readShot;
  });
  useEffect(() => {
    if (!onScreenshot) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        readShotRef.current(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onScreenshot]);
  const nameOf = (id: number | '') => (id === '' ? '' : (shown?.teams.find((t) => t.team_id === id)?.name ?? ''));


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
        <UnmatchedNames unmatched={shown.unmatched} />
        {saveError && <Alert severity="error">{saveError}</Alert>}
        {onScreenshot && (
          <Card sx={{ p: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" component="h2">
                  From a screenshot
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Screenshot their roster in Yahoo, then choose it or paste it here (⌘V).
                </Typography>
              </Box>
              <Button
                variant="outlined"
                startIcon={<ImageOutlinedIcon />}
                onClick={() => fileInput.current?.click()}
                disabled={reading}
              >
                {reading ? 'Reading…' : 'Choose'}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                hidden
                aria-label="Screenshot of their roster"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) readShot(f);
                  e.target.value = '';
                }}
              />
            </Box>
            {shot.error && (
              <Alert severity="error" sx={{ mt: 1.25 }}>
                {shot.error}
              </Alert>
            )}
            {shot.ok && (
              <Alert severity={shot.ok.players.length ? 'success' : 'warning'} sx={{ mt: 1.25 }}>
                {shot.ok.players.length
                  ? `Read ${shot.ok.players.length} players${shot.ok.team_name ? ` for ${shot.ok.team_name}` : ''}${
                      shot.ok.skipped_mine ? ` (left out ${shot.ok.skipped_mine} of yours)` : ''
                    }. Check them${shot.ok.team_id == null ? ', choose the team' : ''}, then Save.`
                  : 'No NBA player names found in that screenshot.'}
                {shot.ok.too_many && ' More players than a roster holds: only the first were kept.'}
                {shot.ok.ambiguous.length > 0 && ` Skipped ${shot.ok.ambiguous.join(', ')} (shared by two players): add him by search.`}
                <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                  {shot.ok.policy}
                </Typography>
              </Alert>
            )}
          </Card>
        )}
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

        <RosterPicker
          title="Their players"
          players={players}
          onPlayersChange={setPlayers}
          owner="opponent"
          paste={paste}
          onPasteChange={setPaste}
          pasting={pasting}
          onPastingChange={setPasting}
          onSearch={onSearch}
          onOpenPlayer={onOpenPlayer}
        />


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
