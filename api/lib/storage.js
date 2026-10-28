// @ts-nocheck
import { logger } from './logger.js';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'; // Optional if we need signed URLs, but demand was upload/download logic.
import crypto from 'crypto';
import path from 'path';
import { env } from '../_utils/env.js';
import { LocalFilesystemStorage } from './LocalFilesystemStorage.js';

// STRICT CONFIGURATION
const CONFIG = {
    endpoint: env.storage.endpoint,
    bucket: env.storage.bucket,
    region: env.storage.region,
    accessKeyId: env.storage.accessKeyId,
    secretAccessKey: env.storage.secretAccessKey,
};

const IS_PRODUCTION = env.runtime.vercelEnv === 'production';

const LOCAL_STORAGE_DIR = env.storage.localDir;
const localStorage = LOCAL_STORAGE_DIR
    ? new LocalFilesystemStorage(LOCAL_STORAGE_DIR)
    : null;

// Validation Helper
function checkConfig() {
    const missing = [];
    if (!CONFIG.endpoint) missing.push('STORAGE_ENDPOINT');
    if (!CONFIG.bucket) missing.push('STORAGE_BUCKET');
    if (!CONFIG.accessKeyId) missing.push('STORAGE_ACCESS_KEY_ID');
    if (!CONFIG.secretAccessKey) missing.push('STORAGE_SECRET_ACCESS_KEY');

    if (missing.length > 0) {
        const msg = `Missing Storage Configuration: ${missing.join(', ')}`;
        logger.error(`[Storage] CRITICAL: ${msg}`);

        if (IS_PRODUCTION) {
            const error = new Error("Service Unavailable: Storage Configuration Missing");
            error.statusCode = 503;
            throw error;
        }
        return false; // In dev, we might behave differently or just fail later
    }
    return true;
}

// Initialize Client (Lazy or Eager?)
// Eager init allows failing fast, but we should handle it gracefully in the module.
let s3Client = null;

try {
    if (!localStorage && checkConfig()) {
        s3Client = new S3Client({
            region: CONFIG.region,
            endpoint: CONFIG.endpoint,
            credentials: {
                accessKeyId: CONFIG.accessKeyId,
                secretAccessKey: CONFIG.secretAccessKey
            },
            forcePathStyle: true // Often needed for R2/MinIO compat
        });
    }
} catch (e) {
    if (IS_PRODUCTION && e.statusCode === 503) {
        // We defer throwing until methods are called, effectively "disabling" storage
        logger.error("[Storage] Disabled due to missing config in PROD");
    }
}

export const storage = {
    /**
     * Uploads buffer to R2.
     * @param {Buffer} buffer 
     * @param {string} mimeType 
     * @returns {Promise<string>} storageKey
     */
    async upload(buffer, mimeType) {
        if (localStorage) {
            const key = await localStorage.upload(buffer);
            logger.info(`[Storage] Uploaded ${key} (${buffer.length} bytes) via local filesystem`);
            return key;
        }

        if (!s3Client) {
            checkConfig(); // Will throw 503 in PROD
            throw new Error("Storage not configured.");
        }

        const key = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;

        const command = new PutObjectCommand({
            Bucket: CONFIG.bucket,
            Key: key,
            Body: buffer,
            ContentType: mimeType,
        });

        await s3Client.send(command);
        logger.info(`[Storage] Uploaded ${key} (${buffer.length} bytes)`);

        return key;
    },

    /**
     * Downloads object as Buffer (for now, to match previous API signature).
     * @param {string} key 
     * @returns {Promise<Buffer>}
     */
    async download(key) {
        if (localStorage) {
            return localStorage.download(key);
        }

        if (!s3Client) {
            checkConfig();
            throw new Error("Storage not configured.");
        }

        const command = new GetObjectCommand({
            Bucket: CONFIG.bucket,
            Key: key,
        });

        const response = await s3Client.send(command);

        // Convert stream to buffer
        return new Promise((resolve, reject) => {
            const chunks = [];
            response.Body.on('data', (chunk) => chunks.push(chunk));
            response.Body.on('error', reject);
            response.Body.on('end', () => resolve(Buffer.concat(chunks)));
        });
    },

    /**
     * Deletes object.
     * @param {string} key 
     */
    async delete(key) {
        if (localStorage) {
            await localStorage.delete(key);
            logger.info(`[Storage] Deleted ${key} via local filesystem`);
            return;
        }

        if (!s3Client) {
            logger.warn("[Storage] Skipping delete (not configured)");
            if (IS_PRODUCTION) checkConfig(); // Throw if strict
            return;
        }

        const command = new DeleteObjectCommand({
            Bucket: CONFIG.bucket,
            Key: key,
        });

        await s3Client.send(command);
        logger.info(`[Storage] Deleted ${key}`);
    }
};
