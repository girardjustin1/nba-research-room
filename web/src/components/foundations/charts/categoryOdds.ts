import type { Category } from '../../../api/types';

/** The fixed display order of the nine categories. */
export const CATEGORY_ORDER = ['fg_pct', 'ft_pct', 'fg3m', 'pts', 'reb', 'ast', 'stl', 'blk', 'tov'];
/** Within this distance of 50% a category reads as "about even" (neutral gray). Display only. */
export const EVEN_BAND = 0.02;

export interface CategoryOddsRow {
  key: string;
  label: string;
  p: number | null;
  punted: boolean;
}

export function buildRows(pCat: Record<string, number | null>, categories: Category[], punts: string[]): CategoryOddsRow[] {
  const byKey = new Map(categories.map((c) => [c.key, c.label]));
  const keys = [...CATEGORY_ORDER.filter((k) => byKey.has(k) || k in pCat), ...categories.map((c) => c.key).filter((k) => !CATEGORY_ORDER.includes(k))];
  return keys.map((key) => ({ key, label: byKey.get(key) ?? key, p: pCat[key] ?? null, punted: punts.includes(key) }));
}

export function standing(row: CategoryOddsRow): string {
  if (row.punted) return 'punted';
  if (row.p == null) return 'no estimate';
  if (Math.abs(row.p - 0.5) < EVEN_BAND) return 'about even';
  return row.p > 0.5 ? 'favored' : 'behind';
}
