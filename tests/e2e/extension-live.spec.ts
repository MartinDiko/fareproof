import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';

const runLive = process.env.FAREPROOF_LIVE_TEST === 'true';

test('real Matrix check leaves the calendar stage', async () => {
  test.skip(!runLive, 'Set FAREPROOF_LIVE_TEST=true to call the real Matrix site.');
  test.setTimeout(180_000);
  const extensionPath = path.resolve(import.meta.dirname, '../../packages/extension/dist');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).host;
    const sidePanel = await context.newPage();
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const policy = sidePanel.locator('.policy-card').filter({ hasText: 'Fare 1 · YVR to FRA one way' });
    const matrixPagePromise = context.waitForEvent('page');
    await policy.getByRole('button', { name: 'Check now' }).click();
    const matrixPage = await matrixPagePromise;
    await matrixPage.waitForURL(/matrix\.itasoftware\.com\/calendar/);
    await expect.poll(() => matrixPage.locator('td.calendar-cell.has-price').count(), {
      timeout: 90_000,
      intervals: [1_000, 2_000, 5_000],
      message: 'Matrix did not render flexible-calendar prices',
    }).toBeGreaterThan(0);

    await expect.poll(async () => sidePanel.evaluate(async () => {
      const result = await chrome.storage.local.get(['fareproof.activeVerificationRun', 'fareproof.policyStatuses']);
      const run = result['fareproof.activeVerificationRun'];
      const status = result['fareproof.policyStatuses']?.find((item: { policyId: string }) => item.policyId === 'fare-1-yvr-fra-one-way');
      return { stage: run?.stage ?? null, state: status?.state, message: status?.message };
    }), { timeout: 30_000, intervals: [500, 1_000, 2_000] }).not.toMatchObject({ stage: 'calendar', state: 'running' });
  } finally {
    await context.close();
  }
});