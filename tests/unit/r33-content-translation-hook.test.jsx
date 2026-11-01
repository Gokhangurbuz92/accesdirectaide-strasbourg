// @vitest-environment jsdom
/* global window */
/**
 * R33 — search result cards use normalised names (title, description) while translation files keep the record's own field names (titre,
 * description_courte, resume). Before R33 the cards' titles and summaries were never translated.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import useContentTranslation, { clearTranslationCache } from '../../src/hooks/useContentTranslation.js';
import { setLanguage } from '../../src/i18n/index.js';

afterEach(async () => { vi.restoreAllMocks(); clearTranslationCache(); await setLanguage('fr'); });

describe('useContentTranslation field aliases', () => {
  it('a news card reads title/description from the translated titre/resume, without loading the full record', async () => {
    await setLanguage('en');
    const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: { n1: { status: 'auto_checked', fields: { titre: 'Title EN', resume: 'Summary EN' } } } }), { status: 200 }));
    const { result } = renderHook(() => useContentTranslation('actualite', { slug: 'n1', title: 'Titre FR', description: 'Résumé FR' }));
    await waitFor(() => expect(result.current.value('title')).toBe('Title EN'));
    expect(result.current.value('description')).toBe('Summary EN');
    expect(result.current.attrs('title').lang).toBe('en');
    expect(fetch.mock.calls.map(([u]) => String(u))).toEqual(['/api/translations/actualite?lang=en']);
  });
  it('a démarche card maps description to description_courte; an untranslated field stays French with lang="fr"', async () => {
    await setLanguage('de');
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: { d1: { status: 'partial', fields: { titre: 'Titel DE' } } } }), { status: 200 }));
    const { result } = renderHook(() => useContentTranslation('demarche', { slug: 'd1', title: 'Titre FR', description: 'Courte FR' }));
    await waitFor(() => expect(result.current.value('title')).toBe('Titel DE'));
    expect(result.current.value('description')).toBe('Courte FR');
    expect(result.current.attrs('description').lang).toBe('fr');
  });
});
