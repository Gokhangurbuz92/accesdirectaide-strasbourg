import type { Meta, StoryObj } from '@storybook/react';
import EmptyState from './EmptyState';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';

const meta: Meta<typeof EmptyState> = {
    title: 'Feedback/EmptyState',
    component: EmptyState,
    tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {
    args: {
        title: 'Information indisponible',
        description: 'Les données que vous recherchez ne sont pas accessibles pour le moment.',
    },
};

export const WithActions: Story = {
    args: {
        title: 'Aucune aide trouvée',
        description: 'Modifiez vos critères de recherche pour obtenir plus de résultats.',
        actions: (
            <>
                <Button variant="outline">Retour</Button>
                <Button>Voir toutes les aides</Button>
            </>
        ),
    },
};

export const WithIcon: Story = {
    args: {
        title: 'Recherche sans résultat',
        description: 'Nous n\'avons pas trouvé d\'informations correspondant à votre requête.',
        icon: <Search className="h-8 w-8" />,
    },
};
