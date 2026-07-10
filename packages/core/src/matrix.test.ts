import { describe, expect, it } from 'vitest';
import fixture from './test-fixtures/ita-yvr-fra-ws-de.json';
import { buildMatrixSearchTasks, defaultFareSearchPolicies, matchSearchPolicy, parseMatrixItineraryJson } from './index';

describe('ITA Matrix contracts', () => {
  it('builds the verified flexible-date Matrix search payload', () => {
    const [task] = buildMatrixSearchTasks(defaultFareSearchPolicies[2]!);
    const encoded = new URL(task!.url).searchParams.get('search')!;
    const payload = JSON.parse(atob(decodeURIComponent(encoded))) as Record<string, unknown>;

    expect(payload).toMatchObject({
      type: 'round-trip',
      slices: [{ origin: ['YVR'], dest: ['FRA'], dates: { departureDate: '2026-09-01', duration: '30-45' } }],
      options: { cabin: 'BUSINESS', stops: '1', currency: { code: 'CAD' } },
      pax: { adults: '2' },
    });
  });

  it('splits return-only coverage into Matrix calendar windows', () => {
    const tasks = buildMatrixSearchTasks(defaultFareSearchPolicies[4]!);

    expect(tasks.map((task) => task.startDate)).toEqual(['2026-10-01', '2026-10-31']);
  });

  it('normalizes Matrix copied JSON without losing codeshare or per-person pricing', () => {
    const itinerary = parseMatrixItineraryJson(JSON.stringify(fixture), 'https://matrix.itasoftware.com/itinerary', new Date('2026-07-10T12:00:00Z'));

    expect(itinerary.fare.total).toMatchObject({ amountMinor: 262_734, currency: 'CAD' });
    expect(itinerary.segments[0]).toMatchObject({ marketingCarrier: { code: 'WS' }, marketingFlightNumber: '5943', operatingCarrier: { code: 'DE' }, operatingFlightNumber: '2455', bookingClass: 'D', cabin: 'BUSINESS', fareBasis: 'DZ0D0HNS', durationMinutes: 595 });
    expect(matchSearchPolicy(defaultFareSearchPolicies[0]!, itinerary).pricePerPersonMinor).toBe(131_367);
  });
});