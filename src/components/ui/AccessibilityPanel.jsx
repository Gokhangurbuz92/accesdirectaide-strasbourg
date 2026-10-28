import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import {
  Eye,
  Type,
  Moon,
  Sun,
  Minus,
  Plus,
  RotateCcw,
  Maximize2
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ACCESSIBILITY_EVENT } from '@/lib/accountAccessibility';

export default function AccessibilityPanel() {
  const [settings, setSettings] = useState({
    fontSize: 100,
    contrast: 'normal',
    lineHeight: 'normal',
    simplifiedMode: false
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem('accessibilitySettings');
      if (saved) setSettings(JSON.parse(saved));
    } catch { /* unreadable or blocked storage: keep the defaults */ }
    // K0 / C04: the signed-in account's saved preferences arrive through this event (src/lib/accountAccessibility.js)
    const onAccount = (/** @type {any} */ e) => { if (e?.detail?.device) setSettings(e.detail.device); };
    window.addEventListener(ACCESSIBILITY_EVENT, onAccount);
    return () => window.removeEventListener(ACCESSIBILITY_EVENT, onAccount);
  }, []);

  useEffect(() => {
    try { localStorage.setItem('accessibilitySettings', JSON.stringify(settings)); } catch { /* private browsing */ }

    document.documentElement.style.fontSize = `${settings.fontSize}%`;

    document.documentElement.classList.remove('high-contrast', 'dark-mode');
    document.body.classList.remove('high-contrast', 'dark-mode');
    if (settings.contrast === 'high') {
      document.documentElement.classList.add('high-contrast');
      document.body.classList.add('high-contrast');
    } else if (settings.contrast === 'dark') {
      document.documentElement.classList.add('dark-mode');
      document.body.classList.add('dark-mode');
    }

    document.body.classList.remove('large-line-height');
    if (settings.lineHeight === 'large') {
      document.body.classList.add('large-line-height');
    }

    document.body.classList.toggle('simplified-mode', settings.simplifiedMode);
    // K0 / C04: the settings screen's "reduce motion" choice is re-applied on every page, not only at the moment it is toggled
    try { document.body.classList.toggle('reduce-motion', JSON.parse(localStorage.getItem('ada_citizen_prefs') || '{}').reduceMotion === true); } catch { /* unreadable storage */ }
  }, [settings]);

  const resetSettings = () => {
    setSettings({
      fontSize: 100,
      contrast: 'normal',
      lineHeight: 'normal',
      simplifiedMode: false
    });
  };

  const adjustFontSize = (/** @type {number} */ delta) => {
    setSettings(prev => ({
      ...prev,
      fontSize: Math.min(150, Math.max(80, prev.fontSize + delta))
    }));
  };

  return (
    <div className="flex items-center gap-1">
      {/* Visible controls on desktop for direct UI access (DoD 3.1) */}
      <div className="hidden sm:flex items-center bg-slate-100 rounded-md border border-slate-200">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-slate-700 hover:text-blue-700 rounded-r-none"
          onClick={() => adjustFontSize(-10)}
          aria-label="Réduire la taille du texte"
          disabled={settings.fontSize <= 80}
        >
          <div className="flex items-center gap-0.5">
            <span className="font-bold text-sm leading-none">A</span>
            <Minus className="h-3 w-3" />
          </div>
        </Button>
        <span className="text-xs font-semibold px-1 min-w-[36px] text-center text-slate-600">
          {settings.fontSize}%
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-slate-700 hover:text-blue-700 rounded-l-none"
          onClick={() => adjustFontSize(10)}
          aria-label="Augmenter la taille du texte"
          disabled={settings.fontSize >= 150}
        >
          <div className="flex items-center gap-0.5">
            <span className="font-bold text-sm leading-none">A</span>
            <Plus className="h-3 w-3" />
          </div>
        </Button>
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-foreground border-border hover:bg-accent hover:text-accent-foreground"
            aria-label="Options d'accessibilité"
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            <span className="hidden md:inline xl:hidden 2xl:inline">Accessibilité</span>{/* PKG-11 / P01: no room beside the full desktop menu from 1280 to 1535 px (the button keeps its name) */}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-4 bg-white border border-slate-200 shadow-xl rounded-xl" align="end" sideOffset={8}>
          <div className="space-y-3">
            {/* Title with accent */}
            <div className="flex items-center gap-2 pb-1">
              <div className="w-1 h-5 rounded-full bg-gradient-to-b from-blue-600 to-indigo-600" />
              <h3 className="font-bold text-slate-900 text-sm">
                Adapter l'affichage
              </h3>
            </div>

            {/* Taille du texte */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                Taille du texte
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => adjustFontSize(-10)}
                  aria-label="Réduire la taille du texte"
                  disabled={settings.fontSize <= 80}
                  className="h-10 w-10 p-0 text-slate-600 bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-slate-300 rounded-lg transition-all"
                >
                  <span className="text-xl font-bold leading-none">−</span>
                </Button>
                <span className="flex-1 text-center font-bold text-slate-900 text-lg tabular-nums">
                  {settings.fontSize}%
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => adjustFontSize(10)}
                  aria-label="Augmenter la taille du texte"
                  disabled={settings.fontSize >= 150}
                  className="h-10 w-10 p-0 text-slate-600 bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-slate-300 rounded-lg transition-all"
                >
                  <span className="text-xl font-bold leading-none">+</span>
                </Button>
              </div>
            </div>

            <hr className="border-slate-100" />

            {/* Contraste */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                Contraste
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                <Button
                  variant={settings.contrast === 'normal' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSettings(prev => ({ ...prev, contrast: 'normal' }))}
                  className={`text-xs h-8 ${settings.contrast !== 'normal' ? 'border-slate-200 text-slate-600 bg-slate-50 hover:bg-slate-100' : ''}`}
                >
                  <Sun className="h-3 w-3 mr-1" aria-hidden="true" />
                  Normal
                </Button>
                <Button
                  variant={settings.contrast === 'high' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSettings(prev => ({ ...prev, contrast: 'high' }))}
                  className={`text-xs h-8 ${settings.contrast !== 'high' ? 'border-slate-200 text-slate-600 bg-slate-50 hover:bg-slate-100' : ''}`}
                >
                  <Eye className="h-3 w-3 mr-1" aria-hidden="true" />
                  Fort
                </Button>
                <Button
                  variant={settings.contrast === 'dark' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSettings(prev => ({ ...prev, contrast: 'dark' }))}
                  className={`text-xs h-8 ${settings.contrast !== 'dark' ? 'border-slate-200 text-slate-600 bg-slate-50 hover:bg-slate-100' : ''}`}
                >
                  <Moon className="h-3 w-3 mr-1" aria-hidden="true" />
                  Sombre
                </Button>
              </div>
            </div>

            <hr className="border-slate-100" />

            {/* Interligne */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                Espacement des lignes
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  variant={settings.lineHeight === 'normal' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSettings(prev => ({ ...prev, lineHeight: 'normal' }))}
                  className={`text-xs h-8 ${settings.lineHeight !== 'normal' ? 'border-slate-200 text-slate-600 bg-slate-50 hover:bg-slate-100' : ''}`}
                >
                  Normal
                </Button>
                <Button
                  variant={settings.lineHeight === 'large' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSettings(prev => ({ ...prev, lineHeight: 'large' }))}
                  className={`text-xs h-8 ${settings.lineHeight !== 'large' ? 'border-slate-200 text-slate-600 bg-slate-50 hover:bg-slate-100' : ''}`}
                >
                  <Maximize2 className="h-3 w-3 mr-1" aria-hidden="true" />
                  Large
                </Button>
              </div>
            </div>

            <hr className="border-slate-100" />

            {/* Mode simplifié + Réinitialiser */}
            <div className="space-y-1.5">
              <Button
                variant={settings.simplifiedMode ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSettings(prev => ({ ...prev, simplifiedMode: !prev.simplifiedMode }))}
                className={`w-full text-xs h-8 ${!settings.simplifiedMode ? 'border-slate-200 text-slate-600 bg-slate-50 hover:bg-slate-100' : ''}`}
              >
                <Type className="h-3 w-3 mr-1.5" aria-hidden="true" />
                Mode lecture facile
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetSettings}
                className="w-full text-[11px] h-7 text-slate-400 hover:text-slate-600"
              >
                <RotateCcw className="h-3 w-3 mr-1.5" aria-hidden="true" />
                Réinitialiser
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
