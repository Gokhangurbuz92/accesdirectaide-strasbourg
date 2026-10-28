#!/usr/bin/env node

/**
 * Script de vérification de cohérence des variables d'environnement
 * Vérifie que toutes les variables sont présentes dans tous les fichiers
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 VÉRIFICATION DE COHÉRENCE DES VARIABLES D\'ENVIRONNEMENT\n');

// Liste des variables attendues : les prérequis de production de scripts/release-preflight.mjs (campagne de lancement 2026-10-25). ADMIN_TOKEN et
// BYPASS_SECRET n'y figurent plus : ce sont des valeurs interdites en production.
const expectedVars = [
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'DATABASE_SSL_VERIFY',
  'AUTH_MODE',
  'JWT_SECRET',
  'AUTH_SECRET',
  'ADA_ENCRYPTION_KEY',
  'ADA_VAULT_KEY',
  'APP_BASE_URL',
  'MAILER_PROVIDER',
  'MAILER_FROM',
  'MAILER_API_KEY',
  'CRON_SECRET',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'STORAGE_ENDPOINT',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'ALERT_WEBHOOK_URL',
  'SENTRY_DSN',
];

// Vérifier .env.local
console.log('📄 Vérification de .env.local...');
const envLocalPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  const envLocalContent = fs.readFileSync(envLocalPath, 'utf-8');
  const missingInLocal = expectedVars.filter(v => !envLocalContent.includes(`${v}=`));
  
  if (missingInLocal.length === 0) {
    console.log('   ✅ Toutes les variables sont présentes dans .env.local');
  } else {
    console.log('   ❌ Variables manquantes dans .env.local:');
    missingInLocal.forEach(v => console.log(`      - ${v}`));
  }
} else {
  console.log('   ⚠️  .env.local n\'existe pas');
}

// Vérifier .env.example
console.log('\n📄 Vérification de .env.example...');
const envExamplePath = path.join(process.cwd(), '.env.example');
if (fs.existsSync(envExamplePath)) {
  const envExampleContent = fs.readFileSync(envExamplePath, 'utf-8');
  const missingInExample = expectedVars.filter(v => !envExampleContent.includes(`${v}=`));
  
  if (missingInExample.length === 0) {
    console.log('   ✅ Toutes les variables sont documentées dans .env.example');
  } else {
    console.log('   ❌ Variables manquantes dans .env.example:');
    missingInExample.forEach(v => console.log(`      - ${v}`));
  }
} else {
  console.log('   ❌ .env.example n\'existe pas');
}

// Vérifier VERCEL_ENV_SETUP.md
console.log('\n📄 Vérification de VERCEL_ENV_SETUP.md...');
const vercelSetupPath = path.join(process.cwd(), 'VERCEL_ENV_SETUP.md');
if (fs.existsSync(vercelSetupPath)) {
  const vercelSetupContent = fs.readFileSync(vercelSetupPath, 'utf-8');
  const missingInVercel = expectedVars.filter(v => !vercelSetupContent.includes(`${v}`));
  
  if (missingInVercel.length === 0) {
    console.log('   ✅ Toutes les variables sont documentées dans VERCEL_ENV_SETUP.md');
  } else {
    console.log('   ❌ Variables manquantes dans VERCEL_ENV_SETUP.md:');
    missingInVercel.forEach(v => console.log(`      - ${v}`));
  }
} else {
  console.log('   ❌ VERCEL_ENV_SETUP.md n\'existe pas');
}

// Vérifier les espaces dans les URLs PostgreSQL
console.log('\n🔍 Vérification des URLs PostgreSQL (espaces)...');
if (fs.existsSync(envLocalPath)) {
  const envLocalContent = fs.readFileSync(envLocalPath, 'utf-8');
  const postgresUrls = envLocalContent.match(/postgresql:\/\/[^\n"]+/g) || [];
  
  let hasSpaceIssue = false;
  postgresUrls.forEach(url => {
    // Vérifier s'il y a un espace après le mot de passe (avant @)
    if (url.match(/:[^@]+\s+@/)) {
      console.log('   ❌ ESPACE DÉTECTÉ dans une URL PostgreSQL de .env.local (valeur non affichée : elle contient le mot de passe)');
      hasSpaceIssue = true;
    }
  });
  
  if (!hasSpaceIssue) {
    console.log('   ✅ Aucun espace détecté dans les URLs PostgreSQL');
  }
}

console.log('\n📊 RÉSUMÉ:');
console.log(`   Total de variables attendues: ${expectedVars.length}`);
console.log('   ✅ Vérification terminée\n');
