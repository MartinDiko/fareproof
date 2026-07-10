import { z } from 'zod';
import { fareSearchPolicySchema, observedItinerarySchema } from '@fareproof/core';

export const STORAGE_KEYS = {
  policies: 'fareproof.searchPolicies',
  statuses: 'fareproof.policyStatuses',
  activeRun: 'fareproof.activeVerificationRun',
  observations: 'fareproof.policyObservations',
  dateCursors: 'fareproof.dateCursors',
  notificationSettings: 'fareproof.notificationSettings',
  alertLinks: 'fareproof.alertLinks',
} as const;

export const policyStatusSchema = z.object({
  policyId: z.string(),
  state: z.enum(['scheduled', 'running', 'candidate-found', 'retailer-match', 'manual-action-required', 'no-match', 'blocked', 'error']),
  lastAttemptAt: z.string().optional(),
  lastCompletedAt: z.string().optional(),
  nextDueAt: z.string().optional(),
  message: z.string(),
  bestPricePerPersonMinor: z.number().int().nonnegative().optional(),
  bestUrl: z.string().optional(),
});

export const notificationSettingsSchema = z.object({
  browserEnabled: z.boolean(),
  ntfyTopic: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
});

const matrixSearchTaskSchema = z.object({
  id: z.string(),
  policyId: z.string(),
  startDate: z.string(),
  latestDate: z.string(),
  url: z.string().url(),
});

const matrixFlightCandidateSchema = z.object({
  url: z.string().url(),
  priceMinor: z.number().int().nonnegative(),
  currency: z.string(),
  airline: z.string(),
  route: z.string(),
});

const retailerLinkSchema = z.object({
  site: z.string(),
  url: z.string().url(),
  pricePerPersonMinor: z.number().int().nonnegative().optional(),
  currency: z.string().optional(),
});

export const activeVerificationRunSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  updatedAt: z.string(),
  interactive: z.boolean(),
  tasks: z.array(matrixSearchTaskSchema).min(1),
  taskIndex: z.number().int().nonnegative(),
  tabId: z.number().int().optional(),
  stage: z.enum(['calendar', 'flights', 'itinerary', 'bookwithmatrix', 'retailer']),
  dateQueue: z.array(z.string()),
  dateIndex: z.number().int().nonnegative(),
  candidateQueue: z.array(matrixFlightCandidateSchema),
  candidateIndex: z.number().int().nonnegative(),
  matrixJson: z.string().optional(),
  matrixItinerary: observedItinerarySchema.optional(),
  bookWithMatrixUrl: z.string().url().optional(),
  retailerQueue: z.array(retailerLinkSchema),
  retailerIndex: z.number().int().nonnegative(),
  policyIds: z.array(z.string()),
});

export const policyObservationSchema = z.object({
  id: z.string(),
  policyId: z.string(),
  observedAt: z.string(),
  stage: z.enum(['ita-only', 'bookwithmatrix-handoff', 'retailer-result-reproduced', 'manual-confirmation-required']),
  itinerary: observedItinerarySchema,
  url: z.string(),
  retailer: z.string().optional(),
  pricePerPersonMinor: z.number().int().nonnegative(),
  matchedRules: z.array(z.string()),
  missingRules: z.array(z.string()),
});

export const extensionSettingsSchema = z.object({
  policies: z.array(fareSearchPolicySchema),
  statuses: z.array(policyStatusSchema),
  notificationSettings: notificationSettingsSchema,
});

export type PolicyStatus = z.infer<typeof policyStatusSchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type ActiveVerificationRun = z.infer<typeof activeVerificationRunSchema>;
export type PolicyObservation = z.infer<typeof policyObservationSchema>;
export type RetailerLink = z.infer<typeof retailerLinkSchema>;