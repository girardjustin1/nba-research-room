import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  waiversEmpty,
  waiversInjury,
  waiversLastDay,
  waiversNoAcquisitions,
  waiversNormal,
  waiversOneLeft,
  waiversPlayoff,
  waiversPunt,
  waiversStale,
} from '../../mocks/team-builder/waivers';
import { PickupsScreen } from './PickupsScreen';

/** Ranked pickups for this week with paired drops and playable-games strips. Invented data. */
const meta = {
  title: 'Team Builder/Pickups',
  component: PickupsScreen,
  args: { waivers: waiversNormal, onOpenPlayer: () => {}, onCompare: () => {} },
} satisfies Meta<typeof PickupsScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {};
export const FilteredByPosition: Story = { args: { initialPosition: 'C' } };
export const FilteredByCategoryNeed: Story = { args: { initialCategory: 'ast' } };
export const NoMatchesForFilters: Story = { args: { initialPosition: 'SF', initialCategory: 'blk' } };
export const Loading: Story = { args: { waivers: null, loading: true } };
export const ApiError: Story = { args: { waivers: null, error: 'Request failed (HTTP 503)', onRetry: () => {} } };
export const StaleData: Story = { args: { waivers: waiversStale } };
export const InjuryBreakingNews: Story = { args: { waivers: waiversInjury } };
export const LastDayOfWeek: Story = { args: { waivers: waiversLastDay } };
export const PlayoffWeek: Story = { args: { waivers: waiversPlayoff } };
export const PuntBuild: Story = { args: { waivers: waiversPunt } };
export const OneAcquisitionLeft: Story = { args: { waivers: waiversOneLeft } };
export const NoAcquisitionsLeft: Story = { args: { waivers: waiversNoAcquisitions } };
/** Empty: nobody helps. */
export const NoPickupHelps: Story = { args: { waivers: waiversEmpty } };
