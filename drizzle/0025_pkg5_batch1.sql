-- PKG-5: e-mail / SMS ledgers distinguish "a real provider ACCEPTED the request" (PROVIDER_ACCEPTED) from a confirmed delivery; DELIVERED stays valid for
-- in-app notices and older rows (it is never written for e-mail / SMS any more).
ALTER TABLE "AppointmentNotice" DROP CONSTRAINT "AppointmentNotice_status_check";--> statement-breakpoint
ALTER TABLE "AppointmentNotice" ADD CONSTRAINT "AppointmentNotice_status_check" CHECK ("status" IN ('DELIVERED', 'PROVIDER_ACCEPTED', 'TEST_RECORDED', 'NOT_DELIVERED', 'NO_CONSENT', 'NO_RECIPIENT', 'FAILED'));--> statement-breakpoint
ALTER TABLE "ParcoursReminder" DROP CONSTRAINT "ParcoursReminder_status_check";--> statement-breakpoint
ALTER TABLE "ParcoursReminder" ADD CONSTRAINT "ParcoursReminder_status_check" CHECK ("status" IN ('CLAIMED', 'DELIVERED', 'PROVIDER_ACCEPTED', 'TEST_RECORDED', 'NOT_DELIVERED', 'NO_CONSENT', 'FAILED'));
