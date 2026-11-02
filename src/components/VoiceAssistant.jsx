import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX } from 'lucide-react';
import { languageOf, useT } from '@/i18n';
import { canSpeak, chunkText, claimSpeech, releaseSpeech, voicesFor } from '@/lib/readAloud';

/**
 * VoiceAssistant — « Écouter » : reads a short text aloud with the DEVICE's own speech synthesis (French voice when the device has one).
 * PKG-10 / P26: before, every click first sent the text to POST /api/tts, a proxy to an external AI voice service that the AI policy always refuses for the
 * public (so the request failed with a 500) and only then fell back to the device. Now nothing is sent anywhere: no network, no text leaves the device.
 * Where the device cannot speak, the button is not shown (no dead control). Stops when pressed again or when the component leaves the page.
 * R39: one voice at a time — pressing it stops the page reader (and the page reader stops it), and leaving the page no longer silences the page reader
 * (src/lib/readAloud.js claimSpeech / releaseSpeech). The text is read with a voice of ITS language (`lang`), whatever the interface language; the button's
 * own words are in the interface language. With no voice of that language on the device, the button says so instead of doing nothing.
 *
 * Props: text (to read), label? (default « Écouter »), size? ("sm" | "default"), lang? (language of the text, default fr: never read with a voice of another language)
 * @param {{ text: string, label?: string, size?: 'sm' | 'default', lang?: string }} props
 */
export default function VoiceAssistant({ text, label, size = 'sm', lang = 'fr' }) {
    const { t } = useT('reader');
    const [playing, setPlaying] = useState(false);
    const [noVoice, setNoVoice] = useState(false);
    const token = useRef(0);
    // this button as a holder of the device's speech: another reader starting stops it (no further chunk, button back to « Écouter »)
    const owner = useRef(/** @type {import('@/lib/readAloud').SpeechOwner} */ ({ preempt: () => { token.current += 1; setPlaying(false); } }));
    const stop = useCallback(() => { token.current += 1; if (canSpeak()) releaseSpeech(owner.current); setPlaying(false); }, []);
    useEffect(() => () => { token.current += 1; if (canSpeak()) releaseSpeech(owner.current); }, []);
    if (!canSpeak() || !text) return null;

    // R32: the whole text, in short chunks (no 1,000-character cut, no utterance long enough to be stopped early), with a voice of its language
    const speak = () => {
        const voice = voicesFor(window.speechSynthesis.getVoices?.() || [], lang)[0];
        if (!voice) { setNoVoice(true); setPlaying(false); return; }
        setNoVoice(false);
        token.current += 1;
        const mine = token.current;
        claimSpeech(owner.current);
        const chunks = chunkText(String(text));
        let i = 0;
        const next = () => {
            if (mine !== token.current) return;   // stopped, or another reader started: a late `end` never starts the next chunk
            if (i >= chunks.length) { setPlaying(false); releaseSpeech(owner.current); return; }
            const u = new window.SpeechSynthesisUtterance(chunks[i]);
            u.lang = voice.lang; u.voice = voice; u.rate = 0.9;
            u.onend = () => { i += 1; next(); };
            u.onerror = () => { if (mine === token.current) { token.current += 1; setPlaying(false); releaseSpeech(owner.current); } };
            window.speechSynthesis.speak(u);
        };
        next();
        setPlaying(true);
    };
    const langName = languageOf(lang)?.name || lang;

    return (
        <span className="inline-flex flex-wrap items-center gap-2">
            <Button
                type="button"
                variant="outline"
                size={size}
                onClick={playing ? stop : speak}
                aria-pressed={playing}
                aria-label={playing ? t('reader:voice_button.stop_label', 'Arrêter la lecture vocale') : t('reader:voice_button.play_label', 'Lire le texte à voix haute')}
                aria-describedby={noVoice ? 'voice-read-none' : undefined}
                className="gap-1.5"
                data-testid="voice-read"
            >
                {playing ? <VolumeX className="h-3.5 w-3.5" aria-hidden="true" /> : <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />}
                <span className="text-xs">{playing ? t('reader:voice_button.stop', 'Arrêter') : (label || t('reader:voice_button.listen', 'Écouter'))}</span>
            </Button>
            {noVoice ? (
                <span id="voice-read-none" role="status" className="text-xs text-amber-900" data-testid="voice-read-none">
                    {t('reader:voice_button.none', 'Aucune voix en {{language}} n’est installée sur cet appareil : ce texte ne peut pas être lu.', { language: langName })}
                </span>
            ) : null}
        </span>
    );
}
