// LAB stand-in for an S3-compatible bucket (Cloudflare R2 API subset): path-style PUT / GET / HEAD / DELETE object and ListObjectsV2.
// Checks that every request is SigV4-signed with the expected access key id (not the signature itself) and can refuse writes (read-only token) to test
// least privilege. In memory, loopback only. Test helper — never used by the application.
import http from 'node:http';
import crypto from 'node:crypto';

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** @param {{ bucket: string, keys: Record<string, { write: boolean }> }} opts */
export async function startFakeS3({ bucket, keys }) {
  /** @type {Map<string, { body: Buffer, meta: Record<string, string>, t: Date }>} */
  const objects = new Map();
  const log = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const auth = String(req.headers.authorization || '');
      const m = auth.match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\//);
      const who = m && keys[m[1]];
      log.push({ method: req.method, path: u.pathname, key: m?.[1] || null });
      const send = (status, body = '', headers = {}) => { res.writeHead(status, headers); res.end(body); };
      if (!who) return send(403, '<Error><Code>AccessDenied</Code></Error>', { 'content-type': 'application/xml' });
      if (parts[0] !== bucket) return send(404, '<Error><Code>NoSuchBucket</Code></Error>', { 'content-type': 'application/xml' });
      const key = parts.slice(1).join('/');
      if (!key && req.method === 'GET' && u.searchParams.get('list-type') === '2') {
        const prefix = u.searchParams.get('prefix') || '';
        const list = [...objects.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b));
        const body = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${xml(bucket)}</Name><Prefix>${xml(prefix)}</Prefix><KeyCount>${list.length}</KeyCount><IsTruncated>false</IsTruncated>${
          list.map(([k, o]) => `<Contents><Key>${xml(k)}</Key><Size>${o.body.length}</Size><LastModified>${o.t.toISOString()}</LastModified><ETag>"${crypto.createHash('md5').update(o.body).digest('hex')}"</ETag></Contents>`).join('')}</ListBucketResult>`;
        return send(200, body, { 'content-type': 'application/xml' });
      }
      if (!key) return send(400);
      const writes = req.method === 'PUT' || req.method === 'DELETE';
      if (writes && !who.write) return send(403, '<Error><Code>AccessDenied</Code></Error>', { 'content-type': 'application/xml' });
      if (req.method === 'PUT') {
        const meta = Object.fromEntries(Object.entries(req.headers).filter(([h]) => h.startsWith('x-amz-meta-')).map(([h, v]) => [h, String(v)]));
        const body = Buffer.concat(chunks);
        objects.set(key, { body, meta, t: new Date() });
        return send(200, '', { etag: `"${crypto.createHash('md5').update(body).digest('hex')}"` });
      }
      const o = objects.get(key);
      if (req.method === 'DELETE') { objects.delete(key); return send(204); }
      if (!o) return send(404, '<Error><Code>NoSuchKey</Code></Error>', { 'content-type': 'application/xml' });
      const headers = { 'content-length': String(o.body.length), 'content-type': 'application/octet-stream', 'last-modified': o.t.toUTCString(), ...o.meta };
      if (req.method === 'HEAD') return send(200, undefined, headers);
      if (req.method === 'GET') return send(200, o.body, headers);
      return send(405);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { endpoint: `http://127.0.0.1:${port}`, objects, log, close: () => new Promise((r) => server.close(r)) };
}
