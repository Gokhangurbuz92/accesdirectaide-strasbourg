// @ts-nocheck
import { kv } from './kv.js';
import logger from './logger.js';

const LOCK_TTL_SECONDS = 20 * 60; // 20 minutes
const LOCK_PREFIX = 'pipeline:lock:';

/**
 * Acquire a distributed lock for pipeline execution
 * @param {string} pipelineName - Name of the pipeline (e.g., 'ingest-structures')
 * @param {number} ttlSeconds - Lock TTL in seconds (default: 20 minutes)
 * @returns {Promise<string|null>} Lock ID if acquired, null if already locked
 */
export async function acquireLock(pipelineName, ttlSeconds = LOCK_TTL_SECONDS) {
    const lockKey = `${LOCK_PREFIX}${pipelineName}`;
    const lockId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    try {
        // Atomic SET NX — only sets if key does not exist (prevents race condition)
        const acquired = await kv.set(lockKey, lockId, { nx: true, ex: ttlSeconds });
        
        if (!acquired || acquired !== 'OK') {
            logger.warn({ pipelineName }, 'Pipeline already locked');
            return null;
        }
        
        logger.info({ pipelineName, lockId, ttl: ttlSeconds }, 'Pipeline lock acquired');
        return lockId;
    } catch (error) {
        logger.error({ pipelineName, error: String(error.stack) }, 'Failed to acquire lock');
        throw error;
    }
}

/**
 * Release a distributed lock
 * @param {string} pipelineName - Name of the pipeline
 * @param {string} lockId - Lock ID returned by acquireLock
 * @returns {Promise<boolean>} True if released, false if lock was already gone or didn't match
 */
export async function releaseLock(pipelineName, lockId) {
    const lockKey = `${LOCK_PREFIX}${pipelineName}`;
    
    try {
        const existing = await kv.get(lockKey);
        
        if (!existing) {
            logger.warn({ pipelineName, lockId }, 'Lock already released or expired');
            return false;
        }
        
        if (existing !== lockId) {
            logger.warn({ pipelineName, lockId, existingLock: existing }, 'Lock ID mismatch - not releasing');
            return false;
        }
        
        await kv.del(lockKey);
        logger.info({ pipelineName, lockId }, 'Pipeline lock released');
        return true;
    } catch (error) {
        // @ts-ignore
        logger.error({ pipelineName, lockId, error: error.message }, 'Failed to release lock');
        throw error;
    }
}

/**
 * Execute a pipeline function with automatic locking
 * @param {string} pipelineName - Name of the pipeline
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Options
 * @returns {Promise<any>} Result of fn
 */
export async function withLock(pipelineName, fn, options = {}) {
    const { ttl = LOCK_TTL_SECONDS } = options;
    
    const lockId = await acquireLock(pipelineName, ttl);
    
    if (!lockId) {
        throw new Error(`Pipeline '${pipelineName}' is already running`);
    }
    
    try {
        const result = await fn();
        return result;
    } finally {
        await releaseLock(pipelineName, lockId);
    }
}
