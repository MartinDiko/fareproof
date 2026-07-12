import { describe, expect, it } from 'vitest';
import fixture from './test-fixtures/travelpayouts-yvr-fra.json';
import {
  buildTravelpayoutsRequestsForPolicy,
  buildTravelpayoutsUrl,
  defaultFareSearchPolicies,
  parseTravelpayoutsResponse,
} from './index';

describe('Travelpayouts fare discovery', () => {
  it('builds a token-free one-way request URL', () => {
    const url = new URL(buildTravelpayoutsUrl({ origin: 'yvr', destination: 'fra', departureAt: '2026-09', currency: 'CAD' }));

    expect(url.origin + url.pathname).toBe('https://api.travelpayouts.com/aviasales/v3/prices_for_dates');
    expect(url.searchParams.get('origin')).toBe('YVR');
    expect(url.searchParams.get('destination')).toBe('FRA');
    expect(url.searchParams.get('departure_at')).toBe('2026-09');
    expect(url.searchParams.get('currency')).toBe('cad');
    expect(url.searchParams.get('market')).toBe('ca');
    expect(url.searchParams.get('one_way')).toBe('true');
    // The affiliate token must never be embedded in the URL.
    expect(url.searchParams.has('token')).toBe(false);
  });

  it('expands a policy into one request per origin, destination, and month', () => {
    const requests = buildTravelpayoutsRequestsForPolicy(defaultFareSearchPolicies[1]!); // YVR -> SKG/TIA, Sep 2026

    expect(requests.map((request) => `${request.origin}-${request.destination}-${request.departureAt}`)).toEqual([
      'YVR-SKG-2026-09',
      'YVR-TIA-2026-09',
    ]);
    expect(requests.every((request) => request.oneWay)).toBe(true);
  });

  it('normalizes valid records and skips fares without a flight identity', () => {
    const itineraries = parseTravelpayoutsResponse(JSON.stringify(fixture), { now: new Date('2026-07-11T12:00:00Z') });

    // The third fixture record has no airline or flight number and must be dropped.
    expect(itineraries).toHaveLength(2);
    expect(itineraries[0]).toMatchObject({
      sourceSite: 'travelpayouts',
      tripType: 'one-way',
      verificationStage: 'search-result-reproduced',
      fare: { total: { amountMinor: 128_400, currency: 'CAD' } },
    });
    expect(itineraries[0]!.segments[0]).toMatchObject({
      origin: { code: 'YVR' },
      destination: { code: 'FRA' },
      marketingCarrier: { code: 'LH' },
      marketingFlightNumber: '493',
      durationMinutes: 760,
    });
    // Cabin is unknown from this source and must not be fabricated.
    expect(itineraries[0]!.segments[0]!.cabin).toBeUndefined();
    expect(itineraries[0]!.sourceUrl).toBe('https://www.aviasales.com/search/YVR0309FRA1?t=lh');
  });

  it('derives arrival from departure and duration', () => {
    const [first] = parseTravelpayoutsResponse(JSON.stringify(fixture));

    const departure = Date.parse(first!.segments[0]!.departureLocal);
    const arrival = Date.parse(first!.segments[0]!.arrivalLocal);
    expect((arrival - departure) / 60_000).toBe(760);
  });

  it('rejects an unsuccessful response', () => {
    expect(() => parseTravelpayoutsResponse(JSON.stringify({ success: false, error: 'invalid token', data: [] })))
      .toThrow(/invalid token/);
  });

  it('returns no candidates for an empty data set', () => {
    expect(parseTravelpayoutsResponse(JSON.stringify({ success: true, currency: 'cad', data: [] }))).toEqual([]);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseTravelpayoutsResponse('{ not json')).toThrow();
  });
});
