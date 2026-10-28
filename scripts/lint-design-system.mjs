import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Define specific directories to scan
const COMPONENTS_DIR = path.join(ROOT_DIR, 'src', 'components');
const UI_COMPONENTS_DIR = path.join(COMPONENTS_DIR, 'ui');

// Regex to capture hardcoded hex colors
const hexColorRegex = /#[0-9a-fA-F]{3,8}\b/g;

// Tailwind raw palette regex
const tailwindColors = ['slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];
const colorsPattern = tailwindColors.join('|');
const tailwindPaletteRegex = new RegExp(`(?:text|bg|border|ring|from|via|to)-(?:${colorsPattern})-\\d{2,3}\\b`, 'g');

// Only scan JS, JSX, TS, TSX, CSS files
const allowedExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.css']);

let totalViolations = 0;

function walk(dir, callback) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            walk(filePath, callback);
        } else {
            if (allowedExtensions.has(path.extname(filePath))) {
                callback(filePath);
            }
        }
    }
}

function checkFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const isUiComponent = filePath.startsWith(UI_COMPONENTS_DIR);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for hardcoded hex colors in all src/components/**
        let hexMatch;
        while ((hexMatch = hexColorRegex.exec(line)) !== null) {
            console.error(`❌ [Hex Color] ${filePath}:${i + 1}`);
            console.error(`   ${line.trim()}`);
            console.error(`   Found: ${hexMatch[0]}`);
            totalViolations++;
        }

        // Check for plain tailwind palette classes only in src/components/ui/**
        if (isUiComponent) {
            let paletteMatch;
            while ((paletteMatch = tailwindPaletteRegex.exec(line)) !== null) {
                console.error(`❌ [Tailwind Palette] ${filePath}:${i + 1}`);
                console.error(`   ${line.trim()}`);
                console.error(`   Found: ${paletteMatch[0]}`);
                totalViolations++;
            }
        }
    }
}

console.log('🔍 Scanning design system for hardcoded values...');

// Scan all components for hex
if (fs.existsSync(COMPONENTS_DIR)) {
    walk(COMPONENTS_DIR, checkFile);
}

// Documented v1.0.0 technical-debt ceiling.
// docs/roadmap.md and docs/audit-status.md both record 150 existing violations.
// The environment may tighten this ceiling, but must never loosen it.
const BASELINE_VIOLATIONS = 150;
const configuredMaxRaw = process.env.MAX_DESIGN_SYSTEM_VIOLATIONS;

let maxAllowed = BASELINE_VIOLATIONS;

if (configuredMaxRaw !== undefined) {
    const configuredMax = Number(configuredMaxRaw);

    if (
        configuredMaxRaw.trim() === '' ||
        !Number.isInteger(configuredMax)
    ) {
        console.error(
            `🚨 Invalid MAX_DESIGN_SYSTEM_VIOLATIONS: expected an integer between 0 and ${BASELINE_VIOLATIONS}.`
        );
        process.exit(2);
    }

    if (
        configuredMax < 0 ||
        configuredMax > BASELINE_VIOLATIONS
    ) {
        console.error(
            `🚨 Invalid MAX_DESIGN_SYSTEM_VIOLATIONS: ${configuredMax}. ` +
            `The documented baseline ceiling is ${BASELINE_VIOLATIONS}; the gate may only be tightened.`
        );
        process.exit(2);
    }

    maxAllowed = configuredMax;
}

if (totalViolations > maxAllowed) {
    console.error(
        `\n🚨 Failed: Found ${totalViolations} design system violations (max allowed: ${maxAllowed}).`
    );
    process.exit(1);
}

console.log(
    `✅ Design system check passed. ${totalViolations} violations within non-regression ceiling (<= ${maxAllowed}).`
);
process.exit(0);
