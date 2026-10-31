// Central Routing Definition — Static imports for Vercel bundler tracing
// Each handler uses inline import() with string literals so @vercel/nft
// can statically analyze and include them in the serverless bundle.
// Used by both api/index.js (Vercel) and dev-server.js (Local)

/**
 * @typedef {Object} Route
 * @property {string} path
 * @property {'exact' | 'prefix'} match
 * @property {Function} handler - Lazy loader: () => import('./handler.js')
 */

/** @type {Route[]} */
export const routes = [
    // --- Health ---
    { path: 'health/live', match: 'exact', handler: () => import('./_handlers/health.js') },
    { path: 'health/ready', match: 'exact', handler: () => import('./_handlers/health.js') },
    { path: 'health/diagnostic', match: 'exact', handler: () => import('./_handlers/health.js') },
    { path: 'health', match: 'exact', handler: () => import('./_handlers/health.js') },
    { path: 'health/deep', match: 'exact', handler: () => import('./_handlers/health-deep.js') },
    { path: 'healthz', match: 'exact', handler: () => import('./_handlers/health.js') },
    { path: 'status', match: 'exact', handler: () => import('./_handlers/public-status.js') },   // PKG-10 / P24 public status (no internals)
    { path: 'monitor/cron/actualites', match: 'exact', handler: () => import('./_handlers/monitor/cron-actualites.js') },
    { path: 'monitor/core', match: 'exact', handler: () => import('./_handlers/monitor/core.js') },
    { path: 'monitor/data-quality', match: 'exact', handler: () => import('./_handlers/monitor/data-quality.js') },
    { path: 'monitor/ingestion-freshness', match: 'exact', handler: () => import('./_handlers/monitor/ingestion-freshness.js') },
    { path: 'monitor/pro-rdv', match: 'exact', handler: () => import('./_handlers/monitor/pro-rdv.js') },
    { path: 'monitor/csp-report', match: 'exact', handler: () => import('./_handlers/monitor/csp-report.js') },
    // --- Special / Root ---
    { path: 'download', match: 'exact', handler: () => import('./_handlers/download.js') },
    { path: 'robots.txt', match: 'exact', handler: () => import('./_handlers/robots.js') },
    { path: 'robots', match: 'exact', handler: () => import('./_handlers/robots.js') },
    { path: 'sitemap.xml', match: 'exact', handler: () => import('./_handlers/sitemap.js') },
    { path: 'public/page', match: 'exact', handler: () => import('./_handlers/public/page.js') },   // P22: the record pages' initial HTML (canonical, title, 404 / 410)
    { path: 'sitemap', match: 'exact', handler: () => import('./_handlers/sitemap.js') },
    { path: 'login-pro-guard', match: 'exact', handler: () => import('./_handlers/login-pro-guard.js') },
    { path: 'taxonomy', match: 'exact', handler: () => import('./_handlers/taxonomy.js') },
    { path: 'pdf', match: 'prefix', handler: () => import('./_handlers/pdf.js') },
    { path: 'contact', match: 'exact', handler: () => import('./_handlers/contact.js') },
    { path: 'support', match: 'exact', handler: () => import('./_handlers/support.js') },
    { path: 'institution/', match: 'prefix', handler: () => import('./_handlers/institution.js') },

    // --- Auth (Admin) ---
    { path: 'auth/login', match: 'exact', handler: () => import('./_handlers/auth/login.js') },
    { path: 'auth/signup', match: 'exact', handler: () => import('./_handlers/auth/signup.js') },
    { path: 'auth/logout', match: 'exact', handler: () => import('./_handlers/auth/logout.js') },
    { path: 'auth/me', match: 'exact', handler: () => import('./_handlers/auth/me.js') },
    { path: 'auth/verify-email', match: 'exact', handler: () => import('./_handlers/auth/verify-email.js') },
    { path: 'auth/resend-verification', match: 'exact', handler: () => import('./_handlers/auth/resend-verification.js') },
    { path: 'auth/forgot-password', match: 'exact', handler: () => import('./_handlers/auth/forgot-password.js') },
    { path: 'auth/reset-password', match: 'exact', handler: () => import('./_handlers/auth/reset-password.js') },
    { path: 'auth/delete-account', match: 'exact', handler: () => import('./_handlers/auth/delete-account.js') },
    { path: 'auth/export-data', match: 'exact', handler: () => import('./_handlers/auth/export-data.js') },

    // --- Pro Module ---
    { path: 'pro/auth/login', match: 'exact', handler: () => import('./_handlers/pro/auth/login.js') },
    { path: 'pro/auth/mfa-verify', match: 'exact', handler: () => import('./_handlers/pro/auth/mfa-verify.js') },
    { path: 'pro/auth/register', match: 'exact', handler: () => import('./_handlers/pro/auth/register.js') },
    { path: 'pro/auth/forgot-password', match: 'exact', handler: () => import('./_handlers/pro/auth/forgot-password.js') },
    { path: 'pro/auth/reset-password', match: 'exact', handler: () => import('./_handlers/pro/auth/reset-password.js') },
    { path: 'pro/auth/register-invite', match: 'exact', handler: () => import('./_handlers/pro/auth/register-invite.js') },
    { path: 'pro/auth/refresh', match: 'exact', handler: () => import('./_handlers/pro/auth/refresh.js') },
    { path: 'pro/auth/logout', match: 'exact', handler: () => import('./_handlers/pro/auth/logout.js') },   // PKG-11 audit: server-side pro logout
    { path: 'pro/me', match: 'exact', handler: () => import('./_handlers/pro/me.js') },
    { path: 'pro/mfa-setup', match: 'exact', handler: () => import('./_handlers/pro/mfa-setup.js') },
    { path: 'pro/slots', match: 'exact', handler: () => import('./_handlers/pro/slots.js') },
    { path: 'pro/availability', match: 'exact', handler: () => import('./_handlers/pro/availability.js') },
    { path: 'pro/timeoff', match: 'exact', handler: () => import('./_handlers/pro/timeoff.js') },
    { path: 'pro/rdv/settings', match: 'exact', handler: () => import('./_handlers/pro/rdv-settings.js') },
    { path: 'pro/outlook/availability', match: 'exact', handler: () => import('./_handlers/pro/outlook-availability.js') },
    { path: 'pro/team', match: 'exact', handler: () => import('./_handlers/pro/team.js') },
    { path: 'pro/team/stats', match: 'exact', handler: () => import('./_handlers/pro/team-stats.js') },
    { path: 'pro/regional-stats', match: 'exact', handler: () => import('./_handlers/pro/regional-stats.js') },
    { path: 'pro/invite', match: 'exact', handler: () => import('./_handlers/pro/invite.js') },
    { path: 'pro/resend-invite', match: 'exact', handler: () => import('./_handlers/pro/resend-invite.js') },
    { path: 'pro/dossier', match: 'exact', handler: () => import('./_handlers/pro/dossier.js') },
    { path: 'pro/notifications/unread-count', match: 'exact', handler: () => import('./_handlers/pro/notifications/unread-count.js') },
    { path: 'pro/notifications', match: 'exact', handler: () => import('./_handlers/pro/notifications.js') },
    { path: 'pro/audit/list', match: 'exact', handler: () => import('./_handlers/pro/audit/list.js') },
    { path: 'pro/audit', match: 'exact', handler: () => import('./_handlers/pro/audit.js') },
    { path: 'pro/reports', match: 'exact', handler: () => import('./_handlers/pro/reports.js') },
    { path: 'pro/dossier/redeem', match: 'exact', handler: () => import('./_handlers/pro/dossier/redeem.js') },
    { path: 'pro/dossier/upload-secure', match: 'exact', handler: () => import('./_handlers/pro/dossier/upload-secure.js') },
    { path: 'pro/dossier/export', match: 'exact', handler: () => import('./_handlers/pro/dossier/export.js') },
    { path: 'pro/dossier/views', match: 'exact', handler: () => import('./_handlers/pro/dossier/views.js') },
    { path: 'pro/consent', match: 'exact', handler: () => import('./_handlers/pro/consent.js') },
    { path: 'pro/dossier-synthesis', match: 'exact', handler: () => import('./_handlers/pro/dossier-synthesis.js') },
    { path: 'pro/attestation-data', match: 'exact', handler: () => import('./_handlers/pro/attestation-data.js') },
    { path: 'pro/interop-siao', match: 'exact', handler: () => import('./_handlers/pro/interop-siao.js') },
    { path: 'pro/system-maintenance', match: 'exact', handler: () => import('./_handlers/pro/system-maintenance.js') },
    { path: 'pro/agent-discovery', match: 'exact', handler: () => import('./_handlers/pro/agent-discovery.js') },
    { path: 'pro/agent-scheduler', match: 'exact', handler: () => import('./_handlers/pro/agent-scheduler.js') },
    { path: 'pro/health-check', match: 'exact', handler: () => import('./_handlers/pro/health-check.js') },
    { path: 'pro/outlook', match: 'exact', handler: () => import('./_handlers/pro/outlook.js') },
    { path: 'pro/appointments', match: 'exact', handler: () => import('./_handlers/pro/appointments.js') },
    { path: 'pro/services', match: 'exact', handler: () => import('./_handlers/pro/services.js') },
    // Full pro messaging (list + thread + send). Replaced by an exact list-only route by mistake; restored as a prefix route.
    { path: 'pro/messages', match: 'exact', handler: () => import('./_handlers/pro/messages.js') },
    { path: 'pro/messages/conversations', match: 'prefix', handler: () => import('./_handlers/pro/messages-conversations.js') },
    { path: 'pro/appointments/cancel', match: 'exact', handler: () => import('./_handlers/pro/appointments/cancel.js') },
    { path: 'pro/appointments/visio', match: 'exact', handler: () => import('./_handlers/pro/appointments/visio.js') },
    { path: 'pro/appointments/ics', match: 'exact', handler: () => import('./_handlers/pro/appointments/ics.js') },
    { path: 'pro/cases', match: 'exact', handler: () => import('./_handlers/pro/cases.js') },
    { path: 'pro/referrals', match: 'exact', handler: () => import('./_handlers/pro/referrals.js') },
    { path: 'pro/structure', match: 'exact', handler: () => import('./_handlers/pro/structure.js') },
    // Citizen messaging (list / thread / send / from-appointment) — route lost in the 2026-03-14 cleanup.
    { path: 'messages', match: 'prefix', handler: () => import('./_handlers/messages.js') },
    { path: 'tts', match: 'exact', handler: () => import('./_handlers/tts.js') },

    // --- Public Content ---
    { path: 'public/dossier-revoke', match: 'exact', handler: () => import('./_handlers/public/dossier-revoke.js') },
    { path: 'public/dossier-grants', match: 'exact', handler: () => import('./_handlers/public/dossier-grants.js') },
    { path: 'public/passport', match: 'exact', handler: () => import('./_handlers/public/passport.js') },
    { path: 'public/sms-notify', match: 'exact', handler: () => import('./_handlers/public/sms-notify.js') },
    { path: 'public/falc/summarize', match: 'exact', handler: () => import('./_handlers/public/falc/summarize.js') },
    { path: 'public/assistant/orient', match: 'exact', handler: () => import('./_handlers/public/assistant/orient.js') },
    { path: 'public/suggest-structure', match: 'exact', handler: () => import('./_handlers/public/suggest-structure.js') },

    // --- Core Data ---
    { path: 'aides', match: 'prefix', handler: () => import('./_handlers/aides.js') },
    { path: 'aids', match: 'prefix', handler: () => import('./_handlers/aides.js') },
    { path: 'drees', match: 'prefix', handler: () => import('./_handlers/drees.js') },
    { path: 'search-pro', match: 'exact', handler: () => import('./_handlers/search-pro.js') },
    { path: 'search', match: 'exact', handler: () => import('./_handlers/search.js') },
    { path: 'structures', match: 'prefix', handler: () => import('./_handlers/structures.js') },
    { path: 'demarches', match: 'prefix', handler: () => import('./_handlers/demarches.js') },
    { path: 'actualites', match: 'prefix', handler: () => import('./_handlers/actualites.js') },
    { path: 'guides', match: 'prefix', handler: () => import('./_handlers/guides.js') },
    { path: 'tools', match: 'prefix', handler: () => import('./_handlers/tools.js') },
    { path: 'dispositifs', match: 'prefix', handler: () => import('./_handlers/dispositifs/index.js') },
    { path: 'ressources', match: 'prefix', handler: () => import('./_handlers/ressources.js') },
    { path: 'reports', match: 'prefix', handler: () => import('./_handlers/reports.js') },
    { path: 'feedback', match: 'exact', handler: () => import('./_handlers/feedback.js') },
    { path: 'glossaire', match: 'exact', handler: () => import('./_handlers/glossaire.js') },
    { path: 'rdv', match: 'prefix', handler: () => import('./_handlers/rdv.js') },

    // --- Assistant (AI) ---
    { path: 'assistant/chat', match: 'exact', handler: () => import('./_handlers/assistant/chat.js') },
    { path: 'assistant/recommendations', match: 'exact', handler: () => import('./_handlers/assistant/recommendations.js') },

    // --- Diagnostic (OpenFisca) ---
    { path: 'diagnostic', match: 'prefix', handler: () => import('./_handlers/diagnostic.js') },

    // --- Cron ---
    { path: 'cron/pipeline', match: 'exact', handler: () => import('./_handlers/cron/pipeline.js') },
    { path: 'cron/actualites', match: 'exact', handler: () => import('./_handlers/cron/actualites.js') },
    { path: 'cron/review-queue/scan', match: 'exact', handler: () => import('./_handlers/cron/review-queue-scan.js') },
    { path: 'cron/hive-scan', match: 'exact', handler: () => import('./_handlers/cron/hive-scan.js') },
    { path: 'cron/ingest-structures', match: 'exact', handler: () => import('./_handlers/cron/ingest-structures.js') },
    { path: 'cron/ingest-aids', match: 'exact', handler: () => import('./_handlers/cron/ingest-aids.js') },
    { path: 'cron/link-check', match: 'exact', handler: () => import('./_handlers/cron/link-check.js') },
    { path: 'cron/veille', match: 'exact', handler: () => import('./_handlers/cron/veille.js') },   // automatic verification chain (owner decision 2026-10-25)
    { path: 'cron/rdv-reminder', match: 'exact', handler: () => import('./_handlers/cron/rdv-reminder.js') },
    { path: 'cron/referral-timeouts', match: 'exact', handler: () => import('./_handlers/cron/referral-timeouts.js') },
    { path: 'cron/parcours-reminder', match: 'exact', handler: () => import('./_handlers/cron/parcours-reminder.js') },
    { path: 'cron/ingest-demarches', match: 'exact', handler: () => import('./_handlers/cron/ingest-demarches.js') },
    { path: 'cron/ingest-annuaire', match: 'exact', handler: () => import('./_handlers/cron/ingest-annuaire.js') },
    { path: 'cron/backup-db', match: 'exact', handler: () => import('./_handlers/cron/backup-db.js') },
    { path: 'cron/gdpr-purge', match: 'exact', handler: () => import('./_handlers/cron/gdpr-purge.js') },
    { path: 'cron/health-alert', match: 'exact', handler: () => import('./_handlers/cron/health-alert.js') },

    // --- Admin ---
    { path: 'admin/inbox', match: 'exact', handler: () => import('./_handlers/admin/inbox.js') },
    { path: 'admin/actions', match: 'exact', handler: () => import('./_handlers/admin/actions.js') },
    { path: 'admin/runs', match: 'exact', handler: () => import('./_handlers/admin/runs.js') },
    { path: 'admin/cron-runs', match: 'prefix', handler: () => import('./_handlers/admin/cron-runs.js') },
    { path: 'admin/partnerships', match: 'exact', handler: () => import('./_handlers/admin/partnerships.js') },
    { path: 'admin/link-checks', match: 'exact', handler: () => import('./_handlers/admin/link-checks.js') },
    { path: 'admin/validate-publication', match: 'exact', handler: () => import('./_handlers/admin/validate-publication.js') },
    { path: 'admin/content-verification', match: 'exact', handler: () => import('./_handlers/admin/content-verification.js') },
    { path: 'admin/veille', match: 'exact', handler: () => import('./_handlers/admin/veille.js') },   // the owner's digest of the automatic verification
    { path: 'admin/content', match: 'exact', handler: () => import('./_handlers/admin/content.js') },
    { path: 'admin/structure-proposals', match: 'exact', handler: () => import('./_handlers/admin/structure-proposals.js') },
    { path: 'admin/duplicates', match: 'exact', handler: () => import('./_handlers/admin/duplicates.js') },   // D13 duplicate register (owner LAB audit)
    { path: 'admin/dsr-review', match: 'exact', handler: () => import('./_handlers/admin/dsr-review.js') },
    { path: 'admin/dsr-erasure', match: 'exact', handler: () => import('./_handlers/admin/dsr-erasure.js') },
    { path: 'admin/org-closure', match: 'exact', handler: () => import('./_handlers/admin/org-closure.js') },
    { path: 'admin/processing-restrictions', match: 'exact', handler: () => import('./_handlers/admin/processing-restrictions.js') },
    { path: 'admin/organizations', match: 'exact', handler: () => import('./_handlers/admin/organizations.js') },
    { path: 'admin/ws2-queue', match: 'exact', handler: () => import('./_handlers/admin/ws2-queue.js') },
    { path: 'admin/login', match: 'exact', handler: () => import('./_handlers/admin/login.js') },
    { path: 'admin/elevation', match: 'exact', handler: () => import('./_handlers/admin/elevation.js') },
    { path: 'admin/sessions', match: 'exact', handler: () => import('./_handlers/admin/sessions.js') },   // PKG-11 / ADM-10 session revocation + audit
    { path: 'admin/content-versions', match: 'exact', handler: () => import('./_handlers/admin/content-versions.js') },
    { path: 'admin/audit-log', match: 'exact', handler: () => import('./_handlers/admin/audit-log.js') },
    { path: 'admin/platform', match: 'exact', handler: () => import('./_handlers/admin/platform.js') },
    { path: 'admin/privacy', match: 'exact', handler: () => import('./_handlers/admin/privacy.js') },
    { path: 'admin/support', match: 'exact', handler: () => import('./_handlers/admin/support.js') },
    { path: 'admin/data-quality', match: 'exact', handler: () => import('./_handlers/admin/data-quality.js') },
    { path: 'admin/institutions', match: 'exact', handler: () => import('./_handlers/admin/institutions.js') },
    { path: 'admin/falc', match: 'exact', handler: () => import('./_handlers/admin/falc.js') },
    { path: 'admin/ai-oversight', match: 'exact', handler: () => import('./_handlers/admin/ai-oversight.js') },
    { path: 'citizen/profile', match: 'exact', handler: () => import('./_handlers/citizen/profile.js') },
    // launch-readiness item 66: rectification of the contact data (e-mail with a confirmation link to the new address, phone)
    { path: 'citizen/email-change', match: 'exact', handler: () => import('./_handlers/citizen/email-change.js') },
    { path: 'citizen/email-change-confirm', match: 'exact', handler: () => import('./_handlers/citizen/email-change-confirm.js') },
    { path: 'citizen/phone', match: 'exact', handler: () => import('./_handlers/citizen/phone.js') },
    { path: 'citizen/household', match: 'exact', handler: () => import('./_handlers/citizen/household.js') },
    { path: 'citizen/guardians', match: 'exact', handler: () => import('./_handlers/citizen/guardians.js') },   // C05 (R30): minor ↔ legal guardian link
    { path: 'citizen/preferences', match: 'exact', handler: () => import('./_handlers/citizen/preferences.js') },
    { path: 'citizen/push', match: 'exact', handler: () => import('./_handlers/citizen/push.js') },   // R11 / N04: notifications on this device (Web Push)
    { path: 'citizen/shares', match: 'exact', handler: () => import('./_handlers/citizen/shares.js') },
    { path: 'citizen/parcours', match: 'exact', handler: () => import('./_handlers/citizen/parcours.js') },
    { path: 'citizen/favorites', match: 'exact', handler: () => import('./_handlers/citizen/favorites.js') },
    { path: 'citizen/history', match: 'exact', handler: () => import('./_handlers/citizen/history.js') },
    { path: 'citizen/coffre', match: 'exact', handler: () => import('./_handlers/citizen/coffre.js') },
    { path: 'citizen/espace', match: 'exact', handler: () => import('./_handlers/citizen/espace.js') },
    { path: 'citizen/dossier', match: 'exact', handler: () => import('./_handlers/citizen/dossier.js') },
    { path: 'citizen/delegations', match: 'exact', handler: () => import('./_handlers/citizen/delegations.js') },
    { path: 'citizen/referrals', match: 'exact', handler: () => import('./_handlers/citizen/referrals.js') },
    { path: 'citizen/restriction', match: 'exact', handler: () => import('./_handlers/citizen/restriction.js') },
    { path: 'admin/review-queue', match: 'prefix', handler: () => import('./_handlers/admin/review-queue.js') },
    { path: 'admin/stats', match: 'exact', handler: () => import('./_handlers/admin/stats.js') },
    { path: 'admin/national-stats', match: 'exact', handler: () => import('./_handlers/admin/national-stats.js') },
    { path: 'admin/features', match: 'exact', handler: () => import('./_handlers/admin/features.js') },
    { path: 'admin/rag-health', match: 'exact', handler: () => import('./_handlers/admin/rag-health.js') },
    { path: 'admin/conversations', match: 'exact', handler: () => import('./_handlers/admin/conversations.js') },
    { path: 'admin/analytics', match: 'exact', handler: () => import('./_handlers/admin/analytics.js') },
    { path: 'admin/hive-repair', match: 'exact', handler: () => import('./_handlers/admin/hive-repair.js') },
    { path: 'admin/bulk-repair', match: 'exact', handler: () => import('./_handlers/admin/bulk-repair.js') },
    { path: 'admin/mfa-setup', match: 'exact', handler: () => import('./_handlers/admin/mfa-setup.js') },
    { path: 'admin/mfa-verify', match: 'exact', handler: () => import('./_handlers/admin/mfa-verify.js') },
    { path: 'admin/ai-metrics', match: 'exact', handler: () => import('./_handlers/admin/ai-metrics.js') },
    { path: 'admin/alerts', match: 'exact', handler: () => import('./_handlers/admin/alerts.js') },
    { path: 'admin/logs', match: 'exact', handler: () => import('./_handlers/admin/logs.js') },
    { path: 'admin/dashboard', match: 'exact', handler: () => import('./_handlers/admin/dashboard.js') },
    { path: 'admin/orchestrator', match: 'exact', handler: () => import('./_handlers/admin/orchestrator.js') },

    // --- Share ---
    // PUB-6: the byte-pinned create.js, behind a per-address rate limit
    { path: 'share/create', match: 'exact', handler: () => Promise.all([import('./_handlers/share/create.js'), import('./_utils/share-create-limit.js')]).then(([m, l]) => ({ default: l.withShareCreateLimit(m.default) })) },
    { path: 'share/get', match: 'exact', handler: () => import('./_handlers/share/get.js') },
    { path: 'share/thread', match: 'exact', handler: () => import('./_handlers/share/thread.js') },

    // --- Assistant ---
    { path: 'assistant/feedback', match: 'exact', handler: () => import('./_handlers/assistant/feedback.js') },

    // --- Phase 2: E2EE Messaging & Outlook ---
    { path: 'secure-messages', match: 'exact', handler: () => import('./_handlers/secure-messages.js') },
    { path: 'auth/callback/outlook', match: 'exact', handler: () => import('./_handlers/auth/outlook-callback.js') },

    // --- Documentation ---
    { path: 'docs/openapi.json', match: 'exact', handler: () => import('./_handlers/openapi.js') },
];
