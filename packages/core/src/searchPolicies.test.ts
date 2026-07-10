import { describe, expect, it } from 'vitest';
import { defaultFareSearchPolicies, matchLinkedReturnWindow, matchSearchPolicy, observedItinerarySchema } from './index';

function fare(overrides: { total?: number; longCabin?: 'ECONOMY' | 'BUSINESS'; connection?: string } = {}) {
  const connection = overrides.connection ?? 'YYZ';
  return observedItinerarySchema.parse({
    id: 'candidate-1',
    sourceSite: 'fixture-retailer',
    sourceUrl: 'https://example.test/fare',
    observedAt: '2026-07-10T12:00:00Z',
    tripType: 'one-way',
    passengers: { adults: 2, children: 0, infants: 0 },
    segments: [
      { origin: { code: 'YVR' }, destination: { code: connection }, departureLocal: '2026-09-17T08:00:00-07:00', arrivalLocal: '2026-09-17T15:25:00-04:00', durationMinutes: 265, marketingCarrier: { code: 'WS' }, marketingFlightNumber: '710', cabin: 'ECONOMY' },
      { origin: { code: connection }, destination: { code: 'FRA' }, departureLocal: '2026-09-17T18:00:00-04:00', arrivalLocal: '2026-09-18T07:50:00+02:00', durationMinutes: 470, marketingCarrier: { code: 'WS' }, marketingFlightNumber: '5943', operatingCarrier: { code: 'DE' }, operatingFlightNumber: '2455', bookingClass: 'D', cabin: overrides.longCabin ?? 'BUSINESS', fareBasis: 'DZ0D0HNS' },
    ],
    fare: { total: { amountMinor: overrides.total ?? 300_000, currency: 'CAD' } },
    fareIdentity: { fareBasisCodes: ['DZ0D0HNS'], bookingClasses: ['D'], passengerTypeCodes: ['ADT'] },
    warnings: [],
    verificationStage: 'retailer-result-reproduced',
    extractionConfidence: 90,
  });
}

describe('Fare search policies', () => {
  const policy = defaultFareSearchPolicies[0]!;

  it('ships the five requested editable defaults', () => {
    expect(defaultFareSearchPolicies.map(({ id }) => id)).toEqual([
      'fare-1-yvr-fra-one-way',
      'fare-2-yvr-skg-tia-one-way',
      'fare-1-1-yvr-fra-round-trip',
      'fare-2-1-yvr-skg-tia-round-trip',
      'fare-3-return-one-way',
    ]);
    expect(defaultFareSearchPolicies.every((item) => item.schedule.intervalMinutes === 5)).toBe(true);
  });

  it('accepts economy on the short leg and business on the long leg', () => {
    const result = matchSearchPolicy(policy, fare(), { YYZ: 'CA' });

    expect(result.matches).toBe(true);
    expect(result.pricePerPersonMinor).toBe(150_000);
  });

  it('rejects economy on a leg longer than six hours', () => {
    const result = matchSearchPolicy(policy, fare({ longCabin: 'ECONOMY' }), { YYZ: 'CA' });

    expect(result.matches).toBe(false);
    expect(result.failedRules).toContain('segment 2 cabin');
  });

  it('rejects a connection outside Canada and an over-limit per-person price', () => {
    const result = matchSearchPolicy(policy, fare({ connection: 'SEA', total: 330_000 }), { SEA: 'US' });

    expect(result.matches).toBe(false);
    expect(result.failedRules).toEqual(expect.arrayContaining(['connection country', 'maximum price per person']));
  });

  it('matches round-trip routes and stops per direction within the return window', () => {
    const outbound = fare();
    const roundTrip = observedItinerarySchema.parse({
      ...outbound,
      tripType: 'round-trip',
      segments: [
        ...outbound.segments.map((segment) => ({ ...segment, sliceIndex: 0 })),
        { sliceIndex: 1, origin: { code: 'FRA' }, destination: { code: 'YYZ' }, departureLocal: '2026-10-22T10:00:00+02:00', arrivalLocal: '2026-10-22T12:30:00-04:00', durationMinutes: 510, marketingCarrier: { code: 'WS' }, marketingFlightNumber: '5942', operatingCarrier: { code: 'DE' }, operatingFlightNumber: '2454', cabin: 'BUSINESS' },
        { sliceIndex: 1, origin: { code: 'YYZ' }, destination: { code: 'YVR' }, departureLocal: '2026-10-22T15:00:00-04:00', arrivalLocal: '2026-10-22T17:05:00-07:00', durationMinutes: 305, marketingCarrier: { code: 'WS' }, marketingFlightNumber: '711', cabin: 'ECONOMY' },
      ],
    });

    const result = matchSearchPolicy(defaultFareSearchPolicies[2]!, roundTrip, { YYZ: 'CA' });

    expect(result.matches).toBe(true);
    expect(result.matchedRules).toContain('return window');
  });

  it('ties return-only matches to an observed outbound date and destination', () => {
    const outbound = fare();
    const returnItinerary = observedItinerarySchema.parse({
      ...outbound,
      id: 'return-1',
      segments: [{ ...outbound.segments[1], origin: { code: 'FRA' }, destination: { code: 'YVR' }, departureLocal: '2026-10-22T10:00:00+02:00', arrivalLocal: '2026-10-22T12:00:00-07:00' }],
    });

    expect(matchLinkedReturnWindow(defaultFareSearchPolicies[4]!, returnItinerary, [outbound])).toMatchObject({ matches: true });
    expect(matchLinkedReturnWindow(defaultFareSearchPolicies[4]!, { ...returnItinerary, segments: [{ ...returnItinerary.segments[0]!, departureLocal: '2026-12-01T10:00:00+02:00' }] }, [outbound])).toMatchObject({ matches: false });
  });
});