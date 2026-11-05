#!/usr/bin/env node
/**
 * R46 (N01 / N02 / N06 / B10) — offline verification of the appointment communication channels: e-mail, SMS, video, connected calendar.
 * No network, no database, no provider call, no message sent. It applies the adapters' own readiness rules to the current environment and prints, per
 * channel, the state (OFF / TEST / SANDBOX / INCOMPLETE / BLOCKED / CONFIGURED), the reason code and the NAMES of missing variables — never a value.
 *
 *   node scripts/channels-check.mjs                 print the four lines (exit 0)
 *   node scripts/channels-check.mjs --json          the same as JSON
 *   node scripts/channels-check.mjs --expect-silent exit 1 if any channel could reach a person (LAB / release guard: nothing must be sent)
 *
 * CONFIGURED never means « verified »: a real provider check is an owner step (scripts/mail-sandbox-check.mjs for Mailjet SandboxMode; the Microsoft app
 * registration for Outlook; a Jitsi deployment for video; a routed STOP webhook for SMS).
 */
/** @param {string[]} argv @param {{ log?: (s: string) => void, env?: Record<string, string | undefined> }} [io] */
export async function runChannelsCheck(argv, io = {}) {
  const log = io.log || ((s) => process.stdout.write(`${s}\n`));
  const env = io.env || process.env;
  const { channelStatuses } = await import('../api/lib/communication-channels.js');
  const rows = channelStatuses(env);
  if (argv.includes('--json')) log(JSON.stringify(rows));
  else for (const r of rows) log(`${r.channel.padEnd(9)} state=${r.state} provider=${r.provider} reason=${r.reason || 'none'} missing=${r.missing.join(',') || 'none'} reachesPeople=${r.reachesPeople ? 'yes' : 'no'}`);
  if (argv.includes('--expect-silent') && rows.some((r) => r.reachesPeople)) { log('FAIL: a channel could reach a person'); return 1; }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runChannelsCheck(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { process.stdout.write(`error: ${err?.name || 'Error'}\n`); process.exitCode = 1; });
}
