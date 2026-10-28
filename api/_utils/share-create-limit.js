import { checkRateLimit, getClientIp, getRateLimitStatus } from './rateLimit.js';
import { resolveCitizen } from './citizen-auth.js';
import { isRestricted } from '../_services/processing-restriction.js';

/**
 * PKG-11 / PUB-6 — the public dossier creation, bounded per address. api/_handlers/share/create.js is byte-pinned (RC4 freeze), so the limit sits in front of it:
 * the router wraps the unchanged create.js with this gate (api/routes.js), and every request that passes is handled by create.js as before. The database also
 * bounds each dossier's size (migration 0033). 60 per 10 minutes per address: far above a person sharing with a few organizations; the full native QA run peaks
 * at 42 from one address (run 31d6d7).
 * @param {(req: any, res: any) => any} createShare the pinned handler
 */
export function withShareCreateLimit(createShare) {
    return async function shareCreateLimited(/** @type {any} */ req, /** @type {any} */ res) {
        if (req.method === 'POST') {
            const limit = await checkRateLimit('SHARE_CREATE', `ip:${getClientIp(req)}`);
            if (!limit.allowed) {
                res.setHeader('Retry-After', '600');
                // @ts-ignore
                return res.status(getRateLimitStatus(limit)).json(limit.error || { error: 'Trop de tentatives.', code: 'RATE_LIMITED' });
            }
            // R14: a signed-in person who asked for the limitation of processing (RGPD art. 18) does not share anew (processing-restriction.js) — create.js stored
            // a live, unsealed link for them; it is pinned, so the refusal sits here like the limit
            const citizen = await resolveCitizen(req).catch(() => null);
            if (citizen && (await isRestricted(citizen.id).catch(() => true))) {
                return res.status(409).json({ error: 'Vous avez demandé la limitation du traitement de vos données : levez-la depuis vos paramètres avant de créer un nouveau partage.', code: 'PROCESSING_RESTRICTED' });
            }
        }
        return createShare(req, res);
    };
}
