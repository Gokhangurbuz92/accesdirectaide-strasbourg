// @ts-nocheck
/**
 * crypto-files.js
 * Client-side encryption utilities for file uploads (images, PDF, documents). NOT end-to-end: the key derives from a server-known shareId (see RC4_SECURITY_REVIEW.md).
 * Uses AES-GCM with PBKDF2-derived keys from shareId.
 *
 * The shareId acts as a shared secret between usager and agent —
 * the server only ever stores opaque encrypted blobs.
 */

const ALGORITHM = 'AES-GCM';
const SALT = 'ada-vault-2026';
const ITERATIONS = 100000;

/**
 * Derive an AES-256 key from a shareId string.
 */
async function deriveKey(/** @type {string} */ secretId, usage) {
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        encoder.encode(secretId),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: encoder.encode(SALT),
            iterations: ITERATIONS,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: ALGORITHM, length: 256 },
        false,
        usage
    );
}

/**
 * Encrypt a File object client-side.
 * Returns a Blob containing [12-byte IV][ciphertext].
 */
// @ts-ignore
export async function encryptFile(file, secretId) {
    const arrayBuffer = await file.arrayBuffer();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(secretId, ['encrypt']);
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: ALGORITHM, iv },
        key,
        arrayBuffer
    );

    // Prepend IV to ciphertext
    return new Blob([iv, ciphertext], { type: 'application/octet-stream' });
}

/**
 * Decrypt a Blob back to a viewable object URL.
 * The first 12 bytes are the IV, the rest is ciphertext.
 */
// @ts-ignore
export async function decryptFile(blob, secretId, /** @type {string} */ originalMimeType) {
    const arrayBuffer = await blob.arrayBuffer();
    const iv = arrayBuffer.slice(0, 12);
    const data = arrayBuffer.slice(12);
    const key = await deriveKey(secretId, ['decrypt']);

    const decryptedContent = await window.crypto.subtle.decrypt(
        { name: ALGORITHM, iv },
        key,
        data
    );

    return URL.createObjectURL(
        new Blob([decryptedContent], { type: originalMimeType || 'application/octet-stream' })
    );
}
