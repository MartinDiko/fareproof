import { z } from 'zod';
import { observedItinerarySchema, type ObservedItinerary } from './domain';
import { fareSearchPolicySchema, type FareSearchPolicy } from './searchPolicies';

const MAX_MATRIX_JSON_BYTES = 512_000;

const matrixAirportSchema = z.object({ code: z.string().regex(/^[A-Z]{3}$/), name: z.string().optional() });
const matrixCarrierSchema = z.object({ code: z.string().min(2).max(3), shortName: z.string().optional() });
const matrixSegmentSchema = z.object({
  bookingInfos: z.array(z.object({ bookingCode: z.string().optional(), cabin: z.string().optional() })).optional(),
  carrier: matrixCarrierSchema,
  destination: matrixAirportSchema,
  origin: matrixAirportSchema,
  flight: z.object({ number: z.union([z.string(), z.number()]) }),
  legs: z.array(z.object({
    aircraft: z.object({ shortName: z.string().optional() }).optional(),
    arrival: z.string(),
    departure: z.string(),
    duration: z.number().int().positive().optional(),
  })).optional(),
  arrival: z.string(),
  departure: z.string(),
  duration: z.number().int().positive().optional(),
  operationalFlight: z.object({ number: z.union([z.string(), z.number()]), carrier: matrixCarrierSchema }).optional(),
});

const matrixItineraryJsonSchema = z.object({
  ext: z.object({ totalPrice: z.string() }),
  itinerary: z.object({
    slices: z.array(z.object({
      ext: z.object({ warnings: z.string().optional() }).optional(),
      segments: z.array(matrixSegmentSchema).min(1),
    })).min(1),
  }),
  pricings: z.array(z.object({ ext: z.object({ pax: z.object({ adults: z.number().int().positive() }).optional(), totalPrice: z.string().optional() }).optional() })).optional(),
  tickets: z.array(z.object({
    pricings: z.array(z.object({
      fareCalculations: z.array(z.object({ lines: z.array(z.string()) })).optional(),
      fares: z.array(z.object({
        bookingInfos: z.array(z.object({ bookingCode: z.string().optional(), cabin: z.string().optional(), segment: z.object({ origin: z.string(), destination: z.string() }) })).optional(),
        carrier: z.string().optional(),
        code: z.string().optional(),
        ptcs: z.array(z.string()).optional(),
      })).optional(),
      notes: z.array(z.string()).optional(),
    })).optional(),
  })).optional(),
  displayTotal: z.string().optional(),
  id: z.union([z.string(), z.number()]).optional(),
  passengerCount: z.number().int().positive().optional(),
});

export interface MatrixSearchTask {
  id: string;
  policyId: string;
  startDate: string;
  latestDate: string;
  url: string;
}

function parseMatrixMoney(value: string): { amountMinor: number; currency: string } {
  const match = /^([A-Z]{3})(\d+(?:\.\d{1,2})?)$/.exec(value.trim());
  if (!match?.[1] || !match[2]) throw new Error(`Unsupported Matrix money value: ${value}`);
  return { currency: match[1], amountMinor: Math.round(Number(match[2]) * 100) };
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function encodeSearch(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return encodeURIComponent(btoa(binary));
}

export function buildMatrixSearchTasks(input: FareSearchPolicy): MatrixSearchTask[] {
  const policy = fareSearchPolicySchema.parse(input);
  const tasks: MatrixSearchTask[] = [];
  let startDate = policy.departureDateRange.earliest;
  let index = 0;
  while (startDate <= policy.departureDateRange.latest) {
    const dates: Record<string, unknown> = {
      searchDateType: 'calendar',
      departureDate: startDate,
      departureDateType: 'depart',
      departureDateModifier: '0',
      departureDatePreferredTimes: [],
      returnDateType: 'depart',
      returnDateModifier: '0',
      returnDatePreferredTimes: [],
    };
    if (policy.tripType === 'round-trip' && policy.returnWindow) {
      dates.duration = `${policy.returnWindow.minimumDaysAfterDeparture}-${policy.returnWindow.maximumDaysAfterDeparture}`;
    }
    const options: Record<string, unknown> = {
      cabin: 'BUSINESS',
      extraStops: '1',
      allowAirportChanges: 'false',
      showOnlyAvailable: 'true',
      currency: { displayName: `Canadian Dollar (${policy.currency})`, code: policy.currency },
    };
    if (policy.routing.maximumStops !== undefined) options.stops = String(policy.routing.maximumStops);
    const search = {
      type: policy.tripType === 'round-trip' ? 'round-trip' : 'one-way',
      slices: [{ origin: policy.origins, dest: policy.destinations, dates }],
      options,
      pax: { adults: String(policy.passengers.adults) },
    };
    tasks.push({
      id: `${policy.id}-${index}`,
      policyId: policy.id,
      startDate,
      latestDate: policy.departureDateRange.latest,
      url: `https://matrix.itasoftware.com/calendar?search=${encodeSearch(search)}`,
    });
    startDate = addDays(startDate, 30);
    index += 1;
  }
  return tasks;
}

export function parseMatrixItineraryJson(text: string, sourceUrl: string, now = new Date()): ObservedItinerary {
  if (new TextEncoder().encode(text).byteLength > MAX_MATRIX_JSON_BYTES) throw new Error('Matrix itinerary exceeds the 500 KB limit.');
  let unknownPayload: unknown;
  try {
    unknownPayload = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Matrix itinerary is not valid JSON.');
  }
  const payload = matrixItineraryJsonSchema.parse(unknownPayload);
  const ticketPricing = payload.tickets?.flatMap((ticket) => ticket.pricings ?? [])[0];
  const fares = ticketPricing?.fares ?? [];
  const fareForSegment = (origin: string, destination: string) => fares.find((fare) => fare.bookingInfos?.some((info) => info.segment.origin === origin && info.segment.destination === destination));
  const segments = payload.itinerary.slices.flatMap((slice, sliceIndex) => slice.segments.map((segment) => {
    const fare = fareForSegment(segment.origin.code, segment.destination.code);
    const booking = segment.bookingInfos?.[0] ?? fare?.bookingInfos?.[0];
    const cabin = booking?.cabin?.replace(/\s+/g, '_').toUpperCase();
    const legsDuration = segment.legs?.reduce((sum, leg) => sum + (leg.duration ?? 0), 0);
    return {
      sliceIndex,
      origin: { code: segment.origin.code, airportName: segment.origin.name },
      destination: { code: segment.destination.code, airportName: segment.destination.name },
      departureLocal: segment.departure,
      arrivalLocal: segment.arrival,
      durationMinutes: segment.duration ?? (legsDuration ? legsDuration : undefined),
      marketingCarrier: { code: segment.carrier.code, name: segment.carrier.shortName },
      marketingFlightNumber: String(segment.flight.number),
      operatingCarrier: segment.operationalFlight ? { code: segment.operationalFlight.carrier.code, name: segment.operationalFlight.carrier.shortName } : undefined,
      operatingFlightNumber: segment.operationalFlight ? String(segment.operationalFlight.number) : undefined,
      bookingClass: booking?.bookingCode,
      cabin: cabin === 'ECONOMY' || cabin === 'PREMIUM_ECONOMY' || cabin === 'BUSINESS' || cabin === 'FIRST' ? cabin : undefined,
      fareBasis: fare?.code,
      aircraft: segment.legs?.[0]?.aircraft?.shortName,
    };
  }));
  const total = parseMatrixMoney(payload.ext.totalPrice || payload.displayTotal || '');
  const adults = payload.passengerCount ?? payload.pricings?.[0]?.ext?.pax?.adults ?? 1;
  return observedItinerarySchema.parse({
    id: `ita-${String(payload.id ?? now.getTime())}`,
    sourceSite: 'ita-matrix',
    sourceUrl,
    observedAt: now.toISOString(),
    tripType: payload.itinerary.slices.length > 1 ? 'round-trip' : 'one-way',
    passengers: { adults, children: 0, infants: 0 },
    segments,
    fare: { total: { ...total, originalText: payload.ext.totalPrice } },
    fareIdentity: {
      validatingCarrier: fares[0]?.carrier ? { code: fares[0].carrier } : undefined,
      fareOwner: fares[0]?.carrier ? { code: fares[0].carrier } : undefined,
      fareBasisCodes: [...new Set(fares.flatMap((fare) => fare.code ? [fare.code] : []))],
      bookingClasses: [...new Set(segments.flatMap((segment) => segment.bookingClass ? [segment.bookingClass] : []))],
      passengerTypeCodes: [...new Set(fares.flatMap((fare) => fare.ptcs ?? []))],
    },
    warnings: [
      ...payload.itinerary.slices.flatMap((slice) => slice.ext?.warnings ? [slice.ext.warnings] : []),
      ...(ticketPricing?.notes ?? []),
    ],
    verificationStage: 'ita-only',
    extractionConfidence: 98,
  });
}