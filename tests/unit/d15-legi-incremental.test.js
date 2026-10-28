/**
 * D15 — incremental refresh of the LEGI extraction (scripts/legi-subset.py --state / --incremental), on SYNTHETIC archives served from 127.0.0.1:
 * a refresh that streams only the new daily deltas must give exactly the file a full run over the same archives gives, and it must refuse (exit 3,
 * nothing written) whenever only a full run is right.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const SCRIPT = path.resolve('scripts/legi-subset.py');
const CASF = 'LEGITEXT000006074069';

// one python helper writes the LEGI-shaped archives (gzip + tar, the members the extractor reads)
const BUILD = `
import io, sys, tarfile
def art(aid, num, etat, debut, fin, text):
    return ('<ARTICLE><ID>%s</ID><NUM>%s</NUM><ETAT>%s</ETAT><DATE_DEBUT>%s</DATE_DEBUT><DATE_FIN>%s</DATE_FIN>'
            '<LIEN_ART debut="%s" etat="%s" fin="%s" id="%s"/><BLOC_TEXTUEL><CONTENU><p>%s</p></CONTENU></BLOC_TEXTUEL></ARTICLE>') % (aid, num, etat, debut, fin, debut, etat, fin, aid, text)
def write(path, members):
    with tarfile.open(path, 'w:gz') as t:
        for name, data in members:
            b = data.encode('utf-8'); i = tarfile.TarInfo(name); i.size = len(b); i.mtime = 0; t.addfile(i, io.BytesIO(b))
d = sys.argv[1]; p = 'legi/global/code_et_TNC_en_vigueur/code_en_vigueur/LEGI/TEXT/00/00/06/07/40/${CASF}/article/LEGI/ARTI/'
write(d + '/Freemium_legi_global_20250101-000000.tar.gz', [
    (p + 'LEGIARTI000000000001.xml', art('LEGIARTI000000000001', 'L262-2', 'VIGUEUR', '2020-01-01', '2999-01-01', 'version 1')),
    (p + 'LEGIARTI000000000002.xml', art('LEGIARTI000000000002', 'L262-3', 'VIGUEUR', '2020-01-01', '2999-01-01', 'autre article')),
    (p + 'LEGIARTI000000000009.xml', art('LEGIARTI000000000009', 'L999-1', 'VIGUEUR', '2020-01-01', '2999-01-01', 'hors reference'))])
write(d + '/LEGI_20250102-000000.tar.gz', [   # L262-2 amended: the old version ends, a new one starts
    (p + 'LEGIARTI000000000001.xml', art('LEGIARTI000000000001', 'L262-2', 'MODIFIE', '2020-01-01', '2025-01-02', 'version 1')),
    (p + 'LEGIARTI000000000003.xml', art('LEGIARTI000000000003', 'L262-2', 'VIGUEUR', '2025-01-02', '2999-01-01', 'version 2'))])
write(d + '/LEGI_20250103-000000.tar.gz', [   # L262-3 removed
    ('legi/20250103-000000/liste_suppression_legi.dat', 'legi/global/code_et_TNC_en_vigueur/code_en_vigueur/LEGI/TEXT/LEGIARTI000000000002\\n')])
`;

let dir, server, base;
const listing = () => '<html><body>' + fs.readdirSync(path.join(dir, 'pub')).map((n) => `<a href="${n}">${n}</a>`).join('\n') + '</body></html>';
const py = (...args) => run('python3', ['-I', SCRIPT, '--rules', path.join(dir, 'rules.json'), '--base-url', base, '--reference-date', '2025-06-01', ...args], { timeout: 60000 });
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const out = (f) => path.join(dir, f);

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd15-legi-'));
  fs.mkdirSync(path.join(dir, 'pub')); fs.mkdirSync(path.join(dir, 'all'));
  await run('python3', ['-I', '-c', BUILD, path.join(dir, 'all')]);
  fs.writeFileSync(path.join(dir, 'rules.json'), JSON.stringify({ rights: [{ id: 'rsa', legalBasis: ['CASF L262-2 à L262-3'] }] }));
  for (const n of ['Freemium_legi_global_20250101-000000.tar.gz', 'LEGI_20250102-000000.tar.gz']) fs.copyFileSync(path.join(dir, 'all', n), path.join(dir, 'pub', n));
  server = http.createServer((req, res) => {
    const n = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1));
    if (!n) { res.setHeader('content-type', 'text/html'); return res.end(listing()); }
    const f = path.join(dir, 'pub', path.basename(n)); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
    res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}/`;
}, 60000);
afterAll(() => { server?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('D15 LEGI incremental refresh', () => {
  it('a refresh that streams only the new delta equals a full run over the same archives', async () => {
    await py('--out', out('inc.json'), '--state', out('state.json.gz'));   // full run over global + delta 1, state saved
    fs.copyFileSync(path.join(dir, 'all', 'LEGI_20250103-000000.tar.gz'), path.join(dir, 'pub', 'LEGI_20250103-000000.tar.gz'));   // delta 2 is published
    const inc = await py('--out', out('inc.json'), '--index-out', out('inc.index.json'), '--state', out('state.json.gz'), '--incremental');
    expect(inc.stderr).toContain('"newDeltas": ["LEGI_20250103-000000.tar.gz"]');
    expect(inc.stderr).not.toContain('"archive": "Freemium_legi_global_20250101-000000.tar.gz"');   // the global archive is NOT read again
    await py('--out', out('full.json'), '--index-out', out('full.index.json'));
    expect(read('inc.json')).toBe(read('full.json'));
    expect(read('inc.index.json')).toBe(read('full.index.json'));
    const doc = JSON.parse(read('inc.json'));
    expect(doc.source.deltasApplied).toBe(2); expect(doc.source.lastDelta).toBe('LEGI_20250103-000000.tar.gz');
    expect(doc.references[0].resolved.map((x) => [x.num, x.id, x.text])).toEqual([['L262-2', 'LEGIARTI000000000003', 'version 2']]);   // amended + removed applied
  }, 120000);

  it('nothing new: the refresh reads no archive and the file is unchanged', async () => {
    const before = read('inc.json');
    const r = await py('--out', out('inc.json'), '--state', out('state.json.gz'), '--incremental');
    expect(r.stderr).toContain('"newDeltas": []');
    expect(read('inc.json')).toBe(before);
  }, 60000);

  it('refuses (exit 3, nothing written) when only a full run is right', async () => {
    const refused = async (args, why) => {
      const before = fs.existsSync(out('r.json'));
      const e = await py('--out', out('r.json'), ...args).then(() => null, (x) => x);
      expect(e?.code, why).toBe(3); expect(e.stderr).toContain(why);
      expect(fs.existsSync(out('r.json'))).toBe(before);
    };
    await refused(['--state', out('missing.json.gz'), '--incremental'], 'no readable state');
    const rules = read('rules.json'); fs.writeFileSync(out('rules.json'), rules.replace('L262-3', 'L262-4'));
    await refused(['--state', out('state.json.gz'), '--incremental'], 'the register changed');
    fs.writeFileSync(out('rules.json'), rules);
    fs.copyFileSync(path.join(dir, 'all', 'LEGI_20250102-000000.tar.gz'), path.join(dir, 'pub', 'LEGI_20250102-120000.tar.gz'));   // an older delta never read
    await refused(['--state', out('state.json.gz'), '--incremental'], 'older than the last applied one');
    fs.rmSync(path.join(dir, 'pub', 'LEGI_20250102-120000.tar.gz'));
    fs.copyFileSync(path.join(dir, 'all', 'Freemium_legi_global_20250101-000000.tar.gz'), path.join(dir, 'pub', 'Freemium_legi_global_20250201-000000.tar.gz'));
    await refused(['--state', out('state.json.gz'), '--incremental'], 'a newer global archive');
  }, 120000);
});
