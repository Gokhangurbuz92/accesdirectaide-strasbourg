import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// R35 (§8, Q15): no premises or hosting agreement exists, so no public text may announce an in-person reception by AccesDirectAide.
// The publisher's registered address in the legal notice is not a reception and is not concerned. Partner places (structures) are other organisations.
const root = path.resolve(__dirname, '../..');
const CLAIMS = /nos locaux|notre local\b|nos bureaux|dans nos locaux|accueil physique (?:d['’]|chez )?(?:ada|accès direct aide|accesdirectaide)|venez nous (?:voir|rencontrer)|permanence (?:d['’]accueil )?(?:d['’]|de )(?:ada|accès direct aide|accesdirectaide)|our (?:office|premises)|visit us at/i;

function files(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, acc);
    else if (/\.(json|jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name)) acc.push(p);
  }
  return acc;
}

describe('R35 Q15: no in-person reception announced', () => {
  it('no interface text, page or component claims premises of AccesDirectAide', () => {
    const hits = [];
    for (const f of [...files(path.join(root, 'src/i18n/locales')), ...files(path.join(root, 'src/pages')), ...files(path.join(root, 'src/components'))]) {
      const src = fs.readFileSync(f, 'utf8');
      const m = src.match(CLAIMS);
      if (m) hits.push(`${path.relative(root, f)}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });

  it('the guard recognises a claim', () => {
    expect(CLAIMS.test('Venez nous voir dans nos locaux rue du Dôme')).toBe(true);
    expect(CLAIMS.test('Adresse du siège : 1 rue X (mentions légales)')).toBe(false);
  });
});
