import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { GROUP_COLORS, GROUP_LABEL, type PositionGroup } from '../../../lib/positions';
import { FOR_ME, forMeColor, forMeSymbol, STATUS, STATUS_VS_FORME, VIZ } from '../../../theme/viz';

type Mode = 'light' | 'dark';
const INK = { light: { primary: '#0b0b0b', secondary: '#52514e' }, dark: { primary: '#ffffff', secondary: '#c3c2b7' } };

function Swatch({ hex, label, mode }: { hex: string; label: string; mode: Mode }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Box sx={{ width: 28, height: 28, borderRadius: 1, bgcolor: hex, flexShrink: 0 }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" component="p" sx={{ color: INK[mode].primary, fontWeight: 600 }} noWrap>{label}</Typography>
        <Typography variant="caption" component="p" sx={{ color: INK[mode].secondary, fontFamily: 'ui-monospace, monospace' }}>{hex}</Typography>
      </Box>
    </Stack>
  );
}

/** Each mode on its own surface, side by side, independent of the toolbar mode. */
function Pane({ mode, children }: { mode: Mode; children: React.ReactNode }) {
  return (
    <Box sx={{ flex: 1, minWidth: 0, p: 1.5, borderRadius: 2, bgcolor: VIZ[mode].surface, border: 1, borderColor: mode === 'light' ? 'rgba(11,11,11,0.1)' : 'rgba(255,255,255,0.1)' }}>
      <Typography variant="overline" sx={{ color: INK[mode].secondary }}>{mode}</Typography>
      <Stack spacing={1}>{children}</Stack>
    </Box>
  );
}

function Frame({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)', bgcolor: 'background.default', minHeight: '100dvh' }}>
      <Typography variant="subtitle1" component="h1">{title}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>{note}</Typography>
      {children}
    </Box>
  );
}

function ForMeStory() {
  const values = [-3, -2, -1, 0, 1, 2, 3];
  return (
    <Frame
      title="For me"
      note="Green helps me win, red hurts me, gray is no effect, always from my side (an opponent's extra game is red). Every mark also carries ▲/▼/● and words."
    >
      <Stack direction="row" spacing={1}>
        {(['light', 'dark'] as Mode[]).map((m) => (
          <Pane key={m} mode={m}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }} aria-label={`${m} ramp, bad to good`}>
              {values.map((v) => (
                <Box key={v} sx={{ height: 34, borderRadius: 1, bgcolor: forMeColor(v, { min: -3, max: 3 }, m), display: 'grid', placeItems: 'center' }}>
                  <Typography variant="caption" sx={{ color: m === 'light' ? '#0b0b0b' : '#ffffff', fontWeight: 700 }}>{forMeSymbol(v)}</Typography>
                </Box>
              ))}
            </Box>
            <Swatch hex={FOR_ME[m].good} label="good (pole)" mode={m} />
            <Swatch hex={FOR_ME[m].bad} label="bad (pole)" mode={m} />
            <Swatch hex={FOR_ME[m].neutral} label="neutral" mode={m} />
            <Typography variant="caption" sx={{ color: INK[m].secondary }}>
              {m === 'light' ? 'Poles CVD ΔE 8.0, normal 26.5. Arms pass --ordinal (light ends 2.15:1, 2.11:1).' : 'Poles CVD ΔE 9.1, normal 27.1. Arms pass --ordinal (ends 2.95:1, 2.82:1).'}
            </Typography>
          </Pane>
        ))}
      </Stack>
    </Frame>
  );
}

function StatusStory() {
  return (
    <Frame title="Status vs for me" note="Status colors are reserved for state and always ship with an icon and a label. Error moved off forMe bad so a red cell never reads as an alert.">
      <Stack direction="row" spacing={1}>
        {(['light', 'dark'] as Mode[]).map((m) => (
          <Pane key={m} mode={m}>
            <Swatch hex={STATUS[m].error} label="status error" mode={m} />
            <Swatch hex={FOR_ME[m].bad} label="forMe bad" mode={m} />
            <Typography variant="caption" sx={{ color: INK[m].primary, fontWeight: 700 }}>
              ΔE error↔bad {STATUS_VS_FORME[m].errorVsBad} (≥ 15)
            </Typography>
            <Swatch hex={STATUS[m].warning} label="status warning" mode={m} />
            <Swatch hex={STATUS[m].success} label="status success" mode={m} />
            <Typography variant="caption" sx={{ color: INK[m].secondary }}>
              error↔good {STATUS_VS_FORME[m].errorVsGood} · ↔warning {STATUS_VS_FORME[m].errorVsWarning} · ↔success {STATUS_VS_FORME[m].errorVsSuccess}
              {m === 'light' ? ` · old #d03b3b↔bad ${STATUS_VS_FORME.light.oldErrorVsBad}` : ''}
            </Typography>
          </Pane>
        ))}
      </Stack>
    </Frame>
  );
}

function PositionStory() {
  return (
    <Frame title="Position groups" note="Draft grid and VOR bars color by group, not position: three hues pass all-pairs in both modes, five do not. The label always names the exact position.">
      <Stack direction="row" spacing={1}>
        {(['light', 'dark'] as Mode[]).map((m) => (
          <Pane key={m} mode={m}>
            {(Object.keys(GROUP_LABEL) as PositionGroup[]).map((g) => (
              <Swatch key={g} hex={GROUP_COLORS[m][g]} label={GROUP_LABEL[g]} mode={m} />
            ))}
          </Pane>
        ))}
      </Stack>
    </Frame>
  );
}

function ChartTokensStory() {
  const keys = ['pos', 'neutral', 'meterFill', 'meterTrack', 'grid', 'axis', 'muted', 'surface'] as const;
  return (
    <Frame title="Chart tokens" note="Neutral-polarity chart chrome. Text never wears these colors.">
      <Stack direction="row" spacing={1}>
        {(['light', 'dark'] as Mode[]).map((m) => (
          <Pane key={m} mode={m}>
            {keys.map((k) => (
              <Swatch key={k} hex={VIZ[m][k]} label={k} mode={m} />
            ))}
          </Pane>
        ))}
      </Stack>
    </Frame>
  );
}

const meta = { title: 'Foundations/Color', component: ForMeStory } satisfies Meta<typeof ForMeStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ForMe: Story = { name: 'For Me' };
export const Status: Story = { render: () => <StatusStory /> };
export const PositionGroups: Story = { render: () => <PositionStory /> };
export const ChartTokens: Story = { render: () => <ChartTokensStory /> };
