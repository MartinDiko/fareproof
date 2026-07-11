import type { FareSearchPolicy, ObservedItinerary } from '@fareproof/core';
import type { PolicyObservation } from '../shared/state';

export interface FareEvidenceView {
  id: string;
  route: string;
  travelDates: string;
  cabin: string;
  flights: string;
  fareIdentity: string;
  totalMinor: number;
  perPersonMinor: number;
  matrixPricePerPersonMinor: number;
  bookWithMatrixPricePerPersonMinor?: number;
  bookWithMatrixCurrency?: string;
  bookWithMatrixCadPricePerPersonMinor?: number;
  retailerPricePerPersonMinor?: number;
  retailerOriginalPricePerPersonMinor?: number;
  retailerOriginalCurrency?: string;
  usdToCadRate?: number;
  exchangeRateDate?: string;
  priceDifferenceMinor?: number;
  currency: string;
  passengers: number;
  source: string;
  stageLabel: string;
  stageTone: 'neutral' | 'warning' | 'success';
  policyName?: string;
  retailer?: string;
  observedAt: string;
  matchedRules: string[];
  missingRules: string[];
  failedRules: string[];
  message?: string;
  bookingUrl?: string;
  reviewUrl?: string;
}

function passengerCount(itinerary: ObservedItinerary): number {
  return itinerary.passengers.adults + itinerary.passengers.children + itinerary.passengers.infants;
}

function formatFlights(itinerary: ObservedItinerary): string {
  return itinerary.segments.map((segment) => {
    const marketing = `${segment.marketingCarrier.code} ${segment.marketingFlightNumber}`;
    const operating = segment.operatingCarrier && segment.operatingFlightNumber
      ? ` operated by ${segment.operatingCarrier.code} ${segment.operatingFlightNumber}`
      : '';
    return `${marketing}${operating}`;
  }).join(' · ');
}

function formatTravelDates(itinerary: ObservedItinerary): string {
  return [...new Set(itinerary.segments.map((segment) => segment.departureLocal.slice(0, 10)))].join(' · ');
}

function formatCabin(itinerary: ObservedItinerary): string {
  return [...new Set(itinerary.segments.map((segment) => segment.cabin?.replaceAll('_', ' ') ?? 'Cabin unconfirmed'))].join(' / ');
}

function formatFareIdentity(itinerary: ObservedItinerary): string {
  const bookingClasses = itinerary.fareIdentity.bookingClasses.join('/') || 'Class unconfirmed';
  const fareBases = itinerary.fareIdentity.fareBasisCodes.join('/') || 'Fare basis unconfirmed';
  return `${bookingClasses} · ${fareBases}`;
}

function stageDetails(observation?: PolicyObservation): Pick<FareEvidenceView, 'stageLabel' | 'stageTone'> {
  if (!observation) return { stageLabel: 'ITA fare captured', stageTone: 'neutral' };
  const failedRules = observation.failedRules ?? [];
  if (observation.stage === 'retailer-result-reproduced' && observation.missingRules.length === 0 && failedRules.length === 0) {
    return { stageLabel: 'Agency price validated', stageTone: 'success' };
  }
  if (observation.stage === 'bookwithmatrix-handoff') {
    return { stageLabel: observation.missingRules.includes('supported agency booking link') ? 'No agency link available' : 'Checking agency prices', stageTone: 'warning' };
  }
  if (observation.stage === 'manual-confirmation-required' && observation.retailer) {
    if (failedRules.includes('retailer price')) return { stageLabel: 'Agency price did not qualify', stageTone: 'warning' };
    return { stageLabel: failedRules.length ? 'Agency result did not match' : 'Agency verification incomplete', stageTone: 'warning' };
  }
  if (observation.stage === 'manual-confirmation-required') return { stageLabel: 'Manual verification needed', stageTone: 'warning' };
  return { stageLabel: 'ITA policy evidence', stageTone: observation.missingRules.length ? 'warning' : 'neutral' };
}

export function buildFareEvidenceView(
  itinerary: ObservedItinerary,
  observation: PolicyObservation | undefined,
  policies: FareSearchPolicy[],
): FareEvidenceView {
  const passengers = passengerCount(itinerary);
  const pricedPassengers = Math.max(1, itinerary.passengers.adults);
  const stage = stageDetails(observation);
  const failedRules = observation?.failedRules ?? [];
  const matrixPricePerPersonMinor = Math.round(itinerary.fare.total.amountMinor / pricedPassengers);
  const retailerPricePerPersonMinor = observation?.retailerPricePerPersonMinor
    ?? (observation?.stage === 'retailer-result-reproduced' ? observation.pricePerPersonMinor : undefined);
  const isValidated = observation?.stage === 'retailer-result-reproduced'
    && observation.missingRules.length === 0
    && failedRules.length === 0
    && retailerPricePerPersonMinor !== undefined;
  const bookingUrl = isValidated && observation.url.startsWith('https://') ? observation.url : undefined;
  const reviewUrl = observation?.retailer && !isValidated && observation.url.startsWith('https://') ? observation.url : undefined;
  const perPersonMinor = retailerPricePerPersonMinor ?? matrixPricePerPersonMinor;
  const first = itinerary.segments[0];
  const last = itinerary.segments.at(-1);
  return {
    id: observation?.id ?? itinerary.id,
    route: `${first?.origin.code ?? '?'} → ${last?.destination.code ?? '?'}`,
    travelDates: formatTravelDates(itinerary),
    cabin: formatCabin(itinerary),
    flights: formatFlights(itinerary),
    fareIdentity: formatFareIdentity(itinerary),
    totalMinor: retailerPricePerPersonMinor === undefined ? itinerary.fare.total.amountMinor : perPersonMinor * pricedPassengers,
    perPersonMinor,
    matrixPricePerPersonMinor,
    bookWithMatrixPricePerPersonMinor: observation?.bookWithMatrixPricePerPersonMinor,
    bookWithMatrixCurrency: observation?.bookWithMatrixCurrency ?? (observation?.bookWithMatrixPricePerPersonMinor !== undefined ? itinerary.fare.total.currency : undefined),
    bookWithMatrixCadPricePerPersonMinor: observation?.bookWithMatrixCadPricePerPersonMinor
      ?? (observation?.bookWithMatrixCurrency === undefined || observation.bookWithMatrixCurrency === 'CAD' ? observation?.bookWithMatrixPricePerPersonMinor : undefined),
    retailerPricePerPersonMinor,
    retailerOriginalPricePerPersonMinor: observation?.retailerOriginalPricePerPersonMinor,
    retailerOriginalCurrency: observation?.retailerOriginalCurrency,
    usdToCadRate: observation?.usdToCadRate,
    exchangeRateDate: observation?.exchangeRateDate,
    priceDifferenceMinor: retailerPricePerPersonMinor === undefined ? undefined : retailerPricePerPersonMinor - matrixPricePerPersonMinor,
    currency: itinerary.fare.total.currency,
    passengers,
    source: observation?.retailer ?? itinerary.sourceSite,
    stageLabel: stage.stageLabel,
    stageTone: stage.stageTone,
    policyName: policies.find((policy) => policy.id === observation?.policyId)?.name,
    retailer: observation?.retailer,
    observedAt: observation?.observedAt ?? itinerary.observedAt,
    matchedRules: observation?.matchedRules ?? [],
    missingRules: observation?.missingRules ?? [],
    failedRules,
    message: observation?.message,
    bookingUrl,
    reviewUrl,
  };
}

export function latestEvidence(
  current: ObservedItinerary | null,
  observations: PolicyObservation[],
  policies: FareSearchPolicy[],
): FareEvidenceView | null {
  const observation = observations[0];
  if (observation && (!current || Date.parse(observation.observedAt) >= Date.parse(current.observedAt))) {
    return buildFareEvidenceView(observation.itinerary, observation, policies);
  }
  return current ? buildFareEvidenceView(current, undefined, policies) : null;
}

export function latestValidatedEvidence(
  observations: PolicyObservation[],
  policies: FareSearchPolicy[],
): FareEvidenceView | null {
  const observation = observations.find((item) => item.stage === 'retailer-result-reproduced' && item.missingRules.length === 0 && !(item.failedRules?.length) && item.url.startsWith('https://'));
  return observation ? buildFareEvidenceView(observation.itinerary, observation, policies) : null;
}