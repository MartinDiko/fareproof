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
      pricePerPersonMinor: 131_842,
      matchedRules: ['retailer route', 'retailer travel date', 'retailer flight identity', 'retailer long-leg cabin', 'retailer price'],
      missingRules: [],
    };
    const view = buildFareEvidenceView(observation.itinerary, observation, defaultFareSearchPolicies);

    expect(view).toMatchObject({ stageLabel: 'Retailer validated', retailer: 'OneTravel', bookingUrl: 'https://www.onetravel.com/book', perPersonMinor: 131_842, totalMinor: 263_684 });
  });

  it('withholds a booking link when validation evidence is incomplete', () => {
    const observation: PolicyObservation = {
      id: 'incomplete-result',
      policyId: 'fare-1-yvr-fra-one-way',
      observedAt: '2026-07-10T12:30:00Z',
      stage: 'retailer-result-reproduced',
      itinerary,
      url: 'https://www.onetravel.com/book',
      retailer: 'OneTravel',
      pricePerPersonMinor: 131_842,
      matchedRules: ['retailer route'],
      missingRules: ['retailer long-leg cabin'],
    };

    expect(buildFareEvidenceView(itinerary, observation, defaultFareSearchPolicies).bookingUrl).toBeUndefined();
  });
});