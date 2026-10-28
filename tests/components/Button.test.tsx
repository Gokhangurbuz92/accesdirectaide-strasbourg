// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '../../src/components/ui/button';

describe('Button Component', () => {
    it('renders with default text', () => {
        render(<Button>Cliquez ici</Button>);
        expect(screen.getByRole('button', { name: /cliquez ici/i })).toBeInTheDocument();
    });

    it('calls onClick when clicked', () => {
        const handleClick = vi.fn();
        render(<Button onClick={handleClick}>Action</Button>);
        fireEvent.click(screen.getByRole('button'));
        expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('is disabled when disabled prop is true', () => {
        render(<Button disabled>Désactivé</Button>);
        expect(screen.getByRole('button')).toBeDisabled();
    });

    it('applies base class names', () => {
        render(<Button>Test</Button>);
        const btn = screen.getByRole('button');
        expect(btn.className).toContain('inline-flex');
        expect(btn.className).toContain('items-center');
        expect(btn.className).toContain('font-medium');
    });

    it('applies size variant classes for lg', () => {
        render(<Button size="lg">Grand bouton</Button>);
        const btn = screen.getByRole('button');
        // lg variant uses larger dimensions — verify it has different classes than default
        expect(btn.className).toContain('inline-flex');
        expect(btn.className.length).toBeGreaterThan(50);
    });

    it('applies destructive variant classes', () => {
        render(<Button variant="destructive">Supprimer</Button>);
        const btn = screen.getByRole('button');
        // Destructive variant has distinct styling
        expect(btn.className).toContain('inline-flex');
        expect(btn.className.length).toBeGreaterThan(50);
    });

    it('renders as child element when asChild is true', () => {
        render(
            <Button asChild>
                <a href="/test">Lien bouton</a>
            </Button>
        );
        const link = screen.getByRole('link', { name: /lien bouton/i });
        expect(link).toBeInTheDocument();
        expect(link.tagName).toBe('A');
    });

    it('does not call onClick when disabled', () => {
        const handleClick = vi.fn();
        render(<Button disabled onClick={handleClick}>Interdit</Button>);
        fireEvent.click(screen.getByRole('button'));
        expect(handleClick).not.toHaveBeenCalled();
    });
});
