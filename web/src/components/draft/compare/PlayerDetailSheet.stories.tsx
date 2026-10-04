import type { Meta, StoryObj } from '@storybook/react-vite';
import { CATEGORIES, makePool, makeTeamDays, makeTeamWeeks, onTheClockBoard, onTheClockSession } from '../../../mocks/draft/fixtures';
import { PlayerDetailSheet } from './PlayerDetailSheet';

const rec = onTheClockBoard.recommendations[0]!;
const player = makePool(onTheClockSession).find((p) => p.player_id === rec.player_id)!;

const meta = {
  title: 'Draft/Compare/Player Detail Sheet',
  component: PlayerDetailSheet,
  args: {
    player,
    rec,
    categories: CATEGORIES,
    schedule: makeTeamWeeks(),
    loadDays: async (team: string) => makeTeamDays(team),
    favorite: false,
    inCompare: false,
    compareFull: false,
    canDraft: true,
    draftLabel: 'Draft',
    onToggleFavorite: () => {},
    onToggleCompare: () => {},
    onDraft: () => {},
    onClose: () => {},
  },
} satisfies Meta<typeof PlayerDetailSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A ranked player: engine numbers, team schedule volume, per-category effect, reasons. */
export const Ranked: Story = {};
/** Outside the top 10: no gain or availability (the board did not rank him). */
export const Unranked: Story = { args: { rec: undefined } };
export const NotMyPick: Story = { args: { draftLabel: 'Draft for Fictional Five', favorite: true, inCompare: true } };
/** No Yahoo players.csv yet: slots come from Basketball Monster's primary position, labeled as such. */
export const EligibilityFromBbm: Story = { args: { player: { ...player, eligibility_source: 'bbm' } } };
