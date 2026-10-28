// Launch-readiness item 60: encrypts the answers of shared dossiers stored in clear before the encryption at rest existed.
//   node --import tsx scripts/seal-shared-situations.mjs [--apply]
// Reads DATABASE_URL and ADA_ENCRYPTION_KEY from the environment (operator supplied). Dry run unless --apply. Prints counters only, never a value.
const { sealPlainSituations } = await import('../api/_services/key-rotation.js');
const stats = await sealPlainSituations({ apply: process.argv.includes('--apply') });
console.log(JSON.stringify(stats));
process.exit(stats.failed ? 1 : 0);
