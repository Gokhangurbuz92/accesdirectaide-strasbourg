/**
 * R34 — the production publication of the R33 guides is bounded: an allowlist, inserts only, never a withdrawal or an update of another guide, and
 * --apply is refused without those bounds.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { OFFICIAL_GUIDES, R33_ADDITIONS, planGuides, rowOf } from '../../scripts/official-guides.mjs';

const g = (id, steps = [{ titre: 'A', texte: 'x' }]) => ({ slug: `titre-${id.toLowerCase()}`, titre: `Titre ${id}`, contenu_json: { steps } });
const row = (id, extra = {}) => ({ id: `row-${id}`, slug: `titre-${id.toLowerCase()}`, titre: `Titre ${id}`, statut: 'publie', contenu_json: { steps: [{ titre: 'A', texte: 'x' }] }, ...extra });

describe('bounded guide publication', () => {
  it('the allowlist is exactly the 25 R33 additions of the curated list', () => {
    expect(R33_ADDITIONS).toHaveLength(25);
    expect(new Set(R33_ADDITIONS).size).toBe(25);
    expect(OFFICIAL_GUIDES.slice(12).map((e) => e.id)).toEqual(R33_ADDITIONS);
  });

  it('only allowlisted sheets enter the plan; an existing row is skipped, never updated, in insert-only mode', () => {
    const built = [{ e: { id: 'F134' }, g: g('F134', [{ titre: 'B', texte: 'changed' }]) }, { e: { id: 'F2094' }, g: g('F2094') }, { e: { id: 'F706' }, g: g('F706', [{ titre: 'Z', texte: 'new' }]) }];
    const rows = [row('F134'), row('F706')];
    const plan = planGuides(built, rows, { allow: ['F2094', 'F706'], insertOnly: true });
    expect(plan.insert.map((x) => x.id)).toEqual(['F2094']);
    expect(plan.skip_existing.map((x) => x.id)).toEqual(['F706']);
    expect(plan.update).toEqual([]);
    expect(plan.withdraw).toEqual([]);
    expect(JSON.stringify(plan)).not.toContain('F134');
  });

  it('a listed sheet missing from the archive is withheld with its reason, never withdrawn', () => {
    const built = [{ e: { id: 'F2094' }, g: null }, { e: { id: 'F2120' }, g: null }];
    const plan = planGuides(built, [row('F2094')], { allow: ['F2094', 'F2120'], insertOnly: true, redirections: new Map([['F2120', 'F9999']]) });
    expect(plan.withdraw).toEqual([]);
    expect(plan.withheld).toEqual([{ id: 'F2094', reason: 'NOT_IN_ARCHIVE_OR_EMPTY' }, { id: 'F2120', reason: 'REDIRECTED_TO_F9999' }]);
  });

  it('an id outside the curated list, or a slug held by another row, is refused', () => {
    const built = [{ e: { id: 'F2094' }, g: g('F2094') }];
    expect(planGuides(built, [], { allow: ['F1'], insertOnly: true }).refused).toEqual([{ id: 'F1', reason: 'NOT_IN_CURATED_LIST' }]);
    const clash = planGuides(built, [{ id: 'x', slug: 'titre-f2094-old', statut: 'publie' }, { id: 'y', slug: 'titre-f2094', statut: 'brouillon' }].slice(1), { allow: ['F2094'], insertOnly: true });
    expect(clash.skip_existing).toHaveLength(1);   // the same sheet already has a row: skipped, not duplicated
  });

  it('a sheet id never matches a row of a longer number (F706 is not F1706)', () => {
    expect(rowOf([{ slug: 'x-f1706' }], 'F706')).toBeUndefined();
    expect(rowOf([{ slug: 'x-f706' }], 'F706')).toEqual({ slug: 'x-f706' });
  });

  it('the unbounded plan (dry run only) still reports updates and withdrawals', () => {
    const plan = planGuides([{ e: { id: 'F134' }, g: g('F134', [{ titre: 'B', texte: 'y' }]) }, { e: { id: 'F827' }, g: null }], [row('F134'), row('F827')]);
    expect(plan.update.map((x) => x.id)).toEqual(['F134']);
    expect(plan.withdraw.map((x) => x.id)).toEqual(['F827']);
  });

  it('--apply is refused without --only, --insert-only and --expect-published', () => {
    fs.writeFileSync('/tmp/.ada-empty.zip', Buffer.from('PK\x05\x06' + '\0'.repeat(18), 'binary'));
    for (const args of [['--apply'], ['--apply', '--only', 'r33'], ['--apply', '--only', 'r33', '--insert-only']]) {
      const r = spawnSync(process.execPath, ['scripts/official-guides.mjs', '/tmp/.ada-empty.zip', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/refused: --apply needs --only, --insert-only and --expect-published/);
    }
  });

  it('the write is one transaction with postconditions on every other row', () => {
    const src = fs.readFileSync('scripts/official-guides.mjs', 'utf8');
    expect(src).toMatch(/db\.transaction\(/);
    expect(src).toMatch(/POSTCONDITION_FAILED/);
    expect(src).not.toMatch(/set\(\{ statut: 'archive' \}\)/);   // no withdrawal path left in the command
  });
});
