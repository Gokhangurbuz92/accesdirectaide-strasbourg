/**
 * R28: official practical guides (verbatim Service-Public sheets), news ingestion into drafts with human publication, and the C05 age rule on the
 * sensitive account features (public information stays open to every age; the policy is data, validated by a DPO).
 */
import fs from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';

vi.stubEnv('KV_REST_API_URL', 'http://localhost');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');

describe('official guides', () => {
  it('a sheet is cut into its chapters with its words unchanged', async () => {
    const { chaptersOf } = await import('../../scripts/official-guides.mjs');
    const text = 'Introduction du texte officiel.\n\n### Banque\nTableau : Durée\nType | Durée\nChèque | 1 an et 8 jours\n\n## Situation : Locataire\nVous devez prévenir.';
    expect(chaptersOf(text)).toEqual([
      { titre: null, texte: 'Introduction du texte officiel.' },
      { titre: 'Banque', texte: 'Tableau : Durée\nType | Durée\nChèque | 1 an et 8 jours' },
      { titre: 'Locataire', texte: 'Vous devez prévenir.' },
    ]);
  });
  it('the curated list names only Service-Public sheets, and a guide keeps its provenance and no generated text', async () => {
    const { OFFICIAL_GUIDES, guideFromSheet } = await import('../../scripts/official-guides.mjs');
    expect(OFFICIAL_GUIDES.length).toBeGreaterThanOrEqual(10);
    for (const g of OFFICIAL_GUIDES) expect(g.id).toMatch(/^F\d+$/);
    const archive = { builtAt: '2026-10-30T02:38:26', redirections: new Map(), fiches: new Map() };
    expect(guideFromSheet({ id: 'F999999', categorie: 'x', publics: [], contexte: [] }, archive)).toBeNull();   // not in the archive → withdrawn
    const src = fs.readFileSync('scripts/official-guides.mjs', 'utf8');
    expect(src).toMatch(/resume_falc: null/);
    expect(src).toMatch(/licence: 'Licence Ouverte 2\.0', unchanged: true/);
  });
  it('the guide page shows official tables as tables and says the text is the official one', async () => {
    const { blocksOf } = await import('../../src/components/guides/OfficialText.jsx');
    expect(blocksOf('Tableau : Banque\nType | Durée\nChèque | 1 an\nAttention : gardez la preuve.\nTexte.')).toEqual([
      { kind: 'table', caption: 'Banque', rows: [['Type', 'Durée'], ['Chèque', '1 an']] },
      { kind: 'note', label: 'Attention', text: 'gardez la preuve.' },
      { kind: 'p', text: 'Texte.' },
    ]);
    expect(fs.readFileSync('src/pages/GuideDetail.jsx', 'utf8')).toMatch(/Texte officiel de Service-Public\.gouv\.fr<\/strong>, repris sans modification/);
  });
});

describe('news: drafts and human publication', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.stubEnv('KV_REST_API_URL', 'http://localhost'); vi.stubEnv('KV_REST_API_TOKEN', 'mock-token'); });
  it('ingestion never publishes by itself, and a refresh never changes a decision', () => {
    const src = fs.readFileSync('api/_handlers/cron/ingest-actualites-rss.js', 'utf8');
    expect(src).toMatch(/const autoPublish = false;/);
    expect(src).toMatch(/statut: autoPublish \? 'publie' : 'brouillon'/);
    expect(src).toMatch(/humanFinal \|\| String\(existing\?\.statut \|\| ''\) === 'publie' \? refreshKeepingDecision : refresh/);
    expect(fs.readFileSync('scripts/news-ingest.mjs', 'utf8')).toMatch(/verifyNewsDrafts/);
    expect(fs.readFileSync('api/_handlers/cron/actualites.js', 'utf8')).toMatch(/await verifyNewsDrafts\(/);
  });
  it('publication needs a named reviewer, written on the item', async () => {
    const { decisionNote } = await import('../../scripts/review-actualites.mjs');
    expect(decisionNote('publie', 'Camille Martin', new Date('2026-10-31T10:00:00Z'))).toBe('Publiée par Camille Martin le 31/10/2026 après relecture humaine.');
    expect(decisionNote('rejected', 'Camille Martin', new Date('2026-10-31T10:00:00Z'), 'hors sujet')).toBe('Refusée par Camille Martin le 31/10/2026 après relecture humaine : hors sujet.');
    expect(fs.readFileSync('scripts/review-actualites.mjs', 'utf8')).toMatch(/a named reviewer is required/);
  });
  it('the source list keeps broken feeds, and feeds whose texts may not be reused, disabled with their reason', () => {
    const list = JSON.parse(fs.readFileSync('data/news-sources.json', 'utf8'));
    for (const s of list.filter((x) => x.enabled === false)) expect(s.disabledReason, s.name).toMatch(/flux inaccessible|réutilisation des textes interdite/);
    expect(list.find((s) => s.name.startsWith('ARS')).feedUrl).toBe('https://www.grand-est.ars.sante.fr/rss.xml');
    expect(list.filter((s) => s.enabled !== false).map((s) => s.id)).toEqual(['service_public_particuliers', 'service_public_professionnels']);
    for (const s of list.filter((x) => x.enabled !== false)) expect(s.reuse).toMatch(/Licence Ouverte 2\.0/);
  });
});
