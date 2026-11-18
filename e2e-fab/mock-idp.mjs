#!/usr/bin/env node
/**
 * FA-CAP — the LAB identity providers of the suite in their OWN process (the runner blocks while Playwright runs, so an in-process mock could not answer):
 * local mock OpenID Connect issuers from scripts/lab/mock-franceconnect.mjs (NOT FranceConnect / ProConnect: synthetic identities, loopback only,
 * auto-approval). FAB_MOCKS = JSON [{ port, sub, email, clientId?, clientSecret? }]. Prints one JSON line per issuer, then « ready ».
 */
import { startMockFranceConnect } from '../scripts/lab/mock-franceconnect.mjs';

const list = JSON.parse(process.env.FAB_MOCKS || '[]');
const mocks = [];
for (const m of list) {
  if (Number(m.port) === 3000) throw new Error('port 3000 is the owner LAB');
  const mock = await startMockFranceConnect(m);
  mocks.push(mock);
  console.log(JSON.stringify({ issuer: mock.issuer, clientId: mock.clientId }));
}
console.log('ready');
const stop = async () => { for (const m of mocks) await m.close(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
