// @vitest-environment jsdom
/**
 * R16 / D15 — the code articles behind the research register, attached from the DILA LEGI open dataset by scripts/legi-subset.py (global archive + every
 * daily delta, each archive's SHA-256 recorded). Checks: provenance and licence, every code reference of the register is attached or says why not, each
 * attached article is the version in force on the reference date with a Légifrance link, the browser index carries no article text, and the result view
 * shows the texts as reading material only.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { buildAssessment } from '../../api/lib/assessmentContract.js';
import { UNSUPPORTED_RIGHTS } from '../../api/lib/diagnosticAssessment.js';
import AssessmentView from '../../src/components/diagnostic/AssessmentView.jsx';
import { legalBasisFor } from '../../src/lib/legalArticles.js';

const full = JSON.parse(readFileSync('data/rules/legal-articles.v1.json', 'utf8'));
const index = JSON.parse(readFileSync('data/rules/legal-articles.index.v1.json', 'utf8'));
const register = JSON.parse(readFileSync('data/rules/rights-rules.v1.json', 'utf8'));
afterEach(cleanup);

describe('R16 / D15: legal articles attached from DILA LEGI', () => {
  it('records its provenance: producer, licence, the global archive and every delta read with its SHA-256', () => {
    expect(full.schema).toBe('ADA_LEGAL_ARTICLES_V1');
    expect(full.source).toMatchObject({ producer: 'DILA', licence: 'Licence Ouverte / Open Licence 2.0' });
    expect(full.source.archives).toHaveLength(full.source.deltasApplied + 1);
    expect(full.source.archives[0].archive).toBe(full.source.baseArchive);
    for (const a of full.source.archives) expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(full.statement).toMatch(/aucune règle/);
  });

  it('every legalBasis entry of the register appears once and is attached: code articles, annexes, décrets and arrêtés (consolidated texts)', () => {
    const entries = register.rights.flatMap((r) => (r.legalBasis || []).map((b) => `${r.id}|${b}`));
    expect(full.references.map((r) => `${r.right}|${r.basis}`).sort()).toEqual(entries.sort());
    for (const r of full.references) { expect(r.resolved.length, r.basis).toBeGreaterThan(0); expect(r.unresolved).toBeNull(); }
    const texts = full.references.filter((r) => /^(Décret|Arrêté)/.test(r.basis));
    expect(texts.length).toBe(5);
    for (const r of texts) for (const t of r.resolved) {
      expect(t.kind).toBe('text'); expect(['DECRET', 'ARRETE']).toContain(t.nature);
      expect(t.url).toMatch(/^https:\/\/www\.legifrance\.gouv\.fr\/loda\/id\/(JORF|LEGI)TEXT\d{12}$/);
    }
    expect(full.references.find((r) => r.basis === 'Décret n°2025-293 du 29 mars 2025').resolved[0].title).toMatch(/^Décret n° 2025-293 du 29 mars 2025/);
    expect(full.references.find((r) => r.basis === 'CASF R241-33, annexe 2-4').resolved.map((a) => a.num).sort()).toEqual(['Annexe 2-4', 'R241-33']);
  });

  it('each attached article is the version in force on the reference date, with its LEGIARTI id, dates, text hash and Légifrance link', () => {
    const ref = full.referenceDate;
    for (const a of full.references.flatMap((r) => r.resolved).filter((x) => x.kind !== 'text')) {
      expect(a.id).toMatch(/^LEGIARTI\d{12}$/);
      expect(a.url).toBe(`https://www.legifrance.gouv.fr/codes/article_lc/${a.id}`);
      expect(a.dateDebut <= ref && ref < a.dateFin).toBe(true);
      expect(['VIGUEUR', 'ABROGE_DIFF']).toContain(a.etat);
      expect(a.textSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const rsa = full.references.find((r) => r.basis === 'CASF L262-2 à L262-12');
    expect(rsa.resolved.map((a) => a.num)).toEqual(expect.arrayContaining(['L262-2', 'L262-7-1', 'L262-12']));
  });

  it('the browser index matches the full file and carries no article text', () => {
    expect(JSON.stringify(index)).not.toMatch(/"text":/);   // no article text key (a "kind": "text" value is allowed)
    expect(index.references.map((r) => r.articles.map((a) => a.id).join())).toEqual(full.references.map((r) => r.resolved.map((a) => a.id).join()));
  });

  it('the result view lists the texts (sibling of the official pages) with their in-force date, says what is not attached and that no rule is derived; axe clean', async () => {
    const legal = legalBasisFor('rsa');
    expect(legal.references.every((r) => r.attached)).toBe(true);
    const assessment = buildAssessment({ answers: { birthDate: '1990-01-01', householdSize: 1, income: { salary: 800 }, housing: { status: 'tenant', rent: 400 }, territory: '67000' }, unsupportedRights: UNSUPPORTED_RIGHTS });
    const { container } = render(createElement(MemoryRouter, null, createElement(AssessmentView, { results: { assessment } })));
    const block = screen.getByTestId('legal-texts-rsa');
    expect(screen.getByTestId('official-info-rsa').contains(block)).toBe(false);
    expect(block).toHaveTextContent('CASF L262-2 à L262-12 — 12 articles');
    expect(block).toHaveTextContent('Décret n°2025-293 du 29 mars 2025 — 1 texte');
    expect(block.querySelector('[data-testid="legal-text-not-attached"]')).toBeNull();
    expect(block).toHaveTextContent('ADA n\'en tire aucune règle automatiquement');
    expect(block.querySelector('summary, details')).toBeNull();   // the result item is itself a <details>: no nested summary (real Chrome strict locators)
    const toggle = [...block.querySelectorAll('[data-testid="legal-reference-toggle"]')].find((b) => b.textContent.startsWith('CASF L262-2 à L262-12'));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const link = [...block.querySelectorAll('a')].find((a) => a.textContent.startsWith('Article L262-2'));
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.parentElement).toHaveTextContent(/version en vigueur depuis le \d{2}\/\d{2}\/\d{4}/);
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});
