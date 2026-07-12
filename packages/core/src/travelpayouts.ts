import { z } from 'zod';
import { observedItinerarySchema, type ObservedItinerary } from './domain';
import { fareSearchPolicySchema, type FareSearchPolicy } from './searchPolicies';

/**
 * Travelpayouts / Aviasales "Prices for dates" API (aviasales/v3/prices_for_dates).
 *
 * This is an indicative, cached-price discovery source, not a live retailer quote.
 * Records returned here are treated as `search-result-reproduced` candidates: they
 * expose a route, a departure, a marketing flight identity, and an indicative price,
 * but cabin, fare basis, and real-time availability are unknown. A candidate from
 * this adapter still requires the existing retailer-validation stage before it can
 * become a booking-ready alert.
 */

const TRAVELPAYOUTS_ENDPOINT = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';
const AVIASALES_BASE = 'https://www.aviasales.com';
const AIRPORT_CODE = /^[A-Z]{3}$/;
const CARRIER_CODE = /^[A-Z0-9]{2,3}$/;

const travelpayoutsRecordSchema = z.object({
  origin: z.string(),
  destination: z.string(),
  origin_airport: z.string().nullish(),
  destination_airport: z.string().nullish(),
  price: z.number().nonnegative(),
  airline: z.string().nullish(),
  flight_number: z.union([z.number(), z.string()]).nullish(),
  departure_at: z.string().nullish(),
  return_at: z.string().nullish(),
  transfers: z.number().int().nonnegative().nullish(),
  duration: z.number().int().positive().nullish(),
  duration_to: z.number().int().positive().nullish(),
  link: z.string().nullish(),
});

export const travelpayoutsResponseSchema = z.object({
  success: z.boolean().optional(),
  currency: z.string().optional(),
  error: z.string().optional(),
  data: z.array(travelpayoutsRecordSchema).default([]),
});

export type TravelpayoutsResponse = z.infer<typeof travelpayoutsResponseSchema>;

export interface TravelpayoutsUrlParams {
  origin: string;
  destination: string;
  /** `YYYY-MM` (whole month) or `YYYY-MM-DD` (single day). */
  departureAt: string;
  currency: string;
  market?: string;
  oneWay?: boolean;
  limit?: number;
}

export interface TravelpayoutsRequest extends TravelpayoutsUrlParams {
  market: string;
  oneWay: boolean;
  url: string;
}

export interface TravelpayoutsParseContext {
  currency?: string;
  passengersAdults?: number;
  now?: Date;
}

const CURRENCY_TO_MARKET: Record<string, string> = { CAD: 'ca', USD: 'us', GBP: 'gb', EUR: 'ca', AUD: 'au' };

function marketForCurrency(currency: string): string {
  return CURRENCY_TO_MARKET[currency.toUpperCase()] ?? 'ca';
}

/**
 * Builds a Travelpayouts request URL. The affiliate token is intentionally NOT
 * included here: callers pass it as the `X-Access-Token` request header so the
 * token never appears in a URL, log, or the pure core layer.
 */
export function buildTravelpayoutsUrl(params: TravelpayoutsUrlParams): string {
  const market = params.market ?? marketForCurrency(params.currency);
  const url = new URL(TRAVELPAYOUTS_ENDPOINT);
  url.searchParams.set('origin', params.origin.toUpperCase());
  url.searchParams.set('destination', params.destination.toUpperCase());
  url.searchParams.set('departure_at', params.departureAt);
  url.searchParams.set('currency', params.currency.toLowerCase());
  url.searchParams.set('market', market.toLowerCase());
  url.searchParams.set('one_way', String(params.oneWay ?? true));
  url.searchParams.set('sorting', 'price');
  url.searchParams.set('unique', 'false');
  url.searchParams.set('limit', String(params.limit ?? 30));
  return url.toString();
}

function monthsInRange(earliest: string, latest: string): string[] {
  const start = new Date(`${earliest.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${latest.slice(0, 7)}-01T00:00:00Z`);
  const months: string[] = [];
  for (let cursor = start; cursor <= end && months.length < 24; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

/**
 * Expands a fare policy into one one-way discovery request per
 * origin × destination × departure month. Round-trip pricing is not modelled from
 * this cached aggregator; round-trip policies still receive indicative one-way
 * outbound prices.
 */
export function buildTravelpayoutsRequestsForPolicy(input: FareSearchPolicy): TravelpayoutsRequest[] {
  const policy = fareSearchPolicySchema.parse(input);
  const market = marketForCurrency(policy.currency);
  const months = monthsInRange(policy.departureDateRange.earliest, policy.departureDateRange.latest);
  const requests: TravelpayoutsRequest[] = [];
  for (const origin of policy.origins) {
    for (const destination of policy.destinations) {
      for (const departureAt of months) {
        const params: TravelpayoutsUrlParams = { origin, destination, departureAt, currency: policy.currency, market, oneWay: true };
        requests.push({ ...params, market, oneWay: true, url: buildTravelpayoutsUrl(params) });
      }
    }
  }
  return requests;
}

function normalizeCurrency(value: string | undefined, fallback: string | undefined): string | undefined {
  const candidate = (value ?? fallback ?? '').toUpperCase();
  return /^[A-Z]{3}$/.test(candidate) ? candidate : undefined;
}

function addMinutes(iso: string, minutes: number): string | undefined {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed + minutes * 60_000).toISOString();
}

function recordToItinerary(
  record: z.infer<typeof travelpayoutsRecordSchema>,
  currency: string,
  context: TravelpayoutsParseContext,
): ObservedItinerary | null {
  const originCode = (record.origin_airport ?? record.origin).toUpperCase();
  const destinationCode = (record.destination_airport ?? record.destination).toUpperCase();
  const carrierCode = record.airline?.toUpperCase() ?? '';
  const flightNumber = record.flight_number != null ? String(record.flight_number).trim() : '';
  const departureLocal = record.departure_at ?? '';
  // A fare with no route or no marketing flight identity cannot be verified downstream.
  if (!AIRPORT_CODE.test(originCode) || !AIRPORT_CODE.test(destinationCode)) return null;
  if (!CARRIER_CODE.test(carrierCode) || flightNumber.length === 0) return null;
  if (departureLocal.length < 10) return null;

  const durationMinutes = record.duration_to ?? record.duration;
  const arrivalLocal = (durationMinutes ? addMinutes(departureLocal, durationMinutes) : undefined) ?? departureLocal;
  const now = context.now ?? new Date();
  const sourceUrl = record.link && record.link.startsWith('/') ? `${AVIASALES_BASE}${record.link}` : '';

  const candidate = {
    id: `tp-${originCode}-${destinationCode}-${departureLocal.slice(0, 10)}-${carrierCode}${flightNumber}`,
    sourceSite: 'travelpayouts',
    sourceUrl,
    observedAt: now.toISOString(),
    tripType: 'one-way' as const,
    passengers: { adults: 1, children: 0, infants: 0 },
    segments: [{
      sliceIndex: 0,
      origin: { code: originCode },
      destination: { code: destinationCode },
      departureLocal,
      arrivalLocal,
      durationMinutes: durationMinutes && durationMinutes > 0 ? durationMinutes : undefined,
      marketingCarrier: { code: carrierCode },
      marketingFlightNumber: flightNumber,
    }],
    fare: { total: { amountMinor: Math.round(record.price * 100), currency } },
    fareIdentity: { fareBasisCodes: [], bookingClasses: [], passengerTypeCodes: [] },
    warnings: ['Indicative cached price from Travelpayouts; cabin and availability are unconfirmed. Manual verification is required before booking.'],
    verificationStage: 'search-result-reproduced' as const,
    extractionConfidence: 55,
  };
  const parsed = observedItinerarySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Validates and normalizes a Travelpayouts response into indicative one-way
 * itinerary candidates. Records that lack a usable route, marketing flight
 * identity, or departure are skipped rather than fabricated.
 */
export function parseTravelpayoutsResponse(input: unknown, context: TravelpayoutsParseContext = {}): ObservedItinerary[] {
  const payload = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  const response = travelpayoutsResponseSchema.parse(payload);
  if (response.success === false) throw new Error(response.error ?? 'Travelpayouts request was unsuccessful.');
  const currency = normalizeCurrency(response.currency, context.currency);
  if (!currency) throw new Error('Travelpayouts response is missing a valid ISO currency.');
  const byId = new Map<string, ObservedItinerary>();
  for (const record of response.data) {
    const itinerary = recordToItinerary(record, currency, context);
    if (itinerary && !byId.has(itinerary.id)) byId.set(itinerary.id, itinerary);
  }
  return [...byId.values()];
}
