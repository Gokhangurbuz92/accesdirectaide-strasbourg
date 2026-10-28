/* global __ENV */
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'https://www.accesdirectaide.fr';

export const options = {
  vus: 1,
  duration: '10s',
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.1'],
  },
};

export default function () {
  const endpoints = [
    '/api/health',
    '/api/aides?limit=3',
    '/api/monitor/core',
  ];

  endpoints.forEach((ep) => {
    const res = http.get(`${BASE}${ep}`);
    check(res, {
      [`${ep}: 200`]: (r) => r.status === 200,
    });
  });
}
