import crypto from 'crypto';

/**
 * totp.js — RFC 6238 TOTP implementation using Node.js crypto
 *
 * Zero external dependencies. Compatible with Google Authenticator,
 * Authy, FreeOTP, and any RFC 6238-compliant app.
 */

// ---------- Base32 Encoding / Decoding (RFC 4648) ----------

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode a Buffer to base32 string (no padding).
 * @param {Buffer} buffer
 * @returns {string}
 */
export function base32Encode(buffer) {
    let bits = '';
    for (const byte of buffer) {
        bits += byte.toString(2).padStart(8, '0');
    }
    let result = '';
    for (let i = 0; i < bits.length; i += 5) {
        const chunk = bits.slice(i, i + 5).padEnd(5, '0');
        result += BASE32_CHARS[parseInt(chunk, 2)];
    }
    return result;
}

/**
 * Decode a base32 string to Buffer.
 * @param {string} str
 * @returns {Buffer}
 */
export function base32Decode(str) {
    const cleaned = str.replace(/[=\s]/g, '').toUpperCase();
    let bits = '';
    for (const char of cleaned) {
        const idx = BASE32_CHARS.indexOf(char);
        if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
        bits += idx.toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    return Buffer.from(bytes);
}

// ---------- TOTP Core ----------

/**
 * Generate a random TOTP secret (20 bytes → base32).
 * @returns {string} Base32-encoded secret
 */
export function generateSecret() {
    return base32Encode(crypto.randomBytes(20));
}

/**
 * Generate a TOTP code for a given secret and optional time.
 *
 * @param {string} secret Base32-encoded secret
 * @param {number} [timeCounter] Override time counter (default: current 30s window)
 * @returns {string} 6-digit TOTP code
 */
export function generateCode(secret, timeCounter) {
    const counter = timeCounter ?? Math.floor(Date.now() / 1000 / 30);

    // Counter → 8-byte big-endian buffer
    const counterBuf = Buffer.alloc(8);
    counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    counterBuf.writeUInt32BE(counter & 0xffffffff, 4);

    // HMAC-SHA1(secret, counter)
    const key = base32Decode(secret);
    const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();

    // Dynamic truncation (RFC 4226 §5.4)
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);

    return String(code % 1_000_000).padStart(6, '0');
}

/**
 * Verify a TOTP code with ±1 time step tolerance (90 seconds total window).
 *
 * @param {string} secret Base32-encoded secret
 * @param {string} code 6-digit code from the user
 * @returns {boolean}
 */
export function verifyCode(secret, code) {
    return matchCodeStep(secret, code) !== null;
}

/**
 * The time step (30 s counter) a code belongs to, within ±1 step, or null. Callers record it (api/_utils/totp-guard.js) so that a code is accepted once.
 *
 * @param {string} secret Base32-encoded secret
 * @param {string} code 6-digit code from the user
 * @returns {number | null}
 */
export function matchCodeStep(secret, code) {
    if (!secret || !code || code.length !== 6) return null;

    const now = Math.floor(Date.now() / 1000 / 30);

    // Check current window + previous window + next window
    for (const offset of [0, -1, 1]) {
        const expected = generateCode(secret, now + offset);
        // Constant-time comparison to prevent timing attacks
        if (
            expected.length === code.length &&
            crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))
        ) {
            return now + offset;
        }
    }
    return null;
}

/**
 * Build an otpauth:// URL for QR code generation.
 *
 * @param {string} secret Base32 secret
 * @param {string} email User email (account identifier)
 * @param {string} [issuer='AccesDirectAide'] App name
 * @returns {string}
 */
export function buildOtpauthUrl(secret, email, issuer = 'AccesDirectAide') {
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
    return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30&algorithm=SHA1`;
}
