import type { ExtensionMessage } from '../../shared/messages';

type CalendarEntry = Extract<ExtensionMessage, { type: 'MATRIX_CALENDAR' }>['entries'][number];
type FlightCandidate = Extract<ExtensionMessage, { type: 'MATRIX_FLIGHTS' }>['candidates'][number];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function parseDisplayedMoney(text: string): { amountMinor: number; currency: string } | null {
  const match = /(CA\$|CAD|US\$|USD|€|EUR|£|GBP)\s*([\d,]+(?:\.\d{1,2})?)/i.exec(text.replace(/\s+/g, ' '));
  if (!match?.[1] || !match[2]) return null;
  const currency = match[1].toUpperCase().startsWith('CA') ? 'CAD' : match[1].toUpperCase().startsWith('US') ? 'USD' : match[1] === '€' ? 'EUR' : match[1] === '£' ? 'GBP' : match[1].toUpperCase();
  return { currency, amountMinor: Math.round(Number(match[2].replace(/,/g, '')) * 100) };
}

export function parseDisplayedDuration(text: string): number | undefined {
  const days = /(\d+)\s*d(?:ays?)?\b/i.exec(text)?.[1];
  const hours = /(\d+)\s*h(?:ours?)?\b/i.exec(text)?.[1];
  const minutes = /(\d+)\s*m(?:in(?:utes?)?)?\b/i.exec(text)?.[1];
  if (!days && !hours && !minutes) return undefined;
  const total = Number(days ?? 0) * 1_440 + Number(hours ?? 0) * 60 + Number(minutes ?? 0);
  return total > 0 ? total : undefined;
}

function searchStartYear(url: string): number {
  try {
    const encoded = new URL(url).searchParams.get('search');
    if (!encoded) return new Date().getFullYear();
    const payload = JSON.parse(atob(encoded)) as { slices?: Array<{ dates?: { departureDate?: string } }> };
    return Number(payload.slices?.[0]?.dates?.departureDate?.slice(0, 4)) || new Date().getFullYear();
  } catch {
    return new Date().getFullYear();
  }
}

function monthForTable(table: Element): number | null {
  const calendar = table.closest('.calendar');
  const wrapper = calendar?.parentElement;
  const heading = wrapper ? [...wrapper.children].find((child) => child !== calendar)?.textContent?.trim() : undefined;
  const index = heading ? MONTHS.findIndex((month) => heading.includes(month)) : -1;
  return index >= 0 ? index : null;
}

export function extractMatrixCalendar(document: Document, url: string): CalendarEntry[] {
  const startYear = searchStartYear(url);
  const entries = new Map<string, CalendarEntry>();
  let previousMonth = -1;
  let year = startYear;
  for (const table of document.querySelectorAll('table.calendar-table')) {
    const month = monthForTable(table);
    if (month === null) continue;
    if (previousMonth >= 0 && month < previousMonth) year += 1;
    previousMonth = month;
    for (const cell of table.querySelectorAll('td.calendar-cell.has-price')) {
      const day = Number(cell.querySelector('.date')?.textContent?.trim());
      const price = parseDisplayedMoney(cell.querySelector('.price')?.textContent ?? '');
      if (!Number.isInteger(day) || day < 1 || day > 31) continue;
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      entries.set(date, { date, priceMinor: price?.amountMinor, currency: price?.currency });
    }
  }
  return [...entries.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function extractMatrixFlights(document: Document, baseUrl: string): FlightCandidate[] {
  const candidates: FlightCandidate[] = [];
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="/itinerary?search="]')) {
    const price = parseDisplayedMoney(link.textContent ?? '');
    if (!price) continue;
    const row = link.closest('[role=row], tr');
    const rowText = row?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const durationText = row
      ? [...row.children].map((cell) => cell.textContent?.trim() ?? '').find((text) => /\d+\s*h/i.test(text))
      : undefined;
    candidates.push({
      url: new URL(link.getAttribute('href') ?? '', baseUrl).href,
      priceMinor: price.amountMinor,
      currency: price.currency,
      durationMinutes: parseDisplayedDuration(durationText ?? rowText),
      airline: row?.children[1]?.textContent?.trim() ?? '',
      route: rowText,
    });
  }
  return candidates;
}

export function clickMatrixCalendarDate(document: Document, date: string): boolean {
  const target = new Date(`${date}T00:00:00Z`);
  const monthName = MONTHS[target.getUTCMonth()];
  if (!monthName) return false;
  for (const table of document.querySelectorAll('table.calendar-table')) {
    const wrapperText = table.closest('.calendar')?.parentElement?.textContent ?? '';
    if (!wrapperText.includes(monthName)) continue;
    for (const cell of table.querySelectorAll<HTMLElement>('td.calendar-cell.has-price')) {
      if (Number(cell.querySelector('.date')?.textContent?.trim()) === target.getUTCDate()) {
        cell.click();
        return true;
      }
    }
  }
  return false;
}