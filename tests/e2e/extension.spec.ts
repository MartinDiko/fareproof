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

function matrixSearchPage(): string {
  return `<!doctype html><html><body>
    <div role="tab">Round Trip</div><div role="tab">One Way</div>
    <div role="grid"><input placeholder="Add airport"><div role="option">Vancouver International (YVR)</div><div role="option">Frankfurt International (FRA)</div></div>
    <div role="grid"><input placeholder="Add airport"></div>
    <div role="combobox">Search exact date</div><div role="option">See calendar of lowest fares</div>
    <input class="mat-datepicker-input" formcontrolname="departureDate"><input placeholder="Duration">
    <input type="number" formcontrolname="adults" value="1">
    <div role="combobox" formcontrolname="stops">No limit</div><div role="option">Nonstop only</div><div role="option">Up to 1 stop</div><div role="option">Up to 2 stops</div><div role="option">No limit</div>
    <div role="combobox" formcontrolname="cabin">Cheapest available</div><div role="option">Business class or higher</div>
    <input aria-label="Currency"><div role="option">Canadian Dollar (CAD)</div>
    <input type="checkbox" checked><input type="checkbox" checked>
    <button type="submit" onclick="location.href='/calendar?search=fixture'">Search</button>
  </body></html>`;
}

function retailerLoadingThenPricePage(): string {
  const fixture = readFileSync(path.join(fixtures, 'retailer-result.html'), 'utf8').replace('CAD 1,318.42 per person', 'USD 1,000.00 per person');
  const resultBody = /<body>([\s\S]*)<\/body>/.exec(fixture)?.[1] ?? fixture;
  return `<!doctype html><html><head><title>Checking fare</title></head><body><main>Checking current agency price...</main><script>setTimeout(() => { document.body.innerHTML = ${JSON.stringify(resultBody)}; }, 2_200);</script></body></html>`;
}

test('runs Matrix through BookWithMatrix and validates the retailer', async () => {
  test.setTimeout(60_000);
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    let calendarRequests = 0;
    let matrixUnavailable = false;
    const routeMatrix = async (route: Route) => {
      if (route.request().resourceType() !== 'document') {
        await route.continue();
        return;
      }
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/calendar') {
        calendarRequests += 1;
        await route.fulfill({ contentType: 'text/html', body: matrixUnavailable || calendarRequests === 1 ? '<!doctype html><html><body><div role="progressbar">Loading Matrix</div></body></html>' : matrixCalendarPage() });
      }
      else if (pathname === '/flights') await route.fulfill({ contentType: 'text/html', body: readFileSync(path.join(fixtures, 'matrix-calendar.html'), 'utf8') });
      else if (pathname === '/itinerary') await route.fulfill({ contentType: 'text/html', body: matrixItineraryPage() });
      else if (pathname === '/' || pathname === '/search') await route.fulfill({ contentType: 'text/html', body: matrixSearchPage() });
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
    const serviceWorkerErrors: string[] = [];
    serviceWorker.on('console', (message) => {
      if (message.type() === 'error') serviceWorkerErrors.push(message.text());
    });
    const extensionId = new URL(serviceWorker.url()).host;
    await serviceWorker.evaluate(async () => {
      const oldTimestamp = new Date(Date.now() - 10 * 60_000).toISOString();
      await chrome.storage.local.set({
        'fareproof.usdCadRate': { usdToCad: 1.4146, effectiveDate: '2026-07-10', fetchedAt: new Date().toISOString(), source: 'Bank of Canada' },
        'fareproof.activeVerificationRun': {
          id: 'stale-installed-run',
          startedAt: oldTimestamp,
          updatedAt: oldTimestamp,
          interactive: true,
          tasks: [{ id: 'fare-1-yvr-fra-one-way-0', policyId: 'fare-1-yvr-fra-one-way', startDate: '2026-09-01', latestDate: '2026-09-30', url: 'https://matrix.itasoftware.com/calendar?search=fixture' }],
          taskIndex: 0,
          tabId: 2_147_483_647,
          stage: 'calendar',
          stageAttempt: 0,
          dateQueue: [],
          dateIndex: 0,
          candidateQueue: [],
          candidateIndex: 0,
          retailerQueue: [],
          retailerIndex: 0,
          policyIds: ['fare-1-yvr-fra-one-way'],
        },
      });
    });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.setViewportSize({ width: 420, height: 900 });
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(page.locator('.policy-card').filter({ hasText: 'Fare 1 · YVR to FRA one way' })).toBeVisible();
    await expect.poll(async () => page.evaluate(async () => (await chrome.storage.local.get('fareproof.activeVerificationRun'))['fareproof.activeVerificationRun'])).toBeNull();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(420);
    await page.getByLabel('Fare JSON').fill(matrixFixture);
    await page.getByRole('button', { name: 'Parse and create watch' }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const watches = (await chrome.storage.local.get('fareproof.watches'))['fareproof.watches'];
      return watches?.[0]?.criteria?.target?.segments?.[0];
    })).toMatchObject({ marketingCarrier: { code: 'WS' }, marketingFlightNumber: '5943', operatingCarrier: { code: 'DE' }, operatingFlightNumber: '2455' });
    await page.evaluate(async () => {
      const watches = (await chrome.storage.local.get('fareproof.watches'))['fareproof.watches'];
      await chrome.storage.local.set({ 'fareproof.currentObservation': watches[0].criteria.target });
    });
    const evidencePanel = page.locator('.evidence-panel');
    await expect(evidencePanel.locator('.evidence-stage')).toHaveText('ITA fare captured');
    await expect(evidencePanel.locator('.booking-link')).toHaveCount(0);
    const optionsPage = await context.newPage();
    optionsPage.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await optionsPage.setViewportSize({ width: 1280, height: 900 });
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(optionsPage.locator('.policy-editor')).toHaveCount(5);
    expect(await optionsPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    const policy = page.locator('.policy-card').filter({ hasText: 'Fare 1 · YVR to FRA one way' });
    await expect(policy.getByRole('button', { name: 'Check now' })).toBeEnabled();
    const verificationPagePromise = context.waitForEvent('page');
    await policy.getByRole('button', { name: 'Check now' }).click();
    const verificationPage = await verificationPagePromise;
    await verificationPage.route('https://matrix.itasoftware.com/**', routeMatrix);
    await verificationPage.route('https://bookwithmatrix.com/**', routeBookWithMatrix);
    await verificationPage.route('https://www.onetravel.com/**', (route) => route.request().resourceType() === 'document' ? route.fulfill({ contentType: 'text/html', body: retailerLoadingThenPricePage() }) : route.continue());
    await verificationPage.goto('https://matrix.itasoftware.com/search');
    await expect.poll(() => calendarRequests).toBe(1);
    await expect(verificationPage.locator('#fareproof-overlay-host[data-status="matrix-loading"]')).toBeAttached();
    await page.evaluate(async () => chrome.alarms.create('fareproof.run-timeout', { when: Date.now() + 100 }));
    await expect.poll(async () => page.evaluate(async () => {
      const stored = await chrome.storage.local.get(['fareproof.policyStatuses', 'fareproof.activeVerificationRun']);
      const status = stored['fareproof.policyStatuses']?.find((item: { policyId: string }) => item.policyId === 'fare-1-yvr-fra-one-way');
      return { state: status?.state, message: status?.message, stage: stored['fareproof.activeVerificationRun']?.stage };
    }), { timeout: 45_000 }).toMatchObject({ state: 'retailer-match' });
    await expect(policy.getByText('retailer match')).toBeVisible();
    await expect(policy.getByText(/OneTravel confirms USD 1000\.00 = CAD 1414\.60 at 1\.4146 per person; Matrix showed CAD 1313\.67/)).toBeVisible();
    await expect(evidencePanel.locator('.evidence-stage')).toHaveText('Agency price validated');
    await expect(evidencePanel.getByText('YVR → FRA', { exact: true })).toBeVisible();
    await expect(evidencePanel.getByText('2026-09-17 · BUSINESS', { exact: true })).toBeVisible();
    await expect(evidencePanel.getByText('Fare 1 · YVR to FRA one way', { exact: true })).toBeVisible();
    await expect(evidencePanel.getByText(/1,000\.00/)).toBeVisible();
    await expect(evidencePanel.locator('.evidence-grid > div').filter({ hasText: 'OneTravel / person' }).getByText('CA$1,414.60', { exact: true })).toBeVisible();
    await expect(evidencePanel.getByText(/1,318\.42/)).toBeVisible();
    await expect(evidencePanel.getByText(/1,313\.67/)).toBeVisible();
    await expect(evidencePanel.getByText(/100\.93 above Matrix/)).toBeVisible();
    await expect(evidencePanel.getByText(/2,829\.20/)).toBeVisible();
    await expect(evidencePanel.getByText(/1 USD = 1\.4146 CAD/)).toBeVisible();
    await expect(evidencePanel.getByText(/WS 5943 operated by DE 2455/)).toBeVisible();
    await expect(evidencePanel.getByText(/DZ0D0HNS/)).toBeVisible();
    await expect(evidencePanel.getByText('OneTravel', { exact: true })).toBeVisible();
    const confirmedRules = evidencePanel.locator('.evidence-rules.match');
    await expect(confirmedRules).toContainText('agency route');
    await expect(confirmedRules).toContainText('agency travel date');
    await expect(confirmedRules).toContainText('agency flight identity');
    await expect(confirmedRules).toContainText('agency long-leg cabin');
    await expect(confirmedRules).toContainText('agency price');
    const bookingLink = evidencePanel.getByRole('link', { name: /Open booking site · OneTravel/ });
    await expect(bookingLink).toHaveAttribute('href', /https:\/\/www\.onetravel\.com\//);
    const stored = await page.evaluate(async () => chrome.storage.local.get(['fareproof.policyObservations', 'fareproof.activeVerificationRun', 'fareproof.runHistory']));
    expect(stored['fareproof.policyObservations']).toEqual(expect.arrayContaining([
      expect.objectContaining({ policyId: 'fare-1-yvr-fra-one-way', stage: 'retailer-result-reproduced', retailer: 'OneTravel', pricePerPersonMinor: 141_460, retailerPricePerPersonMinor: 141_460, retailerOriginalPricePerPersonMinor: 100_000, retailerOriginalCurrency: 'USD', usdToCadRate: 1.4146, bookWithMatrixPricePerPersonMinor: 131_842 }),
      expect.objectContaining({ policyId: 'fare-1-yvr-fra-one-way', stage: 'bookwithmatrix-handoff', matchedRules: ['agency booking links found'], missingRules: expect.arrayContaining(['retailer price']) }),
    ]));
    expect(stored['fareproof.runHistory']).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: 'match', results: expect.arrayContaining([expect.objectContaining({ policyId: 'fare-1-yvr-fra-one-way', outcome: 'match', originalPricePerPersonMinor: 100_000, originalCurrency: 'USD', cadPricePerPersonMinor: 141_460, usdToCadRate: 1.4146 })]) })]));
    const matchedRun = page.locator('.history-run').filter({ hasText: 'Agency match' }).first();
    await expect(matchedRun).toBeVisible();
    await matchedRun.locator('summary').click();
    await expect(matchedRun.getByText(/US\$1,000\.00.*CA\$1,414\.60/)).toBeVisible();
    expect(stored['fareproof.activeVerificationRun']).toBeNull();
    expect(calendarRequests).toBe(2);
    const notifications = await page.evaluate(async () => chrome.notifications.getAll());
    expect(notifications).toHaveProperty('fareproof-fare-1-yvr-fra-one-way');
    expect(consoleErrors).toEqual([]);

    matrixUnavailable = true;
    const unavailablePagePromise = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Check all enabled searches now' }).click();
    const unavailablePage = await unavailablePagePromise;
    await unavailablePage.route('https://matrix.itasoftware.com/**', routeMatrix);
    await unavailablePage.goto('https://matrix.itasoftware.com/search');
    await expect.poll(async () => page.evaluate(async () => (await chrome.storage.local.get('fareproof.activeVerificationRun'))['fareproof.activeVerificationRun']?.stage)).toBe('calendar');
    await page.evaluate(async () => chrome.alarms.create('fareproof.run-timeout', { when: Date.now() + 100 }));
    await expect.poll(async () => page.evaluate(async () => {
      const run = (await chrome.storage.local.get('fareproof.activeVerificationRun'))['fareproof.activeVerificationRun'];
      return { stage: run?.stage, attempt: run?.stageAttempt };
    }), { timeout: 10_000 }).toEqual({ stage: 'calendar', attempt: 1 });
    await page.evaluate(async () => chrome.alarms.create('fareproof.run-timeout', { when: Date.now() + 100 }));
    await expect.poll(async () => page.evaluate(async () => {
      const stored = await chrome.storage.local.get(['fareproof.activeVerificationRun', 'fareproof.policyStatuses', 'fareproof.runHistory']);
      return {
        activeRun: stored['fareproof.activeVerificationRun'],
        blocked: stored['fareproof.policyStatuses']?.filter((status: { state: string }) => status.state === 'blocked').length,
        error: stored['fareproof.policyStatuses']?.filter((status: { state: string }) => status.state === 'error').length,
        historyOutcome: stored['fareproof.runHistory']?.[0]?.outcome,
        historyResults: stored['fareproof.runHistory']?.[0]?.results?.length,
      };
    }), { timeout: 10_000 }).toEqual({ activeRun: null, blocked: 5, error: 0, historyOutcome: 'matrix-unavailable', historyResults: 5 });
    await expect(page.getByText('Matrix unavailable for the latest run')).toBeVisible();
    await expect(page.locator('.policy-card .status').filter({ hasText: 'Matrix unavailable' })).toHaveCount(5);
    await expect(page.locator('.policy-card .status.danger')).toHaveCount(0);
    await unavailablePage.close();
    matrixUnavailable = false;

    const scheduledPagePromise = context.waitForEvent('page');
    await page.evaluate(async () => {
      const oldTimestamp = new Date(Date.now() - 10 * 60_000).toISOString();
      const result = await chrome.storage.local.get('fareproof.policyStatuses');
      const statuses = (result['fareproof.policyStatuses'] ?? []).map((status: { policyId: string }) => ({
        ...status,
        nextDueAt: status.policyId === 'fare-1-yvr-fra-one-way' ? '1970-01-01T00:00:00.000Z' : '2999-01-01T00:00:00.000Z',
      }));
      await chrome.storage.local.set({
        'fareproof.policyStatuses': statuses,
        'fareproof.activeVerificationRun': {
          id: 'stale-scheduled-run',
          startedAt: oldTimestamp,
          updatedAt: oldTimestamp,
          interactive: false,
          tasks: [{ id: 'fare-1-yvr-fra-one-way-0', policyId: 'fare-1-yvr-fra-one-way', startDate: '2026-09-01', latestDate: '2026-09-30', url: 'https://matrix.itasoftware.com/calendar?search=fixture' }],
          taskIndex: 0,
          tabId: 2_147_483_646,
          stage: 'calendar',
          stageAttempt: 0,
          dateQueue: [],
          dateIndex: 0,
          candidateQueue: [],
          candidateIndex: 0,
          retailerQueue: [],
          retailerIndex: 0,
          policyIds: ['fare-1-yvr-fra-one-way'],
        },
      });
      await chrome.alarms.create('fareproof.dispatch', { when: Date.now() + 100 });
    });
    const scheduledPage = await scheduledPagePromise;
    await expect.poll(async () => page.evaluate(async () => (await chrome.storage.local.get('fareproof.activeVerificationRun'))['fareproof.activeVerificationRun']?.id)).not.toBe('stale-scheduled-run');
    await scheduledPage.close();
    expect(serviceWorkerErrors).toEqual([]);
  } finally {
    await context.close();
  }
});