import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../api/_handlers/assistant/chat.js', import.meta.url), 'utf8');

describe('WS4 PII and telemetry minimization', () => {
  it('blocks NIR and IBAN before retrieval/model execution', () => {
    const piiGate = source.indexOf('containsSensitiveData(trimmedMessage)');
    const retrieval = source.indexOf('retrieveVerifiedRecords(trimmedMessage, resolvedTerritory)');
    const model = source.indexOf('generateCitizenLocalStructuredContent({');
    expect(piiGate).toBeGreaterThan(-1);
    expect(retrieval).toBeGreaterThan(piiGate);
    expect(model).toBeGreaterThan(retrieval);
    expect(source).toContain('NIR_RE');
    expect(source).toContain('IBAN_FR_RE');
  });

  it('does not persist raw citizen prompts', () => {
    expect(source).not.toContain('ConversationLog');
    expect(source).not.toContain('trimmedMessage.slice');
    expect(source).not.toContain('storeLog');
    expect(source).not.toContain('recordMetric');
  });

  it('keeps failure telemetry generic', () => {
    expect(source).toContain('assistant.local_failure');
    expect(source).not.toContain('errorMsg');
    expect(source).not.toContain('captureException(error');
    expect(source).not.toContain('@sentry/node');
    expect(source).not.toContain('captureMessage(');
  });
});
