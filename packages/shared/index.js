/**
 * @ada/shared — Barrel Export
 *
 * Usage:
 *   import { AID_CATEGORIES, loginSchema, cache, isEnabled, logger } from '@ada/shared';
 *   // ou imports granulaires :
 *   import { cache } from '@ada/shared/cache';
 *   import { isEnabled } from '@ada/shared/features';
 *   import { logger } from '@ada/shared/logger';
 */

export * from './constants.js';
export * from './validators.js';
export { cache, CacheService } from './cache.js';
export { FEATURES, isEnabled, getAllFlags } from './features.js';
export { logger } from './logger.js';
