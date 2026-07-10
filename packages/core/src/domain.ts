import { z } from 'zod';

export const cabinClasses = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] as const;
export const verificationStages = [
  'ita-only',
  'search-result-reproduced',
  'retailer-result-reproduced',
  'itinerary-selectable',
  'fare-survived-selection',
  'passenger-details-reached',
  'payment-page-reached',
  'manual-confirmation-required',
  'unavailable',
] as const;

export const moneySchema = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  originalText: z.string().optional(),
});

const airportSchema = z.object({ code: z.string().regex(/^[A-Z]{3}$/) });
const carrierSchema = z.object({ code: z.string().regex(/^[A-Z0-9]{2,3}$/), name: z.string().optional() });

export const flightSegmentSchema = z.object({
  sliceIndex: z.number().int().nonnegative().optional(),
  origin: airportSchema,
  destination: airportSchema,
  departureLocal: z.string().min(10),
  arrivalLocal: z.string().min(10),
  durationMinutes: z.number().int().positive().optional(),
  marketingCarrier: carrierSchema,
  marketingFlightNumber: z.string().min(1),
  operatingCarrier: carrierSchema.optional(),
  operatingFlightNumber: z.string().optional(),
  bookingClass: z.string().optional(),
  cabin: z.enum(cabinClasses).optional(),
  fareBasis: z.string().optional(),
  aircraft: z.string().optional(),
});

export const observedItinerarySchema = z.object({
  id: z.string().min(1),
  sourceSite: z.string().min(1),
  sourceUrl: z.string(),
  observedAt: z.string(),
  tripType: z.enum(['one-way', 'round-trip', 'multi-city']),
  passengers: z.object({ adults: z.number().int().positive(), children: z.number().int().nonnegative().default(0), infants: z.number().int().nonnegative().default(0) }),
  segments: z.array(flightSegmentSchema).min(1),
  fare: z.object({ total: moneySchema }),
  fareIdentity: z.object({
    validatingCarrier: carrierSchema.optional(),
    fareOwner: carrierSchema.optional(),
    fareBasisCodes: z.array(z.string()),
    bookingClasses: z.array(z.string()),
    pointOfSaleCountry: z.string().optional(),
    passengerTypeCodes: z.array(z.string()),
  }),
  warnings: z.array(z.string()),
  verificationStage: z.enum(verificationStages),
  extractionConfidence: z.number().min(0).max(100),
});

export type Money = z.infer<typeof moneySchema>;
export type FlightSegment = z.infer<typeof flightSegmentSchema>;
export type ObservedItinerary = z.infer<typeof observedItinerarySchema>;
export type VerificationStage = (typeof verificationStages)[number];

export interface FareWatchCriteria {
  target: ObservedItinerary;
  priceRule: { maximumTotal: Money; percentTolerance: number };
  itineraryRule: {
    requireSameJourney: boolean;
    requireSameMarketingFlight: boolean;
    allowOperatingFlightMatch: boolean;
    allowCodeshareSubstitution: boolean;
    requireSameCabinEverySegment: boolean;
  };
  fareRule: {
    requireSameBookingClass: boolean;
    requireSameFareBasis: boolean;
    requireSameValidatingCarrier: boolean;
  };
  verificationRule: { minimumStage: VerificationStage; minimumConfidence: number };
}

export interface FareWatch {
  id: string;
  createdAt: string;
  state: 'captured' | 'pending-verification' | 'checking' | 'possible-match' | 'strong-match' | 'exact-match' | 'repriced' | 'manual-action-required' | 'blocked' | 'adapter-failure';
  criteria: FareWatchCriteria;
  fingerprints: Fingerprints;
}

export const fareWatchSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string(),
  state: z.enum(['captured', 'pending-verification', 'checking', 'possible-match', 'strong-match', 'exact-match', 'repriced', 'manual-action-required', 'blocked', 'adapter-failure']),
  criteria: z.object({
    target: observedItinerarySchema,
    priceRule: z.object({ maximumTotal: moneySchema, percentTolerance: z.number().nonnegative() }),
    itineraryRule: z.object({
      requireSameJourney: z.boolean(),
      requireSameMarketingFlight: z.boolean(),
      allowOperatingFlightMatch: z.boolean(),
      allowCodeshareSubstitution: z.boolean(),
      requireSameCabinEverySegment: z.boolean(),
    }),
    fareRule: z.object({
      requireSameBookingClass: z.boolean(),
      requireSameFareBasis: z.boolean(),
      requireSameValidatingCarrier: z.boolean(),
    }),
    verificationRule: z.object({ minimumStage: z.enum(verificationStages), minimumConfidence: z.number().min(0).max(100) }),
  }),
  fingerprints: z.object({ physical: z.array(z.string()), marketing: z.array(z.string()), fare: z.string(), journey: z.string() }),
});

export const fareProofExportSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string(),
  watches: z.array(fareWatchSchema),
});

export type FareProofExport = z.infer<typeof fareProofExportSchema>;

export interface Fingerprints {
  physical: string[];
  marketing: string[];
  fare: string;
  journey: string;
}

export interface ComparisonResult {
  overallClassification: 'exact' | 'strong' | 'possible' | 'mismatch' | 'insufficient-evidence';
  score: number;
  matchedFields: string[];
  mismatchedFields: string[];
  unknownFields: string[];
  humanSummary: string[];
  alertEligible: boolean;
}