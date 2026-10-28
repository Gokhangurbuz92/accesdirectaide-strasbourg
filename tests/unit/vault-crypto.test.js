/**
 * 🔒 VAULT CORRUPTION & ROTATION TEST
 * Tests AES-256-GCM encryption resilience.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the encryption logic directly
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function makeKey(secret) {
    return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return { content: encrypted + ':' + authTag, iv: iv.toString('hex') };
}

function decrypt(content, ivHex, key) {
    const iv = Buffer.from(ivHex, 'hex');
    const [encrypted, authTagHex] = content.split(':');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

describe('Vault — AES-256-GCM Resilience', () => {

    const SECRET = 'my-super-secret-key-for-testing-only'; // gitleaks:allow — test fixture, not a real secret
    const key = makeKey(SECRET);

    it('encrypts and decrypts correctly', () => {
        const plaintext = 'oauth-token-abc123-refresh-xyz789';
        const { content, iv } = encrypt(plaintext, key);
        const result = decrypt(content, iv, key);
        expect(result).toBe(plaintext);
    });

    it('produces different ciphertext for same plaintext (random IV)', () => {
        const plaintext = 'same-token';
        const enc1 = encrypt(plaintext, key);
        const enc2 = encrypt(plaintext, key);
        expect(enc1.content).not.toBe(enc2.content);
        expect(enc1.iv).not.toBe(enc2.iv);
        // But both decrypt to the same value
        expect(decrypt(enc1.content, enc1.iv, key)).toBe(plaintext);
        expect(decrypt(enc2.content, enc2.iv, key)).toBe(plaintext);
    });

    it('fails with wrong key (key rotation simulation)', () => {
        const plaintext = 'secret-data';
        const { content, iv } = encrypt(plaintext, key);

        const wrongKey = makeKey('different-key-after-rotation');
        expect(() => decrypt(content, iv, wrongKey)).toThrow();
    });

    it('detects tampered ciphertext (integrity check)', () => {
        const plaintext = 'important-token';
        const { content, iv } = encrypt(plaintext, key);

        // Completely mangle the ciphertext portion to guarantee GCM auth failure
        const [encrypted, authTag] = content.split(':');
        const mangled = encrypted.split('').reverse().join('');
        expect(() => decrypt(mangled + ':' + authTag, iv, key)).toThrow();
    });

    it('detects tampered authTag (authentication check)', () => {
        const plaintext = 'protected-data';
        const { content, iv } = encrypt(plaintext, key);

        // Tamper with the authTag
        const [enc, tag] = content.split(':');
        // R23: always a different first byte (writing ff over a tag that already began with ff changed nothing: about 1 run in 256 failed)
        const tamperedTag = (tag.startsWith('ff') ? '00' : 'ff') + tag.slice(2);
        expect(() => decrypt(enc + ':' + tamperedTag, iv, key)).toThrow();
    });

    it('detects tampered IV', () => {
        const plaintext = 'secure-token';
        const { content, iv } = encrypt(plaintext, key);

        // Change one byte of the IV
        const tamperedIv = (iv.startsWith('ff') ? '00' : 'ff') + iv.slice(2);   // R23: always a different first byte (as vault-outlook.test.js)
        expect(() => decrypt(content, tamperedIv, key)).toThrow();
    });

    it('handles hex key format (64 chars)', () => {
        const hexKey = crypto.randomBytes(32).toString('hex'); // 64 hex chars
        const bufKey = Buffer.from(hexKey, 'hex');
        const plaintext = 'hex-key-test';
        const { content, iv } = encrypt(plaintext, bufKey);
        expect(decrypt(content, iv, bufKey)).toBe(plaintext);
    });

    it('handles empty plaintext gracefully', () => {
        const { content, iv } = encrypt('', key);
        expect(decrypt(content, iv, key)).toBe('');
    });

    it('handles unicode content', () => {
        const plaintext = 'Données chiffrées: éàü ñ 你好 🔒';
        const { content, iv } = encrypt(plaintext, key);
        expect(decrypt(content, iv, key)).toBe(plaintext);
    });
});
