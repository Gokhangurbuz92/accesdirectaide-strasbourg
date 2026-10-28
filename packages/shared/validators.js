/**
 * @ada/shared/validators — Zod schemas partagés
 *
 * Schemas de validation réutilisables côté API (input validation)
 * et côté frontend (form validation via react-hook-form + @hookform/resolvers/zod).
 */

import { z } from 'zod';
import { AID_CATEGORIES, CONTENT_TYPES, REPORT_REASONS, TERRITORY_SCOPES } from './constants.js';

// ─────────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────────

/** Email normalisé et validé */
export const emailSchema = z
    .string()
    .email('Adresse email invalide')
    .max(255)
    .transform((v) => v.toLowerCase().trim());

/** Mot de passe sécurisé (min 8 chars) */
export const passwordSchema = z
    .string()
    .min(8, 'Le mot de passe doit contenir au moins 8 caractères')
    .max(128);

/** Slug URL-safe */
export const slugSchema = z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug invalide')
    .max(200);

/** UUID v4 */
export const uuidSchema = z.string().uuid();

/** Pagination */
export const paginationSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────

export const loginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, 'Mot de passe requis'),
});

export const signupSchema = z.object({
    email: emailSchema,
    password: passwordSchema,
});

// ─────────────────────────────────────────────────
// Recherche
// ─────────────────────────────────────────────────

export const searchSchema = z.object({
    q: z.string().min(1).max(500),
    type: z.enum(['aides', 'demarches', 'structures', 'actualites']).optional(),
    categorie: z.string().optional(),
    departement: z.string().optional(),
    ...paginationSchema.shape,
});

// ─────────────────────────────────────────────────
// Feedback
// ─────────────────────────────────────────────────

export const feedbackSchema = z.object({
    type: z.enum(['bug', 'suggestion', 'question', 'autre']),
    message: z.string().min(10, 'Le message doit contenir au moins 10 caractères').max(2000),
    email: emailSchema.optional(),
    page: z.string().url().optional(),
});

// ─────────────────────────────────────────────────
// Signalement de contenu
// ─────────────────────────────────────────────────

export const contentReportSchema = z.object({
    contentType: z.nativeEnum(CONTENT_TYPES),
    contentId: uuidSchema,
    reason: z.nativeEnum(REPORT_REASONS),
    message: z.string().max(1000).optional(),
    pageUrl: z.string().url().optional(),
    reporterEmail: emailSchema.optional(),
});

// ─────────────────────────────────────────────────
// Assistant IA
// ─────────────────────────────────────────────────

export const chatInputSchema = z.object({
    message: z
        .string()
        .min(1, 'Message requis')
        .max(2000, 'Le message est trop long (max 2000 caractères)'),
    context: z.record(z.string(), z.unknown()).optional(),
});

// ─────────────────────────────────────────────────
// Diagnostic (OpenFisca)
// ─────────────────────────────────────────────────

export const diagnosticInputSchema = z.object({
    situation: z.object({
        age: z.coerce.number().int().min(0).max(130).optional(),
        nb_enfants: z.coerce.number().int().min(0).max(20).optional(),
        revenu_mensuel: z.coerce.number().min(0).optional(),
        loyer_mensuel: z.coerce.number().min(0).optional(),
        statut_logement: z.enum(['locataire', 'proprietaire', 'heberge', 'sans_domicile']).optional(),
        situation_emploi: z.enum(['emploi', 'chomage', 'etudiant', 'retraite', 'inactif']).optional(),
        departement: z.string().length(2).or(z.string().length(3)).optional(),
        has_conjoint: z.boolean().optional(),
        situation_familiale: z.enum(['celibataire', 'couple', 'marie', 'pacse', 'divorce', 'veuf']).optional(),
        nombre_enfants: z.number().int().min(0).optional(),
        enfants: z.array(z.object({
            date_naissance: z.string().optional(),
            age: z.number().int().min(0).optional(),
            a_charge: z.boolean().optional().default(true)
        })).optional(),
        has_dependents: z.boolean().optional()
    }),
});

// ─────────────────────────────────────────────────
// Rendez-vous
// ─────────────────────────────────────────────────

export const appointmentCreateSchema = z.object({
    structureId: uuidSchema,
    serviceId: uuidSchema,
    startAt: z.string().datetime(),
    beneficiaryName: z.string().min(2).max(100),
    beneficiaryPhone: z.string().max(20).optional(),
    notes: z.string().max(500).optional(),
});
