import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const matrixItineraryJson = readFileSync(
  new URL('../../packages/core/src/test-fixtures/ita-yvr-fra-ws-de.json', import.meta.url),
  'utf8',
);

test('imports and reports Matrix copied itinerary JSON', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('.');
  await expect(page.getByRole('heading', { name: 'Unlock dashboard' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toHaveText('Incorrect password. Try again.');
  await page.getByLabel('Password').fill('fareproof-e2e');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Fare watches', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add fare' }).click();
  await expect(page.getByText('Accepts a FareProof export, Matrix copied JSON, or compact fare JSON.')).toBeVisible();
  await page.getByLabel('Fare JSON').fill(matrixItineraryJson);
  await page.getByRole('button', { name: 'Validate and import' }).click();

  await expect(page.getByText('YVR → FRA')).toBeVisible();
  await expect(page.getByText('WS 5943')).toBeVisible();
  await expect(page.getByText('Operated by DE 2455')).toBeVisible();
  await expect(page.getByText('DZ0D0HNS')).toBeVisible();
  await expect(page.getByText(/2,627\.34/)).toBeVisible();
  expect(consoleErrors).toEqual([]);
});