// @vitest-environment jsdom
/**
 * A-27 — the connected-calendar status line is true: in the default single-agenda mode (appliesToSlots false) it says the busy times have no effect on the
 * slots; with team choice it keeps « the platform reads only your busy times ». Translated (English check).
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import ChannelStatusPanel from '../../src/components/rdv/ChannelStatusPanel.jsx';
import { setLanguage } from '../../src/i18n/index.js';

const cal = (appliesToSlots) => [{ channel: 'calendar', state: 'CONFIGURED', reason: null, provider: 'outlook', missing: [], reachesPeople: false, ...(appliesToSlots === undefined ? {} : { appliesToSlots }) }];
afterEach(async () => { cleanup(); await act(async () => { await setLanguage('fr', { persist: false }); }); });

describe('A-27: the calendar claim follows the slot engine', () => {
  it('single agenda: no claim that busy times count; team choice: the read-only claim', () => {
    const { rerender } = render(h(ChannelStatusPanel, { channels: cal(false) }));
    const line = () => screen.getByTestId('pro-channel-calendar');
    expect(line()).toHaveTextContent('sans effet sur les créneaux');
    expect(line()).not.toHaveTextContent('lit seulement vos plages occupées');
    rerender(h(ChannelStatusPanel, { channels: cal(true) }));
    expect(line()).toHaveTextContent('lit seulement vos plages occupées');
    rerender(h(ChannelStatusPanel, { channels: cal(undefined) }));   // an older answer without the flag keeps the previous wording
    expect(line()).toHaveTextContent('lit seulement vos plages occupées');
  });
  it('translated', async () => {
    await act(async () => { await setLanguage('en', { persist: false }); });
    render(h(ChannelStatusPanel, { channels: cal(false) }));
    expect(screen.getByTestId('pro-channel-calendar')).toHaveTextContent('with no effect on the slots');
  });
});
