import logger from '../../../_utils/logger.js';
import { passwordMessage, passwordProblems } from '../../../../src/lib/passwordPolicy.js';
import { hashPassword } from '../../../_utils/user-auth.js';
import { PRO_PENDING_VERIFICATION_STATUS, logProAudit } from '../../../_utils/auth.js';
import { checkRateLimit, getClientIp } from '../../../_utils/rateLimit.js';
import { sendMail } from '../../../_utils/mailer.js';
import { db } from '../../../../src/db/index.js';
import { Structure, ProUser } from '../../../../src/db/schema.js';
import { sql } from 'drizzle-orm';
import { isPublicBetaRestricted, proSelfRegistrationOpen } from '../../../_utils/public-beta.js';
import { PRO_TERMS_REQUIRED_REFUSAL, proTermsInForce, recordProTermsAcceptance, termsAcceptanceGiven } from '../../../_utils/pro-terms.js';
import { validSiret } from '../../../_utils/siret.js';

/**
 * G14 (owner decision 23/11/2026: ADA Pro opens without a pilot structure) — a structure's own sign-up is a REQUEST, never an open space:
 *   - the professional terms in force are accepted and recorded exactly as at the invited sign-up (api/_utils/pro-terms.js, channel 'register');
 *     no terms in force (Production before the owner's approval) → refused before anything is read;
 *   - a SIRET is required (14 digits, Luhn key — api/_utils/siret.js, the check of the verification chain, La Poste's rule included) and the name is bounded;
 *   - the first administrator is created with the status PENDING_VERIFICATION_STATUS: not a session status (api/_utils/auth.js PRO_SESSION_STATUSES), so
 *     the account can neither sign in (login answers PRO_REGISTRATION_PENDING), nor refresh, nor receive an MFA invitation, nor use ProConnect;
 *   - nothing signs in here: the answer is the same « demande reçue » whatever happened (new structure, known SIRET, address already used, a concurrent
 *     request) — the address and the SIRET are not oracles any more;
 *   - an ADA administrator verifies the structure on an official source and lets it in from /admin/organizations (« Vérifier et activer »:
 *     api/_services/pro-self-registration.js), or refuses the request (« Refuser »).
 * Duplicates (Structure.siret is UNIQUE, no migration): a SIRET already held by a Structure creates NO second Structure — the pending administrator is
 * attached to the existing record, where the administrator sees the request next to the record's existing members; the declared name is kept in the
 * journal only (the record is not changed). The person learns nothing about the existing record.
 */
export const PENDING_VERIFICATION_STATUS = PRO_PENDING_VERIFICATION_STATUS;
/** the bounds of a structure name: the 2-character minimum of the structure import schema (api/lib/ingestion/validators.js) and the 200 characters
 * the directory keeps of a name (api/_services/verification/datainclusion.js, api/_services/admin-content.js) */
export const STRUCTURE_NAME_MIN = 2;
export const STRUCTURE_NAME_MAX = 200;
export const PRO_REGISTRATION_RECEIVED = Object.freeze({
    ok: true,
    status: 'PENDING_VERIFICATION',
    message: 'Demande reçue — votre structure sera vérifiée sur une source officielle avant l’ouverture de votre espace. Vous recevrez un e-mail pour activer votre accès.',
});
export const PRO_REGISTRATION_TERMS_NOT_IN_FORCE = Object.freeze({
    error: 'L’inscription d’une structure n’est pas encore ouverte : les conditions d’utilisation des professionnels ne sont pas encore en vigueur.',
    code: 'PRO_TERMS_NOT_IN_FORCE',
});
const INVALID_SIRET = { error: 'Indiquez le numéro SIRET de la structure (14 chiffres).', code: 'SIRET_INVALID', field: 'siret' };
const INVALID_NAME = { error: `Le nom de la structure doit compter entre ${STRUCTURE_NAME_MIN} et ${STRUCTURE_NAME_MAX} caractères.`, code: 'STRUCTURE_NAME_INVALID', field: 'structureName' };

/**
 * R43 (E1): public self-registration of a structure is closed in Production and during the restricted beta unless ADA_PRO_SELF_REGISTRATION=open — opening
 * the `pro` surface for an invited pilot no longer lets anyone create a structure and its STRUCTURE_ADMIN. Structures of the pilot come from the platform
 * (verified record + the invitation of its first administrator by a SUPERADMIN, scripts/pro-superadmin-bootstrap.mjs for the very first one). LAB and tests
 * outside the beta keep the open sign-up.
 * @param {Record<string, string | undefined>} [envVars]
 */
export function proSelfRegistrationAllowed(envVars = process.env) {
    if (proSelfRegistrationOpen(envVars)) return true;
    return envVars.VERCEL_ENV !== 'production' && !isPublicBetaRestricted(envVars);
}
export const PRO_SELF_REGISTRATION_CLOSED = {
    error: 'PRO_SELF_REGISTRATION_CLOSED',
    message: "La création libre d'un espace structure n'est pas ouverte. Les structures partenaires sont créées par l'équipe d'Accès Direct Aide, puis leurs membres reçoivent une invitation nominative.",
};

/**
 * @param {{ toString: () => string; }} text
 */
function slugify(text) {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w-]+/g, '')       // Remove all non-word chars
        .replace(/--+/g, '-')         // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start
        .replace(/-+$/, '');            // Trim - from end
}

const NOTICE_EXISTING = "Quelqu'un a essayé de créer un espace professionnel avec votre adresse. Si c'était vous, connectez-vous ou réinitialisez votre mot de passe depuis la page de connexion (si votre demande est encore en cours de vérification, vous recevrez un e-mail dès qu'elle aura été traitée). Sinon, vous pouvez ignorer ce message.";
const RECEIVED_MAIL = (/** @type {string} */ name) => `Nous avons bien reçu la demande d'ouverture d'un espace professionnel sur Accès Direct Aide pour « ${name} ».\n\nDemande reçue — votre structure sera vérifiée sur une source officielle avant l'ouverture de votre espace. Votre espace n'est pas encore ouvert : vous recevrez un e-mail dès que la vérification sera faite, avec un lien pour activer la double authentification.\n\nSi vous n'avez pas fait cette demande, vous pouvez ignorer ce message.`;

/**
 * @param {import('../../../_utils/http-types').ApiRequest} req
 * @param {import('../../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }
    if (!proSelfRegistrationAllowed()) {
        return res.status(403).json(PRO_SELF_REGISTRATION_CLOSED);   // before reading the body: nothing is checked, created or sent
    }
    // G14: no professional account under terms that are not in force (Production before the owner's approval) — refused before anything is read
    if (!proTermsInForce()) return res.status(503).json({ ...PRO_REGISTRATION_TERMS_NOT_IN_FORCE });

    const { password } = req.body || {};
    const structureName = String(req.body?.structureName || '').replace(/\s+/g, ' ').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();   // R7: one address, whatever its case (a second account differing only by case was possible)
    const ip = getClientIp(req);

    if (!email || !password || !structureName || !req.body?.siret) {
        return res.status(400).json({ error: "Tous les champs sont requis" });
    }
    if (structureName.length < STRUCTURE_NAME_MIN || structureName.length > STRUCTURE_NAME_MAX) return res.status(400).json(INVALID_NAME);
    const siret = validSiret(req.body.siret);
    if (!siret || String(req.body.siret).replace(/[\s.]/g, '') !== siret) return res.status(400).json(INVALID_SIRET);
    // R7: the same minimum as the password reset; R21: the shared password rule (src/lib/passwordPolicy.js), as for citizens and institutional partners
    const pwProblems = passwordProblems(password);
    if (pwProblems.length) {
        return res.status(400).json({ error: passwordMessage(pwProblems) });
    }
    // G3 / G14: the professional terms are accepted at sign-up (a contract acceptance, recorded with its version) — before any lookup
    if (!termsAcceptanceGiven(req.body?.termsAccepted)) {
        return res.status(400).json({ ...PRO_TERMS_REQUIRED_REFUSAL });
    }

    // Rate Limit
    const ipLimit = await checkRateLimit('REGISTER_PRO', `ip:${ip}`);
    if (!ipLimit.allowed) {
        return res.status(429).json(ipLimit.error || { error: 'Trop de tentatives. Réessayez plus tard.' });
    }

    const noticeExisting = () => sendMail({
        to: email,
        subject: '[PRO] Tentative de création de compte — Accès Direct Aide',
        text: NOTICE_EXISTING,
        category: 'pro_signup_existing',
    }).catch((err) => logger.warn({ msg: 'pro signup notice failed (non-blocking)', err: err?.message }));

    try {
        // Check if email exists
        const existingUser = await db.query.ProUser.findFirst({
            where: (u, { sql: s }) => s`lower(${u.email}) = ${email}`
        });

        if (existingUser) {
            // R7 / G14: the answer is the one of a new request (no session is returned any more, so the two cases can no longer be told apart); the owner of
            // the address is told by e-mail instead
            await noticeExisting();
            return res.status(202).json({ ...PRO_REGISTRATION_RECEIVED });
        }

        let slug = slugify(structureName);
        if (!slug) slug = `structure-${Date.now()}`;
        const existingSlug = await db.query.Structure.findFirst({ where: (s, { eq }) => eq(s.slug, slug) });
        if (existingSlug) {
            slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
        }

        const hashedPassword = await hashPassword(password);

        // R12 (E01): Structure + ProUser in ONE transaction — a failed or duplicate account creation leaves no orphan organization behind; G14: the terms
        // acceptance is recorded in the same transaction, and a known SIRET reuses its Structure
        let result;
        try {
            result = await db.transaction(async (tx) => {
                // one registration per address at a time (ProUser.email is unique per organization only): the address is locked, then re-checked
                await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'pro-register:' + email}, 0))`);
                // G14: one registration per SIRET at a time (Structure.siret is unique): two simultaneous requests for one SIRET share one Structure
                await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'pro-register-siret:' + siret}, 0))`);
                const [taken] = await tx.select({ id: ProUser.id }).from(ProUser).where(sql`lower(${ProUser.email}) = ${email}`).limit(1);
                if (taken) return null;
                const [known] = (await tx.execute(sql`SELECT id FROM "Structure" WHERE siret = ${siret} LIMIT 1`)).rows;
                let structure;
                if (known) {
                    structure = { id: String(known.id), existing: true };
                } else {
                    const [created] = await tx.insert(Structure).values({
                        nom: structureName,
                        slug: slug,
                        siret,
                        status: 'actif',
                        statut: 'brouillon',   // not activated: « Vérifier et activer » (administration, MFA) makes it 'actif' with its verification
                        services: [],
                        publics_accueillis: [],
                        categories_aidees: [],
                        is_pro_enabled: false   // G14: no booking is published before the structure exists for ADA (the structure publishes it later)
                    }).returning({ id: Structure.id });
                    structure = { id: String(created.id), existing: false };
                }
                const [user] = await tx.insert(ProUser).values({
                    email,
                    password_hash: hashedPassword,
                    role: 'STRUCTURE_ADMIN',
                    status: PENDING_VERIFICATION_STATUS,
                    structureId: structure.id
                }).returning({ id: ProUser.id, role: ProUser.role });
                await recordProTermsAcceptance(tx, user.id, user.role, 'register');   // G3 / G14: the proof with the account (same transaction)
                return { structure, user };
            });
        } catch (e) {
            // the same e-mail registered at the same moment: the unique address refuses the second one, with the same answer as an existing account
            if ((/** @type {any} */ (e)?.cause?.code || /** @type {any} */ (e)?.code) === '23505') return res.status(202).json({ ...PRO_REGISTRATION_RECEIVED });
            throw e;
        }
        if (!result) {
            await noticeExisting();
            return res.status(202).json({ ...PRO_REGISTRATION_RECEIVED });
        }

        // the journal keeps the declared name (an existing record is not changed) and whether the SIRET was already known; never the address
        await logProAudit('REGISTER_REQUESTED', result.user.id, result.structure.id, { siretKnown: result.structure.existing, declaredName: structureName.slice(0, STRUCTURE_NAME_MAX) }, ip);

        await sendMail({
            to: email,
            subject: '[PRO] Demande reçue — Accès Direct Aide',   // R42: no organisation name in a subject line (body only)
            text: RECEIVED_MAIL(structureName),
            category: 'pro_welcome',
        }).catch(err => logger.warn({ msg: 'Pro request e-mail failed (non-blocking)', err: err.message }));

        return res.status(202).json({ ...PRO_REGISTRATION_RECEIVED });

    } catch (e) {
        logger.error({ err: e }, "Register error");
        return res.status(500).json({ error: "Erreur lors de l'inscription" });
    }
}
