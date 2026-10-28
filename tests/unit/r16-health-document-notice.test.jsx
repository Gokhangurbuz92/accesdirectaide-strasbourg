// @vitest-environment jsdom
/**
 * R16 (HDS, ledger #91) — every place where a file can be attached WITHOUT a category tells the person not to send medical documents: message attachments
 * (citizen and professional), the professional dossier vault and the legacy appointment chat. Guidance only: the server cannot classify a PDF's content.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { AttachmentPicker } from '../../src/components/Messaging/MessageAttachments.jsx';
import FileVault from '../../src/components/FileVault.jsx';

afterEach(cleanup);

describe('R16: no medical document without an HDS host', () => {
  it('the message attachment picker shows the notice (citizen and professional pickers share it)', () => {
    render(createElement(AttachmentPicker, { id: 'citizen-attach', file: null, onChange: () => {} }));
    expect(screen.getByTestId('citizen-attach-health-notice')).toHaveTextContent('hébergeur agréé pour les données de santé (HDS)');
    expect(readFileSync('src/pages/pro/MessageThread.jsx', 'utf8')).toContain('<AttachmentPicker');
  });

  it('the professional dossier vault shows the notice next to its upload control', () => {
    render(createElement(FileVault, { shareId: 's', documents: [] }));
    expect(screen.getByTestId('file-vault-health-notice')).toHaveTextContent('N’envoyez pas de document médical');
    expect(screen.getByTestId('file-vault-input')).toBeInTheDocument();
  });

  it('the legacy chat shows it whenever attaching is possible', () => {
    const src = readFileSync('src/components/Messaging/ChatWindow.jsx', 'utf8');
    expect(src).toMatch(/canAttach \? <div className="mb-2"><HealthDocumentNotice testid="chat-health-notice" \/>/);
  });
});
