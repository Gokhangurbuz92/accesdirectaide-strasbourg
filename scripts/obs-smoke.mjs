#!/usr/bin/env node

import { fetch } from 'undici';

class UsageError extends Error {}

/**
 * @param {string} value
 * @returns {string}
 */
function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

/**
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function getEnvOrDefault(name, fallback) {
  const raw = process.env[name];
  if (typeof raw === 'string' && raw.trim()) return trimTrailingSlash(raw.trim());
  return trimTrailingSlash(fallback);
}

/**
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function getIntEnvOrDefault(name, fallback) {
  const raw = process.env[name];
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * @param {string[]} argv
 * @returns {{ json: boolean, baseUrl: string | null }}
 */
function parseArgs(argv) {
  /** @type {{ json: boolean, baseUrl: string | null }} */
  const out = { json: false, baseUrl: null };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    if (arg === '--base-url') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new UsageError('Missing value for --base-url');
      }
      out.baseUrl = trimTrailingSlash(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--base-url=')) {
      const value = arg.slice('--base-url='.length);
      if (!value.trim()) throw new UsageError('Missing value for --base-url');
      out.baseUrl = trimTrailingSlash(value);
      continue;
    }
    throw new UsageError(`Unknown argument: ${arg}`);
  }

  return out;
}

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeHeader(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 */
async function getJson(url, timeoutMs) {
  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(timeoutMs),
  });

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  return { response, json };
}

/**
 * @param {boolean} jsonMode
 */
function createReporter(jsonMode) {
  /** @type {Array<{ name: string, ok: boolean, critical: boolean, message: string, status?: number | null, details?: Record<string, unknown> }>} */
  const checks = [];

  /**
   * @param {string} name
   * @param {{ ok: boolean, critical?: boolean, message: string, status?: number | null, details?: Record<string, unknown> }} result
   */
  function record(name, result) {
    const entry = {
      name,
      ok: result.ok,
      critical: result.critical !== false,
      message: result.message,
      status: result.status ?? null,
      details: result.details || {},
    };
    checks.push(entry);

    if (!jsonMode) {
      const prefix = entry.ok ? '✅' : (entry.critical ? '❌' : '⚠️');
      const suffix = entry.status == null ? '' : ` (HTTP=${entry.status})`;
      const line = `${prefix} ${entry.message}${suffix}`;
      if (entry.ok || !entry.critical) console.log(line);
      else console.error(line);
    }
  }

  return { record, checks };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prodUrl = trimTrailingSlash(args.baseUrl || getEnvOrDefault('PROD_URL', 'https://www.accesdirectaide.fr'));
  const timeoutMs = getIntEnvOrDefault('TIMEOUT_MS', 8000);
  const cronSecret = typeof process.env.CRON_SECRET === 'string' && process.env.CRON_SECRET.trim()
    ? process.env.CRON_SECRET.trim()
    : null;

  const reporter = createReporter(args.json);
  if (!args.json) {
    console.log(`[obs-smoke] PROD_URL=${prodUrl}`);
    console.log(`[obs-smoke] TIMEOUT_MS=${timeoutMs}`);
  }

  // 1) core monitor (strict)
  try {
    const { response, json } = await getJson(`${prodUrl}/api/monitor/core`, timeoutMs);
    if (response.status !== 200) {
      reporter.record('monitor.core', {
        ok: false,
        message: '/api/monitor/core expected 200',
        status: response.status,
      });
    } else if (!json || typeof json !== 'object' || json.ok !== true) {
      reporter.record('monitor.core', {
        ok: false,
        message: '/api/monitor/core payload invalid',
        status: response.status,
      });
    } else {
      reporter.record('monitor.core', {
        ok: true,
        message: '/api/monitor/core contract OK',
        status: response.status,
      });
    }
  } catch {
    reporter.record('monitor.core', {
      ok: false,
      message: '/api/monitor/core request failed',
    });
  }

  // 2) cron freshness monitor (200 fresh / 503 degraded accepted)
  try {
    const { response, json } = await getJson(`${prodUrl}/api/monitor/cron/actualites`, timeoutMs);
    const state = json && typeof json === 'object' ? String(json.state || 'unknown') : 'unknown';
    if (response.status !== 200 && response.status !== 503) {
      reporter.record('monitor.cronActualites', {
        ok: false,
        message: '/api/monitor/cron/actualites unexpected status',
        status: response.status,
        details: { state },
      });
    } else if (response.status === 503) {
      reporter.record('monitor.cronActualites', {
        ok: true,
        critical: false,
        message: '/api/monitor/cron/actualites degraded',
        status: response.status,
        details: { state },
      });
    } else {
      reporter.record('monitor.cronActualites', {
        ok: true,
        message: '/api/monitor/cron/actualites fresh',
        status: response.status,
        details: { state },
      });
    }
  } catch {
    reporter.record('monitor.cronActualites', {
      ok: false,
      message: '/api/monitor/cron/actualites request failed',
    });
  }

  // 3) health no-store
  try {
    const response = await fetch(`${prodUrl}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const cacheControl = normalizeHeader(response.headers.get('cache-control'));
    if (response.status !== 200) {
      reporter.record('health.public', {
        ok: false,
        message: '/api/health expected 200',
        status: response.status,
      });
    } else if (!cacheControl.includes('no-store')) {
      reporter.record('health.public', {
        ok: false,
        message: '/api/health missing no-store',
        status: response.status,
      });
    } else {
      reporter.record('health.public', {
        ok: true,
        message: '/api/health cache policy OK',
        status: response.status,
      });
    }
  } catch {
    reporter.record('health.public', {
      ok: false,
      message: '/api/health request failed',
    });
  }

  // 4) data quality monitor (200 or 503 accepted if contract shape is valid)
  try {
    const { response, json } = await getJson(`${prodUrl}/api/monitor/data-quality`, timeoutMs);
    const validShape = Boolean(
      json &&
      typeof json === 'object' &&
      typeof json.ok === 'boolean' &&
      typeof json.requestId === 'string' &&
      json.metrics &&
      json.thresholds,
    );

    if (response.status !== 200 && response.status !== 503) {
      reporter.record('monitor.dataQuality', {
        ok: false,
        message: '/api/monitor/data-quality unexpected status',
        status: response.status,
      });
    } else if (!validShape) {
      reporter.record('monitor.dataQuality', {
        ok: false,
        message: '/api/monitor/data-quality payload invalid',
        status: response.status,
      });
    } else if (response.status === 503) {
      reporter.record('monitor.dataQuality', {
        ok: true,
        critical: false,
        message: '/api/monitor/data-quality degraded',
        status: response.status,
      });
    } else {
      reporter.record('monitor.dataQuality', {
        ok: true,
        message: '/api/monitor/data-quality healthy',
        status: response.status,
      });
    }
  } catch {
    reporter.record('monitor.dataQuality', {
      ok: false,
      message: '/api/monitor/data-quality request failed',
    });
  }

  // 5) ingestion freshness monitor (200 or 503 accepted if contract shape is valid)
  try {
    const { response, json } = await getJson(`${prodUrl}/api/monitor/ingestion-freshness`, timeoutMs);
    const validShape = Boolean(
      json &&
      typeof json === 'object' &&
      typeof json.ok === 'boolean' &&
      typeof json.requestId === 'string' &&
      Object.prototype.hasOwnProperty.call(json, 'latestFetchedAt') &&
      Object.prototype.hasOwnProperty.call(json, 'ageHours') &&
      typeof json.thresholdHours === 'number',
    );

    if (response.status !== 200 && response.status !== 503) {
      reporter.record('monitor.ingestionFreshness', {
        ok: false,
        message: '/api/monitor/ingestion-freshness unexpected status',
        status: response.status,
      });
    } else if (!validShape) {
      reporter.record('monitor.ingestionFreshness', {
        ok: false,
        message: '/api/monitor/ingestion-freshness payload invalid',
        status: response.status,
      });
    } else if (response.status === 503) {
      reporter.record('monitor.ingestionFreshness', {
        ok: true,
        critical: false,
        message: '/api/monitor/ingestion-freshness degraded',
        status: response.status,
      });
    } else {
      reporter.record('monitor.ingestionFreshness', {
        ok: true,
        message: '/api/monitor/ingestion-freshness healthy',
        status: response.status,
      });
    }
  } catch {
    reporter.record('monitor.ingestionFreshness', {
      ok: false,
      message: '/api/monitor/ingestion-freshness request failed',
    });
  }

  // 6) noindex headers for technical endpoints
  const noIndexTargets = [
    `${prodUrl}/api/monitor/core`,
    `${prodUrl}/api/health`,
  ];
  for (const url of noIndexTargets) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const robotsTag = normalizeHeader(response.headers.get('x-robots-tag'));
      if (robotsTag !== 'noindex, nofollow') {
        reporter.record(`headers.noindex:${url}`, {
          ok: false,
          message: `${url} invalid x-robots-tag`,
          status: response.status,
          details: { header: robotsTag || null },
        });
      } else {
        reporter.record(`headers.noindex:${url}`, {
          ok: true,
          message: `${url} x-robots-tag OK`,
          status: response.status,
        });
      }
    } catch {
      reporter.record(`headers.noindex:${url}`, {
        ok: false,
        message: `${url} request failed`,
      });
    }
  }

  // 7) cron review queue scan (optional)
  if (!cronSecret) {
    reporter.record('cron.reviewQueueScan', {
      ok: true,
      critical: false,
      message: 'CRON_SECRET missing, scan skipped',
    });
  } else {
    try {
      const response = await fetch(`${prodUrl}/api/cron/review-queue/scan`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${cronSecret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ limitPerType: 25 }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      let json = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }

      const validShape = Boolean(
        json &&
        typeof json === 'object' &&
        json.ok === true &&
        typeof json.requestId === 'string' &&
        json.summary &&
        typeof json.summary === 'object',
      );

      if (response.status !== 200) {
        reporter.record('cron.reviewQueueScan', {
          ok: false,
          message: '/api/cron/review-queue/scan expected 200',
          status: response.status,
        });
      } else if (!validShape) {
        reporter.record('cron.reviewQueueScan', {
          ok: false,
          message: '/api/cron/review-queue/scan payload invalid',
          status: response.status,
        });
      } else {
        reporter.record('cron.reviewQueueScan', {
          ok: true,
          message: '/api/cron/review-queue/scan contract OK',
          status: response.status,
        });
      }
    } catch {
      reporter.record('cron.reviewQueueScan', {
        ok: false,
        message: '/api/cron/review-queue/scan request failed',
      });
    }
  }

  const criticalFailures = reporter.checks.filter((check) => !check.ok && check.critical);
  const report = {
    ok: criticalFailures.length === 0,
    baseUrl: prodUrl,
    timeoutMs,
    checkedAt: new Date().toISOString(),
    failureCount: criticalFailures.length,
    checks: reporter.checks,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (criticalFailures.length > 0) {
    console.error(`[obs-smoke] FAILED (${criticalFailures.length} critical verification(s))`);
  } else {
    console.log('[obs-smoke] OK');
  }

  process.exit(criticalFailures.length > 0 ? 2 : 0);
}

main().catch((error) => {
  const exitCode = error instanceof UsageError ? 1 : 2;
  const message = error instanceof Error ? error.message : 'unexpected error';
  console.error(`[obs-smoke] FAILED (${message})`);
  process.exit(exitCode);
});
