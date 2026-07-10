import { z } from 'zod';
import { fareSearchPolicySchema, observedItinerarySchema } from '@fareproof/core';

const calendarEntrySchema = z.object({
  date: z.string(),
  priceMinor: z.number().int().nonnegative().optional(),
  currency: z.string().optional(),
});

const matrixFlightCandidateSchema = z.object({
  url: z.string().url(),
  priceMinor: z.number().int().nonnegative(),
  currency: z.string(),
  durationMinutes: z.number().int().positive().optional(),
  airline: z.string(),
  route: z.string(),
});

const retailerLinkSchema = z.object({
  site: z.string(),
  url: z.string().url(),
  pricePerPersonMinor: z.number().int().nonnegative().optional(),
  currency: z.string().optional(),
});

const retailerPageObservationSchema = z.object({
  site: z.string(),
  url: z.string().url(),
  airportCodes: z.array(z.string()),
  flightNumbers: z.array(z.string()),
  flightCabinEvidence: z.array(z.object({ flightNumber: z.string(), cabins: z.array(z.string()) })),
  cabinWords: z.array(z.string()),
  dateTokens: z.array(z.string()),
  prices: z.array(z.object({
    amountMinor: z.number().int().nonnegative(),
    currency: z.string(),
    basis: z.enum(['per-person', 'total', 'unknown']),
  })),
  blocker: z.enum(['captcha', 'login-required', 'unavailable', 'price-changed']).optional(),
});

export const extensionMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CREATE_WATCH'), itinerary: observedItinerarySchema }),
  z.object({ type: z.literal('PAGE_OBSERVATION'), itinerary: observedItinerarySchema }),
  z.object({ type: z.literal('OPEN_SIDE_PANEL') }),
  z.object({ type: z.literal('SAVE_SEARCH_POLICIES'), policies: z.array(fareSearchPolicySchema) }),
  z.object({ type: z.literal('RUN_POLICIES_NOW'), policyIds: z.array(z.string()).optional() }),
  z.object({ type: z.literal('SAVE_NOTIFICATION_SETTINGS'), browserEnabled: z.boolean(), ntfyTopic: z.string().optional() }),
  z.object({ type: z.literal('TEST_NOTIFICATION') }),
  z.object({ type: z.literal('MATRIX_HOME_READY') }),
  z.object({ type: z.literal('MATRIX_FORM_FAILED'), reason: z.string().max(500) }),
  z.object({ type: z.literal('MATRIX_CALENDAR'), entries: z.array(calendarEntrySchema) }),
  z.object({ type: z.literal('MATRIX_FLIGHTS'), candidates: z.array(matrixFlightCandidateSchema) }),
  z.object({ type: z.literal('MATRIX_ITINERARY_READY') }),
  z.object({ type: z.literal('MATRIX_ITINERARY'), rawJson: z.string().max(512_000), itinerary: observedItinerarySchema }),
  z.object({ type: z.literal('MATRIX_CAPTURE_FAILED') }),
  z.object({ type: z.literal('BOOKWITHMATRIX_READY') }),
  z.object({ type: z.literal('BOOKWITHMATRIX_RESULTS'), resultUrl: z.string().url(), links: z.array(retailerLinkSchema) }),
  z.object({ type: z.literal('RETAILER_PAGE'), observation: retailerPageObservationSchema }),
]);

export const contentCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('RUN_MATRIX_SEARCH'),
    task: z.object({ id: z.string(), policyId: z.string(), startDate: z.string(), latestDate: z.string(), url: z.string().url() }),
    policy: fareSearchPolicySchema,
  }),
  z.object({ type: z.literal('SELECT_MATRIX_DATE'), date: z.string() }),
  z.object({ type: z.literal('CAPTURE_MATRIX_JSON') }),
  z.object({ type: z.literal('SUBMIT_BOOKWITHMATRIX'), rawJson: z.string().max(512_000) }),
]);

export type ExtensionMessage = z.infer<typeof extensionMessageSchema>;
export type ContentCommand = z.infer<typeof contentCommandSchema>;
export type MatrixFlightCandidate = Extract<ExtensionMessage, { type: 'MATRIX_FLIGHTS' }>['candidates'][number];
export type RetailerPageObservation = Extract<ExtensionMessage, { type: 'RETAILER_PAGE' }>['observation'];
export type BookWithMatrixResultLink = Extract<ExtensionMessage, { type: 'BOOKWITHMATRIX_RESULTS' }>['links'][number];