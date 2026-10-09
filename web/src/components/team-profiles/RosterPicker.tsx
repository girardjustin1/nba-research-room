import { useEffect, useRef, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import type { PlayerRef, RosterOwner } from '../../api/season';
import { PlayerLine } from '../foundations/PlayerLine';

export interface RosterPickerProps {
  /** Card title; the player count is appended. */
  title: string;
  players: PlayerRef[];
  onPlayersChange: (players: PlayerRef[]) => void;
  /** Owner given to players added here. */
  owner: RosterOwner;
  /** Pasted names, one per line (sent to the server, which matches them). */
  paste: string;
  onPasteChange: (text: string) => void;
  pasting: boolean;
  onPastingChange: (open: boolean) => void;
  /** NBA players matching the text (the server's player search). */
  onSearch: (q: string) => Promise<PlayerRef[]>;
  onOpenPlayer?: (p: PlayerRef) => void;
  /** Extra control on a player's row, before the remove button (e.g. an IL toggle). */
  extra?: (p: PlayerRef) => ReactNode;
  /** Shown above the list, e.g. "13 of 14". */
  countLabel?: string;
}

/**
 * Pick a roster from the NBA list: search to add, remove from the list, or paste names one per
 * line. Shared by This week's opponent and My roster.
 */
export function RosterPicker({
  title,
  players,
  onPlayersChange,
  owner,
  paste,
  onPasteChange,
  pasting,
  onPastingChange,
  onSearch,
  onOpenPlayer,
  extra,
  countLabel,
}: RosterPickerProps) {
  const [options, setOptions] = useState<PlayerRef[]>([]);
  const [query, setQuery] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  return (
    <Card sx={{ p: 1.5 }}>
      <Typography variant="subtitle2" component="h2" sx={{ mb: 1 }}>
        {title} ({countLabel ?? players.length})
      </Typography>
      <Autocomplete<PlayerRef, false, false, false>
        options={searching ? options.filter((o) => !players.some((p) => p.player_id === o.player_id)) : []}
        getOptionLabel={(o) => `${o.name} · ${o.team_abbr ?? '—'}`}
        filterOptions={(x) => x}
        inputValue={query}
        onInputChange={(_e, v, reason) => setQuery(reason === 'reset' || reason === 'selectOption' ? '' : v)}
        value={null}
        onChange={(_e, v) => {
          if (v) onPlayersChange([...players, { ...v, owner }]);
        }}
        noOptionsText={searching ? 'No NBA player by that name' : 'Type at least 2 letters'}
        renderInput={(params) => <TextField {...params} label="Add a player" placeholder="Search the NBA list" />}
      />
      <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', m: 0, mt: 1, p: 0 }}>
        {players.map((p) => (
          <Box component="li" key={p.player_id}>
            <PlayerLine
              player={p}
              onOpen={onOpenPlayer}
              trailing={
                <>
                  {extra?.(p)}
                  <IconButton
                    aria-label={`Remove ${p.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayersChange(players.filter((x) => x.player_id !== p.player_id));
                    }}
                    sx={{ width: 44, height: 44 }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </>
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
          onChange={(e) => onPasteChange(e.target.value)}
          sx={{ mt: 1.5 }}
        />
      ) : (
        <Button onClick={() => onPastingChange(true)} sx={{ mt: 1 }}>
          Paste a list of names
        </Button>
      )}
    </Card>
  );
}

/** Pasted names that matched no NBA player, with suggestions. */
export function UnmatchedNames({ unmatched }: { unmatched: { name: string; suggestions: string[] }[] }) {
  if (unmatched.length === 0) return null;
  return (
    <Alert severity="warning">
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {unmatched.length === 1 ? "1 name didn't match an NBA player" : `${unmatched.length} names didn't match an NBA player`}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {unmatched.map((u) => (
          <Typography component="li" variant="body2" key={u.name}>
            {u.name}
            {u.suggestions.length > 0 ? ` (did you mean ${u.suggestions.join(', ')}?)` : ''}
          </Typography>
        ))}
      </Box>
    </Alert>
  );
}
