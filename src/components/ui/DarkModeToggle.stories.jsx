import DarkModeToggle from './DarkModeToggle';

/**
 * DarkModeToggle.stories.jsx
 * Documentation du sélecteur de thème ADA.
 * Bascule la classe `.dark` sur `<html>` et persiste dans localStorage.
 */
const meta = {
    title: 'UI/DarkModeToggle',
    component: DarkModeToggle,
    decorators: [
        (/** @type {string} */ Story) => (
            <div className="p-8 flex justify-center bg-background border rounded-xl">
                <Story />
            </div>
        ),
    ],
    tags: ['autodocs'],
    parameters: {
        layout: 'centered',
    },
};

export default meta;

export const Default = {};

export const WithClassName = {
    args: {
        className: 'border border-border',
    },
};
