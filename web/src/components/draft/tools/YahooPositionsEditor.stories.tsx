import type { Meta, StoryObj } from '@storybook/react-vite';
import { notFound } from '../../../mocks/draft/room';
import { SAMPLE_POSITIONS_PASTE, sampleSavePositions, yahooPositionsNone, yahooPositionsSome } from '../../../mocks/draft/yahooPositions';
import { YahooPositionsEditor } from './YahooPositionsEditor';

const wait = () => new Promise((r) => setTimeout(r, 300));

const meta = {
  title: 'Draft/Tools/Yahoo Positions Editor',
  component: YahooPositionsEditor,
  args: {
    open: true,
    onClose: () => {},
    load: async () => yahooPositionsSome,
    onSave: async (text: string) => {
      await wait();
      return sampleSavePositions(yahooPositionsSome, text);
    },
  },
} satisfies Meta<typeof YahooPositionsEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Some pages pasted already. */
export const Default: Story = {};
/** Nothing pasted yet: the board uses Basketball Monster's single position. */
export const NonePasted: Story = { args: { load: async () => yahooPositionsNone } };
/** A page pasted, ready to add (Save shows the result, with a name shared by two players skipped). */
export const ReadyToAdd: Story = { args: { initialText: SAMPLE_POSITIONS_PASTE } };
/** The running API predates the endpoint. */
export const EndpointMissing: Story = {
  args: {
    load: async () => {
      throw notFound;
    },
    onSave: async () => {
      throw notFound;
    },
    initialText: SAMPLE_POSITIONS_PASTE,
  },
};
