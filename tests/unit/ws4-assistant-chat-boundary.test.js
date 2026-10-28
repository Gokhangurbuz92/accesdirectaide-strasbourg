import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../api/_handlers/assistant/chat.js', import.meta.url), 'utf8');

describe('WS4 citizen assistant boundary', () => {
  it('routes to the local AI foundation and local retrieval', () => {
    expect(source).toContain('generateCitizenLocalStructuredContent');
    expect(source).toContain('searchAidesHybrid');
    expect(source).toContain('searchDemarches');
    expect(source).toContain('searchStructures');
    expect(source).toContain('territoryFilter');
    expect(source).toContain('resolveAssistantTerritory');
    expect(source).not.toContain('geoScope: territory');
  });

  it('does not use Gemini or text-domain verification', () => {
    expect(source).not.toContain('chatWithRulePack');
    expect(source).not.toContain('gemini-metrics');
    expect(source).not.toContain('OFFICIAL_DOMAINS');
    expect(source).not.toContain("model: 'gemini-2.0-flash'");
    expect(source).not.toContain('@sentry/node');
  });

  it('binds citations to retrieved entity identifiers', () => {
    expect(source).toContain('sourceId');
    expect(source).toContain('entityId');
    expect(source).toContain('allowedIds');
    expect(source).toContain('grounding_validation_failed');
  });
});
