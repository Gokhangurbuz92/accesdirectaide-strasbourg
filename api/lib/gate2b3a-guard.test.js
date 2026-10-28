import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');

/**
 * @param {string} dir
 */
function scanForBypass(dir) {
    /** @type {string[]} */
    let violations = [];
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            if (file === 'node_modules' || file.startsWith('.')) continue;
            violations = violations.concat(scanForBypass(fullPath));
        } else if (file.endsWith('.js') && !file.includes('.test.')) {
            // ONLY gemini.js and ai-provider.js are allowed to import the Gemini SDK directly
            if (fullPath.includes('/lib/gemini.js') || fullPath.includes('/lib/ai-provider.js')) {
                continue;
            }

            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('@google/generative-ai') || content.includes('generativelanguage.googleapis.com')) {
                violations.push(fullPath);
            }
        }
    }
    return violations;
}

describe('Gate 2B-3A: AI Provider Policy Enforcement', () => {
    it('should NOT allow direct import of @google/generative-ai outside of authorized adapters', () => {
        const violations = scanForBypass(path.join(PROJECT_ROOT, 'api'));
        expect(violations).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Hardening (Stage6 LAB): cover every code file type, not only *.js, and keep the
// type-only exception for api/lib/gemini-types.d.ts narrow and explicit.
// The original test above is unchanged.
// ---------------------------------------------------------------------------
const SCANNED_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];
const AUTHORIZED_RUNTIME_ADAPTERS = ['lib/gemini.js', 'lib/ai-provider.js'];
const TYPE_ONLY_EXCEPTION = 'lib/gemini-types.d.ts';
const SDK_PATTERN = /@google\/generative-ai|generativelanguage\.googleapis\.com/;
const ALLOWED_TYPE_IMPORT =
    /^[ \t]*import\s+type\s+\{[^}]*\}\s+from\s+['"]@google\/generative-ai['"]\s*;?[ \t]*$/gm;

/**
 * @param {string} relPath path relative to api/, posix separators
 * @param {string} content
 * @returns {string | null} reason, or null when allowed
 */
function findSdkViolation(relPath, content) {
    if (!SDK_PATTERN.test(content)) return null;
    if (AUTHORIZED_RUNTIME_ADAPTERS.includes(relPath)) return null;
    if (relPath === TYPE_ONLY_EXCEPTION) {
        const rest = content.replace(ALLOWED_TYPE_IMPORT, '');
        if (SDK_PATTERN.test(rest) || /\b(require|import)\s*\(/.test(rest) || /\bexport\s+[^;]*\bfrom\b/.test(rest)) {
            return 'type-only exception violated';
        }
        return null;
    }
    return 'unauthorized SDK reference';
}

/** @param {string} dir @param {string} base @returns {string[]} */
function scanAllCodeFiles(dir, base) {
    /** @type {string[]} */
    let violations = [];
    for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        if (fs.statSync(fullPath).isDirectory()) {
            if (entry === 'node_modules' || entry.startsWith('.')) continue;
            violations = violations.concat(scanAllCodeFiles(fullPath, base));
        } else if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext)) && !entry.includes('.test.')) {
            const rel = path.relative(base, fullPath).split(path.sep).join('/');
            const reason = findSdkViolation(rel, fs.readFileSync(fullPath, 'utf8'));
            if (reason) violations.push(`${rel}: ${reason}`);
        }
    }
    return violations;
}

describe('Gate 2B-3A hardening: all code file types', () => {
    it('no unauthorized SDK reference in any api/ code file (js, jsx, mjs, cjs, ts, tsx, d.ts)', () => {
        expect(scanAllCodeFiles(path.join(PROJECT_ROOT, 'api'), path.join(PROJECT_ROOT, 'api'))).toEqual([]);
    });

    it('positive: authorized adapters and the narrow type-only exception are accepted', () => {
        expect(findSdkViolation('lib/ai-provider.js', "import { GoogleGenerativeAI } from '@google/generative-ai';")).toBeNull();
        expect(findSdkViolation('lib/gemini.js', "await import('@google/generative-ai')")).toBeNull();
        expect(findSdkViolation(TYPE_ONLY_EXCEPTION, "import type { Part } from '@google/generative-ai';\nexport type P = Part;")).toBeNull();
        expect(findSdkViolation('lib/other.js', 'export const x = 1;')).toBeNull();
    });

    it('negative: unauthorized runtime imports are rejected for every file type', () => {
        const src = "import { GoogleGenerativeAI } from '@google/generative-ai';";
        for (const file of ['lib/x.js', 'lib/x.jsx', 'lib/x.mjs', 'lib/x.cjs', 'lib/x.ts', 'lib/x.tsx', '_handlers/x.js']) {
            expect(findSdkViolation(file, src), file).not.toBeNull();
        }
        expect(findSdkViolation('lib/x.cjs', "const g = require('@google/generative-ai');")).not.toBeNull();
        expect(findSdkViolation('lib/x.mjs', "const g = await import('@google/generative-ai');")).not.toBeNull();
        expect(findSdkViolation('_handlers/x.js', "fetch('https://generativelanguage.googleapis.com/v1')")).not.toBeNull();
        expect(findSdkViolation('lib/x.js', '/** @type {import("@google/generative-ai").Part} */')).not.toBeNull();
    });

    it('negative: the exception is limited to import type in gemini-types.d.ts only', () => {
        const typeImport = "import type { Part } from '@google/generative-ai';";
        // same content in any other .d.ts is rejected
        expect(findSdkViolation('lib/other-types.d.ts', typeImport)).not.toBeNull();
        expect(findSdkViolation('_utils/http-types.d.ts', typeImport)).not.toBeNull();
        // value import / re-export / require / dynamic import / endpoint in the exempt file are rejected
        expect(findSdkViolation(TYPE_ONLY_EXCEPTION, "import { GoogleGenerativeAI } from '@google/generative-ai';")).not.toBeNull();
        expect(findSdkViolation(TYPE_ONLY_EXCEPTION, `${typeImport}\nexport * from '@google/generative-ai';`)).not.toBeNull();
        expect(findSdkViolation(TYPE_ONLY_EXCEPTION, `${typeImport}\nexport { Part } from '@google/generative-ai';`)).not.toBeNull();
        expect(findSdkViolation(TYPE_ONLY_EXCEPTION, `${typeImport}\nconst g = require('@google/generative-ai');`)).not.toBeNull();
        expect(findSdkViolation(TYPE_ONLY_EXCEPTION, `${typeImport}\ntype T = import('@google/generative-ai').Part;`)).not.toBeNull();
        expect(findSdkViolation(TYPE_ONLY_EXCEPTION, "// https://generativelanguage.googleapis.com/")).not.toBeNull();
    });
});
