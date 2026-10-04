import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import BlockIcon from '@mui/icons-material/Block';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import LocalHospitalOutlinedIcon from '@mui/icons-material/LocalHospitalOutlined';
import type { IsoDate } from '../../api/season';
import { FOR_ME, forMeSymbol, forMeWord, useResolvedMode, useVizColors } from '../../theme/viz';
import { DetailSheet, type SheetAction, type SheetContent } from './DetailSheet';
import { SEQUENTIAL, binColor, divergingSteps, inkOn, type ScaleKind } from './heatScale';
import { addDays, mondayOf, monthWeeks, shortDate, weekdayOf } from './seasonFormat';

/* ------------------------------------------------------------------ model */

/**
 * What a cell is. "game" = a scheduled team game (certain); "scheduled" = a player's
 * future game shown as a projection (dashed outline); "dnp" and "out" are hatched with an
 * icon; "no_game" is empty.
 */
export type HeatState = 'played' | 'game' | 'scheduled' | 'dnp' | 'out' | 'no_game';

export interface HeatDay {
  date: IsoDate;
  state: HeatState;
  /** Engine value for the chosen metric (projection mean for scheduled days); drives the fill only. */
  value: number | null;
  /** The value as text for the table view (cells never print numbers). */
  tableValue?: string | null;
  markers?: { today?: boolean; light?: boolean; b2b?: boolean; cup?: boolean; playoffs?: boolean; fourGameWeek?: boolean };
  /**
   * Effect on MY week for cells that are not value-shaded: +1 helps me (my player's game
   * day, an opponent's player out), −1 hurts me (my player out / DNP, an opponent's game
   * day), 0 or absent = no effect. Drawn green / red / gray with ▲ ▼.
   */
  effect?: number | null;
  /** What the bottom sheet explains when the cell is tapped. */
  sheet: SheetContent;
}

export interface HeatScaleSpec {
  kind: ScaleKind;
  min: number;
  max: number;
  /** Legend title, e.g. "PTS per game" or "Value (z sum)". */
  label: string;
  lowLabel: string;
  highLabel: string;
  format: (v: number) => string;
}

interface Ctx {
  days: HeatDay[];
  byDate: Map<IsoDate, HeatDay>;
  view: 'week' | 'month';
  scale: HeatScaleSpec;
  start: IsoDate;
  month: string | null;
  selected: IsoDate | null;
  select: (d: IsoDate | null) => void;
  sheetOpen: boolean;
  setSheetOpen: (o: boolean) => void;
  display: 'grid' | 'table';
  setDisplay: (d: 'grid' | 'table') => void;
  title: string;
  actionsFor?: (day: HeatDay) => SheetAction[];
}

const HeatCtx = createContext<Ctx | null>(null);

function useHeat(): Ctx {
  const c = useContext(HeatCtx);
  if (!c) throw new Error('HeatCalendar parts must be inside <HeatCalendar>');
  return c;
}

const WEEKDAY_HEAD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function deadbandOf(scale: HeatScaleSpec): number {
  return scale.kind === 'diverging' ? 0.2 * Math.max(Math.abs(scale.min), Math.abs(scale.max)) : 0;
}

/** The signed "for me" amount behind a cell: its effect, or its value on a diverging scale. */
function forMeAmount(day: HeatDay, scale: HeatScaleSpec): number | null {
  if (day.effect != null && day.effect !== 0) return day.effect;
  if (scale.kind === 'diverging' && day.value != null && (day.state === 'played' || day.state === 'scheduled')) return day.value;
  return null;
}

/* --------------------------------------------------------------- cell look */

function useCellLook() {
  const mode = useResolvedMode();
  const viz = useVizColors();
  const fm = FOR_ME[mode];
  const neutralHatch = mode === 'dark' ? 'rgba(195,194,183,0.45)' : 'rgba(82,81,78,0.35)';
  const effectColor = (e: number | null | undefined) => (e == null || e === 0 ? null : e > 0 ? fm.good : fm.bad);
  return (day: HeatDay | undefined, scale: HeatScaleSpec) => {
    if (!day || day.state === 'no_game') {
      return { bg: 'transparent', ink: 'var(--mui-palette-text-secondary)', border: `1px solid ${viz.grid}`, pattern: undefined as string | undefined };
    }
    if (day.state === 'dnp' || day.state === 'out') {
      const angle = day.state === 'dnp' ? 45 : 135;
      const c = effectColor(day.effect);
      return {
        bg: 'transparent',
        ink: 'var(--mui-palette-text-primary)',
        border: `${c ? 2 : 1}px solid ${c ?? viz.axis}`,
        pattern: `repeating-linear-gradient(${angle}deg, ${c ? `${c}99` : neutralHatch} 0 2px, transparent 2px 7px)`,
      };
    }
    const fill =
      day.value == null || scale.kind === 'binary'
        ? (effectColor(day.effect) ?? SEQUENTIAL[mode][2]!)
        : binColor(day.value, scale.kind, scale.min, scale.max, mode);
    if (day.state === 'scheduled') {
      return { bg: 'transparent', ink: 'var(--mui-palette-text-primary)', border: `2px dashed ${fill}`, pattern: undefined };
    }
    return { bg: fill, ink: inkOn(fill), border: `1px solid ${fill}`, pattern: undefined };
  };
}

/* ------------------------------------------------------------------- parts */

export interface HeatCalendarProps {
  days: HeatDay[];
  view: 'week' | 'month';
  scale: HeatScaleSpec;
  /** Week view: any date in the week (Mon–Sun). Month view: any date in the month. */
  anchor: IsoDate;
  title: string;
  initialSelected?: IsoDate | null;
  /** Open the sheet for `initialSelected` on mount (stories). */
  initialSheetOpen?: boolean;
  initialDisplay?: 'grid' | 'table';
  /** Links shown at the bottom of a day's sheet (e.g. to Player Profile sections). */
  actionsFor?: (day: HeatDay) => SheetAction[];
  /** Compose your own parts; default renders header, grid, legend and the sheet. */
  children?: ReactNode;
}

/**
 * HeatCalendar (compound): Context + Header + Grid + Legend + Sheet. Use it as one
 * component (no children) or compose the parts. Cells are MUI layout, not a chart (MUI X's
 * heatmap is Pro). Cells carry no numbers: week view shows weekday + date, month view the
 * date. The fill carries the meaning (green helps me, red hurts me, gray no effect; a blue
 * ramp for magnitude-only metrics) with a quiet ▲ / ▼ so it is never color alone; projected
 * days are dashed, DNP / out are hatched with an icon. Tapping a day opens a bottom sheet.
 */
export function HeatCalendar({ days, view, scale, anchor, title, initialSelected, initialSheetOpen = false, initialDisplay = 'grid', actionsFor, children }: HeatCalendarProps) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const [selected, setSelected] = useState<IsoDate | null>(initialSelected ?? null);
  const [sheetOpen, setSheetOpen] = useState(initialSheetOpen && initialSelected != null);
  const [display, setDisplay] = useState<'grid' | 'table'>(initialDisplay);
  const value: Ctx = {
    days,
    byDate,
    view,
    scale,
    start: mondayOf(anchor),
    month: view === 'month' ? anchor.slice(0, 7) : null,
    selected,
    select: setSelected,
    sheetOpen,
    setSheetOpen,
    display,
    setDisplay,
    title,
    actionsFor,
  };
  return (
    <HeatCtx.Provider value={value}>
      <Box>
        {children ?? (
          <>
            <HeatCalendarHeader />
            <HeatCalendarGrid />
            <HeatCalendarLegend />
            <HeatCalendarSheet />
          </>
        )}
      </Box>
    </HeatCtx.Provider>
  );
}

/** Title + calendar/table toggle. */
export function HeatCalendarHeader({ subtitle }: { subtitle?: string }) {
  const { title, display, setDisplay } = useHeat();
  return (
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.75 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" component="h3">
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      <ToggleButtonGroup size="small" exclusive value={display} onChange={(_, v: 'grid' | 'table' | null) => v && setDisplay(v)} aria-label={`${title} view`}>
        <ToggleButton value="grid" sx={{ px: 1.5 }}>
          Calendar
        </ToggleButton>
        <ToggleButton value="table" sx={{ px: 1.5 }}>
          Table
        </ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  );
}

function Markers({ day, compact }: { day: HeatDay; compact: boolean }) {
  const m = day.markers ?? {};
  const dot = compact ? 4 : 5;
  return (
    <>
      <Box component="span" aria-hidden sx={{ position: 'absolute', top: 3, right: 3, display: 'flex', gap: '2px', alignItems: 'center' }}>
        {m.light && <Box sx={{ width: dot + 1, height: dot + 1, borderRadius: '50%', border: '1.5px solid currentColor' }} />}
        {m.b2b && (
          <>
            <Box sx={{ width: dot, height: dot, borderRadius: '50%', bgcolor: 'currentColor' }} />
            <Box sx={{ width: dot, height: dot, borderRadius: '50%', bgcolor: 'currentColor' }} />
          </>
        )}
      </Box>
      {m.cup && <EmojiEventsOutlinedIcon aria-hidden sx={{ position: 'absolute', bottom: 2, right: 2, fontSize: compact ? 10 : 12 }} />}
      {m.playoffs && (
        <Box component="span" aria-hidden sx={{ position: 'absolute', bottom: 1, right: 3, fontSize: compact ? 8 : 9, fontWeight: 800 }}>
          PO
        </Box>
      )}
      {m.fourGameWeek && <Box aria-hidden sx={{ position: 'absolute', left: 6, right: 6, bottom: 2, height: 2, borderRadius: 1, bgcolor: 'currentColor', opacity: 0.7 }} />}
    </>
  );
}

/** The calendar cells (or the table when the toggle says so). Tap opens the sheet. */
export function HeatCalendarGrid() {
  const ctx = useHeat();
  const look = useCellLook();
  const { view, scale, selected, select, byDate, setSheetOpen } = ctx;

  if (ctx.display === 'table') return <HeatCalendarTable />;

  const rows: IsoDate[][] =
    view === 'week' ? [Array.from({ length: 7 }, (_, i) => addDays(ctx.start, i))] : monthWeeks(ctx.month ?? ctx.start.slice(0, 7));
  const compact = view === 'month';

  return (
    <Box role="grid" aria-label={ctx.title}>
      {compact && (
        <Box role="row" sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '3px', mb: '3px' }}>
          {WEEKDAY_HEAD.map((w) => (
            <Typography key={w} role="columnheader" variant="caption" sx={{ textAlign: 'center', fontWeight: 700, color: 'text.secondary' }}>
              {w}
            </Typography>
          ))}
        </Box>
      )}
      {rows.map((week) => (
        <Box key={week[0]} role="row" sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '3px', mb: '3px' }}>
          {week.map((date) => {
            const day = byDate.get(date);
            const outside = view === 'month' && ctx.month != null && !date.startsWith(ctx.month);
            const l = look(day, scale);
            const isSel = selected === date;
            const today = day?.markers?.today;
            const amount = day ? forMeAmount(day, scale) : null;
            const glyph = amount == null ? null : forMeSymbol(amount, deadbandOf(scale));
            return (
              <ButtonBase
                key={date}
                role="gridcell"
                disabled={!day}
                onClick={() => {
                  if (!day) return;
                  select(date);
                  setSheetOpen(true);
                }}
                aria-haspopup="dialog"
                aria-label={day ? `${day.sheet.title}${amount != null ? `, ${forMeWord(amount, deadbandOf(scale))}` : ''}. Opens details.` : `${weekdayOf(date)} ${shortDate(date)}, no data`}
                sx={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 0,
                  height: compact ? 46 : 72,
                  borderRadius: 1.5,
                  bgcolor: l.bg,
                  backgroundImage: l.pattern,
                  color: l.ink,
                  border: l.border,
                  opacity: outside || !day ? 0.35 : 1,
                  outline: today || isSel ? '2px solid' : 'none',
                  outlineColor: today ? 'var(--mui-palette-primary-main)' : 'var(--mui-palette-text-primary)',
                  outlineOffset: today ? 0 : 1,
                }}
              >
                {!compact && (
                  <Typography component="span" sx={{ fontSize: 12, fontWeight: 600, lineHeight: 1.2, color: 'inherit', opacity: 0.85 }}>
                    {weekdayOf(date)}
                  </Typography>
                )}
                <Typography component="span" className="tabular" sx={{ fontSize: compact ? 14 : 20, fontWeight: 700, lineHeight: 1.15, color: 'inherit' }}>
                  {Number(date.slice(8))}
                </Typography>
                {day?.state === 'out' && <LocalHospitalOutlinedIcon sx={{ fontSize: compact ? 12 : 16, mt: 0.25 }} aria-hidden />}
                {day?.state === 'dnp' && <BlockIcon sx={{ fontSize: compact ? 12 : 16, mt: 0.25 }} aria-hidden />}
                {glyph && glyph !== '●' && day?.state !== 'out' && day?.state !== 'dnp' && (
                  <Box component="span" aria-hidden sx={{ position: 'absolute', bottom: 2, left: 4, fontSize: compact ? 8 : 10, lineHeight: 1, opacity: 0.8 }}>
                    {glyph}
                  </Box>
                )}
                {day && <Markers day={day} compact={compact} />}
              </ButtonBase>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

const STATE_LABEL: Record<HeatState, string> = {
  played: 'Played',
  game: 'Game',
  scheduled: 'Projected',
  dnp: 'DNP',
  out: 'Out',
  no_game: 'No game',
};

/** Every day as a row: the accessible twin of the grid (values live here, not in cells). */
export function HeatCalendarTable() {
  const { days, title, view, start, month, scale } = useHeat();
  const end = view === 'week' ? addDays(start, 6) : null;
  const shown = days.filter((d) => (view === 'week' ? d.date >= start && d.date <= end! : month ? d.date.startsWith(month) : true));
  return (
    <Table size="small" aria-label={title}>
      <TableHead>
        <TableRow>
          <TableCell sx={{ px: 0.75 }}>Day</TableCell>
          <TableCell sx={{ px: 0.75 }}>State</TableCell>
          <TableCell align="right" sx={{ px: 0.75 }}>
            Value
          </TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {shown.map((d) => {
          const amount = forMeAmount(d, scale);
          return (
            <TableRow key={d.date}>
              <TableCell sx={{ px: 0.75 }}>
                {weekdayOf(d.date)} {shortDate(d.date)}
                <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
                  {d.sheet.subtitle ?? ''}
                </Typography>
              </TableCell>
              <TableCell sx={{ px: 0.75 }}>
                {STATE_LABEL[d.state]}
                {amount != null && (
                  <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
                    {forMeSymbol(amount, deadbandOf(scale))} {forMeWord(amount, deadbandOf(scale))}
                  </Typography>
                )}
              </TableCell>
              <TableCell align="right" className="tabular" sx={{ px: 0.75 }}>
                {d.tableValue ?? '—'}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** The bottom sheet for the tapped day. */
export function HeatCalendarSheet() {
  const { selected, byDate, sheetOpen, setSheetOpen, scale, actionsFor } = useHeat();
  const day = selected ? byDate.get(selected) : undefined;
  const amount = day ? forMeAmount(day, scale) : null;
  const content: SheetContent | null = day
    ? {
        ...day.sheet,
        effect:
          day.sheet.effect ??
          (amount != null ? `${forMeSymbol(amount, deadbandOf(scale))} ${forMeWord(amount, deadbandOf(scale)).replace(/^./, (c) => c.toUpperCase())}` : null),
        actions: [...(day.sheet.actions ?? []), ...(actionsFor?.(day) ?? [])],
      }
    : null;
  return <DetailSheet open={sheetOpen} onClose={() => setSheetOpen(false)} content={content} />;
}

function Swatch({ bg, border, pattern, label }: { bg: string; border: string; pattern?: string; label: string }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      <Box aria-hidden sx={{ width: 14, height: 14, borderRadius: 0.75, bgcolor: bg, border, backgroundImage: pattern, flexShrink: 0 }} />
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
    </Box>
  );
}

/** Color scale + state key + marker key. Always present. */
export function HeatCalendarLegend() {
  const { scale, days } = useHeat();
  const mode = useResolvedMode();
  const viz = useVizColors();
  const fm = FOR_ME[mode];
  const steps = scale.kind === 'diverging' ? divergingSteps(mode) : SEQUENTIAL[mode];
  const states = new Set(days.map((d) => d.state));
  const effects = new Set(days.filter((d) => d.state !== 'no_game').map((d) => Math.sign(d.effect ?? 0)));
  const hatch = mode === 'dark' ? 'rgba(195,194,183,0.45)' : 'rgba(82,81,78,0.35)';
  const m = days.reduce(
    (acc, d) => ({
      light: acc.light || !!d.markers?.light,
      b2b: acc.b2b || !!d.markers?.b2b,
      cup: acc.cup || !!d.markers?.cup,
      po: acc.po || !!d.markers?.playoffs,
      four: acc.four || !!d.markers?.fourGameWeek,
    }),
    { light: false, b2b: false, cup: false, po: false, four: false },
  );
  const shaded = scale.kind !== 'binary' && (states.has('played') || states.has('scheduled'));
  const strong = steps[scale.kind === 'diverging' ? 5 : 3]!;
  return (
    <Box sx={{ mt: 1 }} aria-label="Legend">
      {shaded && (
        <>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', fontWeight: 600 }}>
            {scale.label}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'right' }}>
              {scale.kind === 'diverging' ? `▼ ${scale.lowLabel}` : scale.lowLabel}
            </Typography>
            <Box sx={{ display: 'flex', gap: '2px' }} aria-hidden>
              {steps.map((c, i) => (
                <Box key={`${c}-${i}`} sx={{ width: scale.kind === 'diverging' ? 16 : 22, height: 12, borderRadius: 0.5, bgcolor: c }} />
              ))}
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {scale.kind === 'diverging' ? `${scale.highLabel} ▲` : scale.highLabel}
            </Typography>
          </Box>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
            {scale.kind === 'diverging' ? 'Green ▲ helps you, red ▼ hurts you, gray about even.' : 'Darker = more (magnitude only).'} Tap a day for the numbers.
          </Typography>
        </>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.5, mt: 0.5 }}>
        {states.has('played') && shaded && <Swatch bg={strong} border="none" label="Played (shaded)" />}
        {states.has('game') && effects.has(1) && <Swatch bg={fm.good} border={`1px solid ${fm.good}`} label="▲ Game (helps you)" />}
        {states.has('game') && effects.has(-1) && <Swatch bg={fm.bad} border={`1px solid ${fm.bad}`} label="▼ Game (hurts you)" />}
        {states.has('game') && effects.has(0) && <Swatch bg={SEQUENTIAL[mode][2]!} border="none" label="Game day" />}
        {states.has('scheduled') && <Swatch bg="transparent" border={`2px dashed ${strong}`} label="Projected (dashed)" />}
        {states.has('dnp') && <Swatch bg="transparent" border={`1px solid ${viz.axis}`} pattern={`repeating-linear-gradient(45deg, ${hatch} 0 2px, transparent 2px 5px)`} label="DNP (team played)" />}
        {states.has('out') && <Swatch bg="transparent" border={`1px solid ${viz.axis}`} pattern={`repeating-linear-gradient(135deg, ${hatch} 0 2px, transparent 2px 5px)`} label="Out / injured" />}
        {(states.has('out') || states.has('dnp')) && effects.has(-1) && (
          <Swatch bg="transparent" border={`2px solid ${fm.bad}`} pattern={`repeating-linear-gradient(135deg, ${fm.bad}99 0 2px, transparent 2px 5px)`} label="▼ Your player misses a game" />
        )}
        {(states.has('out') || states.has('dnp')) && effects.has(1) && (
          <Swatch bg="transparent" border={`2px solid ${fm.good}`} pattern={`repeating-linear-gradient(135deg, ${fm.good}99 0 2px, transparent 2px 5px)`} label="▲ Opponent’s player misses a game" />
        )}
        {states.has('no_game') && <Swatch bg="transparent" border={`1px solid ${viz.grid}`} label="No game" />}
      </Box>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
        {[
          'Blue outline = today',
          m.light && '○ light day (≤5 NBA games)',
          m.b2b && '•• back-to-back',
          m.cup && 'trophy = NBA Cup night',
          m.po && 'PO = playoff week',
          m.four && 'underline = 4-game week',
        ]
          .filter(Boolean)
          .join(' · ')}
      </Typography>
    </Box>
  );
}

HeatCalendar.Header = HeatCalendarHeader;
HeatCalendar.Grid = HeatCalendarGrid;
HeatCalendar.Table = HeatCalendarTable;
HeatCalendar.Sheet = HeatCalendarSheet;
HeatCalendar.Legend = HeatCalendarLegend;
