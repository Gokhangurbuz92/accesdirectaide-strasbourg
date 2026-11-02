-- R39: the OPTIONAL J-1 reminder of an account-free (« sans compte ») booking. One nullable column: the moment the person ticked the separate, never
-- pre-ticked box (or turned the reminder on from their personal link); NULL = no reminder (never ticked, or withdrawn). Additive only: no existing row or
-- column changes, no default, no index. Independent of "guestMailConsentAt" (the booking mails).
ALTER TABLE "ProAppointment" ADD COLUMN "guestReminderConsentAt" timestamp (3);
