import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import QueryStatsOutlinedIcon from '@mui/icons-material/QueryStatsOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import type { NoteKind, NotesResponse, SystemNote } from '../../../api/system';
import { MarkdownText } from './MarkdownText';

export interface UpdatesViewProps {
  notes: NotesResponse | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const KIND: Record<NoteKind, { label: string; Icon: typeof CampaignOutlinedIcon }> = {
  update: { label: 'Update', Icon: CampaignOutlinedIcon },
  finding: { label: 'Finding', Icon: QueryStatsOutlinedIcon },
  recommendation: { label: 'Recommendation', Icon: LightbulbOutlinedIcon },
  warning: { label: 'Warning', Icon: WarningAmberOutlinedIcon },
};

function NoteCard({ note }: { note: SystemNote }) {
  const k = KIND[note.kind] ?? KIND.update;
  const warn = note.kind === 'warning';
  return (
    <Card component="article" sx={[{ p: 1.5 }, warn && { borderColor: 'warning.main', borderWidth: 2 }]} aria-label={`${k.label}: ${note.title}`}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <k.Icon sx={{ fontSize: 18, color: warn ? 'warning.main' : 'text.secondary' }} aria-hidden />
        <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.4, flex: 1 }}>
          {k.label}
        </Typography>
        <Typography variant="caption" className="tabular" sx={{ color: 'text.secondary' }}>
          {note.date}
        </Typography>
      </Stack>
      <Typography variant="subtitle2" component="h3" sx={{ mb: 0.5 }}>
        {note.title}
      </Typography>
      <MarkdownText source={note.body} />
      {note.refs.length > 0 && (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 1 }} aria-label="References">
          {note.refs.map((r) => (
            <Box key={r} component="code" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, px: 0.75, py: 0.25, borderRadius: 1, border: 1, borderColor: 'divider', color: 'text.secondary', overflowWrap: 'anywhere' }}>
              {r}
            </Box>
          ))}
        </Stack>
      )}
    </Card>
  );
}

/** Updates from Claude, newest first: one card per note with kind icon + label, safe markdown. */
export function UpdatesView({ notes, loading, error, onRetry }: UpdatesViewProps) {
  if (!notes) {
    if (error) {
      return (
        <Alert severity="error" action={onRetry && <Button color="inherit" onClick={onRetry}>Retry</Button>}>
          Updates unavailable: {error}
        </Alert>
      );
    }
    return (
      <Stack spacing={1} aria-busy={loading ? 'true' : undefined} aria-label="Loading updates">
        <Skeleton variant="rounded" height={120} />
        <Skeleton variant="rounded" height={120} />
      </Stack>
    );
  }
  if (notes.notes.length === 0) {
    return (
      <Card sx={{ p: 2 }}>
        <Typography variant="subtitle2">No updates yet</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Notes from Claude about the engine, findings and recommendations appear here.
        </Typography>
      </Card>
    );
  }
  return (
    <Stack spacing={1.25}>
      {error && (
        <Alert severity="error" action={onRetry && <Button color="inherit" onClick={onRetry}>Retry</Button>}>
          Refresh failed ({error}). Showing the last result.
        </Alert>
      )}
      {notes.notes.map((n) => (
        <NoteCard key={n.id} note={n} />
      ))}
    </Stack>
  );
}
