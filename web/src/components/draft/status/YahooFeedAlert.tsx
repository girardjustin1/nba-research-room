import Alert from '@mui/material/Alert';
import type { Session } from '../../../api/types';
import { roundPick } from '../../../lib/picks';

/**
 * What the Yahoo picks feed couldn't do on its own: names Yahoo lists that matched no player (enter
 * those picks by hand) and picks where the log has a different player than Yahoo (check them; the
 * feed never overwrites a pick). Nothing shows when there's nothing to fix.
 */
export function YahooFeedAlert({ session }: { session: Session }) {
  const f = session.yahoo_feed;
  if (!f || (f.unmatched.length === 0 && f.conflicts.length === 0)) return null;
  return (
    <Alert severity="warning" sx={{ mx: 2, mt: 1 }}>
      {f.unmatched.length > 0 && (
        <>
          Yahoo lists {f.unmatched.length === 1 ? 'a pick' : `${f.unmatched.length} picks`} the app couldn't match (
          {f.unmatched.join(', ')}): enter {f.unmatched.length === 1 ? 'it' : 'them'} with Enter pick.{' '}
        </>
      )}
      {f.conflicts.length > 0 && (
        <>
          Yahoo shows a different player at pick{f.conflicts.length === 1 ? '' : 's'}{' '}
          {f.conflicts.map((n) => roundPick(n, session.teams)).join(', ')}: check {f.conflicts.length === 1 ? 'it' : 'them'} in
          the Draft log.
        </>
      )}
    </Alert>
  );
}
