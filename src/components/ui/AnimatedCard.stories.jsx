// @ts-nocheck
import AnimatedCard from './AnimatedCard';

/**
 * AnimatedCard.stories.jsx
 * Composant de carte avec micro-animations ADA.
 * Entrée en cascade (stagger) + survol subtil. Respecte prefers-reduced-motion.
 */
const meta = {
    title: 'Layout/AnimatedCard',
    component: AnimatedCard,
    decorators: [
        (/** @type {string} */ Story) => (
            <div className="max-w-sm p-4">
                <Story />
            </div>
        ),
    ],
    tags: ['autodocs'],
    argTypes: {
        index: {
            control: { type: 'number', min: 0, max: 10 },
            description: 'Position dans la liste pour le stagger delay',
        },
        className: {
            control: 'text',
            description: 'Classes CSS additionnelles',
        },
    },
};

export default meta;

export const Standard = {
    args: {
        index: 0,
        children: (
            <div className="p-6 bg-card text-card-foreground border rounded-xl shadow-sm">
                <h3 className="text-lg font-bold">Carte d'Aide</h3>
                <p className="text-sm text-muted-foreground mt-2">
                    Prévisualisation de l'animation au survol et de l'entrée en cascade.
                </p>
            </div>
        ),
    },
};

export const Staggered = {
    render: () => (
        <div className="space-y-4">
            {[0, 1, 2].map((i) => (
                <AnimatedCard key={i} index={i}>
                    <div className="p-6 bg-card text-card-foreground border rounded-xl shadow-sm">
                        <h3 className="text-lg font-bold">Carte #{i + 1}</h3>
                        <p className="text-sm text-muted-foreground mt-2">
                            Délai d'entrée : {i * 50}ms
                        </p>
                    </div>
                </AnimatedCard>
            ))}
        </div>
    ),
};
