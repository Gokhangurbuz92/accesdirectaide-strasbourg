-- PKG-11 / C22: the consent ledger is append-only, like ProCaseEvent / ReferralEvent (0022, same function). A recorded decision (grant or withdrawal, its policy
-- version, channel and proof level) can never be rewritten: a change of mind is a NEW row. Deletion stays governed by the retention job, which never deletes
-- the latest decision of a subject / purpose.
CREATE TRIGGER "ConsentLog_append_only" BEFORE UPDATE ON "ConsentLog" FOR EACH ROW EXECUTE FUNCTION "ada_append_only"();
