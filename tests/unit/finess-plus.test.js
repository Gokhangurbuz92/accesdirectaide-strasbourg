// FINESS+ (api/_services/verification/finess.js): the stream reader, the mapping of an establishment, the texts, the file of the day and its checksum — no network.
import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { arrayElements, establishmentsOf, publicOf, readableName, finessTexts, latestDaily, fetchFiness, readFiness, SCOPE, officialLabel, termsVersion } from '../../api/_services/verification/finess.js';

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-finess-unit-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
async function* pieces(text, size) { for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size); }
const collect = async (it) => { const out = []; for await (const x of it) out.push(x); return out; };

describe('FINESS+ stream reader', () => {
  const doc = JSON.stringify({ schemaVersion: 'v1', note: 'a "pmej" in a string [ { is not an array', pmej: [{ a: 1, s: 'brace } and bracket ] and quote \\" inside' }, { a: 2, nested: { pmej: [9] } }, { a: 3 }], gco: [{ b: 1 }] });
  it('yields each element of the top-level array whatever the chunk boundaries, strings with braces, quotes and escapes included', async () => {
    for (const size of [1, 2, 3, 7, 64, 1 << 20]) {
      expect((await collect(arrayElements(pieces(doc, size), 'pmej'))).map((x) => x.a), String(size)).toEqual([1, 2, 3]);
      expect(await collect(arrayElements(pieces(doc, size), 'gco'))).toEqual([{ b: 1 }]);
    }
    expect((await collect(arrayElements(pieces(doc, 5), 'pmej')))[0].s).toBe('brace } and bracket ] and quote \\" inside');   // the text as written, its backslash included
  });
  it('refuses an interrupted document (a truncated download)', async () => {
    await expect(collect(arrayElements(pieces(doc.slice(0, doc.length - 20), 9), 'pmej'))).rejects.toMatchObject({ code: 'BAD_JSON' });
  });
  it('reads a gzip file as a stream; a missing file is an error, not a wait', async () => {
    const d = tmp(); const f = path.join(d, 's.json.gz'); fs.writeFileSync(f, zlib.gzipSync(JSON.stringify({ pmej: [] })));
    expect((await readFiness({ structures: f })).entities).toBe(0);
    await expect(readFiness({ structures: path.join(d, 'absent.json.gz') })).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('an establishment as the directory needs it', () => {
  const pm = { informationsGeneralesPMEJ: { numFinessPm: '670000001', denominationLonguePmSmsse: 'ASSOCIATION EXEMPLE', siren: '123456789' }, ege: [
    { informationsGeneralesEGE: { numFinessEge: '670000002', nomEgeLong: "EHPAD KORIAN L'AIR DU TEMPS", siret: '12345678900011', dateFermeture: null }, categorieentiteGeographiqueExercice: '500', etatObjet: 'A', dateDerniereMaj: '2026-09-01 00:00:00',
      adresse: [{ cogCommune: '67482', codePostal: '67000', ligneAcheminement: 'STRASBOURG CEDEX 1', ligneQuatre: '3 RUE DE LA BARONNE D\'OBERKIRCH', coordonneesGeographique: { directionLatitude: '48.59', directionLongitude: '7.78' } }],
      contact: [{ telecom: { telephone: '0388458045', courriel: 'contact@exemple.fr' } }] },
    { informationsGeneralesEGE: { numFinessEge: '670000003', nomEgeLong: 'PHARMACIE', dateFermeture: '2020-01-01' }, categorieentiteGeographiqueExercice: '620', etatObjet: 'I', adresse: [{ cogCommune: '67482', codePostal: '67000' }] },
    { informationsGeneralesEGE: { numFinessEge: '250000004', nomEgeLong: 'AILLEURS' }, categorieentiteGeographiqueExercice: '500', etatObjet: 'A', adresse: [{ cogCommune: '25056', codePostal: '25000' }] },
  ] };
  it('keeps the establishments of the département with the register\'s facts, open state and scope', () => {
    const [e, closed, ...rest] = establishmentsOf(pm, '67');
    expect(rest).toEqual([]);
    expect(e).toMatchObject({ finess: '670000002', nom: "EHPAD Korian l'Air du Temps", adresse: "3 rue de la Baronne d'Oberkirch", ville: 'Strasbourg', code_postal: '67000', insee: '67482',
      telephone: '03 88 45 80 45', email: 'contact@exemple.fr', siret: '12345678900011', open: true, category: '500', scope: SCOPE[500],
      evidenceUrl: 'https://finess.esante.gouv.fr/fininter/jsp/actionDetailEtablissement.do?noFinesset=670000002' });
    expect(e.categoryLabel).toBe("Etablissement d'hébergement pour personnes âgées dépendantes");   // the official TRE-R397 label
    expect(closed).toMatchObject({ open: false, scope: null, closedAt: '2020-01-01' });
  });
  it('never takes a person\'s own e-mail address as a public contact', () => {
    const p2 = JSON.parse(JSON.stringify(pm)); p2.ege[0].contact[0].telecom.courriel = 'jean.dupont@exemple.fr';
    expect(establishmentsOf(p2, '67')[0].email).toBeNull();
  });
  it('maps the official publics to the directory\'s words and leaves out placements and « without other indication »', () => {
    expect(publicOf('711')).toBe('Personnes âgées'); expect(publicOf('010')).toBe('Personnes en situation de handicap'); expect(publicOf('840')).toBe('Personnes sans domicile');
    expect(publicOf('800')).toBeNull(); expect(publicOf('842')).toBeNull(); expect(publicOf('990')).toBeNull();
  });
  it('writes names in the case people read, acronyms kept', () => {
    expect(readableName('CSAPA ITHAQUE - STRASBOURG')).toBe('CSAPA Ithaque - Strasbourg');
    expect(readableName('Centre de santé Exemple')).toBe('Centre de santé Exemple');
  });
  it('the texts say what the register establishes and what it does not — no service described', () => {
    const [e] = establishmentsOf(pm, '67'); e.publics = ['Personnes âgées'];
    const t = finessTexts(e, { updatedDay: '01/09/2026' });
    expect(t.resume).toContain('Le répertoire national FINESS'); expect(t.resume).toContain('pas les services qu’il propose ni les conditions pour y être accueilli');
    expect(t.resume).toContain('Publics de ses activités autorisées : personnes âgées.');
    expect(t.falc).toContain('Appelez avant d’y aller.');
    expect(`${t.resume} ${t.falc.join(' ')}`).not.toMatch(/€|gratuit|sans rendez-vous|urgence/i);
  });
  it('every category in scope has its official label, with the terminology versions', () => {
    for (const code of Object.keys(SCOPE)) expect(officialLabel('categorie', code), code).toBeTruthy();
    expect(termsVersion()).toMatchObject({ categorie: expect.any(String), public: expect.any(String) });
  });
});

describe('the file of the day and its checksum', () => {
  const bytes = zlib.gzipSync(JSON.stringify({ pmej: [] }));
  const sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
  const api = (checksum) => async (url) => {
    const u = new URL(url);
    if (u.hostname === 'www.data.gouv.fr') return Response.json({ license: 'lov2', organization: { name: 'Agence du Numérique en Santé' }, resources: [
      { title: 'finess-x-mensuel-202609.json.gz', url: 'https://static.data.gouv.fr/m.json.gz', checksum: { type: 'sha1', value: sha1 } },
      { title: 'finess-x-journalier-20261024.json.gz', url: 'https://static.data.gouv.fr/old.json.gz', checksum: { type: 'sha1', value: sha1 } },
      { title: 'finess-x-journalier-20261025.json.gz', url: 'https://static.data.gouv.fr/new.json.gz', filesize: bytes.length, checksum: checksum === undefined ? { type: 'sha1', value: sha1 } : checksum }] });
    if (u.hostname === 'static.data.gouv.fr') return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
    return new Response('', { status: 404 });
  };
  const env = { ADA_VERIFICATION_NETWORK: 'on' };
  it('takes the latest daily file with the publisher\'s SHA-1; refuses a file without one', async () => {
    process.env.ADA_VERIFICATION_MIN_GAP_MS = '0';
    expect(await latestDaily('finess-structures-1', { fetchImpl: api(), env })).toMatchObject({ title: 'finess-x-journalier-20261025.json.gz', date: '2026-10-25', sha1, licence: 'lov2' });
    await expect(latestDaily('finess-structures-1', { fetchImpl: api(null), env })).rejects.toMatchObject({ code: 'NO_CHECKSUM' });
  });
  it('downloads to the cache and checks the SHA-1; a different file is discarded, not used', async () => {
    const d = tmp();
    const ok = await fetchFiness({ cacheDir: d, net: { fetchImpl: api(), env } });
    expect(ok.structures).toMatchObject({ sha1, reused: false }); expect(fs.existsSync(ok.structures.file)).toBe(true);
    expect((await fetchFiness({ cacheDir: d, net: { fetchImpl: api(), env } })).structures.reused, 'the same file of the day is not downloaded again').toBe(true);
    const d2 = tmp();
    await expect(fetchFiness({ cacheDir: d2, net: { fetchImpl: api({ type: 'sha1', value: '0'.repeat(40) }), env } })).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });
    expect(fs.readdirSync(d2).filter((f) => f.endsWith('.json.gz'))).toEqual([]);
  });
});
