// @vitest-environment jsdom
/**
 * RA-03 (interface) — /admin/alertes reads the alert history (GET admin/alerts) and the last recorded run of each scheduled job (GET admin/cron-runs):
 * job alerts « job.failed.<job> » / « job.stale.<job> » are named in words, a failed last run stands out, empty states never claim that a check ran.
 * Read-only: nothing is posted. Synthetic data. No JSX.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import axe from 'axe-core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiClient: { admin: { k5: vi.fn() } } }));
vi.mock('@/api/client', () => api);
import AdminAlerts from '../../src/pages/admin/k5/Alerts.jsx';
import { alertKind, lastRunPerJob } from '../../src/pages/admin/k5/alertsModel.js';

afterEach(() => { cleanup(); api.apiClient.admin.k5.mockReset(); });
const page = () => render(createElement(MemoryRouter, {}, createElement(AdminAlerts)));
const RUNS = [
  { id: 'r3', job: 'veille', status: 'failed', startedAt: '2026-11-17T02:00:00.000Z', durationMs: 4200 },
  { id: 'r2', job: 'health-alert', status: 'success', startedAt: '2026-11-17T01:07:00.000Z', durationMs: 830 },
  { id: 'r1', job: 'veille', status: 'success', startedAt: '2026-11-16T02:00:00.000Z', durationMs: 4000 },
];
const ALERTS = [
  { name: 'job.failed.veille', message: 'veille failed', severity: 'critical', timestamp: '2026-11-17T02:05:00.000Z', details: { runId: 'r3' } },
  { name: 'job.stale.ingest-aids', message: 'no run for 30h', severity: 'critical', timestamp: '2026-11-16T12:00:00.000Z', details: {} },
  { name: 'db.down', message: 'Database is unreachable', severity: 'critical', timestamp: '2026-11-15T12:00:00.000Z', details: { error: 'timeout' } },
];

describe('alerts and scheduled jobs — administrator page', () => {
  it('names the alert kinds and keeps the newest run per job', () => {
    expect(['job.failed.veille', 'job.stale.ingest-aids', 'db.down', ''].map(alertKind)).toEqual([{ kind: 'JOB_FAILED', job: 'veille' }, { kind: 'JOB_STALE', job: 'ingest-aids' }, { kind: 'CHECK', job: null }, { kind: 'CHECK', job: null }]);
    expect(lastRunPerJob(RUNS).map((r) => [r.job, r.id])).toEqual([['health-alert', 'r2'], ['veille', 'r3']]);
  });

  it('shows the last run of each job and the alert history, read-only', async () => {
    api.apiClient.admin.k5.mockImplementation(async (path) => (path === 'alerts' ? { ok: true, count: 3, alerts: ALERTS } : { items: RUNS }));
    const { container } = page();
    await waitFor(() => expect(screen.getAllByTestId('admin-alerts-job')).toHaveLength(2));
    expect(api.apiClient.admin.k5.mock.calls).toEqual([['alerts'], ['cron-runs?limit=100']]);
    const jobs = screen.getByRole('table', { name: /Dernière exécution par tâche/ });
    expect(within(jobs).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['health-alert', 'veille']);
    const veille = screen.getAllByTestId('admin-alerts-job')[1];
    expect(veille).toHaveAttribute('data-status', 'failed'); expect(veille).toHaveTextContent('en échec'); expect(veille).toHaveTextContent('4.2 s');
    expect(screen.getByText(/Parmi les 3 exécutions enregistrées les plus récentes/)).toBeInTheDocument();
    const list = screen.getAllByTestId('admin-alert');
    expect(list.map((li) => li.querySelector('p').textContent)).toEqual(['Tâche planifiée en échec : veille', 'Tâche planifiée en retard : ingest-aids', 'Contrôle de santé : db.down']);
    expect(list[2]).toHaveTextContent('Database is unreachable'); expect(list[2]).toHaveTextContent('"error": "timeout"');
    expect(within(list[1]).queryByText('Détails techniques')).toBeNull();
    expect(screen.queryByRole('button', { name: /acquitter|relancer/i })).toBeNull();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it('empty states never claim that a check ran; one source failing does not hide the other', async () => {
    api.apiClient.admin.k5.mockImplementation(async (path) => { if (path === 'alerts') return { ok: true, count: 0, alerts: [] }; throw { status: 401 }; });
    page();
    expect(await screen.findByTestId('admin-alerts-none')).toHaveTextContent('pas que la vérification de santé a tourné');
    expect(screen.getByTestId('admin-alerts-runs-problem')).toHaveTextContent('Session expirée');
  });

  it('is routed at /admin/alertes and listed in the menu', () => {
    expect(fs.readFileSync('src/pages/index.jsx', 'utf8')).toMatch(/<Route path="alertes" element=\{<AdminAlerts \/>\} \/>/);
    expect(fs.readFileSync('src/pages/admin/AdminLayout.jsx', 'utf8')).toMatch(/to: '\/admin\/alertes'/);
  });
});
