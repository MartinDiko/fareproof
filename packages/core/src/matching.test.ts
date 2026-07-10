import { describe, expect, it } from 'vitest';
import { compareItinerary, createWatch, parseFareProofExport, parseImportedFare } from './index';
import matrixFixture from './test-fixtures/ita-yvr-fra-ws-de.json';

const suppliedFare = JSON.stringify({
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
});

describe('FareProof core', () => {
  it('normalizes the supplied codeshare fare without losing fare identity', () => {
    const fare = parseImportedFare(suppliedFare, new Date('2026-07-10T12:00:00Z'));

    expect(fare.segments[0]).toMatchObject({ marketingCarrier: { code: 'WS' }, marketingFlightNumber: '5943', operatingCarrier: { code: 'DE' }, operatingFlightNumber: '2455', bookingClass: 'D', fareBasis: 'DZ0D0HNS' });
    expect(fare.fare.total).toMatchObject({ amountMinor: 131367, currency: 'CAD' });
  });

  it('accepts Matrix Copy itinerary as JSON in manual import', () => {
    const fare = parseImportedFare(JSON.stringify(matrixFixture), new Date('2026-07-10T12:00:00Z'));

    expect(fare).toMatchObject({ sourceSite: 'ita-matrix', passengers: { adults: 2 }, fare: { total: { amountMinor: 262_734, currency: 'CAD' } } });
    expect(fare.segments[0]).toMatchObject({ marketingCarrier: { code: 'WS' }, marketingFlightNumber: '5943', operatingCarrier: { code: 'DE' }, operatingFlightNumber: '2455', durationMinutes: 595 });
  });

  it('treats an exact but search-only result as ineligible for an alert', () => {
    const target = parseImportedFare(suppliedFare);
    const result = compareItinerary(createWatch(target), target);

    expect(result.overallClassification).toBe('strong');
    expect(result.alertEligible).toBe(false);
  });

  it('hard-fails a higher-cabin target reproduced in economy', () => {
    const target = parseImportedFare(suppliedFare);
    const candidate = { ...target, segments: target.segments.map((segment) => ({ ...segment, cabin: 'ECONOMY' as const })) };
    const result = compareItinerary(createWatch(target), candidate);

    expect(result.overallClassification).toBe('mismatch');
    expect(result.mismatchedFields).toContain('cabin on every segment');
    expect(result.alertEligible).toBe(false);
  });

  it('validates a versioned extension export before web import', () => {
    const watch = createWatch(parseImportedFare(suppliedFare), new Date('2026-07-10T12:00:00Z'));
    const bundle = parseFareProofExport(JSON.stringify({ schemaVersion: 1, exportedAt: '2026-07-10T12:01:00Z', watches: [watch] }));

    expect(bundle.watches[0]?.criteria.target.fareIdentity.fareBasisCodes).toEqual(['DZ0D0HNS']);
  });
});