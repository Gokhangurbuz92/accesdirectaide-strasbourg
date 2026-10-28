import { test, expect } from './fixtures.js';

test.setTimeout(60000);

// DTA S6: the pre-RDV-module page /appointments/request (slot picker + name/e-mail form, POST /api/appointments, GET /api/public/availability) has no routed backend
// (see tests/unit/orphan-handler-contract.test.js and frontend-api-route-contract.test.js) and the unrouted handler it targeted invented a default service and created
// anonymous "confirmed" appointments without an atomic lock. The page is therefore retired: this journey now asserts the honest notice, that nothing is requested from the
// backend, and that the way forward is the structure directory. The real booking journey is covered by rdv-booking.spec.js and the real-API DTA-B14 test.
test('Public Booking Flow', async ({ page }) => {
  const backendCalls = [];
  page.on('request', (r) => { if (/\/api\/(appointments|public\/availability|public\/messages)/.test(new URL(r.url()).pathname)) backendCalls.push(r.url()); });
  await page.goto('/appointments/request?structure_id=dummy-123');

  await expect(page.getByRole('heading', { name: 'Prendre rendez-vous', level: 1 })).toBeVisible();
  await expect(page.getByText("Aucun rendez-vous n'a été créé, modifié ou annulé")).toBeVisible();
  await expect(page.getByText('Choisir un créneau')).toHaveCount(0);
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Trouver une structure' })).toHaveAttribute('href', '/structures');

  // the cancel / reschedule / messages links of the old versions carry a capability in the path, the query and the fragment: all three are replaced by a neutral URL
  for (const [p, heading, neutral] of [
    ['/appointments/cancel/NOT-A-REAL-TOKEN?token=NOT-A-REAL-TOKEN#token=NOT-A-REAL-TOKEN', 'Annuler un rendez-vous', '/appointments/cancel'],
    ['/appointments/reschedule/NOT-A-REAL-TOKEN#token=NOT-A-REAL-TOKEN', 'Reporter un rendez-vous', '/appointments/reschedule'],
    ['/r/NOT-A-REAL-TOKEN/messages?token=NOT-A-REAL-TOKEN', 'Messagerie', '/r/messages'],
  ]) {
    await page.goto(p);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${neutral}$`));
    expect(page.url()).not.toContain('NOT-A-REAL-TOKEN');
  }
  expect(backendCalls).toEqual([]);
});

test('Pro Login Flow', async ({ page }) => {
  // Use correct route
  await page.goto('/pro/login');

  // Match heading from redesigned ProLogin.jsx
  await expect(page.getByRole('heading', { name: 'Espace Pro' })).toBeVisible();
});