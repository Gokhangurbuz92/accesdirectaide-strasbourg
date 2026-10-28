// Key rotation helper: node --import tsx scripts/rc5-rewrap-keys.mjs [--apply]
// Reads DATABASE_URL and ADA_ENCRYPTION_KEY / ADA_ENCRYPTION_KEY_PREVIOUS from the environment (operator supplied; never from a file in this repo).
// Dry-run unless --apply. Prints counters only, never ciphertext or plaintext.
const apply = process.argv.includes('--apply');
// PKG-5: --all re-wraps every encrypted column and blob (api/_services/key-rotation.js rewrapAll) and prints rotationStatus (safe to retire the old key or not).
const { rewrapMessages, rewrapAll, rotationStatus } = await import('../api/_services/key-rotation.js');
const all = process.argv.includes('--all');
const run = all ? await rewrapAll({ apply }) : await rewrapMessages({ apply });
const stats = all ? { ...run, orphans: run.orphans.length, status: await rotationStatus() } : run;
console.log(JSON.stringify(stats));
process.exit(stats.failed ? 1 : 0);
