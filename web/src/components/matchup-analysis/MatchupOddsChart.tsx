import type { CategoryLine, SeasonCategory } from '../../api/season';
import { pct } from '../../lib/format';
import { EVEN_BAND } from '../foundations/charts/categoryOdds';
import { catLabel, statValue } from '../foundations/seasonFormat';
import { SignedBarChart } from '../foundations/SignedBarChart';

export interface MatchupOddsChartProps {
  lines: CategoryLine[];
  categories: SeasonCategory[];
  opponentName: string;
  initialView?: 'chart' | 'table';
}

function standing(l: CategoryLine): string {
  if (l.punted) return 'punted';
  if (l.p_win == null) return 'no estimate';
  if (Math.abs(l.p_win - 0.5) < EVEN_BAND) return 'about even';
  return l.p_win > 0.5 ? 'favored' : 'behind';
}

/**
 * Per-category P(win) against this week's opponent: the draft room's diverging
 * category-odds chart, extended with the projected end-of-week totals (mean ± sd) in the
 * table view and "close" marks on the swing categories the engine flags.
 */
export function MatchupOddsChart({ lines, categories, opponentName, initialView }: MatchupOddsChartProps) {
  const cat = (k: CategoryLine['key']) => categories.find((c) => c.key === k);
  const rows = lines.map((l) => {
    const label = catLabel(l.key, categories) + (l.punted ? ' (punt)' : l.swing ? ' •' : '');
    const c = cat(l.key);
    const proj = (e: CategoryLine['mine_final']) => (e ? `${statValue(e.mean, c?.is_ratio ?? false)} ± ${statValue(e.sd, c?.is_ratio ?? false)}` : '—');
    return {
      key: l.key,
      label,
      value: l.p_win == null ? null : l.p_win - 0.5,
      display: pct(l.p_win),
      neutral: l.punted,
      readout:
        `${catLabel(l.key, categories)}: ${pct(l.p_win)} to win, ${standing(l)}${l.swing ? ', a close category' : ''}. ` +
        `Projected you ${proj(l.mine_final)}, them ${proj(l.theirs_final)}${c && !c.higher_is_better ? ' (fewer wins)' : ''}.`,
      proj,
      line: l,
    };
  });
  return (
    <SignedBarChart
        title={`Odds vs ${opponentName}`}
        subtitle="P(win) by Sunday · • close"
        rows={rows}
        domain={0.62}
        ticks={[-0.5, -0.25, 0, 0.25, 0.5]}
        tickFormat={(v) => `${Math.round((v + 0.5) * 100)}%`}
        evenBand={EVEN_BAND}
        initialView={initialView}
        hint="Tap a bar for the projected totals. 50% is a coin flip."
        table={{
          headers: ['Cat', 'P(win)', 'You', 'Them'],
          cells: (_r, i) => {
            const r = rows[i]!;
            return [r.label, pct(r.line.p_win), r.proj(r.line.mine_final), r.proj(r.line.theirs_final)];
          },
        }}
    />
  );
}
