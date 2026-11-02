#!/usr/bin/env node
/**
 * R38 — ONE real test e-mail through the configured provider, run by the owner on their own machine once the provider account exists:
 *   MAILER_PROVIDER=resend MAILER_FROM='AccesDirectAide <contact@accesdirectaide.fr>' MAILER_API_KEY=… node scripts/mail-provider-check.mjs --to <your address> --confirm
 * (type the key into your own shell or load it from your password manager; never paste it in a chat, a file of the repository or a ticket).
 * It sends through the site's own adapter (api/_utils/mailer.js: retries, idempotency key) and prints only the outcome — PROVIDER_ACCEPTED means the provider
 * took the message, not that it reached the inbox: check the inbox (and the spam folder) yourself. Refuses noop/test, a missing --to or --confirm.
 * Nothing about the key is printed. Sending does not touch the MX records: contact@accesdirectaide.fr keeps receiving through Microsoft 365.
 */
import { getMailerStatus, sendMail } from '../api/_utils/mailer.js';
const arg = (n) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : null);
const to = arg('to');
const status = getMailerStatus();
if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || !process.argv.includes('--confirm')) { console.error('usage: … --to <address> --confirm'); process.exit(2); }
if (!status.deliverable || ['noop', 'test'].includes(status.provider)) { console.error(`MAIL_CHECK NOT_READY ${JSON.stringify({ provider: status.provider, reason: status.reason })}`); process.exit(1); }
const r = await sendMail({ to, subject: 'AccesDirectAide — test du service d’envoi', category: 'ops-alert',
  text: `Message de test envoyé le ${new Date().toISOString()} par scripts/mail-provider-check.mjs. Si vous le lisez, l’envoi des e-mails du site fonctionne.` }).catch((e) => ({ outcome: 'ERROR', error: String(e?.name || 'error') }));
console.log(`MAIL_CHECK ${JSON.stringify({ provider: status.provider, outcome: r.outcome, ...(r.error ? { error: r.error } : {}) })}`);
process.exit(r.outcome === 'PROVIDER_ACCEPTED' ? 0 : 1);
