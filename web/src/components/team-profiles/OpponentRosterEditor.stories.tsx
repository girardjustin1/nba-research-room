import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { OpponentRoster } from '../../api/season';
import {
  opponentRosterEmpty,
  opponentRosterFilled,
  opponentRosterUnmatched,
  sampleSave,
  sampleSearch,
} from '../../mocks/team-profiles/opponentRoster';
import { OpponentRosterEditor, type OpponentRosterEditorProps } from './OpponentRosterEditor';

/** This week's opponent, entered by hand. Invented teams and players; saving works in memory. */
const meta = {
  title: 'Team Profiles/This week\'s opponent',
  component: OpponentRosterEditor,
  args: {
    data: opponentRosterFilled,
    onSearch: async (q: string) => sampleSearch(q),
    onSave: async (b) => sampleSave(opponentRosterFilled, b),
    onOpenPlayer: () => {},
  },
  render: (args) => <Interactive {...args} />,
} satisfies Meta<typeof OpponentRosterEditor>;

/** Saving updates the screen, as the app does. */
function Interactive(args: OpponentRosterEditorProps) {
  const [data, setData] = useState<OpponentRoster | null>(args.data);
  return (
    <OpponentRosterEditor
      {...args}
      data={data}
      onSave={async (b) => {
        const r = sampleSave(data ?? opponentRosterEmpty, b);
        setData(r);
        return r;
      }}
    />
  );
}

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing entered for this week: pick the team, then search or paste names. */
export const Empty: Story = { args: { data: opponentRosterEmpty } };
/** This week's opponent saved. */
export const Saved: Story = {};
/** After a paste where two names didn't match an NBA player. */
export const NamesDidNotMatch: Story = { args: { data: opponentRosterUnmatched } };
export const Loading: Story = { args: { data: null, loading: true } };
export const ApiError: Story = { args: { data: null, error: 'Request failed (HTTP 500)', onRetry: () => {} } };
