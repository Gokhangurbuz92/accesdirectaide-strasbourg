// R31 acceptance — run from the repository root:
//   1. a disposable local PostgreSQL database, migrated (drizzle-kit migrate), timezone UTC; an env file with LOCAL random secrets (see scripts/lab-local.mjs init)
//   2. npx tsx scripts/acceptance/r31-lab-seed.mjs <accounts.json>          (writes random test credentials there, mode 600 — never commit it)
//   3. vite build to a directory outside the tree; LAB_PORT=5173 (an origin the API accepts locally) node --import tsx scripts/lab-server.mjs
//   4. node scripts/acceptance/r31-lab-accept.mjs <accounts.json> [screenshot dir] [result.json]
// R31 LAB acceptance — synthetic data only, on the isolated database of lab.env (127.0.0.1:55434/ada_r31_e2e). Credentials are random, written to accounts.json (mode 600).
import fs from 'node:fs'; import crypto from 'node:crypto';
const root = process.cwd();
// synthetic data only, and only on a database of this machine
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(process.env.DATABASE_URL || 'postgresql://none').hostname)) { console.error('refusing: DATABASE_URL is not local'); process.exit(3); }
const { db } = await import(root + '/src/db/index.js');
const s = await import(root + '/src/db/schema.js');
const { hashPassword } = await import(root + '/api/_utils/password-hash.js');
const { encryptToken } = await import(root + '/api/_utils/vault.ts');
const { sql } = await import('drizzle-orm');
const out = process.argv[2];
const pw = () => `Lab${crypto.randomBytes(9).toString('hex')}!aA1`;
const b32 = () => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; return [...crypto.randomBytes(32)].map((x) => a[x % 32]).join(''); };   // 32 characters = 160 bits
const acc = { admin: { email: 'admin.r31@lab.test', password: pw(), totp: b32() }, pro: { email: 'pro.r31@lab.test', password: pw() }, pro2: { email: 'pro2.r31@lab.test', password: pw() }, other: { email: 'autre.r31@lab.test', password: pw() } };
await db.execute(sql`DELETE FROM "AdminUser" WHERE email = ${acc.admin.email}`);
const enc = encryptToken(acc.admin.totp);
await db.insert(s.AdminUser).values({ id: 'r31-admin', email: acc.admin.email, password: await hashPassword(acc.admin.password), role: 'admin', mfaEnabled: true, mfaSecret: enc.content, mfaIv: enc.iv, displayName: 'Administrateur fictif R31', failedLoginAttempts: 0 }).onConflictDoNothing();
const V = (x) => ({ statut: 'publie', launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'verification-automatique', territory_verified: true, data_origin: 'official_source', date_verification: new Date(Date.now() - 3 * 86400000), source_url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006', ...x });
for (const [id, nom] of [['r31-s1', 'Centre social fictif (Neudorf)'], ['r31-s2', 'Association fictive (Cronenbourg)']]) {
  await db.insert(s.Structure).values({ id, slug: id, nom, ville: 'Strasbourg', services: [], publics_accueillis: [], categories_aidees: ['Accès aux droits'], ...V({ statut: 'actif' }) }).onConflictDoNothing();
}
for (const [k, sid, role] of [['pro', 'r31-s1', 'STRUCTURE_ADMIN'], ['pro2', 'r31-s1', 'PRO'], ['other', 'r31-s2', 'PRO']]) {
  await db.insert(s.ProUser).values({ id: `r31-${k}`, email: acc[k].email, password_hash: await hashPassword(acc[k].password), role, structureId: sid, status: 'active' }).onConflictDoNothing();
}
await db.insert(s.Aide).values({ id: 'r31-aide-apl', slug: 'aide-fictive-loyer', titre: 'Aide fictive au paiement du loyer', cest_quoi: 'Fiche de test : aide fictive pour réduire le loyer.', categorie: 'logement', ...V() }).onConflictDoNothing();
await db.insert(s.Aide).values({ id: 'r31-aide-sante', slug: 'aide-fictive-sante', titre: 'Aide fictive pour les frais de santé', cest_quoi: 'Fiche de test : aide fictive pour les frais de santé.', categorie: 'santé', ...V() }).onConflictDoNothing();
await db.insert(s.Demarche).values({ id: 'r31-dem-hlm', slug: 'demarche-fictive-logement-social', titre: 'Démarche fictive : demander un logement social', description_courte: 'Fiche de test : démarche fictive de logement social.', categorie: 'logement', ...V() }).onConflictDoNothing();
await db.insert(s.SharedDiagnostic).values({ id: 'r31-dossier', expiresAt: new Date(Date.now() + 60 * 86400000), situation: { synthetic: true }, results: {}, viewCount: 0 }).onConflictDoNothing();
await db.insert(s.SharedDossierGrant).values({ id: 'r31-grant', sharedDiagnosticId: 'r31-dossier', structureId: 'r31-s1', grantedByProUserId: 'r31-pro' }).onConflictDoNothing();
await db.insert(s.ProCase).values({ id: 'r31-case', sharedDiagnosticId: 'r31-dossier', structureId: 'r31-s1', status: 'IN_PROGRESS', assigneeProUserId: 'r31-pro' }).onConflictDoNothing();
fs.writeFileSync(out, JSON.stringify(acc, null, 2), { mode: 0o600 });
console.log('seeded', Object.keys(acc).join(','));
process.exit(0);
