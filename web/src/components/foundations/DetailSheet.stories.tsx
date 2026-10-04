import type { Meta, StoryObj } from '@storybook/react-vite';
import { DetailSheet } from './DetailSheet';

/** The bottom sheet a tapped grid cell opens (MUI SwipeableDrawer). */
const meta = {
  title: 'Foundations/Detail Sheet',
  component: DetailSheet,
  args: {
    open: true,
    onClose: () => {},
    content: {
      title: 'Thu Nov 19 · Callum Bramwell',
      subtitle: '@ MEM (away)',
      effect: '▲ Helps you',
      sections: [
        { heading: 'Projection', lines: ['BLK: 1.6 ± 1.2 (mean ± sd).', 'Chance he plays: 97% · medium confidence.'] },
        { heading: 'Schedule', lines: ['Your open slots he fits that day: 2.'] },
      ],
      actions: [{ label: 'See the projection', onClick: () => {} }],
    },
  },
} satisfies Meta<typeof DetailSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
export const LongContent: Story = {
  args: {
    content: {
      title: 'A long sheet',
      sections: Array.from({ length: 12 }, (_, i) => ({ heading: `Section ${i + 1}`, lines: ['Line one of invented text.', 'Line two of invented text.'] })),
    },
  },
};
export const Dark: Story = { globals: { colorMode: 'dark' } };
