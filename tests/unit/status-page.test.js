import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HelmetProvider } from 'react-helmet-async';

// Mock @/ dependencies used by Status.jsx
vi.mock('@/components/SEO', () => ({
  default: () => null,
}));
vi.mock('@/components/ui/button', () => ({
  Button: (props) => React.createElement('button', props, props.children),
}));
vi.mock('@/components/ui/card', () => ({
  Card: (props) => React.createElement('div', props, props.children),
  CardContent: (props) => React.createElement('div', props, props.children),
  CardHeader: (props) => React.createElement('div', props, props.children),
  CardTitle: (props) => React.createElement('div', props, props.children),
}));
vi.mock('@/components/ui/badge', () => ({
  Badge: (props) => React.createElement('span', props, props.children),
}));

import Status from '../../src/pages/Status.jsx';

describe('Status page', () => {
  // P24 overlay v1 (P24_PUBLIC_STATUS_OVERLAY_V1.md): the two internal monitor cards (protected endpoints, internal counts) are replaced by the public French sections
  it('renders the public status sections without internal metrics', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        HelmetProvider,
        null,
        React.createElement(Status, null),
      ),
    );

    for (const t of ['État du service', 'Comptes et rendez-vous', 'E-mails', 'Assistant', 'Informations sur les aides']) expect(html).toContain(t);
    expect(html).not.toMatch(/Data Quality|Ingestion Freshness|Open P0|Threshold/);
  });
});
