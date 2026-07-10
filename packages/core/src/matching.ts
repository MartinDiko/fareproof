import { verificationStages, type ComparisonResult, type FareWatch, type FareWatchCriteria, type Fingerprints, type ObservedItinerary } from './domain';

const key = (...parts: Array<string | undefined>) => parts.map((part) => part?.toUpperCase() ?? '?').join('|');
const date = (value: string) => value.slice(0, 10);

export function createFingerprints(itinerary: ObservedItinerary): Fingerprints {
  const physical = itinerary.segments.map((segment) => key(segment.origin.code, segment.destination.code, date(segment.departureLocal), segment.operatingCarrier?.code, segment.operatingFlightNumber));
  const marketing = itinerary.segments.map((segment) => key(segment.origin.code, segment.destination.code, date(segment.departureLocal), segment.marketingCarrier.code, segment.marketingFlightNumber, segment.cabin));
  const journey = physical.join('>');
  const fare = key(marketing.join('>'), itinerary.fareIdentity.bookingClasses.join(','), itinerary.fareIdentity.fareBasisCodes.join(','), itinerary.fareIdentity.validatingCarrier?.code, itinerary.fare.total.currency, String(itinerary.passengers.adults));
  return { physical, marketing, fare, journey };
}

export function createDefaultCriteria(target: ObservedItinerary): FareWatchCriteria {
  const tolerance = Math.max(2_000, Math.round(target.fare.total.amountMinor * 0.015));
  return {
    target,
    priceRule: { maximumTotal: { ...target.fare.total, amountMinor: target.fare.total.amountMinor + tolerance }, percentTolerance: 1.5 },
    itineraryRule: { requireSameJourney: true, requireSameMarketingFlight: false, allowOperatingFlightMatch: true, allowCodeshareSubstitution: true, requireSameCabinEverySegment: true },
    fareRule: { requireSameBookingClass: false, requireSameFareBasis: false, requireSameValidatingCarrier: false },
    verificationRule: { minimumStage: 'itinerary-selectable', minimumConfidence: 85 },
  };
}

export function createWatch(target: ObservedItinerary, now = new Date()): FareWatch {
  return { id: `watch-${now.getTime()}`, createdAt: now.toISOString(), state: 'pending-verification', criteria: createDefaultCriteria(target), fingerprints: createFingerprints(target) };
}

export function compareItinerary(watch: FareWatch, candidate: ObservedItinerary): ComparisonResult {
  const target = watch.criteria.target;
  const matchedFields: string[] = [];
  const mismatchedFields: string[] = [];
  const unknownFields: string[] = [];
  const hardMismatches: string[] = [];
  const targetPrints = watch.fingerprints;
  const candidatePrints = createFingerprints(candidate);

  const record = (name: string, matches: boolean, hard = false) => {
    (matches ? matchedFields : mismatchedFields).push(name);
    if (!matches && hard) hardMismatches.push(name);
  };

  record('journey', targetPrints.journey === candidatePrints.journey, watch.criteria.itineraryRule.requireSameJourney);
  record('travel date', target.segments.every((segment, index) => date(segment.departureLocal) === date(candidate.segments[index]?.departureLocal ?? '')), true);
  record('origin and destination', target.segments.every((segment, index) => segment.origin.code === candidate.segments[index]?.origin.code && segment.destination.code === candidate.segments[index]?.destination.code), true);
  record('cabin on every segment', target.segments.every((segment, index) => segment.cabin === candidate.segments[index]?.cabin), watch.criteria.itineraryRule.requireSameCabinEverySegment);
  record('marketing flight', targetPrints.marketing.join('>') === candidatePrints.marketing.join('>'), watch.criteria.itineraryRule.requireSameMarketingFlight);
  record('passenger count', target.passengers.adults === candidate.passengers.adults && target.passengers.children === candidate.passengers.children && target.passengers.infants === candidate.passengers.infants, true);
  const sameCurrency = target.fare.total.currency === candidate.fare.total.currency;
  record('original currency', sameCurrency, true);
  const priceWithinTolerance = sameCurrency && candidate.fare.total.amountMinor <= watch.criteria.priceRule.maximumTotal.amountMinor;
  record('price tolerance', priceWithinTolerance, true);

  const fareChecks: Array<[string, string[], string[]]> = [
    ['booking class', target.fareIdentity.bookingClasses, candidate.fareIdentity.bookingClasses],
    ['fare basis', target.fareIdentity.fareBasisCodes, candidate.fareIdentity.fareBasisCodes],
  ];
  for (const [name, expected, actual] of fareChecks) {
    if (expected.length === 0 || actual.length === 0) unknownFields.push(name);
    else record(name, expected.join('|') === actual.join('|'));
  }

  const weights = { journey: 30, cabin: 15, price: 20, identity: 10, fare: 15, verification: 10 };
  const journeyScore = targetPrints.journey === candidatePrints.journey ? weights.journey : 0;
  const cabinScore = matchedFields.includes('cabin on every segment') ? weights.cabin : 0;
  const priceScore = priceWithinTolerance ? weights.price : 0;
  const identityScore = matchedFields.includes('marketing flight') ? weights.identity : targetPrints.physical.join('>') === candidatePrints.physical.join('>') ? 7 : 0;
  const knownFare = fareChecks.filter(([, expected, actual]) => expected.length > 0 && actual.length > 0);
  const fareScore = knownFare.length === 0 ? 5 : Math.round(weights.fare * knownFare.filter(([name]) => matchedFields.includes(name)).length / knownFare.length);
  const stageIndex = verificationStages.indexOf(candidate.verificationStage);
  const verificationScore = Math.min(weights.verification, Math.max(0, stageIndex * 2));
  const score = hardMismatches.length > 0 ? Math.min(49, journeyScore + cabinScore + priceScore + identityScore + fareScore + verificationScore) : journeyScore + cabinScore + priceScore + identityScore + fareScore + verificationScore;
  const minimumStageMet = stageIndex >= verificationStages.indexOf(watch.criteria.verificationRule.minimumStage) && stageIndex < verificationStages.indexOf('manual-confirmation-required');
  const overallClassification = hardMismatches.length > 0 ? 'mismatch' : score >= 95 ? 'exact' : score >= 85 ? 'strong' : score >= 65 ? 'possible' : 'insufficient-evidence';

  return {
    overallClassification,
    score,
    matchedFields,
    mismatchedFields,
    unknownFields,
    humanSummary: [
      `${overallClassification.toUpperCase()} - ${score}%`,
      ...matchedFields.map((field) => `Match: ${field}`),
      ...mismatchedFields.map((field) => `Mismatch: ${field}`),
      ...unknownFields.map((field) => `Unconfirmed: ${field}`),
    ],
    alertEligible: hardMismatches.length === 0 && score >= watch.criteria.verificationRule.minimumConfidence && minimumStageMet,
  };
}