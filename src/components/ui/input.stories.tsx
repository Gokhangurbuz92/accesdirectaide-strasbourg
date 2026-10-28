import type { Meta, StoryObj } from '@storybook/react';
import { Input } from './input';

const meta = {
    title: 'UI/Input',
    component: Input,
    tags: ['autodocs'],
    argTypes: {
        disabled: {
            control: 'boolean',
        },
    },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default
export const Default: Story = {
    args: {
        placeholder: 'Enter text here...',
        'aria-label': 'Default input',
    },
};

// Filled
export const Filled: Story = {
    args: {
        value: 'This is some filled text',
        readOnly: true,
        'aria-label': 'Filled input',
    },
};

// Disabled
export const Disabled: Story = {
    args: {
        placeholder: 'Disabled input',
        disabled: true,
        'aria-label': 'Disabled input',
    },
};

// Error
export const Error: Story = {
    args: {
        defaultValue: 'Invalid input',
        'aria-invalid': true,
        className: 'border-destructive focus-visible:ring-destructive text-foreground',
        'aria-label': 'Error input',
    },
    parameters: {
        docs: {
            description: {
                story: 'Pass `border-destructive`, `focus-visible:ring-destructive`, and `text-destructive` classes to visually indicate an error state natively.',
            },
        },
    },
};

// FocusVisible
export const FocusVisible: Story = {
    args: {
        placeholder: 'I will be focused',
        autoFocus: true,
        'aria-label': 'Focused input',
    },
};
