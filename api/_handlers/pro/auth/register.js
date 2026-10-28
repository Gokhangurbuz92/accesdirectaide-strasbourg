import logger from '../../../_utils/logger.js';
import { passwordMessage, passwordProblems } from '../../../../src/lib/passwordPolicy.js';
import { hashPassword, buildAppUrl } from '../../../_utils/user-auth.js';
import { signProToken, logProAudit } from '../../../_utils/auth.js';
import { checkRateLimit, getClientIp } from '../../../_utils/rateLimit.js';
import { sendMail } from '../../../_utils/mailer.js';
import { templates } from '../../../lib/email-service.js';
import { db } from '../../../../src/db/index.js';
import { Structure, ProUser } from '../../../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';

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
/**
 * @param {import('../../../_utils/http-types').ApiRequest} req
 * @param {import('../../../_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { password, structureName } = req.body;
    const email = String(req.body?.email || '').trim().toLowerCase();   // R7: one address, whatever its case (a second account differing only by case was possible)
    const ip = getClientIp(req);

    if (!email || !password || !structureName) {
        return res.status(400).json({ error: "Tous les champs sont requis" });
    }
    // R7: the same minimum as the password reset; R21: the shared password rule (src/lib/passwordPolicy.js), as for citizens and institutional partners
    const pwProblems = passwordProblems(password);
    if (pwProblems.length) {
        return res.status(400).json({ error: passwordMessage(pwProblems) });
    }

    // Rate Limit
    const ipLimit = await checkRateLimit('REGISTER_PRO', `ip:${ip}`);
    if (!ipLimit.allowed) {
        return res.status(429).json(ipLimit.error || { error: 'Trop de tentatives. Réessayez plus tard.' });
    }

    try {
        // Check if email exists
        const existingUser = await db.query.ProUser.findFirst({
            where: (u, { sql: s }) => s`lower(${u.email}) = ${email}`
        });

        if (existingUser) {
            // R7: the answer no longer says that this address has an account (the owner of the address is told by e-mail instead). A sign-up that logs in
            // at once cannot hide the difference between « created » and « not created » completely: that needs a sign-up confirmed by e-mail (owner decision).
            await sendMail({
                to: email,
                subject: '[PRO] Tentative de création de compte — Accès Direct Aide',
                text: "Quelqu'un a essayé de créer un espace professionnel avec votre adresse. Si c'était vous, connectez-vous ou réinitialisez votre mot de passe depuis la page de connexion. Sinon, vous pouvez ignorer ce message.",
                category: 'pro_signup_existing',
            }).catch((err) => logger.warn({ msg: 'pro signup notice failed (non-blocking)', err: err?.message }));
            return res.status(400).json({ error: "L'inscription n'a pas pu être faite avec ces informations. Si vous avez déjà un espace, connectez-vous ou réinitialisez votre mot de passe." });
        }

        // Create Structure
        let slug = slugify(structureName);
        if (!slug) slug = `structure-${Date.now()}`;

        // Ensure slug uniqueness
        const existingStructure = await db.query.Structure.findFirst({ where: (s, { eq }) => eq(s.slug, slug) });
        if (existingStructure) {
            slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
        }

        const hashedPassword = await hashPassword(password);

        // R12 (E01): Structure + ProUser in ONE transaction (the database is node-postgres; the former comment about neon-http no longer held) — a failed or
        // duplicate account creation leaves no orphan organization behind
        let result;
        try {
            result = await db.transaction(async (tx) => {
                // one registration per address at a time (ProUser.email is unique per organization only): the address is locked, then re-checked
                await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'pro-register:' + email}, 0))`);
                const [taken] = await tx.select({ id: ProUser.id }).from(ProUser).where(sql`lower(${ProUser.email}) = ${email}`).limit(1);
                if (taken) return null;
                const [structure] = await tx.insert(Structure).values({
                    nom: structureName,
                    slug: slug,
                    status: 'actif',
                    statut: 'brouillon',
                    services: [],
                    publics_accueillis: [],
                    categories_aidees: [],
                    is_pro_enabled: true
                }).returning();
                const [user] = await tx.insert(ProUser).values({
                    email,
                    password_hash: hashedPassword,
                    role: 'STRUCTURE_ADMIN',
                    status: 'active',
                    structureId: structure.id
                }).returning();
                return { structure, user };
            });
            if (!result) return res.status(400).json({ error: "L'inscription n'a pas pu être faite avec ces informations. Si vous avez déjà un espace, connectez-vous ou réinitialisez votre mot de passe." });
        } catch (e) {
            // the same e-mail registered at the same moment: the unique address refuses the second one, with the same neutral answer as an existing account
            if ((/** @type {any} */ (e)?.cause?.code || /** @type {any} */ (e)?.code) === '23505') return res.status(400).json({ error: "L'inscription n'a pas pu être faite avec ces informations. Si vous avez déjà un espace, connectez-vous ou réinitialisez votre mot de passe." });
            throw e;
        }

        const token = signProToken(result.user);

        await logProAudit('REGISTER_SUCCESS', result.user.id, result.structure.id, {}, ip);

        // Send welcome email to new pro user
        const emailTemplate = templates.welcome(structureName, null);   // PKG-11 audit: no verification step here (the former link carried a made-up token)
        await sendMail({
            to: email,
            subject: `[PRO] Bienvenue sur Accès Direct Aide — ${structureName}`,
            text: `Bienvenue sur Accès Direct Aide ! Votre espace professionnel pour "${structureName}" est maintenant actif.`,
            html: emailTemplate.html,
            category: 'pro_welcome',
        }).catch(err => logger.warn({ msg: 'Pro welcome email failed (non-blocking)', err: err.message }));

        return res.status(200).json({
            token,
            user: {
                id: result.user.id,
                email: result.user.email,
                role: result.user.role,
                structureId: result.structure.id,
                structureName: result.structure.nom
            }
        });

    } catch (e) {
        logger.error({ err: e }, "Register error");
        return res.status(500).json({ error: "Erreur lors de l'inscription" });
    }
}
