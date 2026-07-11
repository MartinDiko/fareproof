import { describe, expect, it } from 'vitest';
import { defaultFareSearchPolicies, parseMatrixItineraryJson } from '@fareproof/core';
import matrixFixture from '../../../core/src/test-fixtures/ita-yvr-fra-ws-de.json';
import type { PolicyObservation } from '../shared/state';
import { buildFareEvidenceView } from './evidenceView';

const itinerary = parseMatrixItineraryJson(JSON.stringify(matrixFixture), 'https://matrix.itasoftware.com/itinerary');

describe('buildFareEvidenceView', () => {
  it('shows detailed Matrix evidence without claiming a booking link', () => {
    const view = buildFareEvidenceView(itinerary, undefined, defaultFareSearchPolicies);

    expect(view).toMatchObject({ route: 'YVR → FRA', perPersonMinor: 131_367, totalMinor: 262_734, passengers: 2, stageLabel: 'ITA fare captured', bookingUrl: undefined });
    expect(view.flights).toContain('WS 5943 operated by DE 2455');
    expect(view.fareIdentity).toContain('DZ0D0HNS');
  });

  it('exposes the direct retailer URL only after complete retailer validation', () => {
    const observation: PolicyObservation = {
      id: 'retailer-result',
      policyId: 'fare-1-yvr-fra-one-way',
      observedAt: '2026-07-10T12:30:00Z',
      stage: 'retailer-result-reproduced',
      itinerary: { ...itinerary, sourceSite: 'OneTravel', sourceUrl: 'https://www.onetravel.com/book' },
      url: 'https://www.onetravel.com/book',
      retailer: 'OneTravel',
      pricePerPersonMinor: 150_000,
      bookWithMatrixPricePerPersonMinor: 131_842,
      retailerPricePerPersonMinor: 150_000,
      matchedRules: ['retailer route', 'retailer travel date', 'retailer flight identity', 'retailer long-leg cabin', 'retailer price'],
      missingRules: [],
      failedRules: [],
    };
    const view = buildFareEvidenceView(observation.itinerary, observation, defaultFareSearchPolicies);

    expect(view).toMatchObject({ stageLabel: 'Agency price validated', retailer: 'OneTravel', bookingUrl: 'https://www.onetravel.com/book', reviewUrl: undefined, perPersonMinor: 150_000, totalMinor: 300_000, matrixPricePerPersonMinor: 131_367, bookWithMatrixPricePerPersonMinor: 131_842, priceDifferenceMinor: 18_633 });
  });

  it('treats BookWithMatrix as a handoff while agency prices are pending', () => {
    const observation: PolicyObservation = {
      id: 'bookwithmatrix-result',
      policyId: 'fare-1-yvr-fra-one-way',
      observedAt: '2026-07-10T12:30:00Z',
      stage: 'bookwithmatrix-handoff',
      itinerary,
      url: 'https://bookwithmatrix.com/result',
      pricePerPersonMinor: 131_367,
      bookWithMatrixPricePerPersonMinor: 131_842,
      matchedRules: ['agency booking links found'],
      missingRules: ['retailer price'],
    };

    expect(buildFareEvidenceView(itinerary, observation, defaultFareSearchPolicies)).toMatchObject({ stageLabel: 'Checking agency prices', stageTone: 'warning', perPersonMinor: 131_367, bookWithMatrixPricePerPersonMinor: 131_842, bookingUrl: undefined, reviewUrl: undefined });
  });

  it('withholds booking but exposes manual review when the agency price fails', () => {
    const observation: PolicyObservation = {
      id: 'incomplete-result',
      policyId: 'fare-1-yvr-fra-one-way',
      observedAt: '2026-07-10T12:30:00Z',
      stage: 'manual-confirmation-required',
      itinerary,
      url: 'https://www.onetravel.com/book',
      retailer: 'OneTravel',
      pricePerPersonMinor: 250_000,
      retailerPricePerPersonMinor: 250_000,
      matchedRules: ['retailer route', 'retailer travel date', 'retailer flight identity', 'retailer long-leg cabin'],
      missingRules: [],
      failedRules: ['retailer price'],
    };

    expect(buildFareEvidenceView(itinerary, observation, defaultFareSearchPolicies)).toMatchObject({ stageLabel: 'Agency price did not qualify', perPersonMinor: 250_000, bookingUrl: undefined, reviewUrl: 'https://www.onetravel.com/book', failedRules: ['retailer price'] });
  });

  it('preserves the USD quote beside its CAD policy value', () => {
    const observation: PolicyObservation = {
      id: 'usd-result',
      policyId: 'fare-1-yvr-fra-one-way',
      observedAt: '2026-07-10T12:30:00Z',
      stage: 'retailer-result-reproduced',
      itinerary: { ...itinerary, sourceSite: 'OneTravel', sourceUrl: 'https://www.onetravel.com/book' },
      url: 'https://www.onetravel.com/book',
      retailer: 'OneTravel',
      pricePerPersonMinor: 141_460,
      bookWithMatrixPricePerPersonMinor: 99_000,
      bookWithMatrixCurrency: 'USD',
      bookWithMatrixCadPricePerPersonMinor: 140_045,
      retailerPricePerPersonMinor: 141_460,
      retailerOriginalPricePerPersonMinor: 100_000,
      retailerOriginalCurrency: 'USD',
      usdToCadRate: 1.4146,
      exchangeRateDate: '2026-07-10',
      matchedRules: ['retailer route', 'retailer travel date', 'retailer flight identity', 'retailer long-leg cabin', 'retailer price'],
      missingRules: [],
      failedRules: [],
    };

    expect(buildFareEvidenceView(observation.itinerary, observation, defaultFareSearchPolicies)).toMatchObject({ perPersonMinor: 141_460, retailerOriginalPricePerPersonMinor: 100_000, retailerOriginalCurrency: 'USD', bookWithMatrixCadPricePerPersonMinor: 140_045, usdToCadRate: 1.4146, exchangeRateDate: '2026-07-10' });
  });
});