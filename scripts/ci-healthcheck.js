#!/usr/bin/env node

import process from 'process';

// Use global fetch (Node 18+) or undici if needed
const fetch = globalThis.fetch;

if (!fetch) {
    console.error("This script requires Node.js 18+ (global fetch).");
    process.exit(1);
}

const args = process.argv.slice(2);
const allowNoIndex = args.includes('--allow-noindex');
const BASE_URL = args.find(arg => !arg.startsWith('--')) || 'https://www.accesdirectaide.fr';

console.log(`🏥 CI Healthcheck starting for: ${BASE_URL}`);
if (allowNoIndex) console.log('   (Ignoring noindex checks)');
console.log('--------------------------------------------------');

const PATHS = [
    { path: '/', name: 'Homepage' },
    { path: '/aides', name: 'Aides' },
    { path: '/demarches', name: 'Demarches' },
    { path: '/annuaire', name: 'Annuaire' },
    { path: '/actualites', name: 'Actualites' },
    { path: '/api/version', name: 'API Version', checkJson: true },
    { path: '/robots.txt', name: 'Robots.txt', checkText: 'Sitemap:' },
    { path: '/sitemap.xml', name: 'Sitemap', checkText: 'urlset' }
];

let failed = false;

async function checkUrl(item) {
    const url = `${BASE_URL}${item.path}`;
    let itemPassed = true;

    try {
        const res = await fetch(url);

        // 1. Check Status
        if (res.status !== 200) {
            console.error(`❌ [${item.name}] Status ${res.status} (Expected 200) - ${url}`);
            itemPassed = false;
        }

        // 2. Check x-release-sha
        const sha = res.headers.get('x-release-sha');
        if (!sha) {
            console.error(`❌ [${item.name}] Missing x-release-sha header`);
            itemPassed = false;
        }

        // 3. Check x-robots-tag
        const robotsTag = res.headers.get('x-robots-tag');
        if (robotsTag && robotsTag.includes('noindex')) {
            if (allowNoIndex) {
                // console.log(`   [${item.name}] x-robots-tag contains noindex (Allowed)`);
            } else {
                console.error(`❌ [${item.name}] x-robots-tag contains noindex! (${robotsTag})`);
                itemPassed = false;
            }
        }

        // 4. Content Checks
        if (item.checkJson) {
            try {
                const data = await res.json();
                if (!data.sha || !data.version) {
                    console.error(`❌ [${item.name}] Invalid JSON response (missing sha/version)`);
                    itemPassed = false;
                }
            } catch {
                console.error(`❌ [${item.name}] Failed to parse JSON`);
                itemPassed = false;
            }
        } else if (item.checkText) {
            try {
                const text = await res.text();
                if (!text.includes(item.checkText)) {
                    console.error(`❌ [${item.name}] Content missing "${item.checkText}"`);
                    itemPassed = false;
                }
            } catch {
                console.error(`❌ [${item.name}] Failed to read text`);
                itemPassed = false;
            }
        }

    } catch (err) {
        console.error(`❌ [${item.name}] Fetch Failed: ${err.message}`);
        itemPassed = false;
    }

    if (!itemPassed) failed = true;
    return itemPassed;
}

async function run() {
    for (const item of PATHS) {
        const success = await checkUrl(item);
        if (success) {
             console.log(`✅ [${item.name}] OK`);
        }
    }

    console.log('--------------------------------------------------');
    if (failed) {
        console.error("💥 Healthcheck FAILED");
        process.exit(1);
    } else {
        console.log("✨ Healthcheck PASSED");
        process.exit(0);
    }
}

run();
