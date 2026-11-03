// @vitest-environment jsdom
/* global document, window, Node, NodeFilter */
/**
 * R41-C — the professional SharedDossier tools (ExpertTools: AI draft + printable recap; FileVault: supporting documents), the attachment line of the
 * messaging window and the review-queue filters in the interface language. French keeps its former wording (other tests read it); in Arabic and English
 * no French sentence is left outside a lang="fr" fragment, the sizes are formatted for the language, and the axe rules pass. jsdom: no layout.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExpertTools from '../../src/components/ExpertTools.jsx';
import FileVault from '../../src/components/FileVault.jsx';
import ChatWindow from '../../src/components/Messaging/ChatWindow.jsx';
import { setLanguage } from '../../src/i18n/index.js';

const DRAFTS = { drafts: [
  { id: 'd1', status: 'PENDING', model: 'local-7b', points: ['Point A'], sourceChanged: true },
  { id: 'd2', status: 'APPROVED', model: 'local-7b', points: ['Point B'], reviewedBy: 'Camille', reviewNote: '' },
] };
const DOCS = [{ id: 'doc1', name: 'avis.pdf', byteLength: 1572864, downloadToken: 'tok' }];

beforeEach(() => {
  window.localStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = () => {};
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => DRAFTS })));
});
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await act(async () => { await setLanguage('fr', { persist: false }); }); });
const lang = async (code) => { await act(async () => { await setLanguage(code, { persist: false }); }); };
const tools = () => h(MemoryRouter, null, h('main', null, h(ExpertTools, { shareId: 'abc', aiAllowed: true }), h(FileVault, { shareId: 'abc', documents: DOCS })));

const outsideFrench = (root) => {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let out = ''; let n;
  while ((n = w.nextNode())) { if (n.nodeType === Node.TEXT_NODE && !n.parentElement.closest('[lang="fr"]')) out += ` ${n.textContent}`; }
  const attrs = [...root.querySelectorAll('[aria-label],[placeholder],[title]')].filter((e) => !e.closest('[lang="fr"]'))
    .map((e) => [e.getAttribute('aria-label'), e.getAttribute('placeholder'), e.getAttribute('title')].filter(Boolean).join(' '));
  return `${out} ${attrs.join(' ')}`;
};
const FRENCH = /\b(vous|votre|vos|les|une|pour|avec|aucun|dossier|brouillon|récapitulatif|fichier|document enregistré|télécharger|relu|chiffré|structure)\b|Ko\b|Mo\b/i;

describe('French: the former wording', () => {
  it('ExpertTools and FileVault keep their French text', async () => {
    const { container } = render(tools());
    await waitFor(() => expect(screen.getAllByTestId('pro-synthesis-draft')).toHaveLength(2));
    expect(screen.getByText('Synthèse IA (brouillon à relire)')).toBeInTheDocument();
    expect(screen.getByText('Brouillon IA — non relu · IA (local-7b)')).toBeInTheDocument();
    expect(screen.getByText('Relu par Camille')).toBeInTheDocument();
    expect(screen.getByText('Le dossier a changé depuis ce brouillon : il ne peut plus être approuvé.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ouvrir le récapitulatif' })).toHaveAttribute('href', '/pro/attestation/abc');
    expect(screen.getByText('Coffre-fort justificatifs')).toBeInTheDocument();
    expect(screen.getByText('1,5 Mo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Télécharger avis.pdf' })).toBeInTheDocument();
    expect(container.textContent).toContain('Ce n’est pas un chiffrement de bout en bout.');
  });
});

describe.each([
  ['ar', 'ملخّص بالذكاء الاصطناعي (مسودة للمراجعة)', 'راجعها: Camille', 'خزانة المستندات الداعمة', '1.5 م.ب', 'تنزيل avis.pdf', 'هذا ليس تشفيرًا من طرف إلى طرف.'],
  ['en', 'AI summary (draft to review)', 'Reviewed by Camille', 'Supporting documents vault', '1.5 MB', 'Download avis.pdf', 'This is not end-to-end encryption.'],
])('%s: SharedDossier tools', (code, title, reviewed, vault, size, download, e2e) => {
  it('render translated, with no French outside lang="fr", and pass axe', async () => {
    await lang(code);
    const { container } = render(tools());
    await waitFor(() => expect(screen.getAllByTestId('pro-synthesis-draft')).toHaveLength(2));
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(reviewed)).toBeInTheDocument();
    expect(screen.getByText(vault)).toBeInTheDocument();
    expect(screen.getByText(size)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: download })).toBeInTheDocument();
    expect(container.textContent).toContain(e2e);
    expect(document.documentElement).toHaveAttribute('dir', code === 'ar' ? 'rtl' : 'ltr');
    expect(document.documentElement).toHaveAttribute('lang', code);
    // file names and the model id are data, not interface text
    expect(outsideFrench(container).replace(/avis\.pdf|local-7b|Camille|Point [AB]|AccesDirectAide/g, '')).not.toMatch(FRENCH);
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(res.violations.map((v) => v.id)).toEqual([]);
  });

  it('upload errors are in the language', async () => {
    await lang(code);
    render(tools());
    fireEvent.change(screen.getByTestId('file-vault-input'), { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } });
    expect(screen.getByTestId('file-vault-error')).toHaveTextContent(code === 'ar' ? 'الصيغة غير مقبولة' : 'Format not accepted');
  });
});

describe('the messaging attachment line', () => {
  it.each([
    ['fr', 'note.pdf (2,0 Ko)', 'Retirer le fichier'],
    ['en', 'note.pdf (2.0 KB)', 'Remove the file'],
    ['ar', 'note.pdf (2.0 ك.ب)', 'إزالة الملف'],
  ])('%s', async (code, line, remove) => {
    await lang(code);
    const { container } = render(h(ChatWindow, { messages: [], onSendMessage: () => {}, onUploadFile: () => {}, loading: false }));
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File([new Uint8Array(2048)], 'note.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: remove })).toBeInTheDocument();
  });
});
