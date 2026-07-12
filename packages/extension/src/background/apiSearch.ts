import {
  buildTravelpayoutsRequestsForPolicy,
  createWatch,
  fareSearchPolicySchema,
  parseTravelpayoutsResponse,
  type FareWatch,
} from '@fareproof/core';
import { apiCandidatesSchema, apiSearchSettingsSchema, STORAGE_KEYS, type ApiSearchSettings } from '../shared/state';

export const TRAVELPAYOUTS_ORIGIN = 'https://api.travelpayouts.com/*';
const MAX_API_CANDIDATES = 200;
const MAX_REQUESTS_PER_RUN = 12;
const REQUEST_TIMEOUT_MS = 15_000;

export interface ApiSearchResult {
  ok: boolean;
  count: number;
  reason?: string;
}

export async function getApiSearchSettings(): Promise<ApiSearchSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.apiSearchSettings);
  const parsed = apiSearchSettingsSchema.safeParse(stored[STORAGE_KEYS.apiSearchSettings]);
  return parsed.success ? parsed.data : apiSearchSettingsSchema.parse({});
}

async function getApiCandidates(): Promise<FareWatch[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.apiCandidates);
  const parsed = apiCandidatesSchema.safeParse(stored[STORAGE_KEYS.apiCandidates]);
  return parsed.success ? parsed.data : [];
}

async function getEnabledPolicies() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.policies);
  const parsed = fareSearchPolicySchema.array().safeParse(stored[STORAGE_KEYS.policies]);
  return (parsed.success ? parsed.data : []).filter((policy) => policy.enabled);
}

async function fetchTravelpayouts(url: string, token: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'X-Access-Token': token, Accept: 'application/json' },
      signal: controller.signal,
      credentials: 'omit',
    });
    if (!response.ok) throw new Error(`Travelpayouts responded ${response.status}.`);
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the optional Travelpayouts discovery search. Completely inert unless the
 * user has enabled it, supplied a token, and granted the host permission. Results
 * are stored as export-ready watches under their own key and never touch the
 * Matrix verification run.
 */
export async function runApiSearch(): Promise<ApiSearchResult> {
  const settings = await getApiSearchSettings();
  if (!settings.enabled || !settings.token) {
    return { ok: false, count: 0, reason: 'Flight-price API search is disabled or missing a token.' };
  }
  const hasPermission = await chrome.permissions.contains({ origins: [TRAVELPAYOUTS_ORIGIN] });
  if (!hasPermission) {
    return { ok: false, count: 0, reason: 'Access to the Travelpayouts API has not been granted.' };
  }
  const policies = await getEnabledPolicies();
  if (!policies.length) return { ok: false, count: 0, reason: 'No enabled search policy to query.' };

  const requests = policies
    .flatMap((policy) => buildTravelpayoutsRequestsForPolicy(policy).map((request) => ({ request, currency: policy.currency })))
    .slice(0, MAX_REQUESTS_PER_RUN);

  const now = new Date();
  const discovered = new Map<string, FareWatch>();
  let failures = 0;
  for (const { request, currency } of requests) {
    try {
      const payload = await fetchTravelpayouts(request.url, settings.token);
      for (const itinerary of parseTravelpayoutsResponse(payload, { currency, now })) {
        discovered.set(itinerary.id, { ...createWatch(itinerary, now), id: `api-${itinerary.id}` });
      }
    } catch {
      failures += 1;
    }
  }

  if (!discovered.size) {
    return {
      ok: failures < requests.length,
      count: 0,
      reason: failures ? 'Travelpayouts returned no indicative fares (some requests failed).' : 'Travelpayouts returned no indicative fares for the current policies.',
    };
  }

  const existing = await getApiCandidates();
  const merged = new Map<string, FareWatch>();
  for (const watch of [...discovered.values(), ...existing]) if (!merged.has(watch.id)) merged.set(watch.id, watch);
  const next = apiCandidatesSchema.parse([...merged.values()].slice(0, MAX_API_CANDIDATES));
  await chrome.storage.local.set({ [STORAGE_KEYS.apiCandidates]: next });
  return { ok: true, count: discovered.size };
}
