/**
 * R12 — the automatic FALC summary on an aide page: a refused or failed request is said on the page (it was swallowed: the button looked dead).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('aide FALC preview errors', () => {
  const src = readFileSync('src/pages/AideDetail.jsx', 'utf8');
  it('no silent catch around the summary request; an error is shown with the full record still valid', () => {
    expect(src).not.toMatch(/Silently handle/);
    expect(src).toMatch(/data-testid="falc-preview-error"/);
    expect(src).toMatch(/setFalcError\(res\.status === 429/);
  });
});
