#!/usr/bin/env node
/**
 * Hash Admin Password — Accès Direct Aide
 *
 * Génère un hash scrypt pour ADMIN_PASSWORD_HASH.
 *
 * Usage:
 *   node scripts/hash-admin-password.mjs "VotreMotDePasse"
 *
 * Puis copier le hash dans .env.local :
 *   ADMIN_PASSWORD_HASH=scrypt:abc123:def456...
 */

import crypto from 'node:crypto';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

async function hashPassword(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16).toString('hex');
        crypto.scrypt(password, salt, KEY_LEN, SCRYPT_PARAMS, (err, derivedKey) => {
            if (err) reject(err);
            else resolve(`scrypt:${salt}:${derivedKey.toString('hex')}`);
        });
    });
}

const password = process.argv[2];
if (!password) {
    console.error('❌ Usage: node scripts/hash-admin-password.mjs "VotreMotDePasse"');
    console.error('');
    console.error('Exemple:');
    console.error('  node scripts/hash-admin-password.mjs "MonSuperMotDePasse123"');
    process.exit(1);
}

const hash = await hashPassword(password);

console.log('\n✅ Hash scrypt généré avec succès !\n');
console.log('Hash:');
console.log(hash);
console.log('\n📋 Ajoutez cette ligne dans .env.local et Vercel :\n');
console.log(`ADMIN_PASSWORD_HASH=${hash}`);
console.log('\n⚠️  Vous pouvez ensuite supprimer ADMIN_PASSWORD de vos variables d\'environnement.\n');
