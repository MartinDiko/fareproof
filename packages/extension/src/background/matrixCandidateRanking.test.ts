import { describe, expect, it } from 'vitest';
import { rankMatrixFlightCandidates } from './matrixCandidateRanking';

describe('rankMatrixFlightCandidates', () => {
  it('selects the lowest price and uses shortest duration as the tie-breaker', () => {
    const ranked = rankMatrixFlightCandidates([
      { url: 'https://matrix.itasoftware.com/itinerary?search=slow', priceMinor: 131_400, currency: 'CAD', durationMinutes: 720, airline: 'WestJet', route: 'YVR to FRA' },
      { url: 'https://matrix.itasoftware.com/itinerary?search=short', priceMinor: 131_400, currency: 'CAD', durationMinutes: 595, airline: 'WestJet', route: 'YVR to FRA' },
      { url: 'https://matrix.itasoftware.com/itinerary?search=expensive', priceMinor: 162_200, currency: 'CAD', durationMinutes: 580, airline: 'WestJet', route: 'YVR to FRA' },
    ], 'CAD', 160_000);

    expect(ranked.map((candidate) => new URL(candidate.url).searchParams.get('search'))).toEqual(['short', 'slow']);
  });
});