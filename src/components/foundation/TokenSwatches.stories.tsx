import type { Meta, StoryObj } from '@storybook/react';
import { TokenSwatches } from './TokenSwatches';

const meta = {
    title: 'Foundation/Tokens',
    component: TokenSwatches,
    parameters: {
        layout: 'fullscreen',
    },
} satisfies Meta<typeof TokenSwatches>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
