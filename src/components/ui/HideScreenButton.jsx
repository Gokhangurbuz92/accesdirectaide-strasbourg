import { useState, useEffect, useCallback } from 'react';
import { EyeOff } from 'lucide-react';

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
        <div className="fixed bottom-24 right-6 z-[40]">
            <button
                onClick={triggerHide}
                className="group relative flex items-center justify-center w-12 h-12 bg-red-600 hover:bg-red-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
                aria-label="Cacher mon écran immédiatement (Echap x3)"
            >
                <EyeOff className="w-5 h-5" />
                <span className="absolute right-full mr-3 whitespace-nowrap bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden sm:block">
                    Cacher mon écran (Échap x3)
                </span>
            </button>
        </div>
    );
}
