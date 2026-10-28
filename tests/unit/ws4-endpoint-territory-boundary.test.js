import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const chat = readFileSync(new URL('../../api/_handlers/assistant/chat.js', import.meta.url), 'utf8');
const orient = readFileSync(new URL('../../api/_handlers/public/assistant/orient.js', import.meta.url), 'utf8');
const resolver = readFileSync(new URL('../../api/lib/geography/AssistantTerritoryResolver.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../../src/components/chat/ChatAssistant.jsx', import.meta.url), 'utf8');
const client = readFileSync(new URL('../../src/lib/assistant/client.ts', import.meta.url), 'utf8');

describe('WS4 endpoint and territory boundary', () => {
  it('binds the active ChatAssistant to the local chat endpoint only', () => {
    expect(ui).toContain("fetch('/api/assistant/chat'");
    expect(ui).not.toContain('/api/public/assistant/orient');
  });

  it('preserves the accessible live response region', () => {
    expect(ui).toContain('role="log"');
    expect(ui).toContain('aria-live="polite"');
  });

  it('updates the privacy notice to the no-prompt-persistence contract', () => {
    expect(ui).toContain("ne sont pas enregistrés dans un journal de conversation");
    expect(ui).not.toContain('tronqués à 500 caractères');
    expect(ui).not.toContain('enregistrés de manière anonyme');
  });

  it('keeps the typed client pinned to the same local endpoint without mutation', () => {
    expect(client).toContain("const ENDPOINT = '/api/assistant/chat'");
  });

  it('turns public orient into a local compatibility wrapper', () => {
    expect(orient).toContain("import chatHandler from '../../assistant/chat.js'");
    expect(orient).toContain('local_grounded_compat');
    expect(orient).not.toMatch(/gemini|google_api_key|conversationlog|generatetext/i);
  });

  it('removes external Sentry transport from the citizen chat path', () => {
    expect(chat).not.toContain('@sentry/node');
    expect(chat).not.toContain('captureMessage(');
    expect(orient).not.toContain('@sentry/node');
  });

  it('resolves canonical territory before embedding and retrieval', () => {
    const territoryIndex = chat.indexOf('resolveAssistantTerritory({');
    const retrievalIndex = chat.indexOf('retrieveVerifiedRecords(trimmedMessage, resolvedTerritory)');
    expect(territoryIndex).toBeGreaterThan(-1);
    expect(retrievalIndex).toBeGreaterThan(territoryIndex);
    expect(chat).toContain('generateCitizenLocalQueryEmbedding(message)');
    expect(chat).not.toContain('geoScope: territory');
  });

  it('uses only the canonical hierarchy IDs for applicability filtering', () => {
    expect(chat).toContain('resolvedTerritory.territoryIds');
    expect(chat).toContain('territoryFilter');
    expect(chat).not.toContain('userTerritoryIds: [territory]');
  });

  it('keeps the resolver local-only and fail-closed', () => {
    expect(resolver).toContain("status: 'AMBIGUOUS'");
    expect(resolver).toContain("status: 'HISTORICAL_ONLY'");
    expect(resolver).toContain("status: 'UNAVAILABLE'");
    expect(resolver).not.toMatch(/fetch\s*\(|https?:\/\//i);
  });
});
