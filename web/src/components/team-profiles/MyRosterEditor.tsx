import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { MyRoster, MyRosterRequest, PlayerRef } from '../../api/season';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { ErrorState, LoadingState } from '../foundations/ScreenStates';
import { RosterPicker, UnmatchedNames } from './RosterPicker';

export interface MyRosterEditorProps {
  data: MyRoster | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSearch: (q: string) => Promise<PlayerRef[]>;
  /** Replace my roster; resolves with the saved roster (unmatched names included). */
  onSave: (body: MyRosterRequest) => Promise<MyRoster>;
  onOpenPlayer?: (p: PlayerRef) => void;
  onTabChange?: (tab: SeasonTab) => void;
}

const fmtSaved = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * My roster, entered by hand, for when Yahoo doesn't supply it: players from the NBA list (search
 * or pasted names) and who is on the IL. Kept on this computer only, replaced on each save.
 */
export function MyRosterEditor({ data, loading, error, onRetry, onSearch, onSave, onOpenPlayer, onTabChange }: MyRosterEditorProps) {
  const [players, setPlayers] = useState<PlayerRef[]>([]);
  const [il, setIl] = useState<number[]>([]);
  const [paste, setPaste] = useState('');
  const [pasting, setPasting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<MyRoster | null>(null);

  const shown = result ?? data;
  const [seen, setSeen] = useState<MyRoster | null>(null);
  if (shown !== seen) {
    setSeen(shown);
    if (shown) {
      setPlayers(shown.players);
      setIl(shown.il_ids);
    }
  }

  const names = useMemo(() => paste.split('\n').map((s) => s.trim()).filter(Boolean), [paste]);
  const ids = players.map((p) => p.player_id);
  const ilNow = il.filter((i) => ids.includes(i));
  const changed =
    shown != null &&
    (names.length > 0 ||
      ids.join() !== shown.players.map((p) => p.player_id).join() ||
      [...ilNow].sort().join() !== [...shown.il_ids].sort().join());
  const tooMany = shown != null && players.length > shown.max_players;

  const save = () => {
    setSaving(true);
    setSaveError(null);
    onSave({ player_ids: ids, names, il_ids: ilNow }).then(
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

  const header = (
    <ScreenHeader
      title="My roster"
      subtitle={shown ? `${players.length} of ${shown.max_players} players${ilNow.length ? ` · ${ilNow.length} on IL` : ''}` : undefined}
    />
  );
  let body;
  if (error && !shown) body = <ErrorState message={error} onRetry={onRetry} what="your roster" />;
  else if (!shown) body = <LoadingState blocks={[300, 120]} label={loading ? 'Loading your roster' : 'Loading'} />;
  else {
    body = (
      <Stack spacing={1.5}>
        <UnmatchedNames unmatched={shown.unmatched} />
        {saveError && <Alert severity="error">{saveError}</Alert>}
        {tooMany && <Alert severity="error">A roster holds at most {shown.max_players} players: remove {players.length - shown.max_players}.</Alert>}
        <RosterPicker
          title="Your players"
          countLabel={`${players.length} of ${shown.max_players}`}
          players={players}
          onPlayersChange={setPlayers}
          owner="mine"
          paste={paste}
          onPasteChange={setPaste}
          pasting={pasting}
          onPastingChange={setPasting}
          onSearch={onSearch}
          onOpenPlayer={onOpenPlayer}
          extra={(p) => {
            const on = il.includes(p.player_id);
            return (
              <Chip
                label="IL"
                size="small"
                color={on ? 'warning' : 'default'}
                variant={on ? 'filled' : 'outlined'}
                aria-pressed={on}
                aria-label={`${p.name} on IL`}
                onClick={(e) => {
                  e.stopPropagation();
                  setIl((xs) => (on ? xs.filter((x) => x !== p.player_id) : [...xs, p.player_id]));
                }}
                sx={{ mr: 0.5 }}
              />
            );
          }}
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
          {shown.saved_at ? `Saved ${fmtSaved(shown.saved_at)}` : 'Not saved yet'}
        </Typography>
        <Button variant="contained" onClick={save} disabled={!changed || saving || tooMany}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Box>
    ) : undefined;
  return (
    <SeasonShell tab="builder" onTabChange={onTabChange} header={header} footer={footer}>
      {body}
    </SeasonShell>
  );
}
