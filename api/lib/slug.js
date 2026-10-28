// @ts-nocheck
/**
 * Slug generation utility
 * Shared between backfill script and ingestion pipeline
 */

import slugify from '@sindresorhus/slugify';
import logger from '../_utils/logger.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, and, ne } from 'drizzle-orm';

/**
 * Model name → Drizzle schema table mapping
 */
const MODEL_MAP = {
  aide: schema.Aide,
  demarche: schema.Demarche,
  structure: schema.Structure,
  actualite: schema.Actualite,
};

/**
 * Generate a unique slug for a given text and model
 *
 * @param {string} modelName - Model name (lowercase: 'aide', 'demarche', 'structure', 'actualite')
 * @param {string} baseText - Text to slugify (titre, nom, etc.)
 * @param {string|null} excludeId - Optional ID to exclude from uniqueness check (for updates)
 * @returns {Promise<string>} Unique slug
 */
export async function generateUniqueSlug(modelName, baseText, excludeId = null) {
    if (!baseText || typeof baseText !== 'string' || baseText.trim() === '') {
        throw new Error('Cannot generate slug from empty or invalid text');
    }

    const table = MODEL_MAP[modelName];
    if (!table) {
        throw new Error(`Unknown model: ${modelName}`);
    }

    // Truncate if too long (before slugify to avoid very long slugs)
    const truncated = baseText.length > 200 ? baseText.substring(0, 200) : baseText;

    let baseSlug = slugify(truncated, { locale: 'fr' });

    // Fallback if slugify returns empty (e.g., text with only special chars)
    if (!baseSlug || baseSlug.length < 2) {
        baseSlug = 'item';
    }

    let suffix = 0;
    let isUnique = false;
    let finalSlug = baseSlug;

    while (!isUnique) {
        const testSlug = suffix === 0 ? baseSlug : `${baseSlug}-${suffix}`;

        // Check if slug exists (excluding current item if updating)
        const conditions = [eq(table.slug, testSlug)];
        if (excludeId) {
            conditions.push(ne(table.id, excludeId));
        }

        const existing = await db
            .select({ id: table.id })
            .from(table)
            .where(and(...conditions))
            .limit(1)
            .then((rows) => rows[0] || null);

        if (!existing) {
            isUnique = true;
            finalSlug = testSlug;
        } else {
            suffix++;

            // Safety: prevent infinite loop on pathological cases
            if (suffix > 999) {
                // Extremely unlikely, but fallback to random suffix
                finalSlug = `${baseSlug}-${Date.now().toString(36)}`;
                break;
            }
        }
    }

    return finalSlug;
}

/**
 * Generate slug for item if missing, with error handling
 * Safe to call during ingestion - returns null if generation fails
 *
 * @param {string} modelName - Model name (lowercase)
 * @param {object} item - Item with title/nom field
 * @param {string} titleField - Field name to use as base ('titre', 'nom')
 * @returns {Promise<string|null>} Generated slug or null if failed
 */
export async function ensureSlug(modelName, item, titleField = 'titre') {
    // If slug already exists, return it
    if (item.slug && item.slug.trim() !== '') {
        return item.slug;
    }

    // Get title/nom
    const baseText = item[titleField];

    if (!baseText || typeof baseText !== 'string' || baseText.trim() === '') {
        logger.warn(`[Slug] Cannot generate slug for ${modelName} - missing ${titleField}`);
        return null;
    }

    try {
        return await generateUniqueSlug(modelName, baseText, item.id || null);
    } catch (error) {
        logger.error(`[Slug] Error generating slug for ${modelName}:`, error.message);
        return null;
    }
}
