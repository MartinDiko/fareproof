import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect, test, type Route } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '../..');
const extensionPath = path.join(root, 'packages/extension/dist');
const fixtures = path.join(root, 'packages/extension/src/test-fixtures');
const matrixFixture = readFileSync(path.join(root, 'packages/core/src/test-fixtures/ita-yvr-fra-ws-de.json'), 'utf8');

function matrixCalendarPage(): string {
  const fixture = readFileSync(path.join(fixtures, 'matrix-calendar.html'), 'utf8');
  return fixture.replace('<td class="calendar-cell has-price">', '<td class="calendar-cell has-price" onclick="location.href=\'/flights?search=fixture\'">');
}

function matrixItineraryPage(): string {
  return `<!doctype html><html><body><h1>Itinerary Details</h1><button onclick="navigator.clipboard.writeText(document.querySelector('#payload').textContent)">Copy itinerary as JSON</button><script id="payload" type="application/json">${matrixFixture}</script></body></html>`;
}

test('runs Matrix through BookWithMatrix and validates the retailer', async () => {
  test.setTimeout(60_000);
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const routeMatrix = async (route: Route) => {
      if (route.request().resourceType() !== 'document') {
        await route.continue();
        return;
      }
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/calendar') await route.fulfill({ contentType: 'text/html', body: matrixCalendarPage() });
      else if (pathname === '/flights') await route.fulfill({ contentType: 'text/html', body: readFileSync(path.join(fixtures, 'matrix-calendar.html'), 'utf8') });
      else if (pathname === '/itinerary') await route.fulfill({ contentType: 'text/html', body: matrixItineraryPage() });
      else await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>Matrix mock</body></html>' });
    };
    const routeBookWithMatrix = async (route: Route) => {
      if (route.request().resourceType() !== 'document') {
        await route.continue();
        return;
      }
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/') await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><textarea id="matrixPaste" oninput="location.href=\'/mock-result\'"></textarea></body></html>' });
      else await route.fulfill({ contentType: 'text/html', body: readFileSync(path.join(fixtures, 'bookwithmatrix-result.html'), 'utf8') });
    };

    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.setViewportSize({ width: 420, height: 900 });
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(page.getByText('Fare 1 · YVR to FRA one way')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(420);
    const optionsPage = await context.newPage();
    optionsPage.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await optionsPage.setViewportSize({ width: 1280, height: 900 });
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(optionsPage.locator('.policy-editor')).toHaveCount(5);
    expect(await optionsPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    const policy = page.locator('.policy-card').filter({ hasText: 'Fare 1 · YVR to FRA one way' });
    const verificationPagePromise = context.waitForEvent('page');
    await policy.getByRole('button', { name: 'Check now' }).click();
    const verificationPage = await verificationPagePromise;
    await verificationPage.route('https://matrix.itasoftware.com/**', routeMatrix);
    await verificationPage.route('https://bookwithmatrix.com/**', routeBookWithMatrix);
    await verificationPage.route('https://www.onetravel.com/**', (route) => route.request().resourceType() === 'document' ? route.fulfill({ contentType: 'text/html', body: readFileSync(path.join(fixtures, 'retailer-result.html'), 'utf8') }) : route.continue());
    const activeRun = await page.evaluate(async () => (await chrome.storage.local.get('fareproof.activeVerificationRun'))['fareproof.activeVerificationRun']);
    await verificationPage.goto(activeRun.tasks[0].url);
    await expect.poll(async () => page.evaluate(async () => {
      const stored = await chrome.storage.local.get(['fareproof.policyStatuses', 'fareproof.activeVerificationRun']);
      const status = stored['fareproof.policyStatuses']?.find((item: { policyId: string }) => item.policyId === 'fare-1-yvr-fra-one-way');
      return { state: status?.state, message: status?.message, stage: stored['fareproof.activeVerificationRun']?.stage };
    }), { timeout: 45_000 }).toMatchObject({ state: 'retailer-match' });
    await expect(policy.getByText('retailer match')).toBeVisible();
    await expect(policy.getByText(/OneTravel reproduced the route, date, flight, cabin, and price/)).toBeVisible();
    const stored = await page.evaluate(async () => chrome.storage.local.get(['fareproof.policyObservations', 'fareproof.activeVerificationRun']));
    expect(stored['fareproof.policyObservations']).toEqual(expect.arrayContaining([expect.objectContaining({ policyId: 'fare-1-yvr-fra-one-way', stage: 'retailer-result-reproduced', retailer: 'OneTravel', pricePerPersonMinor: 131_842 })]));
    expect(stored['fareproof.activeVerificationRun']).toBeNull();
    const notifications = await page.evaluate(async () => chrome.notifications.getAll());
    expect(notifications).toHaveProperty('fareproof-fare-1-yvr-fra-one-way');
    expect(consoleErrors).toEqual([]);
  } finally {
    await context.close();
  }
});