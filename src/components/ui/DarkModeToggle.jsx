import { useState, useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/providers/ThemeProvider';

/**
 * DarkModeToggle — Toggles between light and dark mode.
 *
 * Uses ThemeProvider context to avoid duplicating logic.
 * Employs a 'mounted' state check to prevent React hydration mismatches
 * between SSR/Prerender and the initial client render.
 */
export default function DarkModeToggle({ className = '' }) {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Détermine si le thème est sombre
    const isDark =
        theme === 'dark' ||
        (theme === 'system' && mounted && window.matchMedia('(prefers-color-scheme: dark)').matches);

    // Empêche le mismatch d'hydratation en gardant le même rendu initial
    if (!mounted) {
        return (
            <Button
                variant="ghost"
                size="sm"
                className={`h-8 w-8 p-0 opacity-0 ${className}`}
                aria-hidden="true"
                disabled
            >
                <span className="sr-only">Chargement du thème...</span>
            </Button>
        );
    }

    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className={`h-8 w-8 p-0 ${className}`}
            aria-label={isDark ? 'Activer le mode clair' : 'Activer le mode sombre'}
            title={isDark ? 'Activer le mode clair' : 'Activer le mode sombre'}
        >
            {isDark ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} className="text-slate-600" />}
        </Button>
    );
}
