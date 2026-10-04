import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { CalendarMetric, IsoDate, PlayerCalendarResponse } from '../../api/season';
import { HeatCalendar, HeatCalendarGrid, HeatCalendarHeader, HeatCalendarLegend, HeatCalendarSheet } from '../foundations/HeatCalendar';
import { EmptyState } from '../foundations/ScreenStates';
import { calendarToHeatDays, scaleFor, type Perspective } from './calendarAdapter';

export interface PlayerHeatCalendarProps {
  calendar: PlayerCalendarResponse;
  /** The current fantasy week number, for "games left this week". */
  currentWeek: number | null;
  initialView?: 'week' | 'month';
  initialMetric?: CalendarMetric;
  /** Week view shows the Mon–Sun week containing this date (defaults to today). */
  anchor?: IsoDate;
  initialDisplay?: 'grid' | 'table';
  /** Whose player: colors missed games red for mine, green for an opponent's. */
  perspective?: Perspective;
  /** Open this day's sheet on mount (stories). */
  openDate?: IsoDate | null;
  /** Links from a day's sheet to Player Profile sections. */
  onOpenSection?: (section: 'projection' | 'minutes' | 'opponents' | 'news') => void;
}

/**
 * The player's game calendar: week or month, colored by one metric. Past days come from
 * game_logs, future days are projections (mean ± sd), states from overrides/injuries.
 */
export function PlayerHeatCalendar({ calendar, currentWeek, initialView = 'week', initialMetric = 'value', anchor, initialDisplay, perspective = 'mine', openDate, onOpenSection }: PlayerHeatCalendarProps) {
  const [view, setView] = useState<'week' | 'month'>(initialView);
  const [metric, setMetric] = useState<CalendarMetric>(initialMetric);
  const opt = calendar.metric_options.find((o) => o.key === metric) ?? calendar.metric_options[0]!;
  const days = useMemo(() => calendarToHeatDays(calendar, opt.key, currentWeek, perspective), [calendar, opt.key, currentWeek, perspective]);
  const scale = scaleFor(opt);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v: 'week' | 'month' | null) => v && setView(v)} aria-label="Calendar range">
          <ToggleButton value="week" sx={{ px: 1.75 }}>
            Week
          </ToggleButton>
          <ToggleButton value="month" sx={{ px: 1.75 }}>
            Month
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'right' }}>
          {calendar.games_left_this_week} game{calendar.games_left_this_week === 1 ? '' : 's'} left this week
        </Typography>
      </Box>
      <Box role="group" aria-label="Metric" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.25 }}>
        {calendar.metric_options.map((o) => (
          <Chip
            key={o.key}
            label={o.label}
            onClick={() => setMetric(o.key)}
            color={o.key === metric ? 'primary' : 'default'}
            variant={o.key === metric ? 'filled' : 'outlined'}
            aria-pressed={o.key === metric}
            sx={{ height: 36, borderRadius: 18 }}
          />
        ))}
      </Box>
      {calendar.days.length === 0 ? (
        <EmptyState title="No games in this range">The engine has no game log or schedule for these dates.</EmptyState>
      ) : (
        <HeatCalendar
          key={`${view}-${metric}`}
          days={days}
          view={view}
          scale={scale}
          anchor={anchor ?? calendar.today}
          title={`${opt.label} by game`}
          initialDisplay={initialDisplay}
          initialSelected={openDate ?? null}
          initialSheetOpen={openDate != null}
          actionsFor={
            onOpenSection
              ? (d) => [
                  ...(d.state === 'scheduled' ? [{ label: 'See the projection', onClick: () => onOpenSection('projection') }] : []),
                  ...(d.state === 'played' || d.state === 'scheduled' ? [{ label: 'Minutes trend', onClick: () => onOpenSection('minutes') }] : []),
                  ...(d.state !== 'no_game' ? [{ label: 'Opponent context', onClick: () => onOpenSection('opponents') }] : []),
                  ...(d.state === 'out' || d.state === 'dnp' ? [{ label: 'News and status', onClick: () => onOpenSection('news') }] : []),
                ]
              : undefined
          }
        >
          <HeatCalendarHeader subtitle={view === 'week' ? 'This fantasy week, Mon–Sun' : 'This month, Monday first'} />
          <HeatCalendarGrid />
          <HeatCalendarLegend />
          <HeatCalendarSheet />
        </HeatCalendar>
      )}
    </Box>
  );
}
