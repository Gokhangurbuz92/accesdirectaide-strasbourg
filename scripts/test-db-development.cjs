#!/usr/bin/env node

/**
 * Script de diagnostic PostgreSQL - Base de données DEVELOPMENT
 * 
 * Teste la connexion et compte le contenu publié
 * Endpoint: <NEON_ENDPOINT> (Development)
 * 
 * IMPORTANT: Ce script utilise les variables d'environnement
 * Définir DATABASE_URL avant d'exécuter
 */

const { Client } = require('pg');

// Utiliser la variable d'environnement au lieu de hardcoder les credentials
const DEV_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING;

if (!DEV_URL) {
  console.error('❌ ERREUR: Variable d\'environnement manquante');
  console.error('   Définir DATABASE_URL ou POSTGRES_URL_NON_POOLING\n');
  console.error('Exemple:');
  console.error('   export DATABASE_URL="postgresql://USER@HOST/DB"');
  console.error('   node scripts/test-db-development.cjs\n');
  process.exit(1);
}

async function testDevelopmentDB() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  DIAGNOSTIC BASE DE DONNÉES DEVELOPMENT                       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  const client = new Client({
    connectionString: DEV_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔌 Connexion à la base de données...');
    console.log(`   Endpoint: [MASQUÉ POUR SÉCURITÉ]\n`);
    
    await client.connect();
    console.log('✅ Connexion réussie!\n');

    // Test 1: Vérifier les tables existantes
    console.log('📊 ÉTAPE 1: Tables existantes');
    console.log('─'.repeat(64));
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    if (tablesResult.rows.length === 0) {
      console.log('❌ PROBLÈME CRITIQUE: Aucune table trouvée!');
      console.log('   → La base de données est vide');
      console.log('   → Le schéma Prisma n\'a jamais été appliqué\n');
      return;
    }
    
    console.log(`✅ ${tablesResult.rows.length} table(s) trouvée(s):`);
    tablesResult.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    console.log('');

    // Test 2: Compter les aides
    console.log('📊 ÉTAPE 2: Contenu - Aides');
    console.log('─'.repeat(64));
    try {
      const aidesTotal = await client.query('SELECT COUNT(*) AS total FROM "Aide"');
      const aidesPubliees = await client.query('SELECT COUNT(*) AS total FROM "Aide" WHERE statut = \'publie\'');
      const aidesParStatut = await client.query('SELECT statut, COUNT(*) AS count FROM "Aide" GROUP BY statut ORDER BY count DESC');
      
      console.log(`   Total aides: ${aidesTotal.rows[0].total}`);
      console.log(`   Aides publiées: ${aidesPubliees.rows[0].total}`);
      
      if (aidesParStatut.rows.length > 0) {
        console.log('   Répartition par statut:');
        aidesParStatut.rows.forEach(row => {
          console.log(`     - ${row.statut || '(null)'}: ${row.count}`);
        });
      }
      
      if (aidesPubliees.rows[0].total === '0') {
        console.log('   ⚠️  PROBLÈME: Aucune aide publiée → pages vides');
      } else {
        console.log(`   ✅ ${aidesPubliees.rows[0].total} aide(s) publiée(s)`);
      }
    } catch (err) {
      console.log(`   ❌ Table "Aide" n'existe pas: ${err.message}`);
    }
    console.log('');

    // Test 3: Compter les structures
    console.log('📊 ÉTAPE 3: Contenu - Structures');
    console.log('─'.repeat(64));
    try {
      const structuresTotal = await client.query('SELECT COUNT(*) AS total FROM "Structure"');
      // Public API treats statut='actif' as visible/published for structures.
      const structuresActives = await client.query('SELECT COUNT(*) AS total FROM "Structure" WHERE statut = \'actif\'');
      const structuresParStatut = await client.query('SELECT statut, COUNT(*) AS count FROM "Structure" GROUP BY statut ORDER BY count DESC');
      const structuresParStatus = await client.query('SELECT status, COUNT(*) AS count FROM "Structure" GROUP BY status ORDER BY count DESC');
      
      console.log(`   Total structures: ${structuresTotal.rows[0].total}`);
      console.log(`   Structures actives: ${structuresActives.rows[0].total}`);

      if (structuresParStatut.rows.length > 0) {
        console.log('   Répartition par statut:');
        structuresParStatut.rows.forEach(row => {
          console.log(`     - ${row.statut || '(null)'}: ${row.count}`);
        });
      }

      if (structuresParStatus.rows.length > 0) {
        console.log('   Répartition par status:');
        structuresParStatus.rows.forEach(row => {
          console.log(`     - ${row.status || '(null)'}: ${row.count}`);
        });
      }
      
      if (structuresActives.rows[0].total === '0') {
        console.log('   ⚠️  PROBLÈME: Aucune structure active → annuaire vide');
      } else {
        console.log(`   ✅ ${structuresActives.rows[0].total} structure(s) active(s)`);
      }
    } catch (err) {
      console.log(`   ❌ Table "Structure" n'existe pas: ${err.message}`);
    }
    console.log('');

    // Test 4: Compter les actualités
    console.log('📊 ÉTAPE 4: Contenu - Actualités');
    console.log('─'.repeat(64));
    try {
      const actualitesTotal = await client.query('SELECT COUNT(*) AS total FROM "Actualite"');
      const actualitesPubliees = await client.query('SELECT COUNT(*) AS total FROM "Actualite" WHERE statut = \'publie\'');
      
      console.log(`   Total actualités: ${actualitesTotal.rows[0].total}`);
      console.log(`   Actualités publiées: ${actualitesPubliees.rows[0].total}`);
      
      if (actualitesPubliees.rows[0].total === '0') {
        console.log('   ⚠️  PROBLÈME: Aucune actualité publiée');
      } else {
        console.log(`   ✅ ${actualitesPubliees.rows[0].total} actualité(s) publiée(s)`);
      }
    } catch (err) {
      console.log(`   ❌ Table "Actualite" n'existe pas: ${err.message}`);
    }
    console.log('');

    // Test 5: Vérifier les logs d'import
    console.log('📊 ÉTAPE 5: Logs d\'import (pipeline)');
    console.log('─'.repeat(64));
    try {
      const logsRecents = await client.query(`
        SELECT source_name, status, "createdAt" 
        FROM "ImportLog" 
        ORDER BY "createdAt" DESC 
        LIMIT 5
      `);
      
      if (logsRecents.rows.length === 0) {
        console.log('   ❌ PROBLÈME CRITIQUE: Aucun log d\'import');
        console.log('   → Le pipeline d\'ingestion n\'a JAMAIS été exécuté');
        console.log('   → C\'est la cause principale des pages vides\n');
      } else {
        console.log(`   ✅ ${logsRecents.rows.length} import(s) récent(s):`);
        logsRecents.rows.forEach(row => {
          console.log(`     - ${row.source_name}: ${row.status} (${row.createdAt})`);
        });
      }
    } catch (err) {
      console.log(`   ❌ Table "ImportLog" n'existe pas: ${err.message}`);
      console.log('   → Impossible de vérifier l\'historique du pipeline');
    }
    console.log('');

    // Résumé final
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  RÉSUMÉ DIAGNOSTIC                                             ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
    
    console.log('🎯 VERDICT:');
    console.log('   Base de données: ACCESSIBLE ✅');
    console.log('   Schéma Prisma: À VÉRIFIER (selon tables trouvées)');
    console.log('   Contenu publié: À VÉRIFIER (selon counts ci-dessus)\n');
    
    console.log('📋 ACTIONS RECOMMANDÉES:');
    console.log('   1. Si tables manquantes → npx prisma db push');
    console.log('   2. Si contenu = 0 → Déclencher pipeline d\'ingestion');
    console.log('   3. Si statut ≠ "publie" → Vérifier logique de publication\n');

  } catch (error) {
    console.log('❌ ERREUR DE CONNEXION\n');
    console.log('Détails:', error.message);
    console.log('\n🔍 Causes possibles:');
    console.log('   - Variable d\'environnement manquante sur Vercel');
    console.log('   - Firewall Neon bloquant l\'IP du sandbox');
    console.log('   - Credentials incorrects');
    console.log('   - SSL/TLS mal configuré\n');
  } finally {
    await client.end();
    console.log('🔌 Connexion fermée\n');
  }
}

testDevelopmentDB().catch(console.error);
