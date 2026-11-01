// @vitest-environment jsdom
/* global document */
/**
 * R33 — focus moves to the new page's heading after a user navigation, but not after a redirect on load (it skipped the skip link).
 */
import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import RouteFocus from '../../src/components/navigation/RouteFocus.jsx';

let go = null;
function Nav() { go = useNavigate(); return null; }
const page = (title) => h('main', { id: 'main-content' }, h('h1', null, title));
const app = (initial) => h(MemoryRouter, { initialEntries: [initial] }, h(RouteFocus), h(Nav),
  h(Routes, null,
    h(Route, { path: '/old', element: h(Navigate, { to: '/new', replace: true }) }),
    h(Route, { path: '/new', element: page('Nouvelle') }),
    h(Route, { path: '/other', element: page('Autre') })));
const wait = () => act(() => new Promise((r) => setTimeout(r, 120)));

describe('RouteFocus', () => {
  it('a redirect on load leaves the focus at the top (the skip link stays the first Tab stop)', async () => {
    render(app('/old')); await wait();
    expect(document.activeElement).toBe(document.body);
  });
  it('a user navigation moves the focus to the new page heading', async () => {
    render(app('/new')); await wait();
    act(() => go('/other')); await wait();
    expect(document.activeElement?.textContent).toBe('Autre');
  });
});
