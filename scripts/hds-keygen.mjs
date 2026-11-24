#!/usr/bin/env node
/**
 * G14-R3 — generates the ticket key pair of the HDS gateway (P-256). OWNER-RUN, once (and at each rotation).
 *   node scripts/hds-keygen.mjs <kid> <private-key-output-file>
 * Writes the PRIVATE key (base64 PKCS#8 DER, for Vercel HDS_TICKET_PRIVATE_KEY) into the file with mode 0600 — never printed.
 * Prints the PUBLIC value for the HDS app: HDS_TICKET_PUBLIC_KEYS=<kid>:<base64 SPKI DER> (not a secret).
 */
import fs from 'node:fs';
import { generateTicketKeyPair, TICKET_KID_FORMAT } from '../api/lib/hds-ticket.js';

const [kid, out] = process.argv.slice(2);
if (!kid || !TICKET_KID_FORMAT.test(kid) || !out) { console.error('usage: node scripts/hds-keygen.mjs <kid> <private-key-output-file>'); process.exit(2); }
if (fs.existsSync(out)) { console.error(`refused: ${out} exists (never overwrite a key)`); process.exit(2); }
const k = generateTicketKeyPair();
fs.writeFileSync(out, k.privateKeyB64, { mode: 0o600, flag: 'wx' });
console.log(`private key written to ${out} (mode 0600) — set it as Vercel HDS_TICKET_PRIVATE_KEY, with HDS_TICKET_KID=${kid}`);
console.log(`HDS_TICKET_PUBLIC_KEYS=${kid}:${k.publicKeyB64}`);
