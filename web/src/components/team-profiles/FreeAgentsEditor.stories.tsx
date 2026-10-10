import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  SAMPLE_PASTE,
  freeAgentsAmbiguous,
  freeAgentsEmpty,
  freeAgentsFilled,
  freeAgentsStale,
  sampleSaveFree,
} from '../../mocks/team-profiles/freeAgents';
import { FreeAgentsEditor } from './FreeAgentsEditor';

/** Free agents pasted from Yahoo's Players page. Invented players; saving works in memory. */
const meta = {
  title: 'Team Profiles/Free agents',
  component: FreeAgentsEditor,
  args: { data: freeAgentsFilled, onSave: async (b) => sampleSaveFree(b), onOpenPlayer: () => {} },
} satisfies Meta<typeof FreeAgentsEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A list pasted a few hours ago. */
export const Pasted: Story = {};
/** Nothing pasted yet: the moves page waits for this (or for Yahoo). */
export const Empty: Story = { args: { data: freeAgentsEmpty } };
/** A page of Yahoo's Players list pasted in, ready to save. */
export const ReadyToSave: Story = { args: { data: freeAgentsEmpty, initialText: SAMPLE_PASTE } };
/** Pasted three days ago: a fresh paste is suggested. */
export const Stale: Story = { args: { data: freeAgentsStale } };
/** One name was shared by two players and skipped. */
export const AmbiguousName: Story = { args: { data: freeAgentsAmbiguous } };
export const Loading: Story = { args: { data: null, loading: true } };
export const Failed: Story = { args: { data: null, error: 'Request failed (HTTP 500)' } };
