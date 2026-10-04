import { useState } from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import { assetUrl, initials } from '../../../lib/assets';

export interface PlayerAvatarProps {
  name: string;
  headshotUrl?: string | null;
  size?: number;
}

/** Player face; falls back to initials when there is no cached headshot or it fails to load. */
export function PlayerAvatar({ name, headshotUrl, size = 40 }: PlayerAvatarProps) {
  const src = assetUrl(headshotUrl);
  return (
    <Avatar
      src={src}
      alt={name}
      sx={{ width: size, height: size, fontSize: size * 0.4, fontWeight: 600, bgcolor: 'action.selected', color: 'text.secondary' }}
      slotProps={{ img: { loading: 'lazy', decoding: 'async' } }}
    >
      {initials(name)}
    </Avatar>
  );
}

export interface TeamBadgeProps {
  abbr: string | null | undefined;
  logoUrl?: string | null;
  size?: number;
}

/** Small team logo (when cached) beside the abbreviation; the abbreviation is always shown. */
export function TeamBadge({ abbr, logoUrl, size = 16 }: TeamBadgeProps) {
  const [failed, setFailed] = useState(false);
  const src = failed ? undefined : assetUrl(logoUrl);
  return (
    <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
      {src && (
        <Box
          component="img"
          src={src}
          alt=""
          aria-hidden
          loading="lazy"
          onError={() => setFailed(true)}
          sx={{ width: size, height: size, objectFit: 'contain', verticalAlign: 'text-bottom', mr: 0.5 }}
        />
      )}
      {abbr ?? '—'}
    </Box>
  );
}
