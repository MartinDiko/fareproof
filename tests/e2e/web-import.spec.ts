import { expect, test } from '@playwright/test';

const suppliedFare = {
  route: 'YVR-FRA',
  date: '2026-09-17',
  marketingCarrier: 'WS',
  marketingFlightNumber: '5943',
  operatingCarrier: 'DE',
  operatingFlightNumber: '2455',
  bookingClass: 'D',
  cabin: 'BUSINESS',
  fareBasis: 'DZ0D0HNS',
  currency: 'CAD',
  total: 1313.67,
};

test('imports and reports the supplied codeshare fare', async ({ page }) => {
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
  await page.getByLabel('Fare JSON').fill(JSON.stringify(suppliedFare));
  await page.getByRole('button', { name: 'Validate and import' }).click();

  await expect(page.getByText('YVR → FRA')).toBeVisible();
  await expect(page.getByText('WS 5943')).toBeVisible();
  await expect(page.getByText('Operated by DE 2455')).toBeVisible();
  await expect(page.getByText('DZ0D0HNS')).toBeVisible();
  await expect(page.getByText(/1,313\.67/)).toBeVisible();
  expect(consoleErrors).toEqual([]);
});