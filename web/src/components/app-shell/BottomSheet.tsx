import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { nearestSnap, SNAP_ORDER, type SheetSnap } from '../../lib/draftHelpers';
import { SAFE_BOTTOM } from '../../lib/layout';

export type { SheetSnap };


export interface SheetTab<T extends string> {
  value: T;
  label: string;
}

export interface BottomSheetProps<T extends string> {
  tabs: SheetTab<T>[];
  tab: T;
  onTabChange: (tab: T) => void;
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  /** Visible height when collapsed, above the home-indicator inset (grip + tabs). */
  peek?: number;
  /** Gap kept above the sheet when full, so the status bar stays visible. */
  topGap?: number;
  children: ReactNode;
}



/**
 * Draggable bottom sheet with three snap points. Drag the grip (or tap it, or use the
 * expand button / Enter key) to move between collapsed, half and full. It sits inside a
 * positioned parent and sizes itself from the parent's height.
 */
export function BottomSheet<T extends string>({ tabs, tab, onTabChange, snap, onSnapChange, peek = 104, topGap = 8, children }: BottomSheetProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const [parentH, setParentH] = useState(800);
  const [drag, setDrag] = useState<{ startY: number; startH: number; h: number } | null>(null);
  const dragged = useRef(false);

  useEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent) return;
    const update = () => setParentH(parent.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  const heights: Record<SheetSnap, number> = {
    collapsed: peek,
    half: Math.max(peek + 80, Math.round(parentH * 0.52)),
    full: Math.max(peek + 120, parentH - topGap),
  };
  const height = drag ? drag.h : heights[snap];
  const cycle = useCallback(() => onSnapChange(SNAP_ORDER[(SNAP_ORDER.indexOf(snap) + 1) % SNAP_ORDER.length] ?? 'collapsed'), [snap, onSnapChange]);

  return (
    <Paper
      ref={root}
      elevation={8}
      square
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: `calc(${height}px + ${SAFE_BOTTOM})`,
        pb: SAFE_BOTTOM,
        display: 'flex',
        flexDirection: 'column',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderTop: 1,
        borderColor: 'divider',
        zIndex: 5,
        transition: drag ? 'none' : 'height 220ms cubic-bezier(.2,.8,.2,1)',
        overflow: 'hidden',
      }}
    >
      <ButtonBase
        aria-label={`Resize panel (now ${snap}). Drag, or tap to cycle.`}
        onClick={() => {
          // A drag already snapped on pointer-up; a tap or Enter cycles.
          if (dragged.current) dragged.current = false;
          else cycle();
        }}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setDrag({ startY: e.clientY, startH: heights[snap], h: heights[snap] });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const h = Math.min(heights.full, Math.max(heights.collapsed, drag.startH - (e.clientY - drag.startY)));
          setDrag({ ...drag, h });
        }}
        onPointerUp={(e) => {
          if (!drag) return;
          const moved = Math.abs(e.clientY - drag.startY) > 6;
          setDrag(null);
          if (moved) {
            dragged.current = true;
            onSnapChange(nearestSnap(drag.h, heights));
          }
        }}
        onPointerCancel={() => setDrag(null)}
        sx={{ height: 28, width: '100%', flexShrink: 0, touchAction: 'none', cursor: 'grab' }}
      >
        <Box sx={{ width: 40, height: 5, borderRadius: 3, bgcolor: 'text.disabled' }} />
      </ButtonBase>
      <Stack direction="row" sx={{ alignItems: 'center', borderBottom: 1, borderColor: 'divider', flexShrink: 0, pr: 0.5 }}>
        <Tabs
          value={tab}
          onChange={(_, v: T) => {
            onTabChange(v);
            if (snap === 'collapsed') onSnapChange('half');
          }}
          variant="fullWidth"
          sx={{ flex: 1, minHeight: 44, '& .MuiTab-root': { minHeight: 44, minWidth: 0, px: 0.5, fontSize: 13, fontWeight: 700, letterSpacing: '0.02em' } }}
        >
          {tabs.map((t) => (
            <Tab key={t.value} value={t.value} label={t.label} />
          ))}
        </Tabs>
        <IconButton aria-label={snap === 'full' ? 'Collapse panel' : 'Expand panel'} onClick={() => onSnapChange(snap === 'full' ? 'collapsed' : snap === 'half' ? 'full' : 'half')}>
          {snap === 'full' ? <ExpandMoreIcon /> : <ExpandLessIcon />}
        </IconButton>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', visibility: height <= peek + 4 && !drag ? 'hidden' : 'visible' }}>
        {children}
      </Box>
    </Paper>
  );
}
