import type { FareSearchPolicy, ObservedItinerary } from '@fareproof/core';
import type { BookWithMatrixResultLink, RetailerPageObservation } from '../shared/messages';

export interface RetailerValidationResult {
  classification: 'exact' | 'possible' | 'mismatch';
  alertEligible: boolean;
  pricePerPersonMinor?: number;
  matchedRules: string[];
  missingRules: string[];
  failedRules: string[];
}

function normalizeFlight(carrier: string, number: string): string {
  return `${carrier}${number}`.replace(/\s+/g, '').toUpperCase();
}

function normalizeDateToken(token: string): string | null {
  if (/^20\d{6}$/.test(token)) return `${token.slice(0, 4)}-${token.slice(4, 6)}-${token.slice(6, 8)}`;
  if (/^20\d{2}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = Date.parse(token);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

export function validateRetailerObservation(
  policy: FareSearchPolicy,
  itinerary: ObservedItinerary,
  link: BookWithMatrixResultLink,
  observation: RetailerPageObservation,
): RetailerValidationResult {
  const matchedRules: string[] = [];
  const missingRules: string[] = [];
  const failedRules: string[] = [];
  const requiredAirports = [...new Set(itinerary.segments.flatMap((segment) => [segment.origin.code, segment.destination.code]))];
  const routeMatches = requiredAirports.every((airport) => observation.airportCodes.includes(airport));
  (routeMatches ? matchedRules : failedRules).push('retailer route');

  const flightTokens = new Set(observation.flightNumbers.map((token) => token.replace(/\s+/g, '').toUpperCase()));
  const segmentIdentityMatches = itinerary.segments.every((segment) => {
    const marketing = normalizeFlight(segment.marketingCarrier.code, segment.marketingFlightNumber);
    const operating = segment.operatingCarrier && segment.operatingFlightNumber ? normalizeFlight(segment.operatingCarrier.code, segment.operatingFlightNumber) : null;
    return flightTokens.has(marketing) || Boolean(operating && flightTokens.has(operating));
  });
  (segmentIdentityMatches ? matchedRules : missingRules).push('retailer flight identity');

  const expectedDates = [...new Set(itinerary.segments.filter((segment, index, segments) => index === 0 || segment.sliceIndex !== segments[index - 1]?.sliceIndex).map((segment) => segment.departureLocal.slice(0, 10)))];
  const retailerDates = new Set(observation.dateTokens.flatMap((token) => {
    const normalized = normalizeDateToken(token);
    return normalized ? [normalized] : [];
  }));
  const datesConfirmed = expectedDates.every((date) => retailerDates.has(date));
  (datesConfirmed ? matchedRules : missingRules).push('retailer travel date');

  const longLegs = itinerary.segments.filter((segment) => (segment.durationMinutes ?? 0) > policy.cabin.longLegMinimumMinutes);
  const cabinConfirmed = longLegs.every((segment) => {
    const marketing = normalizeFlight(segment.marketingCarrier.code, segment.marketingFlightNumber);
    const operating = segment.operatingCarrier && segment.operatingFlightNumber ? normalizeFlight(segment.operatingCarrier.code, segment.operatingFlightNumber) : null;
    return observation.flightCabinEvidence.some((evidence) => (evidence.flightNumber === marketing || evidence.flightNumber === operating) && evidence.cabins.some((cabin) => cabin.includes('BUSINESS') || cabin.includes('FIRST')));
  });
  (cabinConfirmed ? matchedRules : missingRules).push('retailer long-leg cabin');

  const adults = Math.max(1, itinerary.passengers.adults);
  const originalCurrencyPrices = observation.prices.filter((price) => price.currency === policy.currency);
  const normalizedPrices = originalCurrencyPrices.map((price) => ({
    amountMinor: price.basis === 'total' ? Math.round(price.amountMinor / adults) : price.amountMinor,
    basis: price.basis,
  }));
  const linkReproduced = link.currency === policy.currency && link.pricePerPersonMinor !== undefined && normalizedPrices.some((price) => Math.abs(price.amountMinor - link.pricePerPersonMinor!) <= 2_000);
  const explicitPrice = normalizedPrices.find((price) => price.basis !== 'unknown' && price.amountMinor <= policy.maximumPricePerPersonMinor);
  const pricePerPersonMinor = explicitPrice?.amountMinor ?? (linkReproduced ? link.pricePerPersonMinor : undefined);
  const priceConfirmed = pricePerPersonMinor !== undefined && pricePerPersonMinor <= policy.maximumPricePerPersonMinor;
  if (priceConfirmed) matchedRules.push('retailer price');
  else if (originalCurrencyPrices.length) failedRules.push('retailer price');
  else missingRules.push('retailer price');

  if (observation.blocker) failedRules.push(`retailer ${observation.blocker}`);
  const alertEligible = failedRules.length === 0 && missingRules.length === 0;
  const classification = alertEligible ? 'exact' : failedRules.length ? 'mismatch' : 'possible';
  return { classification, alertEligible, pricePerPersonMinor, matchedRules, missingRules, failedRules };
}