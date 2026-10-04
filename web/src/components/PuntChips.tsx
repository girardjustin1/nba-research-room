import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import BlockIcon from '@mui/icons-material/Block';
import type { Category } from '../api/types';

export interface PuntChipsProps {
  categories: Category[];
  value: string[];
  onChange: (punts: string[]) => void;
  disabled?: boolean;
}

/** Toggle chips for punted categories. Selected chips show an icon and "punt", not just a fill. */
export function PuntChips({ categories, value, onChange, disabled }: PuntChipsProps) {
  const toggle = (key: string) =>
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  return (
    <Box role="group" aria-label="Punt categories">
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {categories.map((c) => {
          const on = value.includes(c.key);
          return (
            <Chip
              key={c.key}
              label={on ? `${c.label} · punt` : c.label}
              icon={on ? <BlockIcon /> : undefined}
              color={on ? 'primary' : 'default'}
              variant={on ? 'filled' : 'outlined'}
              onClick={() => toggle(c.key)}
              disabled={disabled}
              aria-pressed={on}
              sx={{ height: 44, borderRadius: 22, px: 0.5, fontSize: 15 }}
            />
          );
        })}
      </Box>
      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 1 }}>
        {value.length ? `Punting ${value.length}. ` : 'No punts. '}
        The engine re-values every player when this changes.
      </Typography>
    </Box>
  );
}
