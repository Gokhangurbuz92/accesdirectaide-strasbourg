import logger from '../../_utils/logger.js';
import { randomUUID } from 'crypto';

import { env } from '../../_utils/env.js';
import { applyNoIndex } from '../../_utils/robots.js';
import Sentry from '../../_utils/sentry.js';
import { getProRdvReadiness, REQUIRED_PRO_RDV_TABLES } from '../../_utils/pro-rdv-readiness.js';

/**
 * Public monitor endpoint for pro RDV schema readiness.
 *
 * - 200 when required Pro RDV tables are present.
 * - 503 otherwise.
 *
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  const requestId = typeof req.requestId === 'string' ? req.requestId : randomUUID();
  const checkedAt = new Date().toISOString();
  const runtimeEnv = env.runtime.vercelEnv || env.runtime.nodeEnv || 'development';

  res.setHeader('x-request-id', requestId);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  applyNoIndex(res);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', requestId });
  }

  try {
    const readiness = await getProRdvReadiness();
    const ok = readiness.ok;

    if (!ok) {
      logger.warn(
        {
          requestId,
          route: 'monitor/pro-rdv',
          missingTables: readiness.missingTables,
          env: runtimeEnv,
        },
        'monitor.pro_rdv.not_ready',
      );
    }

    // Return 200 even when not ready — the `ok: false` flag indicates schema is not deployed.
    // 503 should be reserved for runtime errors in the catch block below.
    return res.status(200).json({
      ok,
      missingTables: readiness.missingTables,
      checkedAt,
      env: runtimeEnv,
      requestId,
      ...(ok ? {} : { status: 'schema_not_deployed' }),
    });
  } catch (error) {
    logger.warn(
      {
        requestId,
        route: 'monitor/pro-rdv',
        env: runtimeEnv,
      },
      'monitor.pro_rdv.error',
    );

    try {
      Sentry.captureException(error, {
        tags: {
          module: 'rdv',
          surface: 'monitor',
          handler: 'monitor/pro-rdv',
          requestId,
          route: 'monitor/pro-rdv',
          'http.method': 'GET',
          'http.status_code': '503',
        },
      });
      await Sentry.flush(1500);
    } catch {
      // best-effort
    }

    return res.status(503).json({
      ok: false,
      missingTables: [...REQUIRED_PRO_RDV_TABLES],
      checkedAt,
      env: runtimeEnv,
      requestId,
      error: 'unavailable',
    });
  }
}
