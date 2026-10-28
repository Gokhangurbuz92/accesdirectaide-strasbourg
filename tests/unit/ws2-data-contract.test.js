import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyWs2Data } from '../../scripts/verify-ws2-data.mjs';

const ROOTS = [];
const SP_IDS = [
  'F10009', 'F12006', 'F1280', 'F12242', 'F14809', 'F14202', 'N19775',
  'N31477', 'F2882', 'F10027', 'F18074', 'F2038', 'F21375', 'F13609',
  'F34917', 'F245', 'F248', 'F10007', 'R34754', 'R78263', 'F1637',
  'R54651', 'R52880', 'F34959', 'N110',
];
const AIDE_IDS = ['F10009', 'F12006', 'F1280', 'F12242', 'F14809', 'F14202', 'F10027', 'N19775', 'F2882', 'F18074', 'F13609', 'F21375', 'F2038'];
const DEMARCHE_IDS = ['R78263', 'F10007', 'R34754', 'F34959', 'F1637', 'F10027', 'R52880', 'R54651', 'F2882', 'N31477', 'N110'];

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers, rows) {
  return `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}\n`;
}

async function writeCsv(root, rel, headers, rows) {
  const target = path.join(root, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, toCsv(headers, rows), 'utf8');
}

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'ada-ws2-contract-'));
  ROOTS.push(root);
  const aideHeaders = ['titre', 'slug', 'categorie', 'est_urgent', 'territoires', 'departements', 'audiences', 'situations_vie', 'mots_cles', 'statut', 'summary_falc', 'cest_quoi', 'pour_qui', 'montant_falc', 'conditions_falc', 'provenance', 'verifiedCurrent', 'launchEligible'];
  const aides = Array.from({ length: 15 }, (_, index) => ({
    titre: `Aide ${index + 1}`, slug: `aide-${index + 1}`, categorie: 'social', est_urgent: 'false', territoires: 'Strasbourg', departements: '67', audiences: 'tous', situations_vie: 'test', mots_cles: 'test', statut: 'actif', summary_falc: 'Resume simple', cest_quoi: 'Description', pour_qui: 'Public', montant_falc: 'Selon situation', conditions_falc: 'Conditions simples', provenance: index < AIDE_IDS.length ? AIDE_IDS[index] : (index === 13 ? 'FAJ Strasbourg' : 'Carte solidaire Grand Est'), verifiedCurrent: 'true', launchEligible: 'true',
  }));
  const demarcheHeaders = ['titre', 'slug', 'categorie', 'departements', 'audiences', 'delai', 'cout', 'statut', 'summary_falc', 'pour_qui', 'ou_faire', 'etapes', 'provenance', 'verifiedCurrent', 'launchEligible'];
  const demarches = Array.from({ length: 10 }, (_, index) => ({
    titre: `Demarche ${index + 1}`, slug: `demarche-${index + 1}`, categorie: 'administratif', departements: '67', audiences: 'tous', delai: 'variable', cout: '0', statut: 'actif', summary_falc: 'Resume simple', pour_qui: 'Public', ou_faire: 'Strasbourg', etapes: 'Etape 1', provenance: index === 0 ? DEMARCHE_IDS.slice(0, 2).join(' ') : (index === 1 ? DEMARCHE_IDS.slice(2, 4).join(' ') : (index === 2 ? DEMARCHE_IDS.slice(4, 6).join(' ') : (index === 3 ? DEMARCHE_IDS.slice(6, 8).join(' ') : (index === 4 ? DEMARCHE_IDS.slice(8).join(' ') : 'data-inclusion Strasbourg')))), verifiedCurrent: 'true', launchEligible: 'true',
  }));
  const structureHeaders = ['nom', 'slug', 'type_structure', 'adresse', 'code_postal', 'ville', 'departement', 'telephone', 'email', 'site_web', 'statut', 'summary_falc', 'provenance', 'verifiedCurrent', 'launchEligible'];
  const structures = Array.from({ length: 20 }, (_, index) => ({
    nom: `Structure ${index + 1}`, slug: `structure-${index + 1}`, type_structure: 'service', adresse: `${index + 1} rue du Test`, code_postal: '67000', ville: 'Strasbourg', departement: '67', telephone: '', email: '', site_web: '', statut: 'actif', summary_falc: 'Accueil social', provenance: 'data-inclusion Strasbourg', verifiedCurrent: 'true', launchEligible: 'true',
  }));
  await writeCsv(root, 'data/aides-alsace.csv', aideHeaders, aides);
  await writeCsv(root, 'data/demarches-alsace.csv', demarcheHeaders, demarches);
  await writeCsv(root, 'data/structures-alsace.csv', structureHeaders, structures);
  await mkdir(path.join(root, 'data/strasbourg'), { recursive: true });
  await writeFile(path.join(root, 'data/strasbourg/service-public-demarches.snapshot.json'), JSON.stringify({ items: SP_IDS.map((id) => ({ id })) }), 'utf8');
  await writeFile(path.join(root, 'data/strasbourg/ws2-source-manifest.json'), JSON.stringify({ schema: 'ada.ws2.source-manifest.v1', offlineOnly: true, runtimeFetch: false }), 'utf8');
  return root;
}

async function rewriteCsv(root, rel, mutate) {
  const file = path.join(root, rel);
  const raw = await readFile(file, 'utf8');
  const lines = raw.trimEnd().split('\n');
  const headers = lines[0].split(',');
  const rows = lines.slice(1).map((line) => Object.fromEntries(line.split(',').map((value, index) => [headers[index], value])));
  mutate(rows, headers);
  await writeFile(file, toCsv(headers, rows), 'utf8');
}

afterEach(async () => {
  while (ROOTS.length) await rm(ROOTS.pop(), { recursive: true, force: true });
});

describe('WS2 deterministic launch-data contract', () => {
  it('accepts a complete verified offline Strasbourg fixture', async () => {
    const root = await makeFixture();
    await expect(verifyWs2Data({ rootDir: root })).resolves.toMatchObject({ launchReady: true, offlineOnly: true, counts: { aides: 15, demarches: 10, structures: 20 }, requiredServicePublicIds: 25 });
  });

  it('rejects an invalid aide count', async () => {
    const root = await makeFixture();
    await rewriteCsv(root, 'data/aides-alsace.csv', (rows) => rows.pop());
    await expect(verifyWs2Data({ rootDir: root })).rejects.toMatchObject({ code: 'WS2_AIDE_COUNT_INVALID' });
  });

  it('rejects fewer than twenty structures', async () => {
    const root = await makeFixture();
    await rewriteCsv(root, 'data/structures-alsace.csv', (rows) => rows.pop());
    await expect(verifyWs2Data({ rootDir: root })).rejects.toMatchObject({ code: 'WS2_STRUCTURE_COUNT_INVALID' });
  });

  it('rejects a demarche count other than ten', async () => {
    const root = await makeFixture();
    await rewriteCsv(root, 'data/demarches-alsace.csv', (rows) => rows.pop());
    await expect(verifyWs2Data({ rootDir: root })).rejects.toMatchObject({ code: 'WS2_DEMARCHE_COUNT_INVALID' });
  });

  it('rejects missing FALC content', async () => {
    const root = await makeFixture();
    await rewriteCsv(root, 'data/aides-alsace.csv', (rows) => { rows[0].summary_falc = ''; });
    await expect(verifyWs2Data({ rootDir: root })).rejects.toMatchObject({ code: 'WS2_REQUIRED_FIELD_EMPTY' });
  });

  it('rejects unverified launch data', async () => {
    const root = await makeFixture();
    await rewriteCsv(root, 'data/aides-alsace.csv', (rows) => { rows[0].verifiedCurrent = 'false'; });
    await expect(verifyWs2Data({ rootDir: root })).rejects.toMatchObject({ code: 'WS2_NOT_VERIFIED_CURRENT' });
  });

  it('rejects duplicate record keys', async () => {
    const root = await makeFixture();
    await rewriteCsv(root, 'data/aides-alsace.csv', (rows) => { rows[1].slug = rows[0].slug; });
    await expect(verifyWs2Data({ rootDir: root })).rejects.toMatchObject({ code: 'WS2_DUPLICATE_RECORD_KEY' });
  });

  it('rejects a missing frozen Service-Public ID', async () => {
    const root = await makeFixture();
    await writeFile(path.join(root, 'data/strasbourg/service-public-demarches.snapshot.json'), JSON.stringify({ items: SP_IDS.slice(0, -1).map((id) => ({ id })) }), 'utf8');
    await expect(verifyWs2Data({ rootDir: root })).rejects.toMatchObject({ code: 'WS2_SERVICE_PUBLIC_ID_MISSING' });
  });

  it('rejects synthetic or placeholder launch records', async () => {
    const root = await makeFixture();
    await rewriteCsv(root, 'data/aides-alsace.csv', (rows) => { rows[0].summary_falc = 'synthetic record'; });
    await expect(verifyWs2Data({ rootDir: root })).rejects.toMatchObject({ code: 'WS2_SYNTHETIC_OR_PLACEHOLDER_DATA' });
  });

  it('rejects missing required demarche source references', async () => {
    const root = await makeFixture();
    await rewriteCsv(root, 'data/demarches-alsace.csv', (rows) => { for (const row of rows) row.provenance = 'data-inclusion Strasbourg'; });
    await expect(verifyWs2Data({ rootDir: root })).rejects.toMatchObject({ code: 'WS2_REQUIRED_SOURCE_ID_MISSING' });
  });

  it('rejects a manifest that enables remote runtime fetch', async () => {
    const root = await makeFixture();
    await writeFile(path.join(root, 'data/strasbourg/ws2-source-manifest.json'), JSON.stringify({ runtimeFetch: true }), 'utf8');
    await expect(verifyWs2Data({ rootDir: root })).rejects.toMatchObject({ code: 'WS2_REMOTE_RUNTIME_FORBIDDEN' });
  });
});
