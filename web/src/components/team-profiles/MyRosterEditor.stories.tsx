import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { MyRoster } from '../../api/season';
import { myRosterEmpty, myRosterFilled, sampleFromDraft, sampleSaveMine, sampleSearchMine } from '../../mocks/team-profiles/myRoster';
import { MyRosterEditor, type MyRosterEditorProps } from './MyRosterEditor';

/** My roster, entered by hand. Invented players; saving works in memory. */
const meta = {
  title: 'Team Profiles/My roster',
  component: MyRosterEditor,
  args: {
    data: myRosterFilled,
    onSearch: async (q: string) => sampleSearchMine(q),
    onSave: async (b) => sampleSaveMine(myRosterFilled, b),
    onOpenPlayer: () => {},
    onFromDraft: async () => sampleFromDraft(),
  },
  render: (args) => <Interactive {...args} />,
} satisfies Meta<typeof MyRosterEditor>;

/** Saving updates the screen, as the app does. */
function Interactive(args: MyRosterEditorProps) {
  const [data, setData] = useState<MyRoster | null>(args.data);
  return (
    <MyRosterEditor
      {...args}
      data={data}
      onSave={async (b) => {
        const r = sampleSaveMine(data ?? myRosterEmpty, b);
        setData(r);
        return r;
      }}
    />
  );
}

export default meta;
type Story = StoryObj<typeof meta>;

/** 13 players plus one on the IL. */
export const Saved: Story = {};
/** Nothing entered yet. */
export const Empty: Story = { args: { data: myRosterEmpty } };
/** After a paste where a name didn't match an NBA player. */
export const NameDidNotMatch: Story = {
  args: { data: { ...myRosterFilled, unmatched: [{ name: 'Ashgrov', suggestions: ['Rennick Ashgrove'] }] } },
};
export const Loading: Story = { args: { data: null, loading: true } };
export const ApiError: Story = { args: { data: null, error: 'Request failed (HTTP 500)', onRetry: () => {} } };
/** Right after the draft: "Use my draft picks" fills the roster from the draft room's log. */
export const JustDrafted: Story = { args: { data: myRosterEmpty } };
/** The app doesn't know my draft slot: the dialog asks for it, then uses that slot's picks. */
export const AsksForSlot: Story = {
  args: {
    data: myRosterEmpty,
    onFromDraft: async (slot?: number) => {
      if (slot == null) throw new Error('Which draft slot was yours? Choose it, then try again.');
      return sampleFromDraft();
    },
  },
};
