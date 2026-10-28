import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const buildInfoPath = path.resolve(__dirname, '../api/_utils/build-info.js');

// Ensure directory exists
const buildInfoDir = path.dirname(buildInfoPath);
if (!fs.existsSync(buildInfoDir)) {
    fs.mkdirSync(buildInfoDir, { recursive: true });
}

// Generate deterministic build info based on Git commit or env vars
let commitSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VITE_GIT_COMMIT_SHA || 'dev';
let buildTime = process.env.BUILD_TIME || new Date().toISOString();

// Try to get Git commit SHA if not in env
if (commitSha === 'dev') {
    try {
        commitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        // Git not available or not a repo, keep 'dev'
    }
}

const content = `// Auto-generated build info - DO NOT EDIT
export const buildTime = "${buildTime}";
export const commitSha = "${commitSha}";
`;

try {
    // Only write if content changed (to avoid unnecessary git diffs)
    let shouldWrite = true;
    if (fs.existsSync(buildInfoPath)) {
        const existing = fs.readFileSync(buildInfoPath, 'utf-8');
        if (existing === content) {
            shouldWrite = false;
        }
    }
    
    if (shouldWrite) {
        fs.writeFileSync(buildInfoPath, content);
        console.log(`[Setup] Generated build info at ${buildInfoPath}`);
    } else {
        console.log(`[Setup] Build info unchanged, skipping write`);
    }
} catch (e) {
    console.error(`[Setup] Failed to generate build info: ${e.message}`);
    process.exit(1);
}
