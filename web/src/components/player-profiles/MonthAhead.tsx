import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { TeamDaysResponse, TeamWeeksResponse } from '../../api/season';
import { HeatCalendar, HeatCalendarGrid, HeatCalendarHeader, HeatCalendarLegend, HeatCalendarSheet } from '../foundations/HeatCalendar';
import { addDays } from '../foundations/seasonFormat';
import { teamDaysToHeatDays, type Perspective } from './calendarAdapter';

export interface MonthAheadProps {
  days: TeamDaysResponse;
  weeks: TeamWeeksResponse;
  today: string;
  /** How many days ahead to show (about a month). */
  span?: number;
  perspective?: Perspective;
  /** Open this day's sheet on mount (stories). */
  openDate?: string | null;
}

/**
 * His team's next ~30 days as a calendar of game days (implemented /schedule/team_days and
 * /schedule/team_weeks): green ▲ game days for my player (red for an opponent's), empty
 * no-game days, back-to-backs (••), light days (○), 4-game weeks underlined, playoff weeks
 * marked. Tap a day for the sheet.
 */
export function MonthAhead({ days, weeks, today, span = 30, perspective = 'mine', openDate = null }: MonthAheadProps) {
  const to = addDays(today, span - 1);
  const cells = useMemo(() => teamDaysToHeatDays(days, weeks, today, to, today, perspective), [days, weeks, today, to, perspective]);
  const inRange = days.days.filter((d) => d.date >= today && d.date <= to);
  const months = [...new Set(cells.filter((c) => c.date >= today && c.date <= to).map((c) => c.date.slice(0, 7)))];
  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {days.team}: {inRange.length} games in the next {span} days · {inRange.filter((d) => d.back_to_back).length} back-to-backs ·{' '}
        {inRange.filter((d) => d.light_day).length} on light days
      </Typography>
      {months.map((m) => (
        <Box key={m} sx={{ mb: 1.5 }}>
          <HeatCalendar
            days={cells}
            view="month"
            anchor={`${m}-01`}
            title={new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
            scale={{ kind: 'binary', min: 0, max: 1, label: '', lowLabel: '', highLabel: '', format: String }}
            initialSelected={openDate && openDate.startsWith(m) ? openDate : null}
            initialSheetOpen={!!openDate && openDate.startsWith(m)}
          >
            <HeatCalendarHeader />
            <HeatCalendarGrid />
            <HeatCalendarSheet />
            {m === months[months.length - 1] && <HeatCalendarLegend />}
          </HeatCalendar>
        </Box>
      ))}
    </Box>
  );
}
