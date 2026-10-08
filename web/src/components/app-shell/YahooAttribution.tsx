import Box from '@mui/material/Box';
import Link from '@mui/material/Link';

/** Yahoo Fantasy's official logo, used exactly as Yahoo provides it (never copied into this repo). */
export const YAHOO_FANTASY_LOGO =
  'https://763445962456-brand-assets.s3.us-west-2.amazonaws.com/brandwebsite/s3fs-public/Yahoo_Fantasy.svg';
export const YAHOO_FANTASY_URL = 'https://basketball.fantasysports.yahoo.com/';

/**
 * Attribution wherever Yahoo Fantasy information can appear (Yahoo's requirements at
 * sports.yahoo.com/developer): the official logo, unaltered,
 * and "Fantasy data provided by Yahoo Fantasy", linking to Yahoo Fantasy, in the page footer.
 * The demo build shows only invented data and carries none.
 */
export function YahooAttribution({ bottomOffset = 0 }: { bottomOffset?: number }) {
  return (
    <Box
      component="footer"
      sx={{ display: 'flex', justifyContent: 'center', px: 2, pt: 2, pb: `${16 + bottomOffset}px` }}
    >
      <Link
        href={YAHOO_FANTASY_URL}
        target="_blank"
        rel="noopener noreferrer"
        underline="hover"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'text.secondary', typography: 'caption' }}
      >
        <img src={YAHOO_FANTASY_LOGO} alt="Yahoo Fantasy" width={24} height={24} />
        Fantasy data provided by Yahoo Fantasy
      </Link>
    </Box>
  );
}
