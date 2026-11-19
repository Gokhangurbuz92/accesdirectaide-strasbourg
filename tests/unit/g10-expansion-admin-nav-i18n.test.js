// G10 — the administration menu entries of the five expansion capabilities (X04 events, X02 testimonials, X01 stories, X05 job board, X03 Entraide) are
// translated in the five interface languages: each label of a menu entry gated by a « …Opened(frontendEnv… » switch has a navLabel key, and that key exists,
// non-empty, in en / de / tr / ar / uk (French is the default text in the code). Before G10 these five entries stayed French in every language.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = fs.readFileSync('src/pages/admin/AdminLayout.jsx', 'utf8');
const gated = [...src.matchAll(/(\w+Opened)\(frontendEnv\.flags\.publicBeta\) \? \[\{ label: '([^']+)'/g)].map((m) => ({ gate: m[1], label: m[2] }));
const keyOf = Object.fromEntries([...src.matchAll(/'([^']+)': t\('admin:(layout\.nav\.[a-z0-9_]+)'/g)].map((m) => [m[1], m[2]]));

describe('G10 — expansion entries of the administration menu in six languages', () => {
  it('finds the five gated expansion entries', () => {
    expect(gated.map((g) => g.gate).sort()).toEqual(['employmentOpened', 'entraideOpened', 'eventsOpened', 'storiesOpened', 'testimonialsOpened']);
  });
  it.each(['en', 'de', 'tr', 'ar', 'uk'])('%s: every gated entry has a translated navLabel key', (lang) => {
    const dict = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/admin.json`, 'utf8'));
    for (const { label } of gated) {
      expect(keyOf[label], label).toBeTruthy();
      expect(String(dict[keyOf[label]] || '').trim(), `${lang} ${keyOf[label]}`).not.toBe('');
      expect(dict[keyOf[label]], `${lang} ${label}`).not.toBe(label);
    }
  });
});
