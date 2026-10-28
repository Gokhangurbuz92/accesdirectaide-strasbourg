// @ts-nocheck
import logger from '../../_utils/logger.js';
import { requireProAuth, requireProStructureContext } from '../../_utils/auth.js';
import { resolveDossierForStructure, grantHasPurpose, PURPOSE_AI } from '../../_utils/share-access.js';
import { presentResults } from '../../lib/shareResults.js';
import { createDraft, listDrafts, review } from '../../_services/dossier-synthesis.js';

/**
 * Dossier AI synthesis (Pro-only) — PKG-6 / R17: LOCAL model only (no Gemini, no external model, no fallback); the result is a DRAFT in the review queue.
 *   POST /api/pro/dossier-synthesis { shareId }                                       → a new draft (1–3 points), labelled AI, not reviewed
 *   GET  /api/pro/dossier-synthesis?shareId=                                          → this organization's drafts for the dossier
 *   POST /api/pro/dossier-synthesis { action: 'review', shareId, id, decision: 'approve' | 'reject', note }   → a member of the organization reviews it
 * RC5 (kept): data is processed only for (1) a structure holding an active grant, (2) an unexpired dossier and (3) the citizen's EXPLICIT, purpose-specific consent
 * PURP-05 granted by the CITIZEN for THIS organization (the PURP-06 sharing agreement does NOT suffice). The citizen's situation is NOT used; internal fields
 * and every structure's notes / files are stripped. See api/_services/dossier-synthesis.js (model call, validation, draft, review, forgetting).
 */
async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    res.setHeader?.('Cache-Control', 'no-store');
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }
    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const shareId = String((req.method === 'GET' ? req.query?.shareId : body.shareId) || '').trim();
    if (!shareId) {
        return res.status(400).json({ error: 'shareId requis.' });
    }
    const reply = (out) => (out.ok ? res.status(200).json(out) : res.status(out.status).json({ error: out.code, message: out.message }));
    try {
        if (req.method === 'GET') return reply(await listDrafts(shareId, proCtx));
        if (body.action === 'review') return reply(await review(shareId, body.id, body.decision, body.note, proCtx));

        const found = await resolveDossierForStructure(shareId, proCtx);
        if (found.status === 'not_found') {
            return res.status(404).json({ error: 'Dossier introuvable.' });
        }
        if (found.status === 'expired') {
            return res.status(410).json({ error: 'Ce dossier a expiré.' });
        }
        const shared = found.shared;
        if (!grantHasPurpose(found.grant, PURPOSE_AI)) {
            return res.status(403).json({ error: 'AI_CONSENT_REQUIRED', message: 'La personne n\'a pas autorisé l\'analyse par IA (PURP-05) pour votre structure. L\'accord de partage (PURP-06) ne suffit pas.' });
        }
        const safeData = { ...presentResults(shared.results || {}) };
        delete safeData._files;
        delete safeData._consent;
        delete safeData._followUp;
        delete safeData._followUps;
        return reply(await createDraft(shareId, proCtx, safeData));
    } catch (error) {
        logger.error({ err: { name: error?.name } }, '[Synthesis] Erreur');
        return res.status(500).json({ error: 'Échec de la synthèse.' });
    }
}

export default requireProAuth(handler);
