import { z } from 'zod';
import type { FlightSegment, ObservedItinerary } from './domain';

const airportCodeSchema = z.string().regex(/^[A-Z]{3}$/);

export const fareSearchPolicySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  tripType: z.enum(['one-way', 'round-trip', 'return-only']),
  origins: z.array(airportCodeSchema).min(1),
  destinations: z.array(airportCodeSchema).min(1),
  departureDateRange: z.object({ earliest: z.iso.date(), latest: z.iso.date() }),
  returnWindow: z.object({ minimumDaysAfterDeparture: z.number().int().positive(), maximumDaysAfterDeparture: z.number().int().positive() }).optional(),
  linkedOutboundPolicyIds: z.array(z.string()).optional(),
  passengers: z.object({ adults: z.number().int().positive() }),
  maximumPricePerPersonMinor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  routing: z.object({
    minimumStops: z.number().int().nonnegative().optional(),
    maximumStops: z.number().int().nonnegative().optional(),
    allowedConnectionCountries: z.array(z.string().length(2)).optional(),
  }),
  cabin: z.object({
    longLegMinimumMinutes: z.number().int().positive(),
    longLegAllowed: z.array(z.enum(['BUSINESS', 'FIRST'])).min(1),
    shortLegAllowed: z.array(z.enum(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'])).min(1),
  }),
  schedule: z.object({ intervalMinutes: z.number().int().min(5), enabled: z.boolean() }),
});

export type FareSearchPolicy = z.infer<typeof fareSearchPolicySchema>;

export interface PolicyMatchResult {
  matches: boolean;
  matchedRules: string[];
  failedRules: string[];
  unknownRules: string[];
  pricePerPersonMinor: number;
}

const defaultCabinRule: FareSearchPolicy['cabin'] = {
  longLegMinimumMinutes: 360,
  longLegAllowed: ['BUSINESS', 'FIRST'],
  shortLegAllowed: ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'],
};

const defaultSchedule: FareSearchPolicy['schedule'] = { intervalMinutes: 5, enabled: true };

export const defaultFareSearchPolicies: FareSearchPolicy[] = [
  {
    id: 'fare-1-yvr-fra-one-way',
    name: 'Fare 1 · YVR to FRA one way',
    enabled: true,
    tripType: 'one-way',
    origins: ['YVR'],
    destinations: ['FRA'],
    departureDateRange: { earliest: '2026-09-01', latest: '2026-09-30' },
    passengers: { adults: 2 },
    maximumPricePerPersonMinor: 160_000,
    currency: 'CAD',
    routing: { maximumStops: 1, allowedConnectionCountries: ['CA'] },
    cabin: defaultCabinRule,
    schedule: defaultSchedule,
  },
  {
    id: 'fare-2-yvr-skg-tia-one-way',
    name: 'Fare 2 · YVR to SKG or TIA one way',
    enabled: true,
    tripType: 'one-way',
    origins: ['YVR'],
    destinations: ['SKG', 'TIA'],
    departureDateRange: { earliest: '2026-09-01', latest: '2026-09-30' },
    passengers: { adults: 2 },
    maximumPricePerPersonMinor: 160_000,
    currency: 'CAD',
    routing: {},
    cabin: defaultCabinRule,
    schedule: defaultSchedule,
  },
  {
    id: 'fare-1-1-yvr-fra-round-trip',
    name: 'Fare 1.1 · YVR to FRA round trip',
    enabled: true,
    tripType: 'round-trip',
    origins: ['YVR'],
    destinations: ['FRA'],
    departureDateRange: { earliest: '2026-09-01', latest: '2026-09-20' },
    returnWindow: { minimumDaysAfterDeparture: 30, maximumDaysAfterDeparture: 45 },
    passengers: { adults: 2 },
    maximumPricePerPersonMinor: 160_000,
    currency: 'CAD',
    routing: { maximumStops: 1, allowedConnectionCountries: ['CA'] },
    cabin: defaultCabinRule,
    schedule: defaultSchedule,
  },
  {
    id: 'fare-2-1-yvr-skg-tia-round-trip',
    name: 'Fare 2.1 · YVR to SKG or TIA round trip',
    enabled: true,
    tripType: 'round-trip',
    origins: ['YVR'],
    destinations: ['SKG', 'TIA'],
    departureDateRange: { earliest: '2026-09-01', latest: '2026-09-20' },
    returnWindow: { minimumDaysAfterDeparture: 30, maximumDaysAfterDeparture: 45 },
    passengers: { adults: 2 },
    maximumPricePerPersonMinor: 160_000,
    currency: 'CAD',
    routing: {},
    cabin: defaultCabinRule,
    schedule: defaultSchedule,
  },
  {
    id: 'fare-3-return-one-way',
    name: 'Fare 3 · FRA, SKG, or TIA to YVR one way',
    enabled: true,
    tripType: 'return-only',
    origins: ['FRA', 'SKG', 'TIA'],
    destinations: ['YVR'],
    departureDateRange: { earliest: '2026-10-01', latest: '2026-11-14' },
    linkedOutboundPolicyIds: ['fare-1-yvr-fra-one-way', 'fare-2-yvr-skg-tia-one-way'],
    returnWindow: { minimumDaysAfterDeparture: 30, maximumDaysAfterDeparture: 45 },
    passengers: { adults: 2 },
    maximumPricePerPersonMinor: 160_000,
    currency: 'CAD',
    routing: {},
    cabin: defaultCabinRule,
    schedule: defaultSchedule,
  },
].map((policy) => fareSearchPolicySchema.parse(policy));

function datePart(value: string): string {
  return value.slice(0, 10);
}

function segmentDurationMinutes(segment: FlightSegment): number | null {
  if (segment.durationMinutes !== undefined) return segment.durationMinutes;
  const departure = Date.parse(segment.departureLocal);
  const arrival = Date.parse(segment.arrivalLocal);
  if (!Number.isFinite(departure) || !Number.isFinite(arrival)) return null;
  const minutes = Math.round((arrival - departure) / 60_000);
  return minutes > 0 ? minutes : null;
}

function totalPassengers(itinerary: ObservedItinerary): number {
  return itinerary.passengers.adults + itinerary.passengers.children + itinerary.passengers.infants;
}

function itinerarySlices(itinerary: ObservedItinerary): FlightSegment[][] {
  const indexed = new Map<number, FlightSegment[]>();
  for (const segment of itinerary.segments) {
    const index = segment.sliceIndex ?? 0;
    indexed.set(index, [...(indexed.get(index) ?? []), segment]);
  }
  return [...indexed.entries()].sort(([left], [right]) => left - right).map(([, segments]) => segments);
}

export function matchSearchPolicy(
  policy: FareSearchPolicy,
  itinerary: ObservedItinerary,
  airportCountries: Readonly<Record<string, string>> = {},
): PolicyMatchResult {
  const matchedRules: string[] = [];
  const failedRules: string[] = [];
  const unknownRules: string[] = [];
  const slices = itinerarySlices(itinerary);
  const outbound = slices[0] ?? [];
  const inbound = slices[1] ?? [];
  const first = outbound[0];
  const outboundLast = outbound.at(-1);
  const inboundLast = inbound.at(-1);
  const passengers = totalPassengers(itinerary);
  const pricePerPersonMinor = passengers > 0 ? Math.round(itinerary.fare.total.amountMinor / passengers) : itinerary.fare.total.amountMinor;
  const record = (rule: string, passes: boolean) => (passes ? matchedRules : failedRules).push(rule);

  const outboundRouteMatches = Boolean(first && outboundLast && policy.origins.includes(first.origin.code) && policy.destinations.includes(outboundLast.destination.code));
  const returnRouteMatches = policy.tripType !== 'round-trip' || Boolean(inbound[0] && inboundLast && policy.destinations.includes(inbound[0].origin.code) && policy.origins.includes(inboundLast.destination.code));
  record('route', outboundRouteMatches && returnRouteMatches);
  if (first) {
    const departureDate = datePart(first.departureLocal);
    record('departure date', departureDate >= policy.departureDateRange.earliest && departureDate <= policy.departureDateRange.latest);
  } else {
    failedRules.push('departure date');
  }
  record('minimum passengers', itinerary.passengers.adults >= policy.passengers.adults);
  record('original currency', itinerary.fare.total.currency === policy.currency);
  record('maximum price per person', itinerary.fare.total.currency === policy.currency && pricePerPersonMinor <= policy.maximumPricePerPersonMinor);

  const stopsBySlice = slices.map((segments) => Math.max(0, segments.length - 1));
  if (policy.routing.minimumStops !== undefined) record('minimum stops', stopsBySlice.every((stops) => stops >= policy.routing.minimumStops!));
  if (policy.routing.maximumStops !== undefined) record('maximum stops', stopsBySlice.every((stops) => stops <= policy.routing.maximumStops!));
  if (policy.routing.allowedConnectionCountries?.length && stopsBySlice.some((stops) => stops > 0)) {
    const connectionCodes = slices.flatMap((segments) => segments.slice(0, -1).map((segment) => segment.destination.code));
    const countries = connectionCodes.map((code) => airportCountries[code]);
    if (countries.some((country) => country === undefined)) unknownRules.push('connection country');
    else record('connection country', countries.every((country) => policy.routing.allowedConnectionCountries?.includes(country ?? '')));
  }

  for (const [index, segment] of itinerary.segments.entries()) {
    const duration = segmentDurationMinutes(segment);
    if (duration === null || !segment.cabin) {
      unknownRules.push(`segment ${index + 1} cabin duration`);
      continue;
    }
    const allowed = duration > policy.cabin.longLegMinimumMinutes ? policy.cabin.longLegAllowed : policy.cabin.shortLegAllowed;
    record(`segment ${index + 1} cabin`, allowed.includes(segment.cabin as never));
  }

  if (policy.tripType === 'round-trip') record('round trip', itinerary.tripType === 'round-trip');
  if (policy.tripType !== 'round-trip') record('one way', itinerary.tripType === 'one-way');
  if (policy.tripType === 'round-trip' && policy.returnWindow && first && inbound[0]) {
    const departureDay = Date.parse(`${datePart(first.departureLocal)}T00:00:00Z`);
    const returnDay = Date.parse(`${datePart(inbound[0].departureLocal)}T00:00:00Z`);
    const durationDays = Math.round((returnDay - departureDay) / 86_400_000);
    record('return window', durationDays >= policy.returnWindow.minimumDaysAfterDeparture && durationDays <= policy.returnWindow.maximumDaysAfterDeparture);
  }

  return {
    matches: failedRules.length === 0 && unknownRules.length === 0,
    matchedRules,
    failedRules,
    unknownRules,
    pricePerPersonMinor,
  };
}

export interface LinkedReturnResult {
  matches: boolean;
  reason: string;
}

export function matchLinkedReturnWindow(
  policy: FareSearchPolicy,
  returnItinerary: ObservedItinerary,
  outboundItineraries: ObservedItinerary[],
): LinkedReturnResult {
  if (policy.tripType !== 'return-only' || !policy.returnWindow) return { matches: true, reason: 'No linked return window required.' };
  const returnFirst = returnItinerary.segments[0];
  if (!returnFirst) return { matches: false, reason: 'Return itinerary has no first segment.' };
  const returnDay = Date.parse(`${datePart(returnFirst.departureLocal)}T00:00:00Z`);
  for (const outbound of outboundItineraries) {
    const outboundFirst = outbound.segments[0];
    const outboundLast = itinerarySlices(outbound)[0]?.at(-1);
    if (!outboundFirst || !outboundLast || outboundFirst.origin.code !== returnFirst.destination.code || outboundLast.destination.code !== returnFirst.origin.code) continue;
    const outboundDay = Date.parse(`${datePart(outboundFirst.departureLocal)}T00:00:00Z`);
    const durationDays = Math.round((returnDay - outboundDay) / 86_400_000);
    if (durationDays >= policy.returnWindow.minimumDaysAfterDeparture && durationDays <= policy.returnWindow.maximumDaysAfterDeparture) {
      return { matches: true, reason: `Return is ${durationDays} days after the linked outbound.` };
    }
  }
  return { matches: false, reason: 'No observed outbound to the same destination is 30–45 days before this return.' };
}