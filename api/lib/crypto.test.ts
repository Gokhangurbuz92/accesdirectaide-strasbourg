import { describe, it, expect, vi } from 'vitest';

// Mock env.js first (Vitest hoists this automatically)
vi.mock('../_utils/env.js', () => ({
    env: {
        secrets: {
            adaEncryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', // gitleaks:allow (test fixture)
        },
        runtime: {
            vercelEnv: 'test',
            logLevel: 'silent'
        },
        sentry: {
            release: 'test-release'
        }
    }
}));

import { 
    encrypt, 
    decrypt, 
    encryptBuffer, 
    decryptBuffer, 
    hash, 
    generateAttachmentToken, 
    verifyAttachmentToken 
} from './crypto.js';

describe('Core Cryptography (`api/lib/crypto.ts`)', () => {

    describe('Text Encryption (AES-256-GCM)', () => {

        it('should successfully encrypt and decrypt a standard string', () => {
            const originalText = "SECRET_SOCIAL_SECURITY_NUMBER_OR_PII";
            const encrypted = encrypt(originalText);
            
            expect(encrypted).not.toBeNull();
            expect(typeof encrypted).toBe('string');
            expect(encrypted).toContain('v1:'); // Format assertion
            expect(encrypted).not.toContain(originalText);

            const decrypted = decrypt(encrypted);
            expect(decrypted).toBe(originalText);
        });

        it('should generate completely different ciphertexts for the exact same input', () => {
             const originalText = "IDENTICAL_PAYLOAD";
             const encryptedA = encrypt(originalText);
             const encryptedB = encrypt(originalText);
             
             // The IV should guarantee complete ciphertext variance
             expect(encryptedA).not.toBe(encryptedB);
             
             // But both must resolve back strictly
             expect(decrypt(encryptedA)).toBe(originalText);
             expect(decrypt(encryptedB)).toBe(originalText);
        });

        it('should FAIL-FAST and throw if the AuthTag is tampered with (Zero-Knowledge integrity constraint)', () => {
            const encryptedStr = encrypt("SENSITIVE_DATA");
            if (!encryptedStr) throw new Error("Encryption failed");

            const parts = encryptedStr.split(':');
            expect(parts.length).toBe(4);
            
            // parts: [version, iv, authTag, encryptedHex]
            // Mutate purely the AuthTag
            const originalTag = parts[2];
            const mutatedTag = originalTag.replace(/[0-9a-f]/i, (c) => (c === 'a' ? 'b' : 'a'));
            
            parts[2] = mutatedTag;
            const tamperedStr = parts.join(':');

            // Must THROW explicitly because in Zero-Knowledge, corruption is fatal.
            expect(() => decrypt(tamperedStr)).toThrow(/FATAL: Decryption failed/);
        });

        it('should FAIL-FAST and throw if the Ciphertext is tampered with', () => {
            const encryptedStr = encrypt("SENSITIVE_DATA");
            if (!encryptedStr) throw new Error("Encryption failed");

            const parts = encryptedStr.split(':');
            
            // Mutate the ciphertext
            const originalCipher = parts[3];
            parts[3] = originalCipher.replace(/[0-9a-f]/i, (c) => (c === 'a' ? 'b' : 'a'));
            const tamperedStr = parts.join(':');

            expect(() => decrypt(tamperedStr)).toThrow(/FATAL: Decryption failed/);
        });

        it('should correctly handle null or empty inputs safely', () => {
            expect(encrypt(null)).toBeNull();
            expect(encrypt("")).toBeNull();
            expect(encrypt(undefined)).toBeNull();

            expect(decrypt(null)).toBeNull();
            expect(decrypt("")).toBeNull();
            expect(decrypt(undefined)).toBeNull();
        });
    });

    describe('Buffer Encryption (AES-256-GCM)', () => {
        it('should successfully encrypt and decrypt arbitrary binary data', () => {
            const pureData = Buffer.from('FAKE_PDF_BINARY_STRING_OF_0_AND_1', 'utf-8');
            const encryptedBuffer = encryptBuffer(pureData);

            expect(Buffer.isBuffer(encryptedBuffer)).toBe(true);
            expect(encryptedBuffer).not.toEqual(pureData);
            
            const decryptedBuffer = decryptBuffer(encryptedBuffer);
            
            expect(Buffer.isBuffer(decryptedBuffer)).toBe(true);
            expect(decryptedBuffer.toString('utf-8')).toBe(pureData.toString('utf-8'));
        });

        it('should FAIL-FAST and throw on truncation attacks for Buffers', () => {
            const pureData = Buffer.from('Important File Content', 'utf-8');
            const encryptedBuffer = encryptBuffer(pureData);
            
            // Remove the last 5 bytes
            const truncatedBuffer = encryptedBuffer.subarray(0, encryptedBuffer.length - 5);
            
            expect(() => decryptBuffer(truncatedBuffer)).toThrow(/Decryption failed/);
        });
    });

    describe('Deterministic Blind Indexing (SHA-256)', () => {
        it('should properly hash inputs deterministically', () => {
            const val1 = hash("email@domain.com");
            const val2 = hash("email@domain.com");
            
            expect(val1).not.toBeNull();
            expect(val1?.length).toBe(64); // hex sha256 output
            expect(val1).toBe(val2); // Must be strictly identical for WHERE lookups
        });
    });

    describe('Attachment Access Tokens (HMAC-SHA256)', () => {
        it('should mint an authorized token and properly verify it', () => {
            const token = generateAttachmentToken('file-1234');
            expect(typeof token).toBe('string');
            expect(token).toContain('.');

            const verifiedId = verifyAttachmentToken(token);
            expect(verifiedId).toBe('file-1234');
        });

        it('should reject tokens whose signature has been spoofed', () => {
             const token = generateAttachmentToken('file-admin');
             const parts = token.split('.');
             
             // Spoof the b64 json payload directly
             const spoofedPayload = Buffer.from(JSON.stringify({
                id: 'file-superadmin',
                exp: Math.floor(Date.now() / 1000) + 3600
             })).toString('base64url');

             const tamperedToken = `${spoofedPayload}.${parts[1]}`; // Signature belongs to file-admin
             
             expect(verifyAttachmentToken(tamperedToken)).toBeNull();
        });

        it('should reject structurally expired tokens automatically', () => {
             // Generate token expiring *1 second ago*
             const expiringToken = generateAttachmentToken('file-volatile', -1);
             expect(verifyAttachmentToken(expiringToken)).toBeNull();
        });
    });
});
