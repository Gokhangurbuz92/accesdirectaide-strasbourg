// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX } from 'lucide-react';
import { chunkText, voicesFor } from '@/lib/readAloud';

/**
 * VoiceAssistant — « Écouter » : reads a short text aloud with the DEVICE's own speech synthesis (French voice when the device has one).
 * PKG-10 / P26: before, every click first sent the text to POST /api/tts, a proxy to an external AI voice service that the AI policy always refuses for the
 * public (so the request failed with a 500) and only then fell back to the device. Now nothing is sent anywhere: no network, no text leaves the device.
 * Where the device cannot speak, the button is not shown (no dead control). Stops when pressed again or when the component leaves the page.
 *
 * Props: text (to read), label? (default « Écouter »), size? ("sm" | "default"), lang? (language of the text, default fr: never read with a voice of another language)
 */
const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';

export default function VoiceAssistant({ text, label = 'Écouter', size = 'sm', lang = 'fr' }) {
    const [playing, setPlaying] = useState(false);
    const stop = useCallback(() => { if (canSpeak()) window.speechSynthesis.cancel(); setPlaying(false); }, []);
    useEffect(() => () => { if (canSpeak()) window.speechSynthesis.cancel(); }, []);
    if (!canSpeak() || !text) return null;

    // R32: the whole text, in short chunks (no 1,000-character cut, no utterance long enough to be stopped early), with a voice of its language
    const speak = () => {
        window.speechSynthesis.cancel();
        const voice = voicesFor(window.speechSynthesis.getVoices?.() || [], lang)[0];
        if (!voice) { setPlaying(false); return; }
        const chunks = chunkText(String(text));
        let i = 0;
        const next = () => {
            if (i >= chunks.length) { setPlaying(false); return; }
            const u = new window.SpeechSynthesisUtterance(chunks[i]);
            u.lang = voice.lang; u.voice = voice; u.rate = 0.9;
            u.onend = () => { i += 1; next(); };
            u.onerror = () => setPlaying(false);
            window.speechSynthesis.speak(u);
        };
        next();
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
