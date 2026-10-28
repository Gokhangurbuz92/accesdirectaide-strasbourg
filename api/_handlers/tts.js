// @ts-nocheck
/**
 * POST /api/tts — RETIRED (R12, P26).
 *
 * It was a server-side proxy sending the page text to an external AI voice service (Gemini TTS) — refused by the AI policy for the public, and unused since
 * PKG-10: « Lire le texte à voix haute » speaks on the person's own device, nothing leaves it (src/components/VoiceAssistant.jsx). The route answers 410 and
 * calls no provider, so no text can be sent to a voice service through it.
 */
export default async function handler(/** @type {import('../_utils/http-types').ApiRequest} */ req, /** @type {import('../_utils/http-types').ApiResponse} */ res) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(410).json({ error: 'SERVER_TTS_RETIRED', message: 'La lecture à voix haute se fait sur votre appareil : aucun service vocal externe n’est utilisé.' });
}
