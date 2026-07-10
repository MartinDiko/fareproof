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
  bookingUrl?: string;
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
  if (observation.stage === 'retailer-result-reproduced' && observation.missingRules.length === 0) {
    return { stageLabel: 'Retailer validated', stageTone: 'success' };
  }
  if (observation.stage === 'bookwithmatrix-handoff') {
    return { stageLabel: observation.missingRules.length ? 'Manual verification needed' : 'BookWithMatrix accepted', stageTone: 'warning' };
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
  const stage = stageDetails(observation);
  const isValidated = observation?.stage === 'retailer-result-reproduced' && observation.missingRules.length === 0;
  const bookingUrl = isValidated && observation.url.startsWith('https://') ? observation.url : undefined;
  const perPersonMinor = observation?.pricePerPersonMinor ?? Math.round(itinerary.fare.total.amountMinor / Math.max(1, passengers));
  const first = itinerary.segments[0];
  const last = itinerary.segments.at(-1);
  return {
    id: observation?.id ?? itinerary.id,
    route: `${first?.origin.code ?? '?'} → ${last?.destination.code ?? '?'}`,
    travelDates: formatTravelDates(itinerary),
    cabin: formatCabin(itinerary),
    flights: formatFlights(itinerary),
    fareIdentity: formatFareIdentity(itinerary),
    totalMinor: observation ? perPersonMinor * passengers : itinerary.fare.total.amountMinor,
    perPersonMinor,
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
    bookingUrl,
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
  const observation = observations.find((item) => item.stage === 'retailer-result-reproduced' && item.missingRules.length === 0 && item.url.startsWith('https://'));
  return observation ? buildFareEvidenceView(observation.itinerary, observation, policies) : null;
}