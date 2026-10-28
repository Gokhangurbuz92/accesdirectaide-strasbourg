import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect, beforeAll } from 'vitest';
import cryptoNode from 'crypto';

describe('Crypto Library', () => {
    let cryptoLib;

    beforeAll(async () => {
        // Setup environment BEFORE importing the module
        process.env.ADA_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex = 64 hex chars

        // Dynamic import to pick up the env var
        cryptoLib = await import('../../api/lib/crypto.js');
    });

    it('should encrypt and decrypt a string (v1 format)', () => {
        const text = "Hello World";
        const encrypted = cryptoLib.encrypt(text);

        expect(encrypted).toMatch(/^v1:/); // Verify v1 prefix
        const decrypted = cryptoLib.decrypt(encrypted);
        expect(decrypted).toBe(text);
    });

    it('should decrypt legacy format (iv:tag:data)', () => {
        // Manually create legacy format
        const text = "Legacy Data";
        const key = Buffer.from(process.env.ADA_ENCRYPTION_KEY, 'hex');
        const iv = cryptoNode.randomBytes(16);
        const cipher = cryptoNode.createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');

        const legacyString = `${iv.toString('hex')}:${authTag}:${encrypted}`;

        const decrypted = cryptoLib.decrypt(legacyString);
        expect(decrypted).toBe(text);
    });

    it('should return null for invalid data', () => {
        expect(cryptoLib.decrypt("invalid:data")).toBeNull();
        expect(cryptoLib.decrypt("v1:bad:data")).toBeNull();
    });

    it('should hash text consistently', () => {
        const text = "test@example.com";
        const h1 = cryptoLib.hash(text);
        const h2 = cryptoLib.hash(text);
        expect(h1).toBe(h2);
        expect(h1).toBeTypeOf('string');
    });

    it('should expose hash as hashContact', () => {
        expect(cryptoLib.hashContact).toBe(cryptoLib.hash);
    });

    it('should encrypt and decrypt a buffer', () => {
        const buf = Buffer.from("Hello Buffer");
        const encrypted = cryptoLib.encryptBuffer(buf);
        const decrypted = cryptoLib.decryptBuffer(encrypted);
        expect(decrypted.equals(buf)).toBe(true);
    });
});
