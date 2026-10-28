// Launch readiness — the bundle of scripts/content-transfer.mjs is checked before anything is read into a database (no database here).
import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FORMAT, NEVER_COPIED, TABLES, readBundle, rowHash, targetName } from '../../scripts/content-transfer.mjs';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const made = [];
const ok = { Aide: { id: 'a', titre: 'Une aide' } };
function bundle(rows = { Aide: [ok.Aide] }, patch = (m) => m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-ct-unit-')); made.push(dir);
  const files = {};
  for (const t of Object.keys(TABLES)) {
    const list = rows[t] || []; const body = JSON.stringify(list); fs.writeFileSync(path.join(dir, `${t}.json`), body);
    files[t] = { file: `${t}.json`, rows: list.length, sha256: sha(body), rowHashes: Object.fromEntries(list.map((r) => [r.id, rowHash(r)])) };
  }
  fs.writeFileSync(path.join(dir, 'MANIFEST.json'), JSON.stringify(patch({ format: FORMAT, source: { identitySha256: 'x', hostSha256: 'y' }, schema: { migrations: 39, migrationsSha256: 'z' }, files })));
  return dir;
}
afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

describe('content transfer bundle', () => {
  it('reads a well-formed bundle; the row hash does not depend on key order', () => {
    const r = readBundle(bundle());
    expect(r.ok).toBe(true); expect(r.rows.Aide).toEqual([ok.Aide]);
    expect(rowHash({ a: 1, b: { c: 2, d: [1, { e: 3, f: 4 }] } })).toBe(rowHash({ b: { d: [1, { f: 4, e: 3 }], c: 2 }, a: 1 }));
  });

  it('refuses a content record that carries a verification state, a staff identity or an internal note', () => {
    for (const k of NEVER_COPIED.content) expect(readBundle(bundle({ Aide: [{ ...ok.Aide, [k]: 'x' }] }))).toMatchObject({ ok: false, reason: expect.stringContaining('donnée interne') });
    expect(readBundle(bundle({ SourceRegistryEntry: [{ id: 's', source_id: 's', name: 'S', type: 'REST_API', auth_config: { k: 1 } }] }))).toMatchObject({ ok: false });
  });

  it('refuses a secret-looking field, a missing identifier or required field, a duplicate', () => {
    expect(readBundle(bundle({ Aide: [{ ...ok.Aide, api_key: 'k' }] }))).toMatchObject({ ok: false, reason: expect.stringContaining('secret') });
    expect(readBundle(bundle({ Aide: [{ titre: 'sans identifiant' }] }))).toMatchObject({ ok: false, reason: expect.stringContaining('sans identifiant') });
    expect(readBundle(bundle({ Aide: [{ id: 'a' }] }))).toMatchObject({ ok: false, reason: expect.stringContaining('champ obligatoire') });
    expect(readBundle(bundle({ Aide: [ok.Aide, ok.Aide] }))).toMatchObject({ ok: false, reason: expect.stringContaining('double') });
  });

  it('refuses another table, another format, an incomplete manifest, a changed file or row', () => {
    const extra = (m) => ({ ...m, files: { ...m.files, CitizenUser: { file: 'CitizenUser.json', rows: 0, sha256: sha('[]'), rowHashes: {} } } });
    expect(readBundle(bundle(undefined, extra))).toMatchObject({ ok: false, reason: expect.stringContaining('tables inattendues') });
    expect(readBundle(bundle(undefined, (m) => ({ ...m, format: 'ada-content-transfer/1' })))).toMatchObject({ ok: false, reason: expect.stringContaining('format inconnu') });
    expect(readBundle(bundle(undefined, (m) => ({ ...m, schema: undefined })))).toMatchObject({ ok: false, reason: expect.stringContaining('incomplet') });
    const d = bundle(); fs.writeFileSync(path.join(d, 'Aide.json'), '[{"id":"x","titre":"t"}]');
    expect(readBundle(d)).toMatchObject({ ok: false, reason: expect.stringContaining('a changé depuis l’export') });
    const d2 = bundle(undefined, (m) => ({ ...m, files: { ...m.files, Aide: { ...m.files.Aide, rowHashes: { a: 'autre' } } } }));
    expect(readBundle(d2)).toMatchObject({ ok: false, reason: expect.stringContaining('empreinte') });
  });

  it('names the target as host/database, never with its credentials', () => {
    expect(targetName('postgresql://u:secret@db.example.eu:5432/ada?sslmode=require')).toBe('db.example.eu/ada');
  });
});
