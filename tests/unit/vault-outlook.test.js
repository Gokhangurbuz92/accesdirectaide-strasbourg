import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

/**
 * Vault — AES-256-GCM Token Encryption Tests
 *
 * Tests the encrypt/decrypt cycle used by the Outlook token vault.
 * Uses the same algorithm (aes-256-gcm) as api/_utils/vault.js.
 */

const ALGORITHM = 'aes-256-gcm';

// Generate a deterministic test key (32 bytes = 256 bits)
const TEST_KEY = crypto.createHash('sha256').update('test-outlook-key-2026').digest();

function encryptToken(plaintext, key = TEST_KEY) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return { content: encrypted + ':' + authTag, iv: iv.toString('hex') };
}

function decryptToken(encryptedPayload, ivHex, key = TEST_KEY) {
    const iv = Buffer.from(ivHex, 'hex');
    const parts = encryptedPayload.split(':');
    if (parts.length !== 2) throw new Error('Invalid format');
    const [encrypted, authTagHex] = parts;
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

describe('Vault — AES-256-GCM Token Encryption', () => {
    // ── Roundtrip ──
    it('should encrypt and decrypt a short token', () => {
        const token = 'fake-test-token-not-a-real-secret';
        const { content, iv } = encryptToken(token);
        const decrypted = decryptToken(content, iv);
        expect(decrypted).toBe(token);
    });

    it('should encrypt and decrypt a long access token (1KB+)', () => {
        const token = crypto.randomBytes(512).toString('base64');
        const { content, iv } = encryptToken(token);
        const decrypted = decryptToken(content, iv);
        expect(decrypted).toBe(token);
    });

    // ── Uniqueness ──
    it('should produce different ciphertexts for the same input (unique IV)', () => {
        const token = 'same-token-value';
        const enc1 = encryptToken(token);
        const enc2 = encryptToken(token);
        expect(enc1.content).not.toBe(enc2.content);
        expect(enc1.iv).not.toBe(enc2.iv);
    });

    // ── Tamper detection ──
    it('should reject tampered ciphertext (auth tag validation)', () => {
        const { content, iv } = encryptToken('sensitive-data');
        // Flip a character in the ciphertext
        const tampered = 'X' + content.slice(1);
        expect(() => decryptToken(tampered, iv)).toThrow();
    });

    it('should reject tampered IV', () => {
        const { content, iv } = encryptToken('sensitive-data');
        const tamperedIv = iv.startsWith('ff') ? '00' + iv.slice(2) : 'ff' + iv.slice(2);
        expect(() => decryptToken(content, tamperedIv)).toThrow();
    });

    // ── Wrong key ──
    it('should fail decryption with wrong key', () => {
        const { content, iv } = encryptToken('secret-token');
        const wrongKey = crypto.createHash('sha256').update('wrong-key').digest();
        expect(() => decryptToken(content, iv, wrongKey)).toThrow();
    });

    // ── Format ──
    it('should use ciphertext:authTag format', () => {
        const { content } = encryptToken('test');
        expect(content).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
        const parts = content.split(':');
        expect(parts).toHaveLength(2);
        // Auth tag should be 32 hex chars (16 bytes)
        expect(parts[1]).toHaveLength(32);
    });

    it('should produce hex IV (24 chars = 12 bytes)', () => {
        const { iv } = encryptToken('test');
        expect(iv).toMatch(/^[0-9a-f]{24}$/);
    });

    // ── Edge cases ──
    it('should handle empty string', () => {
        const { content, iv } = encryptToken('');
        const decrypted = decryptToken(content, iv);
        expect(decrypted).toBe('');
    });

    it('should handle special characters and Unicode', () => {
        const token = 'tökén=Çà+ëst/spécial&très=long';
        const { content, iv } = encryptToken(token);
        const decrypted = decryptToken(content, iv);
        expect(decrypted).toBe(token);
    });

    it('should reject invalid payload format (no colon separator)', () => {
        const { iv } = encryptToken('test');
        expect(() => decryptToken('invalid-no-colon', iv)).toThrow();
    });
});
