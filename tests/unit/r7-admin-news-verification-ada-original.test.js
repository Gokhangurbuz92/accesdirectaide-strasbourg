/**
 * R7 admin — the automatic news verification (R29) checks imported drafts only. An ADA original article in 'brouillon' was returned to its
 * author by a named administrator with a note (editorial workflow reject → commentaire_statut); the verification used to overwrite that human note
 * with « Non publiée — vérification automatique … ». It now leaves ADA originals alone (they are published only through the editorial workflow).
 */
import { describe, it, expect } from 'vitest';
import { verifyNewsDrafts } from '../../api/_services/news-verification.js';

const NOW = new Date('2026-10-31T10:00:00Z');
const schema = { Actualite: { titre: 'titre', statut: 'statut', id: 'id' } };
const ops = { eq: (col, value) => ({ col, value }) };
function fakeDb(rows) {
  const updates = [];
  const db = {
    select: () => ({ from: () => ({ where: async (w) => rows.filter((r) => r.statut === w.value).map((r) => ({ ...r })) }) }),
    update: () => ({ set: (data) => ({ where: async (w) => { updates.push({ id: w.value, data }); } }) }),
  };
  return { db, updates };
}

describe('R7 admin — news verification preserves the human reject note of ADA originals', () => {
  it('an ADA original draft is neither checked nor rewritten; an imported draft still is', async () => {
    const rows = [
      { id: 'ada1', statut: 'brouillon', type_actu: 'ada_original', titre: 'Article ADA renvoyé', canonical_url: null, resume: 'x', date_publication: NOW, commentaire_statut: 'Sources insuffisantes : ajoutez la fiche officielle.' },
      { id: 'imp1', statut: 'brouillon', type_actu: 'info', titre: 'Actualité importée', canonical_url: 'https://exemple.fr/a', resume: 'y', date_publication: NOW },
    ];
    const { db, updates } = fakeDb(rows);
    const r = await verifyNewsDrafts({ db, schema, ops, now: NOW, fetchImpl: async () => { throw new Error('no network'); } });
    expect(updates.map((u) => u.id)).toEqual(['imp1']);
    expect(r).toMatchObject({ checked: 1, kept: 1, published: 0 });
  });
});
