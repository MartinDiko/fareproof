import type { FareSearchPolicy, MatrixSearchTask } from '@fareproof/core';

function waitForElement<T extends Element>(find: () => T | undefined, description: string, timeoutMs = 8_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const existing = find();
    if (existing) {
      resolve(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const element = find();
      if (!element) return;
      window.clearTimeout(timer);
      observer.disconnect();
      resolve(element);
    });
    const timer = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Matrix control not found: ${description}`));
    }, timeoutMs);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  });
}

function elementWithText(selector: string, text: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(selector)].find((element) => element.textContent?.replace(/\s+/g, ' ').trim() === text);
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
}

function airportInputs(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('input[placeholder="Add airport"]')];
}

function clearAirports(input: HTMLInputElement): void {
  const grid = input.closest('[role="grid"]');
  for (const button of grid?.querySelectorAll<HTMLElement>('[role="row"] button') ?? []) button.click();
}

async function addAirport(fieldIndex: number, code: string): Promise<void> {
  const input = airportInputs()[fieldIndex];
  if (!input) throw new Error(`Matrix airport field ${fieldIndex + 1} is unavailable.`);
  input.focus();
  setInputValue(input, code);
  const option = await waitForElement(
    () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((element) => element.textContent?.includes(`(${code})`) || element.textContent?.trim() === code),
    `airport ${code}`,
  );
  option.click();
}

async function chooseOption(control: HTMLElement, optionText: string): Promise<void> {
  control.click();
  const option = await waitForElement(() => elementWithText('[role="option"]', optionText), optionText);
  option.click();
}

function formatMatrixDate(date: string): string {
  const [year, month, day] = date.split('-');
  if (!year || !month || !day) throw new Error(`Invalid Matrix date: ${date}`);
  return `${month}/${day}/${year}`;
}

function formControl(name: string): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(`[formcontrolname="${name}"]`) ?? undefined;
}

export async function submitMatrixSearch(task: MatrixSearchTask, policy: FareSearchPolicy): Promise<void> {
  const tabName = policy.tripType === 'round-trip' ? 'Round Trip' : 'One Way';
  const tab = await waitForElement(() => elementWithText('[role="tab"]', tabName), `${tabName} tab`);
  tab.click();

  await waitForElement(() => airportInputs()[1], 'origin and destination fields');
  const initialInputs = airportInputs();
  clearAirports(initialInputs[0]!);
  clearAirports(initialInputs[1]!);
  for (const origin of policy.origins) await addAirport(0, origin);
  for (const destination of policy.destinations) await addAirport(1, destination);

  const dateMode = await waitForElement(
    () => [...document.querySelectorAll<HTMLElement>('[role="combobox"]')].find((element) => /Search exact date|See calendar of lowest fares/.test(element.textContent ?? '')),
    'date search mode',
  );
  if (!dateMode.textContent?.includes('See calendar of lowest fares')) await chooseOption(dateMode, 'See calendar of lowest fares');

  const departureDate = await waitForElement(
    () => document.querySelector<HTMLInputElement>('input[formcontrolname="departureDate"], input.mat-datepicker-input') ?? undefined,
    'start date',
  );
  setInputValue(departureDate, formatMatrixDate(task.startDate));

  if (policy.tripType === 'round-trip' && policy.returnWindow) {
    const duration = await waitForElement(
      () => document.querySelector<HTMLInputElement>('input[placeholder="Duration"]') ?? undefined,
      'round-trip duration',
    );
    setInputValue(duration, `${policy.returnWindow.minimumDaysAfterDeparture}-${policy.returnWindow.maximumDaysAfterDeparture}`);
  }

  const adults = await waitForElement(
    () => document.querySelector<HTMLInputElement>('input[formcontrolname="adults"]') ?? document.querySelectorAll<HTMLInputElement>('input[type="number"]')[0],
    'adult passenger count',
  );
  setInputValue(adults, String(policy.passengers.adults));

  const stops = await waitForElement(() => formControl('stops'), 'stops');
  const stopOption = policy.routing.maximumStops === 0 ? 'Nonstop only' : policy.routing.maximumStops === 1 ? 'Up to 1 stop' : policy.routing.maximumStops === 2 ? 'Up to 2 stops' : 'No limit';
  await chooseOption(stops, stopOption);

  const cabin = await waitForElement(() => formControl('cabin'), 'cabin');
  await chooseOption(cabin, 'Business class or higher');

  const currency = await waitForElement(
    () => document.querySelector<HTMLInputElement>('input[aria-label="Currency"]') ?? undefined,
    'currency',
  );
  currency.focus();
  setInputValue(currency, policy.currency);
  const currencyOption = await waitForElement(
    () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((element) => element.textContent?.includes(`(${policy.currency})`)),
    policy.currency,
  );
  currencyOption.click();

  const checkboxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  for (const checkbox of checkboxes.slice(0, 2)) if (!checkbox.checked) checkbox.click();

  const search = await waitForElement(
    () => [...document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((button) => button.textContent?.includes('Search') && !button.disabled),
    'enabled Search button',
  );
  search.click();
}