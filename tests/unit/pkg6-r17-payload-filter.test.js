/**
 * PKG-6 / R17 — payload filtering of what the LOCAL model receives, including LEGACY dossier rows (open item « synthesis AI-payload filtering of legacy rows
 * NOT_VERIFIED »). Same steps as api/_handlers/pro/dossier-synthesis.js after authorization (presentResults + deletions) then createDraft; the model is a spy.
 */
import { describe, expect, it, vi } from 'vitest';
import { presentResults } from '../../api/lib/shareResults.js';
import { createDraft, minimalInput } from '../../api/_services/dossier-synthesis.js';

const S = { mail: 'jeanne.r17@example.test', note: 'NOTE_SENTINEL_r17', amount: 98765.43, file: 'FILE_SENTINEL_r17', sig: 'SIG_SENTINEL_r17', sit: 'SITUATION_SENTINEL_r17' };
const handlerView = (results) => { const d = { ...presentResults(results) }; delete d._files; delete d._consent; delete d._followUp; delete d._followUps; return d; };
const db = { execute: vi.fn(async () => ({ rows: [] })), insert: () => ({ values: () => ({ catch: () => {} }) }) };
const pro = { userId: 'u1', email: 'pro@example.test', structureId: 'S1' };

describe('PKG-6 / R17 payload filtering (legacy and current rows)', () => {
  it('a LEGACY row (rights[] with eligibility and amounts, totals, notes, files, consent) never reaches the model: 409 NOTHING_TO_SUMMARIZE, nothing stored', async () => {
    const legacy = { rights: [{ code: 'rsa', eligible: true, amount: S.amount, note: S.mail }], totalMonthly: S.amount, situation: S.sit, _followUps: { S1: { internalNote: S.note } }, _files: [{ name: S.file }], _consent: { sig: S.sig } };
    const generate = vi.fn();
    const out = await createDraft('sd-legacy', pro, handlerView(legacy), { db, generate });
    expect(out).toMatchObject({ ok: false, status: 409, code: 'NOTHING_TO_SUMMARIZE' });
    expect(generate).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('a current row: the model gets ONLY label / state / missing facts / who to ask, whatever else the item or the row carries', async () => {
    const results = { assessment: { items: [{ code: 'rsa', label: 'RSA', state: 'CHECK_REQUIRED', missingFacts: ['income'], whoToAsk: 'votre CAF', explanation: `contact ${S.mail}`, amount: S.amount, provenance: { source: S.note }, basisFacts: ['birthDate'] }] },
      rights: [{ code: 'rsa', amount: S.amount }], situation: S.sit, _followUps: { S1: { internalNote: S.note } }, _files: [{ name: S.file }], _consent: { sig: S.sig } };
    const generate = vi.fn(async () => null);   // model "down": we only inspect what it was given
    await createDraft('sd-now', pro, handlerView(results), { db, generate });
    expect(generate).toHaveBeenCalledTimes(1);
    const { prompt, systemInstruction, fallbackProvider, allowFallback, primaryProvider } = generate.mock.calls[0][0];
    expect(JSON.parse(prompt)).toEqual({ pistes: [{ aide: 'RSA', etat: 'CHECK_REQUIRED', manque: ['income'], aDemanderA: 'votre CAF' }] });
    for (const v of Object.values(S)) expect(prompt + systemInstruction).not.toContain(String(v));
    expect({ primaryProvider, fallbackProvider, allowFallback }).toEqual({ primaryProvider: 'ollama', fallbackProvider: null, allowFallback: false });
  });

  it('minimalInput caps the size (20 items, 10 missing facts, bounded strings)', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ code: `c${i}`, label: 'x'.repeat(200), state: 'CHECK_REQUIRED', missingFacts: Array(15).fill('income'), whoToAsk: 'y'.repeat(300) }));
    const m = minimalInput({ assessment: { items } });
    expect(m.pistes.length).toBe(20); expect(m.pistes[0].aide.length).toBe(80); expect(m.pistes[0].manque.length).toBe(10); expect(m.pistes[0].aDemanderA.length).toBe(120);
  });
});
