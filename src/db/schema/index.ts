/**
 * Schema barrel — re-exports everything from the canonical schema.ts.
 *
 * Domain-specific imports are available from:
 *   - ./core       → Aide, Structure, Demarche, Actualite, Dispositif
 *   - ./auth       → AdminUser, CitizenUser, AuthToken, AuditLog
 *   - ./pro        → ProUser, ProRdvService, appointments, etc.
 *   - ./taxonomy   → NeedCategory, AudienceCategory, ProProfile, etc.
 *   - ./ingestion  → SourceDocument, ImportLog, IngestJob, etc.
 *   - ./ai         → AiMetric, ReviewQueueItem, CronRun
 *   - ./messaging  → ConversationLog, SharedDiagnostic, etc.
 *
 * For backward compatibility, import from '../schema' or '../schema/index'.
 */
export * from '../schema';
