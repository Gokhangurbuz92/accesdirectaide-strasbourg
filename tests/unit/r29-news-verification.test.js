/**
 * R29 — automatic, evidence-based publication of news drafts (owner decision of 31/10/2026). A draft is published only when every check passes;
 * nothing names a person or claims a human review.
 */
import { describe, it, expect } from 'vitest';
import {
  offlineChecks, pageChecks, verifyNewsDrafts, audienceOf, cleanUrl, publicationNote, draftNote, REUSE_BY_HOST, NEWS_MAX_AGE_DAYS,
} from '../../api/_services/news-verification.js';

const NOW = new Date('2026-10-31T10:00:00Z');
const SP = 'https://www.service-public.gouv.fr/particuliers/actualites/A19121?xtor=RSS-111';
const draft = (over = {}) => ({
  id: 'a1', statut: 'brouillon', titre: 'Donnez votre avis sur l’Assurance retraite', canonical_url: SP, date_publication: new Date('2026-10-29T22:30:00Z'),
  resume: 'L’Assurance retraite lance une consultation. Service Public vous explique.', summary_falc: null, key_points_falc: [], ...over,
});
const page = (over = {}) => `<html><body><main><h1>${over.title ?? 'Donnez votre avis sur l&rsquo;Assurance retraite'}</h1>
  <p>${over.dateLine ?? 'Publié le 30 octobre 2026 - Service Public / Direction de l’information légale et administrative'}</p>
  <p>${over.body ?? 'L’Assurance retraite lance une <strong>consultation</strong>. Service Public vous explique.'}</p></main></body></html>`;
const fetchOk = (html, url = SP.replace(/\?.*/, '')) => async () => ({ status: 200, url, text: async () => html, headers: new Headers({ 'content-type': 'text/html' }) });

describe('R29 news verification — checks without network', () => {
  const ctx = () => ({ now: NOW, takenTitles: new Set() });
  it('a recent Service-Public « Particuliers » item in the publisher’s own words passes', () => {
    expect(offlineChecks(draft(), ctx()).reasons).toEqual([]);
  });
  it('a publisher whose legal notice forbids reuse is never published, with the notice cited', () => {
    const r = offlineChecks(draft({ canonical_url: 'https://www.grand-est.ars.sante.fr/grippe' }), ctx()).reasons;
    expect(r.join(' ')).toMatch(/réutilisation non autorisée sans accord écrit de ARS Grand Est/);
    expect(REUSE_BY_HOST['www.grandest.fr'].status).toBe('authorisation-required');
    expect(offlineChecks(draft({ canonical_url: 'https://exemple.fr/a' }), ctx()).reasons.join(' ')).toMatch(/éditeur inconnu/);
  });
  it('business news, old news, future dates, model-written text and duplicates stay drafts', () => {
    expect(audienceOf('https://entreprendre.service-public.gouv.fr/actualites/A1')).toBe('professionnels');
    expect(offlineChecks(draft({ canonical_url: 'https://entreprendre.service-public.gouv.fr/actualites/A1' }), ctx()).reasons.join(' ')).toMatch(/entreprises/);
    expect(offlineChecks(draft({ date_publication: new Date(NOW.getTime() - (NEWS_MAX_AGE_DAYS + 1) * 86400000) }), ctx()).reasons.join(' ')).toMatch(/plus de 90 jours/);
    expect(offlineChecks(draft({ date_publication: new Date('2026-11-05T00:00:00Z') }), ctx()).reasons.join(' ')).toMatch(/futur/);
    expect(offlineChecks(draft({ summary_falc: 'texte simplifié' }), ctx()).reasons.join(' ')).toMatch(/non rédigé par l’éditeur/);
    expect(offlineChecks(draft({ resume: '' }), ctx()).reasons.join(' ')).toMatch(/aucun résumé/);
    const taken = { now: NOW, takenTitles: new Set(['donnez votre avis sur l\'assurance retraite']) };
    expect(offlineChecks(draft(), taken).reasons.join(' ')).toMatch(/doublon/);
  });
  it('tracking parameters are removed from the original address', () => {
    expect(cleanUrl(SP)).toBe('https://www.service-public.gouv.fr/particuliers/actualites/A19121');
  });
});

describe('R29 news verification — the original page', () => {
  it('same title, same day (Paris time) and the summary word for word → no reason', async () => {
    expect((await pageChecks(draft(), { fetchImpl: fetchOk(page()) })).reasons).toEqual([]);
  });
  it('an updated item is dated by its update', async () => {
    const html = page({ dateLine: 'Publié le 02 octobre 2025 - Mise à jour le 30 octobre 2026' });
    expect((await pageChecks(draft(), { fetchImpl: fetchOk(html) })).reasons).toEqual([]);
  });
  it('a different title, another date, a changed summary or a missing page keep the draft', async () => {
    expect((await pageChecks(draft(), { fetchImpl: fetchOk(page({ title: 'Autre titre' })) })).reasons.join(' ')).toMatch(/titre/);
    expect((await pageChecks(draft(), { fetchImpl: fetchOk(page({ dateLine: 'Publié le 02 octobre 2025' })) })).reasons.join(' ')).toMatch(/datée du 02\/10\/2025/);
    expect((await pageChecks(draft(), { fetchImpl: fetchOk(page({ body: 'Un autre texte.' })) })).reasons.join(' ')).toMatch(/mot pour mot/);
    const gone = async () => ({ status: 404, url: SP, text: async () => '', headers: new Headers() });
    expect((await pageChecks(draft(), { fetchImpl: gone })).reasons.join(' ')).toMatch(/HTTP 404/);
  });
});

describe('R29 news verification — publication', () => {
  function fakeDb(rows) {
    const updates = [];
    const db = {
      select: () => ({ from: () => ({ where: async (w) => rows.filter((r) => r.statut === w.value).map((r) => ({ ...r })) }) }),
      update: () => ({ set: (data) => ({ where: async (w) => { updates.push({ id: w.value, data }); } }) }),
    };
    return { db, updates };
  }
  const schema = { Actualite: { titre: 'titre', statut: 'statut', id: 'id' } };
  const ops = { eq: (col, value) => ({ col, value }) };
  it('publishes what passes, keeps the rest as drafts with the reasons, and never names a person', async () => {
    const { db, updates } = fakeDb([draft(), draft({ id: 'a2', canonical_url: 'https://www.grandest.fr/actualites/x/' })]);
    const r = await verifyNewsDrafts({ db, schema, ops, now: NOW, fetchImpl: fetchOk(page()) });
    expect(r).toMatchObject({ checked: 2, published: 1, kept: 1 });
    const pub = updates.find((u) => u.id === 'a1').data;
    expect(pub).toMatchObject({ statut: 'publie', auto_publish: true, updatedBy: 'verification-automatique' });
    expect(pub.commentaire_statut).toMatch(/Publiée automatiquement le 31\/10\/2026 après vérification automatique/);
    expect(pub.commentaire_statut).toMatch(/Licence Ouverte 2\.0/);
    expect(pub.commentaire_statut).toMatch(/Aucune relecture humaine\./);
    const kept = updates.find((u) => u.id === 'a2').data;
    expect(kept.statut).toBeUndefined();
    expect(kept.commentaire_statut).toMatch(/^Non publiée — vérification automatique du 31\/10\/2026 : réutilisation non autorisée/);
  });
  it('a dry run writes nothing', async () => {
    const { db, updates } = fakeDb([draft()]);
    expect((await verifyNewsDrafts({ db, schema, ops, now: NOW, apply: false, fetchImpl: fetchOk(page()) })).published).toBe(1);
    expect(updates).toEqual([]);
  });
  it('the notes are explicit about what was checked', () => {
    expect(publicationNote(draft(), REUSE_BY_HOST['www.service-public.gouv.fr'], NOW)).not.toMatch(/relu par|validée par/);
    expect(draftNote(['a', 'b'], NOW)).toBe('Non publiée — vérification automatique du 31/10/2026 : a ; b.');
  });
});
