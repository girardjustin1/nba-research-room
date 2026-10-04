import { useCallback, useState } from 'react';

/** Starred players, per draft, in this browser only (a per-viewer convenience). */
const key = (draftId: string) => `draft-favorites:${draftId}`;

function read(draftId: string): number[] {
  try {
    const raw = window.localStorage.getItem(key(draftId));
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

export function useFavorites(draftId: string): [Set<number>, (playerId: number) => void] {
  const [ids, setIds] = useState<Set<number>>(() => new Set(read(draftId)));
  const [forDraft, setForDraft] = useState(draftId);
  if (forDraft !== draftId) {
    setForDraft(draftId);
    setIds(new Set(read(draftId)));
  }
  const toggle = useCallback(
    (playerId: number) => {
      setIds((prev) => {
        const next = new Set(prev);
        if (next.has(playerId)) next.delete(playerId);
        else next.add(playerId);
        try {
          window.localStorage.setItem(key(draftId), JSON.stringify([...next]));
        } catch {
          /* storage blocked: favorites stay for this visit only */
        }
        return next;
      });
    },
    [draftId],
  );
  return [ids, toggle];
}
