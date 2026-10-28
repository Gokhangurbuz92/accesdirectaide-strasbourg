import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';

const meta = {
    title: 'UI/Button',
    component: Button,
    tags: ['autodocs'],
    argTypes: {
        variant: {
            control: 'select',
            options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
        },
        size: {
            control: 'select',
            options: ['default', 'sm', 'lg', 'icon'],
        },
        isLoading: {
            control: 'boolean',
        },
        disabled: {
            control: 'boolean',
        },
    },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default
export const Default: Story = {
    args: {
        children: 'Button',
        variant: 'default',
    },
};

// Outline
export const Outline: Story = {
    args: {
        children: 'Button',
        variant: 'outline',
    },
};

// Ghost
export const Ghost: Story = {
    args: {
        children: 'Button',
        variant: 'ghost',
    },
};

// Destructive
export const Destructive: Story = {
    args: {
        children: 'Button',
        variant: 'destructive',
    },
};

// Disabled
export const Disabled: Story = {
    args: {
        children: 'Button',
        disabled: true,
    },
};

// Loading
export const Loading: Story = {
    args: {
        children: 'Please wait',
        isLoading: true,
    },
};

// FocusVisible
export const FocusVisible: Story = {
    args: {
        children: 'Tab to focus me',
        autoFocus: true,
    },
    parameters: {
        docs: {
            description: {
                story: 'This button demonstrates the `focus-visible` styling ring. Press Tab while outside the component to focus it via keyboard rendering the high-contrast `ring`.',
            },
        },
    },
};
