import { useState, useEffect, useCallback } from 'react';
import { EyeOff } from 'lucide-react';
import { frontendEnv } from '@/config/env';

export default function HideScreenButton() {
    const [isHidden, setIsHidden] = useState(false);
    const [escCount, setEscCount] = useState(0);

    const triggerHide = useCallback(() => {
        setIsHidden(true);
        setEscCount(0);
    }, []);

    const triggerShow = useCallback(() => {
        setIsHidden(false);
    }, []);

    useEffect(() => {
        const handleKeyDown = (/** @type {{ key: string; }} */ e) => {
            if (e.key === 'Escape') {
                if (!isHidden) {
                    setEscCount(prev => {
                        const newCount = prev + 1;
                        if (newCount >= 3) {
                            triggerHide();
                            return 0;
                        }
                        return newCount;
                    });
                }
            } else {
                // Reset count if another key is pressed
                setEscCount(0);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isHidden, triggerHide]);

    // Reset count quickly to require fast 3 presses
    useEffect(() => {
        if (escCount > 0) {
            const timer = setTimeout(() => setEscCount(0), 1000);
            return () => clearTimeout(timer);
        }
    }, [escCount]);

    if (isHidden) {
        return (
            <div
                className="fixed inset-0 z-[9999] bg-slate-900/95 backdrop-blur-3xl flex flex-col items-center justify-center p-4 cursor-pointer"
                onClick={triggerShow}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        triggerShow();
                    }
                }}
                aria-label="Écran masqué. Cliquez n'importe où pour afficher l'écran."
                role="button"
                tabIndex={0}
            >
                <EyeOff className="w-16 h-16 text-slate-400 mb-6" />
                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-2 text-center">
                    Écran masqué de sécurité
                </h2>
                <p className="text-slate-300 text-lg sm:text-xl text-center max-w-md">
                    Cliquez n'importe où sur l'écran pour reprendre votre activité.
                </p>
            </div>
        );
    }

    return (
        <div className={`fixed ${frontendEnv.flags.publicBeta ? 'bottom-6' : 'bottom-24'} right-4 z-[40] sm:right-6`}>   {/* above the assistant button when it is shown */}
            {/* R26: a safety control (hide the page at once if someone looks over your shoulder) — its purpose is now written on it; a bare red
                circle read as an alert or an error */}
            <button
                type="button"
                onClick={triggerHide}
                className="flex min-h-11 items-center gap-2 rounded-full bg-slate-900 px-3 text-sm font-semibold text-white shadow-lg ring-1 ring-white/20 transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 sm:px-4"
                aria-label="Masquer l’écran immédiatement (ou appuyez trois fois sur Échap)"
                title="Masquer l’écran immédiatement (Échap trois fois)"
                data-testid="hide-screen-button"
            >
                <EyeOff className="h-5 w-5" aria-hidden="true" />
                <span className="hidden sm:inline">Masquer l’écran</span>
            </button>
        </div>
    );
}
