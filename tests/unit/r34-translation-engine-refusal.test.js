/**
 * R34 — the run of the 25 new guides stopped twice: Ollama refuses some short sentences (« token repeat limit reached », HTTP 500, every time at
 * temperature 0). A refused unit is now a failed attempt; the repair attempts change seed and instruction; if every attempt is refused the field is
 * WITHHELD (the French text is shown) — never a silent gap, never a shown machine guess. Any other engine error still stops the run.
 */
import { describe, expect, it } from 'vitest';
import { translateField, isUnitRefusal } from '../../scripts/translate-content.mjs';

const REFUSED = 'Le document est manuscrit ou dactylographié.';
const engine = (refuseAttempts) => ({
  id: 'fake', async translate(from, to, text, attempt = 0) {
    if (text.includes('manuscrit') && refuseAttempts.includes(attempt)) throw new Error('engine fake answered 500: {"error":"prediction aborted, token repeat limit reached"}');
    return to === 'fr' ? text : `EN ${text.replace(/[àâäéèêëîïôöùûüç]/g, 'e')}`;
  },
});
const value = `Le titre officiel. ${REFUSED}`;

describe('a unit the engine refuses', () => {
  it('is retried by the repair attempts; a later attempt that answers is used', async () => {
    const r = await translateField(engine([0]), null, 'en', 'guide', 'titre', value, null);
    expect(r.checks.critical).not.toContain('engine_failed');
  });
  it('refused by every attempt: the field is withheld with engine_failed, the French unit keeps its place', async () => {
    const r = await translateField(engine([0, 1, 2]), null, 'en', 'guide', 'titre', value, null);
    expect(r.status).toBe('withheld');
    expect(r.checks.critical).toContain('engine_failed');
    expect(JSON.stringify(r.text)).toContain('manuscrit');
  });
  it('only a refusal of one unit is absorbed; a missing engine or network error is not', () => {
    expect(isUnitRefusal(new Error('engine x answered 500: token repeat limit reached'))).toBe(true);
    expect(isUnitRefusal(new Error('fetch failed'))).toBe(false);
    expect(isUnitRefusal(new Error('engine x answered 404'))).toBe(false);
  });
});
