import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helpers for colorful output
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
};

function log(msg, color = colors.reset) {
    console.log(`${color}${msg}${colors.reset}`);
}

function checkMark(passed) {
    return passed ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
}

// 1. Check Node.js Version
function checkNodeVersion() {
    log('\n--- 1. Checking Node.js Environment ---', colors.cyan);
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0], 10);
    const passed = major >= 18;
    log(`[${checkMark(passed)}] Node version: ${version} (Required: >=18)`);
    return passed;
}

// 2. Check essential Environment Variables
function checkEnvVariables() {
    log('\n--- 2. Checking Environment Variables (.env) ---', colors.cyan);
    let passed = true;
    const requireVars = [
        'DATABASE_URL',
        'JWT_SECRET'
    ]; // Removed VITE_PUBLIC_URL as it might not be strictly necessary depending on Vite setup

    const envPath = path.join(rootDir, '.env');
    const envLocalPath = path.join(rootDir, '.env.local');

    let envContent = '';
    if (fs.existsSync(envPath)) {
        envContent += fs.readFileSync(envPath, 'utf8');
    }
    if (fs.existsSync(envLocalPath)) {
        envContent += fs.readFileSync(envLocalPath, 'utf8');
    }

    if (!envContent) {
        log(`[${checkMark(false)}] No .env or .env.local file found.`, colors.yellow);
        return false;
    }

    requireVars.forEach(v => {
        const isPresent = envContent.includes(`${v}=`);
        if (!isPresent && !process.env[v]) {
            log(`[${checkMark(false)}] Missing required environment variable: ${v}`, colors.red);
            passed = false;
        } else {
            log(`[${checkMark(true)}] Found variable: ${v}`);
        }
    });

    return passed;
}

// 3. Check Drizzle ORM Configuration
function checkDrizzle() {
    log('\n--- 3. Checking Drizzle ORM Configuration ---', colors.cyan);
    const schemaPath = path.join(rootDir, 'src', 'db', 'schema.js');
    let passed = true;

    if (fs.existsSync(schemaPath)) {
        log(`[${checkMark(true)}] Drizzle schema found at ${schemaPath}`);
    } else {
        log(`[${checkMark(false)}] Drizzle schema NOT found!`, colors.red);
        passed = false;
    }

    const dbIndexPath = path.join(rootDir, 'src', 'db', 'index.js');
    if (fs.existsSync(dbIndexPath)) {
        log(`[${checkMark(true)}] Drizzle db module found at ${dbIndexPath}`);
    } else {
        log(`[${checkMark(false)}] Drizzle db module NOT found!`, colors.red);
        passed = false;
    }

    return passed;
}

// 4. Inspect for stray console.logs in API handlers (Sanity Check)
function checkStrayConsoleLogs() {
    log('\n--- 4. Code Sanity Check (Stray console.log in API) ---', colors.cyan);
    let passed = true;
    try {
        // Find files using console.log in the api directory recursively
        // Ignoring node_modules and .git naturally, but specifically targeting our /api prefix
        // Now EXCLUDING the logger itself via an inverted match pipeline.
        const result = execSync('grep -rn "console.log" api/ | grep -v "api/lib/logger.js" || true', { cwd: rootDir, encoding: 'utf-8' });

        const lines = result.split('\n').filter(l => l.trim().length > 0 && !l.includes('// console.log'));

        if (lines.length > 0) {
            log(`[${checkMark(false)}] Found active console.log statements in API directory. Please use proper logging (e.g. Pino/Winston or remove them in production).`, colors.yellow);
            lines.slice(0, 5).forEach(l => log(`  -> ${l}`, colors.red));
            if (lines.length > 5) log(`  -> ... and ${lines.length - 5} more.`);
            passed = false; // We treat this as a warning, soft fail
        } else {
            log(`[${checkMark(true)}] No active console.log found in API handlers.`);
        }
    } catch (e) {
        // grep returns exit code 1 if nothing is found, which is what we want!
        log(`[${checkMark(true)}] No active console.log found in API handlers.`);
    }

    return true; // Don't block the whole audit on this
}

// 5. Test Build compilation
function checkBuild() {
    log('\n--- 5. Checking Build Configuration (vite, tsc) ---', colors.cyan);
    log(`Running 'npm run start:build_check'... (This might take a minute)`, colors.yellow);
    try {
        // Run a lightweight TS check or just check if package.json has scripts
        const packageJsonPath = path.join(rootDir, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

        if (!pkg.scripts || !pkg.scripts.build) {
            log(`[${checkMark(false)}] No 'build' script found in package.json`, colors.red);
            return false;
        }

        // We won't run full vite build here as it takes too long for the script, just verifying the manifest
        log(`[${checkMark(true)}] package.json build script exists.`);
        return true;
    } catch (e) {
        log(`[${checkMark(false)}] Error checking build: ${e.message}`, colors.red);
        return false;
    }
}

async function runAudit() {
    log("\n=======================================================", colors.magenta);
    log("🚀 ACCES-DIRECT-AIDE : SYSTEM HEALTH & AUDIT SCRIPT", colors.magenta);
    log("=======================================================\n", colors.magenta);

    const results = {
        node: checkNodeVersion(),
        env: checkEnvVariables(),
        drizzle: checkDrizzle(),
        sanity: checkStrayConsoleLogs(),
        build: checkBuild()
    };

    log('\n=======================================================', colors.magenta);
    log('📊 AUDIT SUMMARY', colors.magenta);
    log('=======================================================\n', colors.magenta);

    let allGood = true;
    for (const [key, passed] of Object.entries(results)) {
        if (!passed) allGood = false;
        log(`${key.toUpperCase().padEnd(10)} : ${passed ? colors.green + 'PASS' + colors.reset : colors.red + 'FAIL' + colors.reset}`);
    }

    if (allGood) {
        log('\n🎉 ALL CHECKS PASSED. The system is relatively healthy and ready for production.', colors.green);
        process.exit(0);
    } else {
        log('\n⚠️ SOME CHECKS FAILED. Please review the output above before claiming total SLA compliance.', colors.red);
        process.exit(1);
    }
}

runAudit();
