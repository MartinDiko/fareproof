import { z } from 'zod';
import { fareProofExportSchema, observedItinerarySchema, type FareProofExport, type ObservedItinerary } from './domain';
import { parseMatrixItineraryJson } from './matrix';

const MAX_IMPORT_BYTES = 512_000;

const compactFareSchema = z.object({
  route: z.string().regex(/^[A-Z]{3}-[A-Z]{3}$/),
  date: z.iso.date(),
  marketingCarrier: z.string().min(2).max(3),
  marketingFlightNumber: z.union([z.string(), z.number()]).transform(String),
  operatingCarrier: z.string().min(2).max(3).optional(),
  operatingFlightNumber: z.union([z.string(), z.number()]).transform(String).optional(),
  bookingClass: z.string().optional(),
  cabin: z.enum(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']),
  fareBasis: z.string().optional(),
  currency: z.string().length(3),
  total: z.number().positive(),
});

export function parseImportedFare(text: string, now = new Date()): ObservedItinerary {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    throw new Error('Import exceeds the 500 KB limit.');
  }

  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch {
    throw new Error('The import is not valid JSON.');
  }

  const normalized = observedItinerarySchema.safeParse(input);
  if (normalized.success) return normalized.data;

  try {
    return parseMatrixItineraryJson(text, '', now);
  } catch {
    // Continue to the compact manual shape.
  }

  const compact = compactFareSchema.safeParse(input);
  if (!compact.success) {
    throw new Error('JSON does not match a supported FareProof, Matrix itinerary, or compact fare shape.');
  }

  const value = compact.data;
  const [origin, destination] = value.route.split('-') as [string, string];
  const observedAt = now.toISOString();
  return observedItinerarySchema.parse({
    id: `manual-${now.getTime()}`,
    sourceSite: 'manual-import',
    sourceUrl: '',
    observedAt,
    tripType: 'one-way',
    passengers: { adults: 1, children: 0, infants: 0 },
    segments: [{
      origin: { code: origin },
      destination: { code: destination },
      departureLocal: `${value.date}T00:00:00`,
      arrivalLocal: `${value.date}T00:00:00`,
      marketingCarrier: { code: value.marketingCarrier.toUpperCase() },
      marketingFlightNumber: value.marketingFlightNumber,
      operatingCarrier: value.operatingCarrier ? { code: value.operatingCarrier.toUpperCase() } : undefined,
      operatingFlightNumber: value.operatingFlightNumber,
      bookingClass: value.bookingClass,
      cabin: value.cabin,
      fareBasis: value.fareBasis,
    }],
    fare: { total: { amountMinor: Math.round(value.total * 100), currency: value.currency.toUpperCase(), originalText: `${value.currency.toUpperCase()} ${value.total.toFixed(2)}` } },
    fareIdentity: {
      fareBasisCodes: value.fareBasis ? [value.fareBasis] : [],
      bookingClasses: value.bookingClass ? [value.bookingClass] : [],
      passengerTypeCodes: ['ADT'],
    },
    warnings: ['Times were not present in the compact import and require manual confirmation.'],
    verificationStage: 'ita-only',
    extractionConfidence: 85,
  });
}

export function parseFareProofExport(text: string): FareProofExport {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    throw new Error('Import exceeds the 500 KB limit.');
  }
  try {
    return fareProofExportSchema.parse(JSON.parse(text) as unknown);
  } catch {
    throw new Error('JSON is not a supported FareProof export.');
  }
}