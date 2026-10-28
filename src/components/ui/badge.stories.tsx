import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './badge';

const meta = {
    title: 'UI/Badge',
    component: Badge,
    tags: ['autodocs'],
    argTypes: {
        variant: {
            control: 'select',
            options: ['neutral', 'verified', 'warning', 'destructive'],
        },
    },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

// Neutral
export const Neutral: Story = {
    args: {
        children: 'Neutral Badge',
        variant: 'neutral',
    },
};

// Verified
export const Verified: Story = {
    args: {
        children: 'Verified Badge',
        variant: 'verified',
    },
};

// Warning
export const Warning: Story = {
    args: {
        children: 'Warning Badge',
        variant: 'warning',
    },
};

// Destructive
export const Destructive: Story = {
    args: {
        children: 'Destructive Badge',
        variant: 'destructive',
    },
};
