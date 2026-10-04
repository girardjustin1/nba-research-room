import type { Meta, StoryObj } from '@storybook/react-vite';
import Card from '@mui/material/Card';
import type { PlayerCalendarResponse } from '../../api/season';
import { calendarB2BWeek, calendarBramwell, calendarEmpty, calendarPlayoffs, calendarRosswellInjury } from '../../mocks/player-profiles/calendar';
import { HeatCalendar, HeatCalendarGrid, HeatCalendarLegend, HeatCalendarSheet } from '../foundations/HeatCalendar';
import { calendarToHeatDays, scaleFor } from './calendarAdapter';
import { PlayerHeatCalendar } from './PlayerHeatCalendar';

/** Heat calendar: compound MUI-layout component (no Pro heatmap). Invented game logs. */
const meta = {
  title: 'Player Profiles/Heat Calendar',
  component: PlayerHeatCalendar,
  decorators: [
    (Story) => (
      <Card sx={{ m: 2, mt: 'calc(var(--sim-safe-top) + 8px)', p: 1.5 }}>
        <Story />
      </Card>
    ),
  ],
  args: { calendar: calendarBramwell, currentWeek: 4, onOpenSection: () => {} },
} satisfies Meta<typeof PlayerHeatCalendar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Fantasy week Mon–Sun, Value (signed: diverging, gray at 0). */
export const Week: Story = {};
export const Month: Story = { args: { initialView: 'month' } };
/** Unsigned count metric: sequential single-hue ramp. */
export const UnsignedMetric: Story = { args: { initialView: 'month', initialMetric: 'pts' } };
/** Signed metric: FG% volume-weighted impact uses the diverging pair. */
export const SignedMetric: Story = { args: { initialView: 'month', initialMetric: 'fg_pct' } };

const allStates: PlayerCalendarResponse = {
  ...calendarBramwell,
  days: calendarBramwell.days.map((d) =>
    d.date === '2026-11-12' ? { ...d, state: 'out', minutes: null, stats: null, value: null, z: null, status_note: 'Ankle, team PR' } : d,
  ),
};
/** Played (shaded), projected (dashed, italic), DNP (45° hatch + icon), out (135° hatch + icon), no game, light days, B2B, Cup nights, today. */
export const AllStates: Story = { args: { calendar: allStates, initialView: 'month' } };
export const InjuryStretch: Story = { args: { calendar: calendarRosswellInjury, initialView: 'month', initialMetric: 'ast' } };
/** The same stretch for an OPPONENT's player: his missed games help you (green hatch). */
export const OpponentInjuryStretch: Story = { args: { calendar: calendarRosswellInjury, initialView: 'month', perspective: 'opponent' } };
export const InjuryStretchWeek: Story = { args: { calendar: calendarRosswellInjury, anchor: '2026-11-09' } };
export const BackToBackWeek: Story = { args: { calendar: calendarB2BWeek, anchor: '2026-11-16', initialMetric: 'reb' } };
export const PlayoffWeek: Story = { args: { calendar: calendarPlayoffs, currentWeek: 20 } };
export const PlayoffMonth: Story = { args: { calendar: calendarPlayoffs, currentWeek: 20, initialView: 'month' } };
export const EmptyMonth: Story = { args: { calendar: calendarEmpty, initialView: 'month' } };
export const TableView: Story = { args: { initialDisplay: 'table' } };
/** Tapped a played day: the bottom sheet explains it. */
export const OpenSheetPlayed: Story = { args: { initialView: 'month', openDate: '2026-11-10' } };
/** Tapped a projected day (mean ± sd, confidence, open slots). */
export const OpenSheetProjected: Story = { args: { openDate: '2026-11-22' } };
/** Tapped an out day for my player. */
export const OpenSheetOut: Story = { args: { calendar: calendarRosswellInjury, initialView: 'month', openDate: '2026-11-11' } };
export const OpenSheetDark: Story = { args: { openDate: '2026-11-21' }, globals: { colorMode: 'dark' } };
export const DarkMode: Story = { args: { initialView: 'month' }, globals: { colorMode: 'dark' } };

/** Composed from parts: legend first, no header, readout last. */
export const ComposedParts: Story = {
  render: () => {
    const opt = calendarBramwell.metric_options[1]!;
    return (
      <HeatCalendar days={calendarToHeatDays(calendarBramwell, opt.key, 4)} view="week" scale={scaleFor(opt)} anchor="2026-11-18" title="PTS by game">
        <HeatCalendarLegend />
        <HeatCalendarGrid />
        <HeatCalendarSheet />
      </HeatCalendar>
    );
  },
};
