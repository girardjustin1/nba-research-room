import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { MyRoster } from '../../api/season';
import { myRosterEmpty, myRosterFilled, sampleSaveMine, sampleSearchMine } from '../../mocks/team-profiles/myRoster';
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
