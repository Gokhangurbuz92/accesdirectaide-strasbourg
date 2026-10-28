// @vitest-environment jsdom
/**
 * Structure page display seen in the owner LAB after the first automatic runs: the département line of a record without its own field (it comes from the
 * postal code, or is left out — never « Département : » followed by nothing) and the provenance note's French spelling.
 */
/* global document */
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import ProvenanceFreshness from '../../src/components/ProvenanceFreshness.jsx';
import { departementLabel } from '../../src/lib/structureFields.js';

afterEach(cleanup);

describe('structure page labels', () => {
  it('the département comes from the record, else from its postal code, else the line is left out', () => {
    expect(departementLabel({ departement: '67', code_postal: '67100' })).toBe('Bas-Rhin');
    expect(departementLabel({ departement: '', code_postal: '67100' })).toBe('Bas-Rhin');
    expect(departementLabel({ departement: null, code_postal: ' 68000 ' })).toBe('Haut-Rhin');
    expect(departementLabel({ departement: '57', code_postal: '67100' })).toBe('57');
    expect(departementLabel({ departement: '', code_postal: '' })).toBeNull();
    expect(departementLabel({ code_postal: '6710' })).toBeNull();
    expect(departementLabel(null)).toBeNull();
  });
  it('the provenance note is written in correct French', () => {
    render(createElement(ProvenanceFreshness, { provenance: { contentStatus: 'VERIFIED', verifiedAt: new Date().toISOString(), sourceUrl: 'https://www.service-public.fr/x' } }));
    expect(document.body.textContent).toContain('Ces informations sont affichées à titre indicatif.');
    expect(document.body.textContent).not.toMatch(/affichees a titre/);
  });
});
