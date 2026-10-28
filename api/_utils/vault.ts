import crypto from 'crypto';
import { env } from './env.js';

/**
 * vault.ts — Chiffrement souverain des secrets (AES-256-GCM)
 *
 * Utilisé pour protéger les jetons Microsoft Outlook en base de données.
 * L'algorithme AES-256-GCM fournit à la fois la confidentialité et
 * l'authentification (protection contre la falsification).
 */

const ALGORITHM = 'aes-256-gcm';

/**
 * Derive the 32-byte encryption key from the env variable.
 * @returns {Buffer} The 32-byte buffer key
 */
function getEncryptionKey(): Buffer {
    const key = env.outlook.tokenEncryptionKey;
    if (!key) {
        throw new Error('CRITICAL: ADA_VAULT_KEY (formerly OUTLOOK_TOKEN_ENCRYPTION_KEY) is not defined. Aborting encryption.');
    }
    // Support both hex (64 chars) and base64/raw formats
    if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
        return Buffer.from(key, 'hex');
    }
    // Hash any key to derive a stable 32-byte key
    return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @param plaintext - The raw string to encrypt
 * @returns Object with encrypted content and iv hex
 */
export function encryptToken(plaintext: string): { content: string; iv: string } {
    if (!plaintext) {
        throw new Error("Plaintext must be provided for encryption");
    }

    const iv: Buffer = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv, { authTagLength: 16 });

    let encrypted: string = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag: string = cipher.getAuthTag().toString('hex');

    return {
        content: encrypted + ':' + authTag,
        iv: iv.toString('hex'),
    };
}

/**
 * Decrypt a ciphertext encrypted with encryptToken.
 * 
 * FAIL-FAST: Throws an error if the AuthTag is invalid or data is corrupted.
 *
 * @param encryptedPayload - Format: "ciphertext:authTag" in hex
 * @param ivHex - Initialization vector in hex
 * @returns Decrypted plaintext string
 */
export function decryptToken(encryptedPayload: string, ivHex: string): string {
    if (!encryptedPayload || !ivHex) {
        throw new Error('Both encryptedPayload and ivHex are required');
    }

    const iv: Buffer = Buffer.from(ivHex, 'hex');

    const parts = encryptedPayload.split(':');
    if (parts.length !== 2) {
        throw new Error('Invalid encrypted payload format (expected ciphertext:authTag)');
    }

    const [encrypted, authTagHex] = parts as [string, string];
    const authTag: Buffer = Buffer.from(authTagHex, 'hex');

    try {
        // Explicit 128-bit auth tag length (OWASP A02:2021 compliant)
        // nosemgrep: javascript.node-crypto.security.gcm-no-tag-length.gcm-no-tag-length
        const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv, { authTagLength: 16 });
        decipher.setAuthTag(authTag);

        let decrypted: string = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (e: any) {
        throw new Error(`⛔ FATAL: DecryptToken failed (Tampered or wrong key). Detail: ${e.message}`);
    }
}

/**
 * Check if vault encryption is available.
 * @returns boolean true if the key exists
 */
export function isVaultReady(): boolean {
    try {
        return Boolean(env.outlook.tokenEncryptionKey);
    } catch {
        return false;
    }
}
