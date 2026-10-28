import logger from '../_utils/logger.js';
import { randomUUID } from 'crypto';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { db } from '../../src/db/index.js';
import { sql } from 'drizzle-orm';
import { env } from '../_utils/env.js';
import { LocalFilesystemStorage } from '../lib/LocalFilesystemStorage.js';
import { verifyAdmin } from '../_utils/auth.js';
import { getCronAuth } from '../_utils/cronAuth.js';
import { getActualitesCronFreshness } from '../_utils/cron-freshness.js';
import { kv } from '../_utils/kv.js';
import Sentry from '../_utils/sentry.js';
import { evaluateReleasePreflight } from '../../scripts/release-preflight.mjs';

const TIMEOUT_MS = 2000;

function isProdLike() {
  return env.runtime.vercelEnv === 'production' || env.runtime.vercelEnv === 'preview';
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label}_timeout`));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(t);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(t);
        reject(err);
      });
  });
}

async function checkDb() {
  const start = Date.now();
  try {
    await withTimeout(db.execute(sql`SELECT 1`), TIMEOUT_MS, 'db');
    return { ok: true, durationMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = message.includes('timeout') ? 'timeout' : 'query_failed';
    return { ok: false, durationMs: Date.now() - start, detail };
  }
}

/**
 * R13: the official territory reference (scripts/geo-load.mjs) is data the product cannot work without — with 0 communes the assistant recognises no
 * commune and the territory filter matches nothing (found in the owner LAB, 26/10). Counted here; a missing reference is a release blocker for the
 * administrator (config.failing), not an outage.
 */
async function checkTerritoryReference() {
  try {
    const r = await withTimeout(db.execute(sql`SELECT count(*) FILTER (WHERE type = 'COMMUNE')::int AS communes, count(*) FILTER (WHERE type = 'EPCI')::int AS epcis FROM "Territory"`), TIMEOUT_MS, 'territory');
    const row = (r?.rows || r || [])[0] || {};
    const communes = Number(row.communes || 0); const epcis = Number(row.epcis || 0);
    return { ok: communes > 0, communes, epcis };
  } catch {
    return { ok: false, communes: null, epcis: null, detail: 'query_failed' };
  }
}

/**
 * @param {string} requestId
 */
async function checkKv(requestId) {
  const start = Date.now();
  const configured = Boolean(env.kv.url && env.kv.token);

  if (!configured) {
    if (isProdLike()) {
      return { ok: false, durationMs: 0, detail: 'not_configured' };
    }
    return { ok: 'skipped', durationMs: 0, detail: 'not_configured' };
  }

  try {
    const testKey = `health:deep:${requestId}`;
    await withTimeout(kv.set(testKey, 'ok', { ex: 10 }), TIMEOUT_MS, 'kv_set');
    const value = await withTimeout(kv.get(testKey), TIMEOUT_MS, 'kv_get');
    await withTimeout(kv.del(testKey), TIMEOUT_MS, 'kv_del');

    const ok = value === 'ok';
    return { ok, durationMs: Date.now() - start, detail: ok ? undefined : 'unexpected_value' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = message.includes('timeout') ? 'timeout' : 'request_failed';
    return { ok: false, durationMs: Date.now() - start, detail };
  }
}

async function checkStorage() {
  const start = Date.now();
  const localDir = env.storage.localDir;

  if (localDir) {
    try {
      const localStorage = new LocalFilesystemStorage(localDir);
      await withTimeout(
        localStorage.healthCheck(),
        TIMEOUT_MS,
        'storage_local_filesystem',
      );

      return {
        ok: true,
        durationMs: Date.now() - start,
        detail: 'local_filesystem',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const detail = message.includes('timeout')
        ? 'timeout'
        : 'local_filesystem_failed';

      return {
        ok: false,
        durationMs: Date.now() - start,
        detail,
      };
    }
  }

  const endpoint = env.storage.endpoint;
  const bucket = env.storage.bucket;
  const accessKeyId = env.storage.accessKeyId;
  const secretAccessKey = env.storage.secretAccessKey;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return { ok: 'skipped', durationMs: 0, detail: 'not_configured' };
  }

  try {
    const client = new S3Client({
      region: env.storage.region,
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true,
    });

    await withTimeout(
      client.send(
        new HeadBucketCommand({
          Bucket: bucket,
        }),
      ),
      TIMEOUT_MS,
      'storage_head_bucket',
    );

    return { ok: true, durationMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = message.includes('timeout') ? 'timeout' : 'request_failed';
    return { ok: false, durationMs: Date.now() - start, detail };
  }
}

/**
 * Deep health endpoint (protected): checks DB/KV/Storage with strict timeouts.
 *
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = typeof req.requestId === 'string' ? req.requestId : randomUUID();
  res.setHeader('x-request-id', requestId);
  res.setHeader('Cache-Control', 'no-store');

  const cronConfigured = Boolean(env.secrets.cronSecret);
  // owner LAB audit (2026-10-25): a named administrator session is checked whatever the configuration of the retired legacy ADMIN_TOKEN (verifyAdmin accepts
  // that token only where it is still allowed). Before, with no legacy token, a signed-in administrator got 401 and the Observability page showed
  // « Impossible de charger /api/health/deep »; with neither secret it answered 500 « No health auth configured ».
  const isAdmin = await verifyAdmin(req);
  const isCron = cronConfigured ? getCronAuth(req).ok : false;
  if (!isAdmin && !isCron) {
    return res.status(401).json({ error: 'Unauthorized', requestId });
  }

  const dbCheck = await checkDb();
  const kvCheck = await checkKv(requestId);
  const storage = await checkStorage();
  const cronActualites = await getActualitesCronFreshness();
  const territoryReference = dbCheck.ok ? await checkTerritoryReference() : { ok: false, communes: null, epcis: null, detail: 'db_unavailable' };
  const cronHardFail = cronActualites.state === 'error';

  const geminiKeyPresent = Boolean(env.ai.geminiKey);

  const overallOk =
    dbCheck.ok === true &&
    (kvCheck.ok === true || kvCheck.ok === 'skipped') &&
    (storage.ok === true || storage.ok === 'skipped') &&
    !cronHardFail;

  // launch-readiness campaign (item 43): a signed-in administrator also sees which production prerequisites are missing — the check ids only, never a value
  // (the cron caller does not get them). It does not change `ok`: a missing prerequisite is a release blocker, not an outage.
  const failing = isAdmin ? [...evaluateReleasePreflight(process.env).filter((r) => r.status === 'FAIL').map((r) => r.id), ...(territoryReference.ok ? [] : ['TERRITORY_REFERENCE_MISSING'])] : null;

  const payload = {
    ok: overallOk,
    ...(failing ? { config: { productionReady: failing.length === 0, failing } } : {}),
    requestId,
    deps: {
      db: dbCheck,
      kv: kvCheck,
      storage,
      territoryReference,
      cron: {
        actualites: cronActualites,
      },
      geminiKeyPresent,
      mailer: {
        provider: String(env.mailer?.provider || 'noop'),
        fromPresent: Boolean(env.mailer?.from),
      },
      sentry: {
        dsnPresent: Boolean(env.sentry.dsn),
        environment: env.runtime.vercelEnv,
        release: env.sentry.release,
      },
    },
  };

  if (!overallOk) {
    logger.warn(
      {
        requestId,
        db: dbCheck.ok,
        kv: kvCheck.ok,
        storage: storage.ok,
        cronActualitesState: cronActualites.state,
      },
      'health.deep.failed',
    );

    try {
      Sentry.captureMessage('health.deep.failed', {
        level: 'warning',
        tags: {
          requestId,
          route: 'health/deep',
        },
      });
      await Sentry.flush(2000);
    } catch {
      // best-effort
    }
  }

  if (req.method === 'HEAD') {
    res.status(overallOk ? 200 : 503).end();
    return;
  }

  return res.status(overallOk ? 200 : 503).json(payload);
}
