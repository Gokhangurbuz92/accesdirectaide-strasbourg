// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { Aide, Demarche, Structure, Actualite } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { validateForPublication, generateValidationReport } from '../../lib/publication-validator.js';
import Sentry from '../../_utils/sentry.js';
import { env } from '../../_utils/env.js';
import { verifyAdmin } from '../../_utils/auth.js';
import { validatePublicationSchema } from '../../../src/db/drizzle-schemas.js';

const ENTITY_MODELS = {
  aide: Aide,
  demarche: Demarche,
  structure: Structure,
  actualite: Actualite,
};

/**
 * POST /api/admin/validate-publication
 *
 * Validates if content can be published
 *
 * Body:
 * {
 *   entityType: 'aide' | 'demarche' | 'structure' | 'actualite',
 *   entityId: string
 * }
 *
 * Returns validation result with errors and warnings
 */
/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit('ADMIN_API', ip);
    if (!rateLimit.allowed) {
        return res.status(getRateLimitStatus(rateLimit)).json(rateLimit.error);
    }

  const log = logger.child({ handler: 'validate-publication' });

  try {
    // Check authentication
    if (!(await verifyAdmin(req))) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const parseResult = validatePublicationSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid payload',
        details: parseResult.error.flatten(),
      });
    }

    const { entityType, entityId } = parseResult.data;

    // Fetch the entity
    const model = ENTITY_MODELS[entityType];
    const uppercaseKey = entityType.charAt(0).toUpperCase() + entityType.slice(1);
    const entity = await db.query[uppercaseKey].findFirst({
      where: eq(model.id, entityId),
    });

    if (!entity) {
      return res.status(404).json({ error: 'Entity not found' });
    }

    // Run validation
    const validationResult = validateForPublication(entity, entityType);
    const report = generateValidationReport(validationResult);

    log.info({
      msg: 'Publication validation performed',
      entityType,
      entityId,
      canPublish: validationResult.canPublish,
      errorCount: validationResult.errors.length,
      warningCount: validationResult.warnings.length,
    });

    return res.status(200).json({
      canPublish: validationResult.canPublish,
      errors: validationResult.errors,
      warnings: validationResult.warnings,
      report,
    });
  } catch (error) {
    log.error({
      msg: 'Validation error',
      // @ts-ignore
      error: error.message,
      // @ts-ignore
      stack: error.stack,
    });
    Sentry.captureException(error);

    return res.status(500).json({
      error: 'Internal server error',
      // @ts-ignore
      message: env.runtime.nodeEnv === 'production' ? 'An error occurred' : error.message,
    });
  }
}
