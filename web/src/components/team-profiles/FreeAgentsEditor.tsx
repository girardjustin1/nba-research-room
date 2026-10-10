import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { FreeAgents, FreeAgentsRequest, PlayerRef } from '../../api/season';
import { PlayerLine } from '../foundations/PlayerLine';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { ErrorState, LoadingState } from '../foundations/ScreenStates';

export interface FreeAgentsEditorProps {
  data: FreeAgents | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Replace the list with the players found in the text; resolves with the saved list. */
  onSave: (body: FreeAgentsRequest) => Promise<FreeAgents>;
  onOpenPlayer?: (p: PlayerRef) => void;
  onTabChange?: (tab: SeasonTab) => void;
  /** Stories: open with this text already pasted. */
  initialText?: string;
}

/** Older than this, the page suggests a fresh paste (other teams add and drop every day). */
export const STALE_HOURS = 24;
const SHOWN = 40;

const fmtSaved = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtAge = (h: number) => (h < 1 ? 'just now' : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`);

/**
 * Free agents, pasted from Yahoo's Players page, for when the app can't read Yahoo: the moves
 * page suggests adds from this list. The engine picks the NBA names out of the paste and keeps only
 * those players (not the text), on this computer, replaced by the next paste.
 */
export function FreeAgentsEditor({
  data,
  loading,
  error,
  onRetry,
  onSave,
  onOpenPlayer,
  onTabChange,
  initialText = '',
}: FreeAgentsEditorProps) {
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<FreeAgents | null>(null);
  const shown = result ?? data;

  const save = () => {
    setSaving(true);
    setSaveError(null);
    onSave({ text }).then(
      (r) => {
        setResult(r);
        setText('');
        setSaving(false);
      },
      (e: unknown) => {
        setSaveError(e instanceof Error ? e.message : 'Saving failed');
        setSaving(false);
      },
    );
  };

  const n = shown?.players.length ?? 0;
  const header = (
    <ScreenHeader
      title="Free agents"
      subtitle={shown ? (shown.saved_at ? `${n} players · pasted ${fmtAge(shown.age_hours ?? 0)}` : 'Not pasted yet') : undefined}
    />
  );
  let body;
  if (error && !shown) body = <ErrorState message={error} onRetry={onRetry} what="the free agents" />;
  else if (!shown) body = <LoadingState blocks={[160, 300]} label={loading ? 'Loading the free agents' : 'Loading'} />;
  else {
    const stale = shown.saved_at != null && (shown.age_hours ?? 0) > STALE_HOURS;
    body = (
      <Stack spacing={1.5}>
        {saveError && <Alert severity="error">{saveError}</Alert>}
        {stale && (
          <Alert severity="warning">
            Pasted {fmtAge(shown.age_hours ?? 0)}: other teams have added and dropped since. Paste a fresh list for current
            suggestions.
          </Alert>
        )}
        {shown.ambiguous.length > 0 && (
          <Alert severity="info">
            Skipped {shown.ambiguous.length === 1 ? 'a name' : `${shown.ambiguous.length} names`} shared by two NBA players (
            {shown.ambiguous.join(', ')}): add that player from his profile instead.
          </Alert>
        )}
        <Card sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" component="h2" sx={{ mb: 0.5 }}>
            Paste from Yahoo
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.25 }}>
            On Yahoo, open Players with Status “All Available Players”, select the list and copy it. Paste here; for more than
            one page, paste each page below the last before saving. Only player names are picked out.
          </Typography>
          <TextField
            multiline
            minRows={5}
            maxRows={12}
            fullWidth
            label="Yahoo's Players page"
            value={text}
            onChange={(e) => setText(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 300_000 } }}
          />
        </Card>
        {n > 0 && (
          <Card sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" component="h2" sx={{ mb: 1 }}>
              Found ({n})
            </Typography>
            <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {shown.players.slice(0, SHOWN).map((p) => (
                <Box component="li" key={p.player_id}>
                  <PlayerLine player={p} onOpen={onOpenPlayer} />
                </Box>
              ))}
            </Stack>
            {n > SHOWN && (
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 1 }}>
                and {n - SHOWN} more
              </Typography>
            )}
          </Card>
        )}
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
          {shown.saved_at ? `Saved ${fmtSaved(shown.saved_at)}` : 'Nothing pasted yet'}
        </Typography>
        <Button variant="contained" onClick={save} disabled={!text.trim() || saving}>
          {saving ? 'Saving…' : 'Save list'}
        </Button>
      </Box>
    ) : undefined;
  return (
    <SeasonShell tab="builder" onTabChange={onTabChange} header={header} footer={footer}>
      {body}
    </SeasonShell>
  );
}
