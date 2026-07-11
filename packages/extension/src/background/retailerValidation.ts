import type { FareSearchPolicy, ObservedItinerary } from '@fareproof/core';
import type { BookWithMatrixResultLink, RetailerPageObservation } from '../shared/messages';
import { convertUsdToCad } from './exchangeRates';

export interface RetailerValidationResult {
  classification: 'exact' | 'possible' | 'mismatch';
  alertEligible: boolean;
  pricePerPersonMinor?: number;
  originalPricePerPersonMinor?: number;
  originalCurrency?: string;
  usdToCadRate?: number;
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
  usdToCadRate?: number,
): RetailerValidationResult {
  const matchedRules: string[] = [];
  const missingRules: string[] = [];
  const failedRules: string[] = [];
  const requiredAirports = [...new Set(itinerary.segments.flatMap((segment) => [segment.origin.code, segment.destination.code]))];
  const routeMatches = requiredAirports.every((airport) => observation.airportCodes.includes(airport));
  const observedRequiredAirports = requiredAirports.filter((airport) => observation.airportCodes.includes(airport));
  const observedAirports = observation.airportCodes.filter((airport) => !['CAD', 'USD', 'EUR', 'GBP'].includes(airport));
  const enoughRouteEvidence = observedRequiredAirports.length > 0 && observedAirports.length >= requiredAirports.length;
  const routeRule = routeMatches ? matchedRules : enoughRouteEvidence ? failedRules : missingRules;
  routeRule.push('retailer route');

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
  const normalizedPrices = observation.prices.flatMap((price) => {
    const originalAmountMinor = price.basis === 'total' ? Math.round(price.amountMinor / adults) : price.amountMinor;
    if (price.currency === policy.currency) return [{ amountMinor: originalAmountMinor, originalAmountMinor, originalCurrency: price.currency, basis: price.basis }];
    if (price.currency === 'USD' && policy.currency === 'CAD' && usdToCadRate !== undefined) {
      return [{ amountMinor: convertUsdToCad(originalAmountMinor, usdToCadRate), originalAmountMinor, originalCurrency: price.currency, basis: price.basis }];
    }
    return [];
  });
  const matrixPricePerPersonMinor = Math.round(itinerary.fare.total.amountMinor / adults);
  const linkPriceInPolicyCurrency = link.pricePerPersonMinor === undefined
    ? undefined
    : link.currency === policy.currency
      ? link.pricePerPersonMinor
      : link.currency === 'USD' && policy.currency === 'CAD' && usdToCadRate !== undefined
        ? convertUsdToCad(link.pricePerPersonMinor, usdToCadRate)
        : undefined;
  const referencePrice = linkPriceInPolicyCurrency ?? matrixPricePerPersonMinor;
  const explicitPrice = normalizedPrices
    .filter((price) => price.basis !== 'unknown')
    .sort((left, right) => Math.abs(left.amountMinor - referencePrice) - Math.abs(right.amountMinor - referencePrice))[0];
  const reproducedPrice = normalizedPrices.find((price) => Math.abs(price.amountMinor - referencePrice) <= 2_000);
  const selectedPrice = explicitPrice ?? reproducedPrice;
  const pricePerPersonMinor = selectedPrice?.amountMinor;
  const priceConfirmed = pricePerPersonMinor !== undefined && pricePerPersonMinor <= policy.maximumPricePerPersonMinor;
  if (priceConfirmed) matchedRules.push('retailer price');
  else if (normalizedPrices.length) failedRules.push('retailer price');
  else {
    missingRules.push('retailer price');
    if (observation.prices.some((price) => price.currency === 'USD') && policy.currency === 'CAD' && usdToCadRate === undefined) missingRules.push('USD to CAD exchange rate');
    const unsupportedCurrencies = [...new Set(observation.prices.map((price) => price.currency).filter((currency) => currency !== policy.currency && currency !== 'USD'))];
    if (unsupportedCurrencies.length) missingRules.push(`unsupported agency currency: ${unsupportedCurrencies.join('/')}`);
  }

  if (observation.blocker) failedRules.push(`retailer ${observation.blocker}`);
  const alertEligible = failedRules.length === 0 && missingRules.length === 0;
  const classification = alertEligible ? 'exact' : failedRules.length ? 'mismatch' : 'possible';
  return {
    classification,
    alertEligible,
    pricePerPersonMinor,
    originalPricePerPersonMinor: selectedPrice?.originalAmountMinor,
    originalCurrency: selectedPrice?.originalCurrency,
    usdToCadRate: selectedPrice?.originalCurrency === 'USD' ? usdToCadRate : undefined,
    matchedRules,
    missingRules,
    failedRules,
  };
}