import HideScreenButton from './HideScreenButton';

/**
 * HideScreenButton.stories.jsx
 * Bouton de sécurité "Quitter vite" pour les usagers en danger.
 * Masque l'écran au clic ou avec Échap×3.
 */
const meta = {
    title: 'Security/HideScreenButton',
    component: HideScreenButton,
    parameters: {
        layout: 'fullscreen',
        docs: {
            description: {
                component:
                    'Bouton "panic" fixé en bas à droite. Clic ou 3× Échap masque tout l\'écran. Cliquer sur l\'overlay le restaure.',
            },
        },
    },
    tags: ['autodocs'],
};

export default meta;

export const Default = {};
