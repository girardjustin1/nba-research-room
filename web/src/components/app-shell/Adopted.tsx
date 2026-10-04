import { useContext, useLayoutEffect, type ReactNode } from 'react';
import { ShellAdoptionContext, type ShellPart } from './AppShellContext';

/** Wrap each shell part in this: it registers on mount (before paint) and unregisters on unmount. */
export function Adopted({ part, children }: { part: ShellPart; children: ReactNode }) {
  const adopt = useContext(ShellAdoptionContext);
  useLayoutEffect(() => (adopt ? adopt(part) : undefined), [adopt, part]);
  return <>{children}</>;
}
