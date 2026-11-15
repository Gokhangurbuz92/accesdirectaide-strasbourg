// @vitest-environment jsdom
/**
 * A-12 — src/pages/LegacyAppointmentLink.jsx (live on /appointments/* and /r/*) was hardcoded French. Its wording goes through the interface language:
 * the French text is unchanged, and the five other languages have every key. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { setLanguage } from '../../src/i18n/index.js';
import LegacyAppointmentLink from '../../src/pages/LegacyAppointmentLink.jsx';

const NEUTRAL = { request: '/appointments/request', cancel: '/appointments/cancel', reschedule: '/appointments/reschedule', messages: '/r/messages' };
const show = (kind) => render(h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [NEUTRAL[kind]] }, h(LegacyAppointmentLink, { kind }))));
afterEach(async () => { cleanup(); await act(async () => { await setLanguage('fr', { persist: false }); }); });

describe('A-12: the legacy appointment landing follows the interface language', () => {
  it('no user-facing French literal is left outside t() in the page source', () => {
    const src = fs.readFileSync('src/pages/LegacyAppointmentLink.jsx', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const outside = src.replace(/t\('booking:[\w.]+',\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\)/g, '');
    expect(outside).not.toMatch(/rendez-vous|structure que|Messagerie|Aucun |Trouver une|Ouvrir mes/);
    expect((src.match(/t\('booking:legacy\./g) || []).length).toBe(12);
  });
  it('French is unchanged', () => {
    show('cancel');
    expect(screen.getByRole('heading', { level: 1, name: 'Annuler un rendez-vous' })).toBeInTheDocument();
    expect(screen.getByText("Ce lien d'une ancienne version n'est plus pris en charge. Utilisez le lien « gérer mon rendez-vous » de votre e-mail de confirmation le plus récent, ou contactez directement la structure.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trouver une structure' })).toHaveAttribute('href', '/structures');
  });
  it.each([
    ['en', 'messages', 'Messages', 'Open my messages', 'No message was read or sent by opening this page.'],
    ['de', 'reschedule', 'Einen Termin verschieben', 'Eine Einrichtung finden', 'Durch das Öffnen dieser Seite wurde kein Termin angelegt, geändert oder abgesagt.'],
    ['ar', 'request', 'حجز موعد', 'البحث عن هيئة', 'لم يُنشأ أي موعد ولم يُعدَّل ولم يُلغَ بفتح هذه الصفحة.'],
  ])('%s: « %s » is shown in that language', async (lang, kind, title, cta, note) => {
    await act(async () => { await setLanguage(lang, { persist: false }); });
    show(kind);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: cta })).toBeInTheDocument();
    expect(screen.getByText(note)).toBeInTheDocument();
  });
  it.each(['en', 'tr', 'ar', 'de', 'uk'])('%s has the twelve keys', (lang) => {
    const loc = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/booking.json`, 'utf8'));
    const keys = Object.keys(loc).filter((k) => k.startsWith('legacy.'));
    expect(keys).toHaveLength(12);
    for (const k of keys) expect(String(loc[k]).trim().length, k).toBeGreaterThan(3);
  });
});
