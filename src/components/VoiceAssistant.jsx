// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX } from 'lucide-react';

/**
 * VoiceAssistant — « Écouter » : reads a short text aloud with the DEVICE's own speech synthesis (French voice when the device has one).
 * PKG-10 / P26: before, every click first sent the text to POST /api/tts, a proxy to an external AI voice service that the AI policy always refuses for the
 * public (so the request failed with a 500) and only then fell back to the device. Now nothing is sent anywhere: no network, no text leaves the device.
 * Where the device cannot speak, the button is not shown (no dead control). Stops when pressed again or when the component leaves the page.
 *
 * Props: text (to read), label? (default « Écouter »), size? ("sm" | "default")
 */
const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';

export default function VoiceAssistant({ text, label = 'Écouter', size = 'sm' }) {
    const [playing, setPlaying] = useState(false);
    const stop = useCallback(() => { if (canSpeak()) window.speechSynthesis.cancel(); setPlaying(false); }, []);
    useEffect(() => () => { if (canSpeak()) window.speechSynthesis.cancel(); }, []);
    if (!canSpeak() || !text) return null;

    const speak = () => {
        window.speechSynthesis.cancel();
        const u = new window.SpeechSynthesisUtterance(String(text).slice(0, 1000));
        u.lang = 'fr-FR';
        u.rate = 0.9;
        const fr = window.speechSynthesis.getVoices?.().find((v) => /^fr(-|_|$)/i.test(v.lang));
        if (fr) u.voice = fr;
        u.onend = () => setPlaying(false);
        u.onerror = () => setPlaying(false);
        window.speechSynthesis.speak(u);
        setPlaying(true);
    };

    return (
        <Button
            type="button"
            variant="outline"
            size={size}
            onClick={playing ? stop : speak}
            aria-pressed={playing}
            aria-label={playing ? 'Arrêter la lecture vocale' : 'Lire le texte à voix haute'}
            className="gap-1.5"
            data-testid="voice-read"
        >
            {playing ? <VolumeX className="h-3.5 w-3.5" aria-hidden="true" /> : <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />}
            <span className="text-xs">{playing ? 'Arrêter' : label}</span>
        </Button>
    );
}
