// @ts-nocheck
import logger from '../../_utils/logger.js';
// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { ProOutlookToken } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { env } from '../../_utils/env.js';
import { decryptToken, encryptToken, envelopeIv } from '../../_utils/outlook-token-crypto.js';
import { requireProAuth, requireProStructureContext } from '../../_utils/auth.js';
import { outlookStatus } from '../../_services/calendar-outlook.js';

// R46: the same endpoints as the shared free/busy adapter (api/_services/rdv-calendar-busy.js) — OUTLOOK_AUTHORITY_URL / OUTLOOK_GRAPH_BASE_URL point at a
// sandbox or a local mock Graph; this route used to hard-code Microsoft's hosts, so it could not be tested against a mock and ignored the sandbox setting
const authorityBase = () => String(process.env.OUTLOOK_AUTHORITY_URL || 'https://login.microsoftonline.com/common/oauth2/v2.0').replace(/\/+$/, '');
const graphBase = () => String(process.env.OUTLOOK_GRAPH_BASE_URL || 'https://graph.microsoft.com/v1.0').replace(/\/+$/, '');
/** R47: every Microsoft call is bounded (a hung token or Graph request used to hold the function until the platform killed it); same bound as rdv-calendar-busy */
export const OUTLOOK_PROVIDER_TIMEOUT_MS = 8_000;
const bounded = () => AbortSignal.timeout(OUTLOOK_PROVIDER_TIMEOUT_MS);

/**
 * Outlook Availability Handler
 *
 * Queries Microsoft Graph API for free/busy slots.
 * Policy: ZERO STORAGE of calendar details — only availability status.
 * Tokens are persisted in ProOutlookToken (encrypted at rest via AES-256-GCM).
 *
 * GET /api/pro/outlook-availability?start=...&end=...
 */

// AES-256-GCM helpers live in _utils/outlook-token-crypto.js (strict: no plaintext fallback, same envelope as outlook.js)

/**
 * Attempts to refresh an expired Outlook access_token using the stored refresh_token.
 *
 * @param {Record<string, any>} storedToken - ProOutlookToken record
 * @param {string} userId - ProUser ID
 * @returns {Promise<string|null>} fresh access_token (plaintext) or null if refresh failed
 */
async function refreshOutlookToken(storedToken, userId) {
    const clientId = env.outlook.clientId;
    const clientSecret = env.outlook.clientSecret;

    let refreshToken;
    try {
        refreshToken = decryptToken(storedToken.refreshTokenEnc);
    } catch {
        return null;
    }

    if (!clientId || !clientSecret || !refreshToken) {
        return null;
    }

    try {
        const response = await fetch(
            `${authorityBase()}/token`,
            {
                method: 'POST',
                signal: bounded(),
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken,
                }),
            }
        );

        const tokens = await response.json();
        if (!response.ok || !tokens.access_token) {
            logger.warn('[Outlook Availability] token refresh refused');   // R46: no provider text, no account id in logs
            return null;
        }

        const newExpiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);

        // Persist refreshed tokens back to ProOutlookToken (encrypted)
        const accessEnvelope = encryptToken(tokens.access_token);
        await db.update(ProOutlookToken).set({
            accessTokenEnc: accessEnvelope,
            refreshTokenEnc: encryptToken(tokens.refresh_token || refreshToken),
            iv: envelopeIv(accessEnvelope),
            expiresAt: newExpiresAt,
        }).where(eq(ProOutlookToken.userId, userId));

        return tokens.access_token;
    } catch (err) {
        logger.warn({ err: { name: err?.name } }, '[Outlook Availability] token refresh failed');
        return null;
    }
}

async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;
    res.setHeader('Cache-Control', 'no-store');
    // R46: Outlook switched off (or incomplete / pending activation) = the same honest state as /api/pro/outlook — no token is read, no provider is called
    const status = outlookStatus();
    if (!status.enabled) return res.status(200).json({ ok: false, status: status.reason === 'NOT_CONFIGURED' ? 'not_configured' : 'disabled', reason: status.reason });

    const url = new URL(req.url || '/', `https://${req.headers?.host || 'localhost'}`);
    const start = url.searchParams.get('start');
    const end = url.searchParams.get('end');

    if (!start || !end) {
        return res.status(400).json({ error: 'Paramètres start et end requis' });
    }

    try {
        // Read tokens from ProOutlookToken (encrypted at rest)
        const storedToken = await db.query.ProOutlookToken.findFirst({
            where: eq(ProOutlookToken.userId, proCtx.userId),
        });

        if (!storedToken) {
            return res.status(404).json({
                error: 'Outlook non synchronisé',
                message: 'Connectez votre compte Outlook via le tableau de bord pour activer la synchronisation.',
            });
        }

        // Decrypt and check expiry
        let currentToken;
        try {
            currentToken = decryptToken(storedToken.accessTokenEnc);
        } catch {
            return res.status(401).json({
                error: 'Token Outlook corrompu',
                message: 'Veuillez re-synchroniser votre compte Outlook.',
            });
        }

        if (storedToken.expiresAt <= new Date()) {
            logger.info('[Outlook Availability] Token expiré, tentative de refresh...');
            const refreshed = await refreshOutlookToken(storedToken, proCtx.userId);
            if (!refreshed) {
                return res.status(401).json({
                    error: 'Session Outlook expirée',
                    message: 'Veuillez re-synchroniser votre compte Outlook.',
                });
            }
            currentToken = refreshed;
        }

        // Query Microsoft Graph for free/busy
        const graphResponse = await fetch(
            `${graphBase()}/me/calendar/getSchedule`,
            {
                method: 'POST',
                signal: bounded(),
                headers: {
                    Authorization: `Bearer ${currentToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    schedules: [req.user.email],
                    startTime: { dateTime: start, timeZone: 'Europe/Paris' },
                    endTime: { dateTime: end, timeZone: 'Europe/Paris' },
                    availabilityViewInterval: 30, // 30-minute slots
                }),
            }
        );

        if (!graphResponse.ok) {
            await graphResponse.json().catch(() => ({}));   // R46: the provider's error body is never logged (it can quote the mailbox)
            logger.warn({ status: graphResponse.status }, '[Outlook Availability] Graph refused the free/busy read');

            // Token rejected at runtime (maybe revoked externally)
            if (graphResponse.status === 401) {
                const refreshed = await refreshOutlookToken(storedToken, proCtx.userId);
                if (!refreshed) {
                    return res.status(401).json({
                        error: 'Token Outlook expiré',
                        message: 'Veuillez re-synchroniser votre compte Outlook.',
                    });
                }
                // Retry once with refreshed token
                const retryResponse = await fetch(
                    `${graphBase()}/me/calendar/getSchedule`,
                    {
                        method: 'POST',
                        signal: bounded(),
                        headers: {
                            Authorization: `Bearer ${refreshed}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            schedules: [req.user.email],
                            startTime: { dateTime: start, timeZone: 'Europe/Paris' },
                            endTime: { dateTime: end, timeZone: 'Europe/Paris' },
                            availabilityViewInterval: 30,
                        }),
                    }
                );
                if (!retryResponse.ok) {
                    return res.status(502).json({
                        error: 'Impossible de lire l\'agenda Outlook.',
                    });
                }
                const retryData = await retryResponse.json();
                const retrySchedule = retryData.value?.[0]?.availabilityView || '';
                return res.status(200).json({
                    ok: true,
                    slots: parseAvailabilityView(retrySchedule),
                    interval: 30,
                    start,
                    end,
                    tokenRefreshed: true,
                });
            }

            return res.status(502).json({
                error: 'Impossible de lire l\'agenda Outlook.',
            });
        }

        const data = await graphResponse.json();
        const schedule = data.value?.[0]?.availabilityView || '';

        return res.status(200).json({
            ok: true,
            slots: parseAvailabilityView(schedule),
            interval: 30,
            start,
            end,
        });
    } catch (error) {
        // @ts-ignore
        logger.error({ err: { name: error?.name } }, '[Outlook Availability] failed');
        // R47: Microsoft did not answer in time (or the network failed): the provider's state, not a server fault
        // @ts-ignore
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || (error?.name === 'TypeError' && error?.message === 'fetch failed')) return res.status(504).json({ error: 'Impossible de lire l\'agenda Outlook.' });
        return res.status(500).json({ error: 'Erreur serveur interne' });
    }
}

/**
 * Translate Microsoft availability string to ADA format.
 * '0' = Available, '1' = Tentative, '2' = Busy, '3' = OOF
 *
 * @param {string} view
 * @returns {Array<{index: number, isAvailable: boolean, status: string}>}
 */
function parseAvailabilityView(view) {
    return view.split('').map((status, index) => ({
        index,
        isAvailable: status === '0',
        status: status === '0' ? 'libre' : status === '1' ? 'provisoire' : 'occupé',
    }));
}

export default requireProAuth(handler);
