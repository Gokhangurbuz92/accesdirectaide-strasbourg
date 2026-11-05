/**
 * R46 / P27 — « each funder's own list prevails »: the funder's own headings beside the Cerfa sections, a required heading left empty blocks
 * « prêt pour validation », and the Markdown working document cannot be broken (or forged) by a pipe or a line break typed in a field.
 */
import { describe, expect, it } from 'vitest';
import { exportMarkdown, normalizeContent, warningsOf } from '../../api/_services/funding-dossiers.js';

describe('R46 P27 funder headings and export safety', () => {
  it('keeps the funder headings (at most 20), drops empty ones, refuses a text without its heading', () => {
    const ok = normalizeContent({ rubriques: [{ titre: 'Impact social attendu', texte: '', attendue: true }, { titre: '', texte: '' }, { titre: 'Partenariats', texte: 'Texte', attendue: 'false' }] });
    expect(ok.ok).toBe(true);
    expect(ok.content.rubriques.map((r) => [r.titre, r.attendue])).toEqual([['Impact social attendu', true], ['Partenariats', false]]);
    expect(normalizeContent({ rubriques: [{ titre: '', texte: 'orphelin' }] }).code).toBe('RUBRIQUE_TITLE_REQUIRED');
    expect(normalizeContent({ rubriques: Array.from({ length: 30 }, (_, i) => ({ titre: `R${i}`, texte: 'x' })) }).content.rubriques).toHaveLength(20);
    expect(normalizeContent({}).content.rubriques).toEqual([]);
  });

  it('a required funder heading left empty is a blocking point; an optional one is not', () => {
    const d = { status: 'EN_PREPARATION', content: { sections: {}, budget: [], rubriques: [{ titre: 'Impact social attendu', texte: '', attendue: true }, { titre: 'Annexe libre', texte: '', attendue: false }] } };
    const w = warningsOf(d).filter((x) => x.code === 'FUNDER_SECTION_EMPTY');
    expect(w).toEqual([{ code: 'FUNDER_SECTION_EMPTY', blocking: true, message: 'Rubrique du financeur « Impact social attendu » à rédiger.' }]);
  });

  it('exports the funder headings and escapes table cells', () => {
    const md = exportMarkdown({ id: 'abcdefgh-2', title: 'Essai', status: 'EN_PREPARATION', version: 3,
      content: { sections: {}, rubriques: [{ titre: 'Impact social attendu', texte: 'Texte rédigé', attendue: true }],
        budget: [{ poste: 'Poste | injecté\n| faux | tableau |', nature: 'CHARGE', montant: 10, statut: 'MESURE', justification: 'a|b' }], financement: [{ financeur: 'Ville|X', montant: 5, statut: 'DEMANDE', reference: '' }], pieces: [] } });
    expect(md).toContain('## Rubriques demandées par le financeur');
    expect(md).toContain('### Impact social attendu (attendue)\n\nTexte rédigé');
    expect(md).toContain('| Poste \\| injecté \\| faux \\| tableau \\| | Charge | 10,00 € | Mesuré | a\\|b |');
    expect(md).toContain('| Ville\\|X | 5,00 € |');
    const budgetRows = md.split('\n').filter((l) => l.startsWith('| Poste'));
    expect(budgetRows).toHaveLength(2);   // the header and the one escaped line: no forged row
  });
});
