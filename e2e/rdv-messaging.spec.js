import { test, expect } from './fixtures.js';

test.describe('P10-E RDV messaging flow', () => {
  test('supports user and pro messaging on same conversation', async ({ page }) => {
    /** @type {Array<{ id: string, senderType: 'USER' | 'PRO', body: string, createdAt: string }>} */
    const thread = [
      {
        id: 'msg-1',
        senderType: 'USER',
        body: 'Bonjour, je confirme ma venue.',
        createdAt: '2026-03-05T10:00:00.000Z',
      },
    ];

    const conversationPayload = () => ({
      ok: true,
      item: {
        id: 'conv-1',
        appointmentId: 'apt-1',
        structure: { id: 'struct-1', slug: 'structure-test', name: 'Structure Test' },
        appointment: {
          id: 'apt-1',
          startsAt: '2026-03-05T10:00:00.000Z',
          endsAt: '2026-03-05T10:30:00.000Z',
          status: 'CONFIRMED',
          serviceName: 'Accompagnement social',
        },
        lastMessageAt: thread[thread.length - 1]?.createdAt,
        messages: thread,
      },
    });

    await page.addInitScript(() => {
      window.localStorage.setItem('pro_token', 'pro-token-test');
    });

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: { kind: 'user', authType: 'user_cookie', role: 'user' },
          user: { id: 'user-1', role: 'user', emailVerified: true },
        }),
      });
    });

    await page.route('**/api/pro/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'pro-1',
            email: 'pro@test.local',
            role: 'STRUCTURE_ADMIN',
            structureId: 'struct-1',
          },
          structure: {
            id: 'struct-1',
            nom: 'Structure Test',
          },
        }),
      });
    });

    await page.route('**/api/messages/conversations/conv-1', async (route) => {
      if (route.request().method() === 'POST') {
        const request = route.request();
        const parsed = request.postDataJSON() || {};
        thread.push({
          id: `msg-user-${thread.length + 1}`,
          senderType: 'USER',
          body: String(parsed.body || ''),
          createdAt: new Date().toISOString(),
        });

        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            item: thread[thread.length - 1],
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(conversationPayload()),
      });
    });

    await page.route('**/api/pro/messages/conversations/conv-1', async (route) => {
      if (route.request().method() === 'POST') {
        const request = route.request();
        const parsed = request.postDataJSON() || {};
        thread.push({
          id: `msg-pro-${thread.length + 1}`,
          senderType: 'PRO',
          body: String(parsed.body || ''),
          createdAt: new Date().toISOString(),
        });

        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            item: thread[thread.length - 1],
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(conversationPayload()),
      });
    });

    await page.route('**/api/pro/messages/conversations', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          items: [
            {
              id: 'conv-1',
              appointmentId: 'apt-1',
              structure: { id: 'struct-1', slug: 'structure-test', name: 'Structure Test' },
              appointment: {
                id: 'apt-1',
                startsAt: '2026-03-05T10:00:00.000Z',
                endsAt: '2026-03-05T10:30:00.000Z',
                status: 'CONFIRMED',
                serviceName: 'Accompagnement social',
              },
              lastMessageAt: thread[thread.length - 1]?.createdAt,
              lastMessagePreview: thread[thread.length - 1]?.body,
            },
          ],
        }),
      });
    });

    await page.goto('/compte/messages/conv-1');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Conversation rendez-vous' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Bonjour, je confirme ma venue.')).toBeVisible({ timeout: 15000 });

    await page.getByLabel('Nouveau message').fill('Je serai present a l heure.');
    await page.getByRole('button', { name: 'Envoyer' }).click();

    await expect(page.getByText('Message envoye.')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Je serai present a l heure.')).toBeVisible({ timeout: 15000 });

    await page.goto('/pro/messages/conv-1');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Conversation usager' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Je serai present a l heure.')).toBeVisible({ timeout: 15000 });

    await page.getByLabel('Nouveau message').fill('Merci, rendez-vous confirme.');
    await page.getByRole('button', { name: 'Envoyer' }).click();

    await expect(page.getByText('Message envoye.')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Merci, rendez-vous confirme.')).toBeVisible({ timeout: 15000 });

    await page.goto('/compte/messages/conv-1');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Merci, rendez-vous confirme.')).toBeVisible({ timeout: 15000 });
  });
});
