export const aiLogger = {
    info: (/** @type {number} */ msg, /** @type {any} */ meta) => console.log(`[AI INFO] ${msg}`, meta || ''),
    error: (/** @type {number} */ msg, /** @type {any} */ meta) => console.error(`[AI ERROR] ${msg}`, meta || ''),
    warn: (/** @type {number} */ msg, /** @type {any} */ meta) => console.warn(`[AI WARN] ${msg}`, meta || '')
};

export const logger = aiLogger;
