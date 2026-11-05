/**
 * R46 (D10) — a loopback STUB of the OpenFisca Web API, for tests only: it speaks the protocol (GET /spec with the Country-Package headers, POST /calculate
 * answering the null variables of the request) but computes nothing — every requested value is a fixed synthetic number. It proves our chain and contract,
 * never the engine's rules (the real-engine evidence is R14 / tests/fixtures/openfisca-france-176-variables.json).
 */
import http from 'node:http';

/** answers every `variable: { period: null }` of the request with values[variable] (0 when not given) */
const fill = (node, values) => {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    const asked = v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).some((x) => x === null);
    out[k] = asked ? Object.fromEntries(Object.entries(v).map(([p, x]) => [p, x === null ? (values[k] ?? 0) : x])) : fill(v, values);
  }
  return out;
};

/** @param {{ version?: string|null, countryPackage?: string, values?: Record<string, number> }} opts */
export async function startStubEngine({ version = '176.1.6', countryPackage = 'openfisca-france', values = {} } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const headers = { 'content-type': 'application/json', ...(countryPackage ? { 'country-package': countryPackage } : {}), ...(version ? { 'country-package-version': version } : {}) };
    if (req.method === 'GET' && req.url === '/spec') { res.writeHead(200, headers); res.end('{"info":{}}'); return; }
    if (req.method === 'POST' && req.url === '/calculate') {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => { const situation = JSON.parse(body); calls.push(situation); res.writeHead(200, headers); res.end(JSON.stringify(fill(situation, values))); });
      return;
    }
    res.writeHead(404, headers); res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { url: `http://127.0.0.1:${port}`, calls, close: () => new Promise((r) => server.close(r)) };
}
