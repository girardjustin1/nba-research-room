/** Safe-area padding: the real inset on a device, or the simulated one Storybook sets. */
export const SAFE_TOP = 'max(env(safe-area-inset-top, 0px), var(--sim-safe-top, 0px))';
export const SAFE_BOTTOM = 'max(env(safe-area-inset-bottom, 0px), var(--sim-safe-bottom, 0px))';
