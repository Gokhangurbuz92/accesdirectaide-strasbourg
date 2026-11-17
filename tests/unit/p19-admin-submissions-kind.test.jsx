// @vitest-environment jsdom
/**
 * P19 — /admin/signalements: a report says its kind (a dispositif report is « Dispositif » whether it was filed as DISPOSITIF (0051) or as AIDE +
 * « dispositif:… » before it; the latter is marked), and the list can be filtered by content type (sent to GET /api/reports?contentType=).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => /** @type {any[][]} */ ([]));
vi.mock('@/api/client', () => ({
  apiClient: { admin: {
    contentReports: async (/** @type {any[]} */ ...args) => {
      calls.push(args);
      return { reports: [
        { id: 'r1', contentType: 'DISPOSITIF', contentId: 'dp-1', kind: 'DISPOSITIF', target: 'dp-1', legacyDispositif: false, reason: 'AUTRE', status: 'NEW' },
        { id: 'r2', contentType: 'AIDE', contentId: 'dispositif:dp-2', kind: 'DISPOSITIF', target: 'dp-2', legacyDispositif: true, reason: 'AUTRE', status: 'NEW' },
        { id: 'r3', contentType: 'STRUCTURE', contentId: 'st-1', reason: 'HORAIRES_FAUX', status: 'NEW' },
      ] };
    },
    k5: async () => [],
    setContentReport: async () => ({}),
  } },
}));

import AdminSubmissions from '../../src/pages/admin/k5/Submissions.jsx';

afterEach(() => { cleanup(); calls.length = 0; });

describe('P19 admin submissions: content kind', () => {
  it('shows the kind and the bare target, marks a dispositif report filed under AIDE, and filters by kind', async () => {
    render(createElement(AdminSubmissions));
    const items = await screen.findAllByTestId('admin-submission-report');
    expect(items[0]).toHaveTextContent(/^Dispositif dp-1 — AUTRE/);
    expect(items[1]).toHaveTextContent(/^Dispositif dp-2 — AUTRE/);
    expect(items[1]).not.toHaveTextContent('dispositif:dp-2');
    expect(screen.getAllByTestId('admin-submission-legacy')).toHaveLength(1);
    expect(items[2]).toHaveTextContent(/^Lieu st-1 — HORAIRES_FAUX/);   // a row without kind (older server) falls back to its contentType
    expect(calls[0]).toEqual(['NEW', '']);
    fireEvent.change(screen.getByLabelText('Type de contenu'), { target: { value: 'DISPOSITIF' } });
    await waitFor(() => expect(calls.at(-1)).toEqual(['NEW', 'DISPOSITIF']));
  });
});
