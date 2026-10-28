import http from 'node:http';
import https from 'node:https';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const PASS_THROUGH_PROTOCOLS = new Set(['data:', 'blob:', 'file:', 'about:']);

function asUrlString(input) {
  if (input instanceof URL) return input.href;
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object' && typeof input.url === 'string') return input.url;
  return String(input ?? '');
}

export function isWs8AllowedNetworkUrl(input) {
  const raw = asUrlString(input).trim();
  if (!raw) return false;

  if (raw.startsWith('/')) return true;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (PASS_THROUGH_PROTOCOLS.has(url.protocol)) return true;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

export function ws8RemoteNetworkError(target) {
  const error = new Error(`WS8_REMOTE_NETWORK_BLOCKED:${asUrlString(target)}`);
  error.code = 'WS8_REMOTE_NETWORK_BLOCKED';
  return error;
}

export function createWs8GuardedFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }

  return async function ws8GuardedFetch(input, init) {
    if (!isWs8AllowedNetworkUrl(input)) {
      throw ws8RemoteNetworkError(input);
    }
    return fetchImpl(input, init);
  };
}

function requestTarget(args, defaultProtocol) {
  const first = args[0];

  if (first instanceof URL || typeof first === 'string') {
    const raw = first instanceof URL ? first.href : first;
    if (typeof raw === 'string' && raw.startsWith('/')) return `${defaultProtocol}//localhost${raw}`;
    return raw;
  }

  if (first && typeof first === 'object') {
    if (first.socketPath) return 'file://local-unix-socket';
    const protocol = first.protocol || defaultProtocol;
    const host = first.hostname || first.host || 'localhost';
    const port = first.port ? `:${first.port}` : '';
    const path = first.path || '/';
    return `${protocol}//${host}${port}${path}`;
  }

  return `${defaultProtocol}//localhost/`;
}

function patchRequestFamily(mod, defaultProtocol, marker) {
  if (mod[marker]) return;

  const originalRequest = mod.request.bind(mod);
  const originalGet = mod.get.bind(mod);

  mod.request = (...args) => {
    const target = requestTarget(args, defaultProtocol);
    if (!isWs8AllowedNetworkUrl(target)) throw ws8RemoteNetworkError(target);
    return originalRequest(...args);
  };

  mod.get = (...args) => {
    const target = requestTarget(args, defaultProtocol);
    if (!isWs8AllowedNetworkUrl(target)) throw ws8RemoteNetworkError(target);
    return originalGet(...args);
  };

  Object.defineProperty(mod, marker, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

export function installWs8StrictOfflineNetworkGuards() {
  if (globalThis.__ADA_WS8_STRICT_OFFLINE_INSTALLED__) return;

  if (typeof globalThis.fetch === 'function') {
    globalThis.fetch = createWs8GuardedFetch(globalThis.fetch.bind(globalThis));
  }

  patchRequestFamily(http, 'http:', '__ADA_WS8_HTTP_GUARD__');
  patchRequestFamily(https, 'https:', '__ADA_WS8_HTTPS_GUARD__');

  Object.defineProperty(globalThis, '__ADA_WS8_STRICT_OFFLINE_INSTALLED__', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}
