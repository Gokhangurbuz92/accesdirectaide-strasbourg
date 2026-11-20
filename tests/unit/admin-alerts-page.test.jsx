// @vitest-environment jsdom
/**
 * RA-03 (interface) — /admin/alertes reads the alert history (GET admin/alerts) and the last recorded run of each scheduled job (GET admin/cron-runs?latest=1,
 * G13: one row per scheduled job with its beta state, « jamais exécutée » when nothing is recorded):
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
import { alertKind, jobRows } from '../../src/pages/admin/k5/alertsModel.js';

afterEach(() => { cleanup(); api.apiClient.admin.k5.mockReset(); });
const page = () => render(createElement(MemoryRouter, {}, createElement(AdminAlerts)));
// the server's answer (api/_services/cron-latest.js): every scheduled job, in its order, then recorded names that are not scheduled jobs
const JOBS = [
  { job: 'veille', category: 'A', state: 'OPEN', approved: true, scheduled: true, lastRun: { id: 'r3', job: 'veille', status: 'failed', startedAt: '2026-11-17T02:00:00.000Z', durationMs: 4200 } },
  { job: 'health-alert', category: 'B', state: 'OPEN', approved: true, scheduled: true, lastRun: { id: 'r2', job: 'health-alert', status: 'success', startedAt: '2026-11-17T01:07:00.000Z', durationMs: 830 } },
  { job: 'link-check', category: 'A', state: 'CLOSED', approved: true, scheduled: true, lastRun: { id: 'r0', job: 'link-check', status: 'skipped', skipReason: 'LINK_CHECK_DISABLED', startedAt: '2026-10-04T03:00:00.000Z', durationMs: 12 } },
  { job: 'gdpr-purge', category: 'C', state: 'AWAITING_APPROVAL', approved: false, scheduled: true, lastRun: null },
  { job: 'ingest-annuaire', category: 'D', state: 'LEGACY_CLOSED', approved: true, scheduled: true, lastRun: null },
  { job: 'veille-registre', category: null, state: 'NOT_SCHEDULED', approved: null, scheduled: false, lastRun: { id: 'r9', job: 'veille-registre', status: 'success', startedAt: '2026-11-01T00:00:00.000Z', durationMs: 50 } },
];
const ALERTS = [
  { name: 'job.failed.veille', message: 'veille failed', severity: 'critical', timestamp: '2026-11-17T02:05:00.000Z', details: { runId: 'r3' } },
  { name: 'job.stale.ingest-aids', message: 'no run for 30h', severity: 'critical', timestamp: '2026-11-16T12:00:00.000Z', details: {} },
  { name: 'db.down', message: 'Database is unreachable', severity: 'critical', timestamp: '2026-11-15T12:00:00.000Z', details: { error: 'timeout' } },
];

describe('alerts and scheduled jobs — administrator page', () => {
  it('names the alert kinds and flattens one row per job, « never » without a run', () => {
    expect(['job.failed.veille', 'job.stale.ingest-aids', 'db.down', ''].map(alertKind)).toEqual([{ kind: 'JOB_FAILED', job: 'veille' }, { kind: 'JOB_STALE', job: 'ingest-aids' }, { kind: 'CHECK', job: null }, { kind: 'CHECK', job: null }]);
    expect(jobRows(JOBS).map((r) => [r.job, r.status, r.state])).toEqual([['veille', 'failed', 'OPEN'], ['health-alert', 'success', 'OPEN'], ['link-check', 'skipped', 'CLOSED'],
      ['gdpr-purge', 'never', 'AWAITING_APPROVAL'], ['ingest-annuaire', 'never', 'LEGACY_CLOSED'], ['veille-registre', 'success', 'NOT_SCHEDULED']]);
    expect(jobRows(undefined)).toEqual([]);
  });

  it('shows every scheduled job (with its beta state, « jamais exécutée » without a run) and the alert history, read-only', async () => {
    api.apiClient.admin.k5.mockImplementation(async (path) => (path === 'alerts' ? { ok: true, count: 3, alerts: ALERTS } : { jobs: JOBS }));
    const { container } = page();
    await waitFor(() => expect(screen.getAllByTestId('admin-alerts-job')).toHaveLength(6));
    expect(api.apiClient.admin.k5.mock.calls).toEqual([['alerts'], ['cron-runs?latest=1']]);
    const jobs = screen.getByRole('table', { name: /Dernière exécution par tâche/ });
    expect(within(jobs).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['veille', 'health-alert', 'link-check', 'gdpr-purge', 'ingest-annuaire', 'veille-registre']);
    const [veille, , linkCheck, purge, legacy, other] = screen.getAllByTestId('admin-alerts-job');
    expect(veille).toHaveAttribute('data-status', 'failed'); expect(veille).toHaveTextContent('en échec'); expect(veille).toHaveTextContent('4.2 s'); expect(veille).toHaveTextContent('ouverte');
    expect(linkCheck).toHaveTextContent('fermée (bêta)'); expect(linkCheck).toHaveTextContent('non exécutée (LINK_CHECK_DISABLED)');
    expect(purge).toHaveAttribute('data-status', 'never'); expect(purge).toHaveTextContent('jamais exécutée'); expect(purge).toHaveTextContent('en attente d’approbation');
    expect(legacy).toHaveTextContent('ancienne tâche, fermée'); expect(legacy).toHaveTextContent('jamais exécutée');
    expect(other).toHaveTextContent('hors liste des tâches planifiées');
    expect(screen.getByText(/quelle que soit sa date/)).toBeInTheDocument();
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
