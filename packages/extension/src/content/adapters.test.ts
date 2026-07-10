import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { extractBookWithMatrixLinks } from './bookwithmatrix/extraction';
import { extractMatrixCalendar, extractMatrixFlights, parseDisplayedDuration } from './ita/extraction';
import { extractRetailerPage } from './retailer/extraction';

function fixture(name: string): Document {
  const path = fileURLToPath(new URL(`../test-fixtures/${name}`, import.meta.url));
  return parseHTML(readFileSync(path, 'utf8')).document as unknown as Document;
}

describe('Website adapters', () => {
  it('extracts Matrix calendar dates and per-person display prices', () => {
    const entries = extractMatrixCalendar(fixture('matrix-calendar.html'), 'https://matrix.itasoftware.com/calendar?search=invalid');

    expect(entries).toEqual([
      { date: `${new Date().getFullYear()}-09-17`, priceMinor: 131_400, currency: 'CAD' },
      { date: `${new Date().getFullYear()}-09-18`, priceMinor: 159_950, currency: 'CAD' },
    ]);
  });

  it('extracts Matrix itinerary links independently', () => {
    const candidates = extractMatrixFlights(fixture('matrix-calendar.html'), 'https://matrix.itasoftware.com/flights');

    expect(candidates[0]).toMatchObject({ url: 'https://matrix.itasoftware.com/itinerary?search=fixture', priceMinor: 131_400, currency: 'CAD', durationMinutes: 595, airline: 'WestJet' });
    expect(candidates).toHaveLength(2);
  });

  it('normalizes Matrix duration labels', () => {
    expect(parseDisplayedDuration('9h 55m')).toBe(595);
    expect(parseDisplayedDuration('1 day 6h 45m')).toBe(1_845);
  });

  it('extracts each BookWithMatrix retailer as a separate handoff', () => {
    const links = extractBookWithMatrixLinks(fixture('bookwithmatrix-result.html'));

    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({ site: 'OneTravel', pricePerPersonMinor: 131_842, currency: 'CAD' }),
      expect.objectContaining({ site: 'Priceline' }),
    ]));
  });

  it('extracts bounded retailer route, flight, cabin, date, and price evidence', () => {
    const observation = extractRetailerPage(fixture('retailer-result.html'), 'https://retailer.example/result');

    expect(observation).toMatchObject({ airportCodes: expect.arrayContaining(['YVR', 'FRA']), flightNumbers: expect.arrayContaining(['WS5943', 'DE2455']), cabinWords: expect.arrayContaining(['BUSINESS']) });
    expect(observation.flightCabinEvidence).toEqual(expect.arrayContaining([expect.objectContaining({ flightNumber: 'WS5943', cabins: expect.arrayContaining(['BUSINESS CLASS']) })]));
    expect(observation.prices).toContainEqual({ amountMinor: 131_842, currency: 'CAD', basis: 'per-person' });
  });
});