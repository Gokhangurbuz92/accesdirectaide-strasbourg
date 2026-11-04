#!/usr/bin/env node
/**
 * R43-MAIL — one genuine Mailjet check WITHOUT delivering anything: Mailjet validates the key, the sender (domain), the Reply-To and the message
 * (SandboxMode, forced on here whatever the environment says) and answers as for a real send; nothing reaches any mailbox.
 *
 *   MAILER_PROVIDER=mailjet MAILER_API_KEY=… MAILER_FROM=… [MAILER_REPLY_TO=…] node scripts/mail-sandbox-check.mjs <test-address@example.org>
 *   (or after `vercel env pull .env.mailcheck --environment=preview`: `node --env-file=.env.mailcheck scripts/mail-sandbox-check.mjs …`, then delete the file)
 *
 * Prints the readiness (variable names and states only) and the outcome / error code — never a key, never the address. Exit 0 only for SANDBOX_VALIDATED.
 */
process.env.MAILER_MAILJET_SANDBOX = '1';
process.env.MAILER_EVENTS_ENABLED = '';   // no suppression lookup (no database needed)

/** @param {string[]} argv @param {{ log?: (s: string) => void }} [io] */
export async function runSandboxCheck(argv, io = {}) {
  const log = io.log || ((s) => process.stdout.write(`${s}\n`));
  const { mailerReadiness, sendMail } = await import('../api/_utils/mailer.js');
  const r = mailerReadiness(process.env);
  log(`readiness: provider=${r.provider} mode=${r.mode} missing=${r.missing.join(',') || 'none'} replyTo=${r.replyTo}`);
  if (r.provider !== 'mailjet') { log('refused: MAILER_PROVIDER must be mailjet'); return 2; }
  if (r.missing.length) { log('refused: variables missing'); return 2; }
  const to = String(argv[0] || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(to)) { log('usage: node scripts/mail-sandbox-check.mjs <test-address>'); return 2; }
  const out = await sendMail({ to, subject: 'Test technique (non envoyé) - Accès Direct Aide', text: 'Test SandboxMode : ce message n’est remis à personne.', category: 'sandbox-check' });
  log(`outcome=${out.outcome}${out.errorCode ? ` errorCode=${out.errorCode}` : ''}${out.providerStatus ? ` status=${out.providerStatus}` : ''}${out.failure ? ` failure=${out.failure}` : ''}`);
  return out.outcome === 'SANDBOX_VALIDATED' ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSandboxCheck(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { process.stdout.write(`error: ${err?.name || 'Error'}\n`); process.exitCode = 1; });
}
