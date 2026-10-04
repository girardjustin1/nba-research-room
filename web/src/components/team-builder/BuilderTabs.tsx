import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

export type BuilderView = 'lineup' | 'moves' | 'pickups';

/** Team Builder sub-navigation under the Team tab. */
export function BuilderTabs({ value, onChange }: { value: BuilderView; onChange?: (v: BuilderView) => void }) {
  return (
    <ToggleButtonGroup
      exclusive
      fullWidth
      size="small"
      value={value}
      onChange={(_, v: BuilderView | null) => v && onChange?.(v)}
      aria-label="Team builder section"
      sx={{ mb: 1.5 }}
    >
      <ToggleButton value="lineup">Lineup</ToggleButton>
      <ToggleButton value="moves">Moves</ToggleButton>
      <ToggleButton value="pickups">Pickups</ToggleButton>
    </ToggleButtonGroup>
  );
}
