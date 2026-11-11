import { describe, expect, it } from 'vitest';
import { balanceFeed, classifyGeo, classifyTopics, clusterStories, fold, sourceRights, storyTokens, TOPIC_IDS } from '../../api/_services/news/editorial.js';

describe('Actualités v2 — geography is the place of the EVENT, not the publisher', () => {
  it('a French-language report about Ukraine is « monde », Ukraine', () => {
    const g = classifyGeo({ titre: 'Ukraine : de nouvelles frappes sur Kharkiv', resume: 'Les autorités ukrainiennes signalent…' }, { territory: 'FRANCE' });
    expect(g.scope).toBe('monde'); expect(g.countries).toContain('UA');
  });
  it('a French measure is « france »; Strasbourg is « alsace » (also France)', () => {
    expect(classifyGeo({ titre: 'Le montant du RSA revalorisé en France au 1er avril' }).scope).toBe('france');
    const a = classifyGeo({ titre: 'Strasbourg : ouverture d’un nouveau point France services' });
    expect(a.scope).toBe('alsace'); expect(a.countries[0]).toBe('FR');
  });
  it('a French marker wins over a foreign country named in passing (France–Allemagne cooperation is France)', () => {
    expect(classifyGeo({ titre: 'Le gouvernement signe un accord avec l’Allemagne sur les transports' }).scope).toBe('france');
  });
  it('« tout le monde » is not « Monde »', () => {
    expect(classifyGeo({ titre: 'Une aide pour tout le monde ?' }).scope).not.toBe('monde');
  });
  it('no place in the text: the source scope decides, else France by default (basis recorded)', () => {
    expect(classifyGeo({ titre: 'Nouvelle procédure' }, { scope: 'WORLD' })).toMatchObject({ scope: 'monde', basis: 'source-scope' });
    expect(classifyGeo({ titre: 'Nouvelle procédure' }, null)).toMatchObject({ scope: 'france', basis: 'default' });
  });
});

describe('Actualités v2 — categories (documented keyword rules)', () => {
  it('housing, family, rights, health', () => {
    expect(classifyTopics({ titre: 'APL : ce qui change pour les locataires' })[0]).toBe('logement');
    expect(classifyTopics({ titre: 'Allocations familiales : nouveau barème CAF' })).toContain('famille');
    expect(classifyTopics({ titre: 'Prime d’activité et RSA : les démarches' })[0]).toBe('droits');
    expect(classifyTopics({ titre: 'Assurance maladie : remboursement des soins dentaires' })[0]).toBe('sante');
  });
  it('a world event also gets « international », an Alsace event « strasbourg »; nothing matched → société', () => {
    expect(classifyTopics({ titre: 'Élections en Pologne' }, { scope: 'monde' })).toContain('international');
    expect(classifyTopics({ titre: 'Fête de quartier' }, { scope: 'alsace' })).toContain('strasbourg');
    expect(classifyTopics({ titre: 'Fête de quartier' })).toEqual(['societe']);
  });
  it('a legacy category keeps its meaning (current filters still work)', () => {
    expect(classifyTopics({ titre: 'Information', categorie: 'logement' })).toContain('logement');
  });
  it('the owner list of 17 categories is complete', () => {
    expect(TOPIC_IDS).toEqual(['une', 'societe', 'politique', 'economie', 'international', 'sante', 'environnement', 'justice', 'emploi', 'education', 'technologie', 'culture', 'logement', 'handicap', 'famille', 'droits', 'strasbourg']);
  });
});

describe('Actualités v2 — one story, several reports', () => {
  const d = (h) => new Date(Date.UTC(2026, 10, 10, h)).toISOString();
  it('similar titles within 72 h are one story led by the licensed report; a different story stays apart', () => {
    const items = [
      { id: 'b1', titre: 'Revalorisation du RSA de 1,7 % au 1er avril', date_publication: d(9), lane: 'B' },
      { id: 'a1', titre: 'RSA : revalorisation de 1,7 % au 1er avril', date_publication: d(10), lane: 'A' },
      { id: 'c1', titre: 'Chèque énergie : envoi des chèques en mai', date_publication: d(11), lane: 'A' },
    ];
    const c = clusterStories(items);
    expect(c).toHaveLength(2);
    expect(c[0].lead.id).toBe('a1'); expect(c[0].members.map((m) => m.id).sort()).toEqual(['a1', 'b1']);
  });
  it('the same words a week apart are two stories', () => {
    const items = [{ id: 'x', titre: 'Revalorisation du RSA au 1er avril', date_publication: d(1) }, { id: 'y', titre: 'Revalorisation du RSA au 1er avril', date_publication: new Date(Date.UTC(2026, 10, 18)).toISOString() }];
    expect(clusterStories(items)).toHaveLength(2);
  });
  it('token folding: accents, case, plurals', () => {
    expect(storyTokens('Les Allocations Familiales')).toEqual(storyTokens('allocation familiale'));
    expect(fold('Élève’s École')).toBe('eleve s ecole');
  });
});

describe('Actualités v2 — 70 / 30 balance never invents items', () => {
  const mk = (scope, n) => Array.from({ length: n }, (_, i) => ({ id: `${scope}${i}`, geo: { scope } }));
  it('about 70 % France in the first ten when both sides have items', () => {
    const out = balanceFeed([...mk('france', 20), ...mk('monde', 20)]).slice(0, 10);
    expect(out.filter((i) => i.geo.scope === 'france').length).toBe(7);
  });
  it('no world item: France fills the feed; no France item: Monde fills it; total preserved', () => {
    expect(balanceFeed(mk('france', 5))).toHaveLength(5);
    expect(balanceFeed(mk('monde', 4)).every((i) => i.geo.scope === 'monde')).toBe(true);
    expect(balanceFeed([...mk('alsace', 3), ...mk('monde', 2)])).toHaveLength(5);
  });
  it('franceShare 0 = fully international first', () => {
    expect(balanceFeed([...mk('france', 3), ...mk('monde', 3)], { franceShare: 0 }).slice(0, 3).every((i) => i.geo.scope === 'monde')).toBe(true);
  });
});

describe('Actualités v2 — rights are fail-closed', () => {
  const now = new Date('2026-11-11T00:00:00Z');
  const ok = { status: 'approved', evidenceUrl: 'https://example.gouv.fr/mentions', verifiedAt: '2026-11-11', rights: { headline: true, excerpt: true, fullText: true, images: false } };
  it('approved with dated evidence and full text = lane A; images stay refused unless granted', () => {
    expect(sourceRights(ok, now)).toMatchObject({ lane: 'A', allow: { fullText: true, images: false }, reason: null });
  });
  it('approved link-only source = lane B (no full text)', () => {
    expect(sourceRights({ ...ok, rights: { headline: false } }, now)).toMatchObject({ lane: 'B', allow: { fullText: false, excerpt: false } });
  });
  it.each([
    ['unknown source', null, 'SOURCE_UNKNOWN'],
    ['pending review', { ...ok, status: 'pending_review' }, 'SOURCE_PENDING_REVIEW'],
    ['restricted', { ...ok, status: 'restricted' }, 'SOURCE_RESTRICTED'],
    ['disabled', { ...ok, enabled: false }, 'SOURCE_BLOCKED'],
    ['no evidence URL', { ...ok, evidenceUrl: '' }, 'RIGHTS_EVIDENCE_MISSING'],
    ['http evidence', { ...ok, evidenceUrl: 'http://x' }, 'RIGHTS_EVIDENCE_MISSING'],
    ['evidence older than a year', { ...ok, verifiedAt: '2025-10-01' }, 'RIGHTS_EVIDENCE_EXPIRED'],
    ['truthy but not true', { ...ok, rights: { fullText: 'yes' } }, null],
  ])('%s', (_n, src, reason) => {
    const r = sourceRights(/** @type {any} */ (src), now);
    if (reason) { expect(r.lane).toBe('BLOCKED'); expect(r.reason).toBe(reason); expect(Object.values(r.allow).some(Boolean)).toBe(false); }
    else expect(r.allow.fullText).toBe(false);
  });
});
