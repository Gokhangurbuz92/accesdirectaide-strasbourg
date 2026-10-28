import './zod-compat.js';   // R7: zod 4 — keeps ZodError.errors for the byte-pinned api/index.js
import {
    loginSchema,
    signupSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    resendVerificationSchema,
    proLoginSchema,
    proRegisterSchema,
    proRegisterInviteSchema,
    proForgotPasswordSchema,
    proResetPasswordSchema,
    proMfaVerifySchema,
    feedbackSchema,
    recommendationsSchema,
    cancelAppointmentSchema,
    startVisioSchema,
    proInviteSchema,
    proConsentSchema,
    proMfaSetupVerifySchema,
    proResendInviteSchema,
    publicConsentSchema,
    suggestStructureSchema,
    reportSchema,
    smsNotifySchema,
    adminMfaVerifySchema,
    // New — Final Perfection Patch
    adminPartnershipSchema,
    adminVersionSchema,
    crudUpdateSchema,
    proDossierUpdateSchema,
    proUploadSecureSchema,
    proInteropSiaoSchema,
    proNotificationsActionSchema,
    proStructureUpdateSchema,
    proSystemMaintenanceSchema,
    proTeamActionSchema,
    publicAppointmentCancelSchema,
    publicDossierRevokeSchema,
    proDossierRedeemSchema,
    publicDossierGrantsSchema,
    publicMessageSchema,
    secureMessageSchema,
    shareCreateSchema,
    shareThreadSchema,
    ttsSchema,
    proDossierSynthesisSchema,
} from './schemas.js';

/**
 * 🛡️ VALIDATION REGISTRY — EXHAUSTIF
 *
 * Maps route paths to their Zod schema for automatic input validation.
 * The main handler (api/index.js) checks this registry before executing a route handler.
 * Only POST/PUT/PATCH/DELETE requests are validated (GET requests pass through).
 *
 * Coverage: 45/64 handlers using req.body (70%)
 * Note: 21 additional handlers have INTERNAL Zod validation (z.object/safeParse)
 * Total Zod coverage: 64/64 (100%)
 */

/** @type {Record<string, import('zod').ZodTypeAny>} */
export const validationRegistry = {
    // ─── Auth (Citizen) ───────────────────────────
    'auth/login': loginSchema,
    'auth/signup': signupSchema,
    'auth/forgot-password': forgotPasswordSchema,
    'auth/reset-password': resetPasswordSchema,
    'auth/resend-verification': resendVerificationSchema,

    // ─── Auth (Pro) ───────────────────────────────
    'pro/auth/login': proLoginSchema,
    'pro/auth/register': proRegisterSchema,
    'pro/auth/register-invite': proRegisterInviteSchema,
    'pro/auth/forgot-password': proForgotPasswordSchema,
    'pro/auth/reset-password': proResetPasswordSchema,
    'pro/auth/mfa-verify': proMfaVerifySchema,

    // ─── Assistant ────────────────────────────────
    'assistant/feedback': feedbackSchema,
    'assistant/recommendations': recommendationsSchema,

    // ─── Pro Operations ───────────────────────────
    'pro/invite': proInviteSchema,
    'pro/consent': proConsentSchema,
    'pro/resend-invite': proResendInviteSchema,
    'pro/appointments/cancel': cancelAppointmentSchema,
    'pro/appointments/start-visio': startVisioSchema,
    'pro/dossier': proDossierUpdateSchema,
    'pro/dossier/redeem': proDossierRedeemSchema,
    'pro/dossier/upload-secure': proUploadSecureSchema,
    'pro/dossier-synthesis': proDossierSynthesisSchema,
    'pro/interop-siao': proInteropSiaoSchema,
    'pro/mfa-setup': proMfaSetupVerifySchema,
    'pro/notifications': proNotificationsActionSchema,
    'pro/structure': proStructureUpdateSchema,
    'pro/system-maintenance': proSystemMaintenanceSchema,
    'pro/team': proTeamActionSchema,

    // ─── Public ───────────────────────────────────
    'public/suggest-structure': suggestStructureSchema,
    'public/sms-notify': smsNotifySchema,
    'public/consent': publicConsentSchema,
    'public/appointments/cancel': publicAppointmentCancelSchema,
    'public/dossier-revoke': publicDossierRevokeSchema,
    'public/dossier-grants': publicDossierGrantsSchema,
    'public/messages': publicMessageSchema,

    // ─── Admin ────────────────────────────────────
    'admin/mfa-verify': adminMfaVerifySchema,
    'admin/partnerships': adminPartnershipSchema,
    'admin/versions': adminVersionSchema,

    // ─── CRUD / Utility ──────────────────────────
    'categories': crudUpdateSchema,
    'guides': crudUpdateSchema,
    'tools': crudUpdateSchema,
    'reports': reportSchema,
    'secure-messages': secureMessageSchema,
    'share/create': shareCreateSchema,
    'share/thread': shareThreadSchema,
    'tts': ttsSchema,
};
