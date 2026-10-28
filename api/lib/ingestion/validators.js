import { z } from 'zod';

/**
 * Zod schema for validating normalized Aid objects from connectors.
 * Prevents corrupted or empty data from entering the database.
 */
export const AidIngestSchema = z.object({
    title: z.string().min(3, "Title must be at least 3 characters").max(500),
    description: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
    source_url: z.string().trim().nullable().optional(),
    apply_url: z.string().trim().nullable().optional(),
    theme: z.string().nullable().optional(),
    fetched_at: z.union([z.date(), z.string()]).optional().transform((v) => (v ? new Date(v) : new Date())),
    
    // Optional enriched fields
    _montant_max: z.string().nullable().optional(),
    _echelon_territorial: z.string().nullable().optional(),
    _code_insee_territoire: z.string().nullable().optional(),
    _source_donnee: z.string().nullable().optional(),
    _lien_demarche: z.string().nullable().optional()
}).passthrough(); // Allow other connector-specific raw fields through just in case

/**
 * Zod schema for validating normalized Demarche objects from connectors.
 */
export const DemarcheIngestSchema = z.object({
    titre: z.string().min(3, "Title must be at least 3 characters").max(500),
    description_courte: z.string().optional(),
    contenu_detaille: z.string().optional(),
    pour_qui: z.string().nullable().optional(),
    lien_officiel: z.string().trim().url("Must be a valid URL").or(z.literal('')).nullable().optional(),
    source_url: z.string().trim().url("Must be a valid URL").or(z.literal('')),
    source_url_exact: z.string().trim().url("Must be a valid URL").or(z.literal('')),
    source_host: z.string().optional(),
    categorie: z.string().optional(),
    audiences: z.array(z.string()).optional(),
    territory_scope: z.string().optional(),
    external_id: z.string().nullable().optional(),
    source_api: z.string().optional(),
    fetched_at: z.date().optional().default(() => new Date()),
}).passthrough();

/**
 * Zod schema for validating normalized Structure objects.
 */
export const StructureIngestSchema = z.object({
    nom: z.string().min(2, "Name must be at least 2 characters").max(500),
    adresse: z.string().min(5, "Address must be provided"),
    ville: z.string().min(1, "City must be provided").max(200),
    code_postal: z.string().min(4, "Zip code must be at least 4 digits").max(10),
    telephone: z.string().nullable().optional(),
    email: z.string().email("Invalid email").nullable().optional().or(z.literal('')),
    site_web: z.string().url("Invalid URL").nullable().optional().or(z.literal('')),
    source_id: z.string().min(1, "Source ID is required"),
    source_url: z.string().url("Must be a valid URL")
}).passthrough();
