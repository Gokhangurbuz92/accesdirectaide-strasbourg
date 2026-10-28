// @ts-nocheck
/**
 * PKG-10 / P24 — public status: what a person can rely on right now, in plain French, WITHOUT internals (no host, version, count, threshold, error text).
 *   GET /api/status → { checkedAt, components: [{ id, label, state, text }] }   state ∈ operational | degraded | unavailable | info
 * Components are real dependencies, each checked here with a short time limit:
 *   - comptes : the database answers (SELECT 1)                      → accounts, appointments, dossier sharing
 *   - emails  : the mail configuration (no message is sent)          → only resend / mailjet with credentials count as real delivery; « test » is said to be a test
 *   - assistant : the LOCAL model server answers on loopback (/api/tags, 1.5 s); an external endpoint is never contacted and counts as unavailable (AI policy)
 *   - donnees : the WS2 launch manifest — while launchReady is false the aid records are « en cours de vérification » (never « vérifiées »)
 * Cached 30 s in memory so the page cannot be used to load the database.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { getMailerStatus } from '../_utils/mailer.js';
import { AIProviderPolicy, LOCALITY } from '../lib/ai-policy.js';

const TTL_MS = 30000;
let cache = null;
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), ms).unref?.())]);

async function database() {
  try { await withTimeout(db.execute(sql`SELECT 1`), 2000); return { state: 'operational', text: 'Les comptes, les rendez-vous et le partage de dossier fonctionnent.' }; }
  catch { return { state: 'unavailable', text: 'Les comptes, les rendez-vous et le partage de dossier sont indisponibles pour le moment.' }; }
}
function emails() {
  const m = getMailerStatus();
  if (m.deliverable && (m.provider === 'resend' || m.provider === 'mailjet')) return { state: 'operational', text: 'Les e-mails (confirmation, rappels) sont envoyés.' };
  if (m.provider === 'test') return { state: 'degraded', text: 'Environnement de test : aucun e-mail réel n\'est envoyé.' };
  return { state: 'unavailable', text: 'L\'envoi des e-mails n\'est pas configuré : les confirmations par e-mail ne partent pas.' };
}
async function assistant() {
  const endpoint = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  if (AIProviderPolicy.classifyLocality(endpoint) !== LOCALITY.LOCAL_LOOPBACK) return { state: 'unavailable', text: 'L\'assistant est indisponible.' };
  try {
    const r = await withTimeout(fetch(new URL('/api/tags', endpoint)), 1500);
    return r.ok ? { state: 'operational', text: 'L\'assistant répond (modèle exécuté par AccesDirectAide, aucun service externe).' } : { state: 'unavailable', text: 'L\'assistant est indisponible.' };
  } catch { return { state: 'unavailable', text: 'L\'assistant est indisponible : le reste du site fonctionne sans lui.' }; }
}
function donnees() {
  let ready = false;
  try { ready = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/strasbourg/ws2-source-manifest.json'), 'utf8')).launchReady === true; } catch { ready = false; }
  // launch-readiness item 46 (D-5 v2): the records are checked automatically against their official sources — never presented as a person's review
  return ready ? { state: 'operational', text: 'Les fiches publiées sont vérifiées automatiquement à partir de leurs sources officielles.' }
    : { state: 'info', text: 'Les fiches d\'aides et de structures sont en cours de vérification automatique à partir de leurs sources officielles : vérifiez toujours auprès de l\'organisme.' };
}

export async function computeStatus() {
  const [c, a] = await Promise.all([database(), assistant()]);
  return {
    checkedAt: new Date().toISOString(),
    components: [
      { id: 'site', label: 'Site', state: 'operational', text: 'Le site répond.' },
      { id: 'comptes', label: 'Comptes et rendez-vous', ...c },
      { id: 'emails', label: 'E-mails', ...emails() },
      { id: 'assistant', label: 'Assistant', ...a },
      { id: 'donnees', label: 'Informations sur les aides', ...donnees() },
    ],
  };
}

export default async function handler(req, res) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' });
  if (!cache || Date.now() - cache.at > TTL_MS) cache = { at: Date.now(), body: await computeStatus() };
  return res.status(200).json(cache.body);
}

/** tests only */
export const _resetStatusCache = () => { cache = null; };
