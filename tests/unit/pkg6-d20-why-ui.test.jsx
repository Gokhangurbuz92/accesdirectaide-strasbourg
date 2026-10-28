// @vitest-environment jsdom
/**
 * PKG-6 / D20 (UI): « Pourquoi ce résultat ? » shows the FALC explanation first, the full explanation, the answers used (labels) and the five provenance lines,
 * for every rendered state. jsdom: no layout, so contrast and screen-reader behaviour are not proven here (axe color-contrast off). No JSX in the test body.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import AssessmentView from '../../src/components/diagnostic/AssessmentView.jsx';
import { buildAssessment } from '../../api/lib/assessmentContract.js';

afterEach(cleanup);
const show = (assessment) => render(createElement(MemoryRouter, null, createElement(AssessmentView, { results: { assessment } })));

describe('PKG-6 / D20 « Pourquoi ce résultat ? »', () => {
  it('each item shows the FALC « en bref », the full why, the answers used and the provenance; no value of the person; axe clean', async () => {
    const { container } = show(buildAssessment({ answers: { birthDate: '1990-01-01', householdSize: 3, income: { salary: 700 }, territory: '67000' } }));
    for (const code of ['rsa', 'faj-strasbourg']) {
      expect(screen.getByTestId(`why-falc-${code}`)).toHaveTextContent(/En bref \(facile à lire\)/);
      expect(screen.getByTestId(`why-${code}`)).toHaveTextContent(/source officielle/);
      expect(screen.getByTestId(`why-basis-${code}`)).toHaveTextContent(/Réponses utilisées : /);
      for (const k of ['source', 'verifiedAt', 'territory', 'rule', 'uncertainty']) expect(screen.getByTestId(`provenance-${code}-${k}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('why-falc-apl')).toHaveTextContent(/Il manque des réponses : statut d'occupation du logement, loyer/);
    expect(container.textContent).not.toMatch(/1990|700 ?€?|67000/);
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
  });
});
