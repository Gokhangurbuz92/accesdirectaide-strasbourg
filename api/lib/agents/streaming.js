import { z } from 'zod';

// Safe streaming stage events
/** @type {["ROUTING", "SEARCHING_OFFICIAL_SOURCES", "VERIFYING_SOURCE", "GENERATING_RESPONSE", "COMPLETE", "ERROR"]} */
export const STREAM_STAGES = [
  'ROUTING',
  'SEARCHING_OFFICIAL_SOURCES',
  'VERIFYING_SOURCE',
  'GENERATING_RESPONSE',
  'COMPLETE',
  'ERROR'
];

export const StreamEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stage'),
    stage: z.enum(STREAM_STAGES),
    timestamp: z.number()
  }),
  z.object({
    type: z.literal('token'),
    content: z.string(), // User-visible token only
    timestamp: z.number()
  }),
  z.object({
    type: z.literal('complete'),
    result: z.unknown().nullable(),
    timestamp: z.number()
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    timestamp: z.number()
  })
]);

// FORBIDDEN from streaming:
// - Chain of thought / internal reasoning
// - Unvalidated tool arguments
// - System prompts
// - Provider internals
// - Sensitive trace data

export class StreamEmitter {
  constructor() {
    /** @type {Array<(event: unknown) => void>} */
    this.listeners = [];
  }

  on(/** @type {(event: unknown) => void} */ callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  emit(/** @type {Record<string, string | number | boolean | null | undefined>} */ event) {
    const validated = StreamEvent.parse(event);
    for (const listener of this.listeners) {
      listener(validated);
    }
  }

  emitStage(/** @type {string | number | boolean | null | undefined} */ stage) {
    this.emit({ type: 'stage', stage, timestamp: Date.now() });
  }

  emitToken(/** @type {string | number | boolean | null | undefined} */ content) {
    this.emit({ type: 'token', content, timestamp: Date.now() });
  }

  emitComplete(/** @type {string | number | boolean | null | undefined} */ result) {
    this.emit({ type: 'complete', result, timestamp: Date.now() });
  }

  emitError(/** @type {string | number | boolean | null | undefined} */ message) {
    this.emit({ type: 'error', message, timestamp: Date.now() });
  }
}
