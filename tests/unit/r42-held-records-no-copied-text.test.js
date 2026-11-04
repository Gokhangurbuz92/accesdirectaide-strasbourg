/**
 * R42-POLISH — two records reproduced (in translation) text from publishers whose legal notices forbid reproduction without written consent
 * (strasbourg.eu, alsace.eu; CONTROL/r41/R41_CONTENT_REUSE_REVIEW_FR.md §2-3). Both are on a Production publication hold, so they have no public
 * page, and their translation files were removed from the public repository. A held record that comes back must be re-translated from the
 * rewritten French text (scripts/translate-content.mjs reads only publicly visible records), never restored from history.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { publicView } from '../../api/lib/contentTranslation.js';

const HELD = [
  ['aide', 'faj-strasbourg'],
  ['dispositif', 'fonds-de-solidarite-pour-le-logement-fsl-de-la-collectivite-europeenne-d-alsace-bas-rhin-hors-eurometropole-f188c3'],
];

describe('held records carry no copied publisher text in the repository', () => {
  it.each(HELD)('%s/%s has no committed translation file', (kind, slug) => {
    expect(fs.existsSync(path.join(process.cwd(), 'data', 'translations', kind, `${slug}.json`))).toBe(false);
  });
  it('a missing translation file is tolerated by the public view (status unavailable, no fields)', () => {
    expect(publicView(null, 'en', 'aide', { slug: 'faj-strasbourg' })).toMatchObject({ status: 'unavailable', fields: {} });
  });
});
