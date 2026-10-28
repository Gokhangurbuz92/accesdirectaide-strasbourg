import type { Meta, StoryObj } from '@storybook/react';
import { AidCard } from './AidCard';

const meta: Meta<typeof AidCard> = {
    title: 'Molecules/AidCard',
    component: AidCard,
    tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AidCard>;

const CURRENT_NOW_FOR_STORIES = new Date('2026-02-20T00:00:00.000Z');

export const Fresh: Story = {
    args: {
        title: 'Aide d\'urgence pour le logement',
        href: '#',
        summary: 'Cette aide financière permet de prévenir les expulsions locatives et de garantir le maintien dans le logement des ménages en difficulté.',
        isUrgent: true,
        verifiedAt: new Date('2026-02-15T00:00:00.000Z'),
        sourceLabel: 'Ministère du Logement',
        sourceUrl: 'https://example.com',
        now: CURRENT_NOW_FOR_STORIES,
    },
};

export const Stale: Story = {
    args: {
        title: 'Soutien psychologique gratuit',
        href: '#',
        summary: 'Consultations gratuites avec des psychologues partenaires pour les jeunes de moins de 25 ans.',
        isUrgent: false,
        verifiedAt: new Date('2025-01-10T00:00:00.000Z'),
        sourceLabel: 'Santé Publique France',
        sourceUrl: 'https://example.com',
        now: CURRENT_NOW_FOR_STORIES,
    },
};

export const Unknown: Story = {
    args: {
        title: 'Prime d\'activité',
        href: '#',
        summary: 'La prime d\'activité est une aide financière destinée aux travailleurs modestes pour compléter leurs revenus.',
        isUrgent: false,
        verifiedAt: null,
        sourceLabel: 'CAF',
        now: CURRENT_NOW_FOR_STORIES,
    },
};
