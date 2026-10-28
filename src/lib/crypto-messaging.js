// @ts-nocheck
/**
 * crypto-messaging.js
 * Chiffrement côté navigateur pour la messagerie ADA (AES-GCM 256-bit, Web Crypto API).
 *
 * SECURITY NOTE (RC5_SEC1): despite the historical name `cryptoE2EE`, this is NOT end-to-end encryption. The key is PBKDF2(secretId) with a fixed salt,
 * and `secretId` (a shareId / conversationId) is stored by the server and given to every recipient, so the platform can derive the key and read the
 * messages. It protects against passive database disclosure only to the extent the identifier stays secret. Do not describe it to users as E2EE or
 * zero-knowledge. A real design needs a client-held secret that never reaches the server (see docs/release/RC4_SECURITY_REVIEW.md).
 * The wire format is unchanged on purpose (existing messages must stay readable).
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;

/**
 * Derive a symmetric key from a shared secret using PBKDF2.
 * @param {string} sharedSecret - The shared secret (e.g. shareId)
 * @returns {Promise<CryptoKey>}
 */
async function deriveSessionKey(sharedSecret) {
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        encoder.encode(sharedSecret),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    const salt = encoder.encode('ada-souverain-salt-2026');

    return window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations: 100000,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: ALGORITHM, length: KEY_LENGTH },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * E2EE utility — encrypt/decrypt messages client-side.
 *
 * Usage:
 *   import { cryptoE2EE } from '@/lib/crypto-messaging';
 *   const cipher = await cryptoE2EE.encrypt('Hello', shareId);
 *   const plain  = await cryptoE2EE.decrypt(cipher, shareId);
 */
export const cryptoE2EE = {
    /**
     * Encrypt plaintext into a base64 blob (IV prepended).
     * @param {string} text - Plaintext message
     * @param {string} secretId - Shared secret for key derivation
     * @returns {Promise<string>} base64-encoded ciphertext
     */
    async encrypt(text, secretId) {
        try {
            const key = await deriveSessionKey(secretId);
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const encoder = new TextEncoder();

            const encryptedContent = await window.crypto.subtle.encrypt(
                { name: ALGORITHM, iv },
                key,
                encoder.encode(text)
            );

            // Prepend IV to ciphertext for transport
            const combined = new Uint8Array(iv.length + encryptedContent.byteLength);
            combined.set(iv);
            combined.set(new Uint8Array(encryptedContent), iv.length);

            return btoa(String.fromCharCode.apply(null, combined));
        } catch (error) {
            if (import.meta.env.DEV) console.error('[E2EE] Erreur encrypt:', error);
            throw error;
        }
    },

    /**
     * Decrypt a base64 blob back to plaintext.
     * @param {string} base64Data - base64-encoded ciphertext (IV + data)
     * @param {string} secretId - Shared secret for key derivation
     * @returns {Promise<string>} decrypted plaintext
     */
    async decrypt(base64Data, secretId) {
        try {
            const key = await deriveSessionKey(secretId);
            const combined = new Uint8Array(
                atob(base64Data)
                    .split('')
                    .map((c) => c.charCodeAt(0))
            );

            const iv = combined.slice(0, 12);
            const data = combined.slice(12);

            const decryptedContent = await window.crypto.subtle.decrypt(
                { name: ALGORITHM, iv },
                key,
                data
            );

            return new TextDecoder().decode(decryptedContent);
        } catch (error) {
            if (import.meta.env.DEV) console.error('[E2EE] Erreur decrypt:', error);
            return '🔒 [Contenu chiffré - Clé invalide]';
        }
    },
};
