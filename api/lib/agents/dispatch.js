// @ts-nocheck
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

export const SourceEnvelope = z.object({
  sourceId: z.string(),
  url: z.string().url().optional(),
  organisation: z.string().optional(),
  domain: z.string().optional(),
  verificationStatus: z.enum(['VERIFIED', 'STALE', 'BROKEN', 'UNVERIFIED']),
  lastVerified: z.string().datetime().optional(),
  contentHash: z.string().optional(),
  freshnessState: z.enum(['FRESH', 'STALE', 'UNKNOWN']).default('UNKNOWN'),
  conflictState: z.enum(['NONE', 'SOURCE_CONFLICT']).default('NONE')
});

export const AgentDispatch = z.object({
  executionId: z.string().guid(),   // R7 zod 4: guid() is zod 3's uuid() check (any 8-4-4-4-12 hex id); uuid() now also checks the RFC version bits
  requestId: z.string().guid(),   // R7 zod 4: guid() is zod 3's uuid() check (any 8-4-4-4-12 hex id); uuid() now also checks the RFC version bits
  userIntent: z.string(),
  sourceComponent: z.string(),
  targetComponent: z.string(),
  payload: z.string(),
  sourceEnvelope: z.array(SourceEnvelope).optional().default([]),
  toolPermissions: z.array(z.string()).optional().default([]),
  deadline: z.number(),
  traceMetadata: z.record(z.string(), z.unknown()).optional()
});

export const AgentResponse = z.object({
  content: z.unknown().nullable(),
  componentName: z.string(),
  componentLatency: z.number(),
  toolsUsed: z.array(z.string()).default([]),
  dispatchId: z.string().guid(),   // R7 zod 4: guid() is zod 3's uuid() check (any 8-4-4-4-12 hex id); uuid() now also checks the RFC version bits
  routingMethod: z.enum(['DETERMINISTIC', 'LLM']),
  modelCallCount: z.number().int().min(0),
  citations: z.array(z.string()).default([]),
  confidence: z.number().nullable().default(null),
  abstention: z.boolean().default(false),
  humanApprovalRequired: z.boolean().default(false),
  safeErrorState: z.string().nullable().default(null),
  eligibilityStatus: z.enum(['UNKNOWN', 'POSSIBLE', 'MISSING_INFORMATION', 'DETERMINISTIC_CHECK_REQUIRED', 'NOT_APPLICABLE']).default('NOT_APPLICABLE'),
  falcReviewStatus: z.enum(['PENDING', 'APPROVED', 'NOT_APPLICABLE']).default('NOT_APPLICABLE'),
  sourceConflict: z.boolean().default(false)
});

export function createDispatch({
  requestId,
  // @ts-ignore
  userIntent,
  // @ts-ignore
  sourceComponent,
  // @ts-ignore
  targetComponent,
  // @ts-ignore
  payload,
  // @ts-ignore
  sourceEnvelope = [],
  // @ts-ignore
  toolPermissions = [],
  timeoutMs = 90000,
  // @ts-ignore
  traceMetadata
}) {
  const executionId = randomUUID();
  const deadline = Date.now() + timeoutMs;
  
  return AgentDispatch.parse({
    executionId,
    requestId,
    userIntent,
    sourceComponent,
    targetComponent,
    payload,
    sourceEnvelope,
    toolPermissions,
    deadline,
    traceMetadata
  });
}

export function createResponse({
  // @ts-ignore
  componentName,
  content = null,
  // @ts-ignore
  componentLatency,
  // @ts-ignore
  dispatchId,
  // @ts-ignore
  routingMethod,
  // @ts-ignore
  modelCallCount,
  ...optionalFields
}) {
  return AgentResponse.parse({
    componentName,
    content,
    componentLatency,
    dispatchId,
    routingMethod,
    modelCallCount,
    ...optionalFields
  });
}
