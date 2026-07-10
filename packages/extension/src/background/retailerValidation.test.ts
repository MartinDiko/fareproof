import { describe, expect, it } from 'vitest';
import { defaultFareSearchPolicies, parseMatrixItineraryJson } from '@fareproof/core';
import matrixFixture from '../../../core/src/test-fixtures/ita-yvr-fra-ws-de.json';
import { validateRetailerObservation } from './retailerValidation';

const policy = defaultFareSearchPolicies[0]!;
const itinerary = parseMatrixItineraryJson(JSON.stringify(matrixFixture), 'https://matrix.itasoftware.com/itinerary');
const link = { site: 'Retailer', url: 'https://retailer.example/fare', pricePerPersonMinor: 131_367, currency: 'CAD' };
const observation = {
  site: 'retailer.example',
  url: 'https://retailer.example/fare',
  airportCodes: ['YVR', 'FRA'],
  flightNumbers: ['WS5943', 'DE2455'],
  flightCabinEvidence: [{ flightNumber: 'WS5943', cabins: ['BUSINESS'] }, { flightNumber: 'DE2455', cabins: ['BUSINESS'] }],
  cabinWords: ['BUSINESS'],
  dateTokens: ['September 17, 2026'],
  prices: [{ amountMinor: 131_367, currency: 'CAD', basis: 'per-person' as const }],
};

describe('Retailer validation', () => {
  it('alerts only when route, flight, cabin, and price are reproduced', () => {
    const result = validateRetailerObservation(policy, itinerary, link, observation);

    expect(result).toMatchObject({ classification: 'exact', alertEligible: true, pricePerPersonMinor: 131_367 });
  });

  it('requires manual verification when fare identity is not visible', () => {
    const result = validateRetailerObservation(policy, itinerary, link, { ...observation, flightNumbers: [] });

    expect(result).toMatchObject({ classification: 'possible', alertEligible: false });
    expect(result.missingRules).toContain('retailer flight identity');
  });

  it('rejects a retailer reprice above the maximum', () => {
    const result = validateRetailerObservation(policy, itinerary, link, { ...observation, prices: [{ amountMinor: 250_000, currency: 'CAD', basis: 'per-person' }], blocker: 'price-changed' });

    expect(result).toMatchObject({ classification: 'mismatch', alertEligible: false });
    expect(result.failedRules).toEqual(expect.arrayContaining(['retailer price', 'retailer price-changed']));
  });

  it('rejects a different route', () => {
    const result = validateRetailerObservation(policy, itinerary, link, { ...observation, airportCodes: ['YVR', 'LHR'] });

    expect(result).toMatchObject({ classification: 'mismatch', alertEligible: false });
    expect(result.failedRules).toContain('retailer route');
  });

  it('does not alert when the date or long-leg cabin is unrelated', () => {
    const result = validateRetailerObservation(policy, itinerary, link, { ...observation, dateTokens: [], flightCabinEvidence: [{ flightNumber: 'WS5943', cabins: [] }], cabinWords: ['BUSINESS'] });

    expect(result).toMatchObject({ classification: 'possible', alertEligible: false });
    expect(result.missingRules).toEqual(expect.arrayContaining(['retailer travel date', 'retailer long-leg cabin']));
  });
});