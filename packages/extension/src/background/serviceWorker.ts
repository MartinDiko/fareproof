import {
  buildMatrixSearchTasks,
  createWatch,
  defaultFareSearchPolicies,
  fareSearchPolicySchema,
  matchLinkedReturnWindow,
  matchSearchPolicy,
  type FareSearchPolicy,
  type FareWatch,
  type ObservedItinerary,
} from '@fareproof/core';
import { extensionMessageSchema, type BookWithMatrixResultLink, type ExtensionMessage } from '../shared/messages';
import {
  activeVerificationRunSchema,
  notificationSettingsSchema,
  policyObservationSchema,
  policyStatusSchema,
  STORAGE_KEYS,
  type ActiveVerificationRun,
  type NotificationSettings,
  type PolicyObservation,
  type PolicyStatus,
} from '../shared/state';
import { validateRetailerObservation } from './retailerValidation';
import { rankMatrixFlightCandidates } from './matrixCandidateRanking';

const WATCHES_KEY = 'fareproof.watches';
const CURRENT_OBSERVATION_KEY = 'fareproof.currentObservation';
const DISPATCH_ALARM = 'fareproof.dispatch';
const RUN_TIMEOUT_ALARM = 'fareproof.run-timeout';
const RUN_TIMEOUT_BY_STAGE: Record<ActiveVerificationRun['stage'], number> = {
  'matrix-home': 20_000,
  calendar: 60_000,
  flights: 120_000,
  itinerary: 60_000,
  bookwithmatrix: 45_000,
  retailer: 30_000,
};
const MAX_OBSERVATIONS = 200;
const DEFAULT_NOTIFICATIONS: NotificationSettings = { browserEnabled: true };
const CANADIAN_AIRPORTS = new Set(['YVR', 'YYC', 'YEG', 'YXE', 'YWG', 'YQR', 'YYZ', 'YTZ', 'YOW', 'YUL', 'YQB', 'YHZ', 'YQM', 'YYT']);
const RETAILER_HOST_SUFFIXES = ['justfly.com', 'flightnetwork.com', 'priceline.com', 'aa.com', 'delta.com', 'alaskaair.com', 'onetravel.com', 'anrdoezrs.net', 'westjet.com', 'condor.com'];
const RETAILER_VALIDATION_RULES = ['retailer route', 'retailer flight identity', 'retailer travel date', 'retailer long-leg cabin', 'retailer price'];

interface StartRunResult {
  started: boolean;
  reason?: string;
}

async function getWatches(): Promise<FareWatch[]> {
  const result = await chrome.storage.local.get(WATCHES_KEY);
  return Array.isArray(result[WATCHES_KEY]) ? (result[WATCHES_KEY] as FareWatch[]) : [];
}

async function saveWatch(itinerary: ObservedItinerary): Promise<FareWatch> {
  const watches = await getWatches();
  const watch = createWatch(itinerary);
  await chrome.storage.local.set({ [WATCHES_KEY]: [watch, ...watches] });
  return watch;
}

function cloneDefaultPolicies(): FareSearchPolicy[] {
  return defaultFareSearchPolicies.map((policy) => fareSearchPolicySchema.parse(structuredClone(policy)));
}

async function getPolicies(): Promise<FareSearchPolicy[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.policies);
  const parsed = fareSearchPolicySchema.array().safeParse(result[STORAGE_KEYS.policies]);
  return parsed.success ? parsed.data : cloneDefaultPolicies();
}

async function getStatuses(): Promise<PolicyStatus[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.statuses);
  const parsed = policyStatusSchema.array().safeParse(result[STORAGE_KEYS.statuses]);
  return parsed.success ? parsed.data : [];
}

async function getRun(): Promise<ActiveVerificationRun | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.activeRun);
  const parsed = activeVerificationRunSchema.safeParse(result[STORAGE_KEYS.activeRun]);
  return parsed.success ? parsed.data : null;
}

async function saveRun(run: ActiveVerificationRun | null): Promise<void> {
  if (!run) {
    await chrome.storage.local.set({ [STORAGE_KEYS.activeRun]: null });
    await chrome.alarms.clear(RUN_TIMEOUT_ALARM);
    return;
  }
  const updated = activeVerificationRunSchema.parse({ ...run, updatedAt: new Date().toISOString() });
  await chrome.storage.local.set({ [STORAGE_KEYS.activeRun]: updated });
  await chrome.alarms.create(RUN_TIMEOUT_ALARM, { when: Date.now() + RUN_TIMEOUT_BY_STAGE[updated.stage] });
}

async function recoverScheduler(): Promise<{ recovered: boolean; run: ActiveVerificationRun | null }> {
  const run = await getRun();
  if (!run) return { recovered: false, run: null };
  const ageMs = Date.now() - Date.parse(run.updatedAt);
  const maximumAgeMs = RUN_TIMEOUT_BY_STAGE[run.stage] + 30_000;
  const tabExists = run.tabId !== undefined && await chrome.tabs.get(run.tabId).then(() => true).catch(() => false);
  if (tabExists && Number.isFinite(ageMs) && ageMs <= maximumAgeMs) return { recovered: false, run };

  const policies = await getPolicies();
  for (const policyId of run.policyIds) {
    const policy = policies.find((item) => item.id === policyId);
    if (!policy) continue;
    await updateStatus(policyId, {
      state: 'error',
      lastCompletedAt: new Date().toISOString(),
      message: tabExists
        ? 'The previous verification expired before it completed. Check now is available again.'
        : 'The previous verification tab no longer exists. Check now is available again.',
    });
  }
  await saveRun(null);
  return { recovered: true, run: null };
}

async function updateStatus(policyId: string, patch: Partial<PolicyStatus>): Promise<PolicyStatus> {
  const statuses = await getStatuses();
  const existing = statuses.find((status) => status.policyId === policyId);
  const next = policyStatusSchema.parse({
    policyId,
    state: 'scheduled',
    message: 'Waiting for the next five-minute check.',
    ...existing,
    ...patch,
  });
  await chrome.storage.local.set({ [STORAGE_KEYS.statuses]: [next, ...statuses.filter((status) => status.policyId !== policyId)] });
  return next;
}

async function ensureDefaults(): Promise<void> {
  const policies = await getPolicies();
  const statuses = await getStatuses();
  const notificationResult = await chrome.storage.local.get(STORAGE_KEYS.notificationSettings);
  const notifications = notificationSettingsSchema.safeParse(notificationResult[STORAGE_KEYS.notificationSettings]);
  const now = new Date().toISOString();
  const nextStatuses = policies.map((policy) => statuses.find((status) => status.policyId === policy.id) ?? policyStatusSchema.parse({ policyId: policy.id, state: 'scheduled', nextDueAt: now, message: 'Ready for the first check.' }));
  await chrome.storage.local.set({
    [STORAGE_KEYS.policies]: policies,
    [STORAGE_KEYS.statuses]: nextStatuses,
    [STORAGE_KEYS.notificationSettings]: notifications.success ? notifications.data : DEFAULT_NOTIFICATIONS,
  });
  await chrome.alarms.create(DISPATCH_ALARM, { periodInMinutes: 5 });
}

function policyForRun(run: ActiveVerificationRun, policies: FareSearchPolicy[]): FareSearchPolicy | null {
  const task = run.tasks[run.taskIndex];
  return task ? policies.find((policy) => policy.id === task.policyId) ?? null : null;
}

async function recordObservation(observation: PolicyObservation): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.observations);
  const parsed = policyObservationSchema.array().safeParse(result[STORAGE_KEYS.observations]);
  const observations = parsed.success ? parsed.data : [];
  const validated = policyObservationSchema.parse(observation);
  await chrome.storage.local.set({ [STORAGE_KEYS.observations]: [validated, ...observations.filter((item) => item.id !== validated.id)].slice(0, MAX_OBSERVATIONS) });
}

function matrixPricePerPerson(itinerary: ObservedItinerary): number {
  return Math.round(itinerary.fare.total.amountMinor / Math.max(1, itinerary.passengers.adults));
}

function retailerObservationId(run: ActiveVerificationRun): string {
  return `observation-${run.id}-retailer-${run.retailerIndex}`;
}

async function recordRetailerAttemptIfMissing(run: ActiveVerificationRun, message: string): Promise<void> {
  const retailer = run.retailerQueue[run.retailerIndex];
  const task = run.tasks[run.taskIndex];
  if (!retailer || !task || !run.matrixItinerary) return;
  const id = retailerObservationId(run);
  const result = await chrome.storage.local.get(STORAGE_KEYS.observations);
  const parsed = policyObservationSchema.array().safeParse(result[STORAGE_KEYS.observations]);
  if (parsed.success && parsed.data.some((item) => item.id === id)) return;
  const matrixPrice = matrixPricePerPerson(run.matrixItinerary);
  await recordObservation({
    id,
    policyId: task.policyId,
    observedAt: new Date().toISOString(),
    stage: 'manual-confirmation-required',
    itinerary: { ...run.matrixItinerary, sourceSite: retailer.site, sourceUrl: retailer.url, verificationStage: 'manual-confirmation-required' },
    url: retailer.url,
    retailer: retailer.site,
    pricePerPersonMinor: matrixPrice,
    bookWithMatrixPricePerPersonMinor: retailer.currency === run.matrixItinerary.fare.total.currency ? retailer.pricePerPersonMinor : undefined,
    matchedRules: [],
    missingRules: RETAILER_VALIDATION_RULES,
    failedRules: [],
    message,
  });
}

function nextDueAt(policy: FareSearchPolicy): string {
  return new Date(Date.now() + policy.schedule.intervalMinutes * 60_000).toISOString();
}

async function startRun(policyIds?: string[], interactive = false): Promise<StartRunResult> {
  const scheduler = await recoverScheduler();
  if (scheduler.run) return { started: false, reason: 'A verification is already running. Wait for it to finish or close its Matrix tab.' };
  const policies = await getPolicies();
  const selected = policies.filter((policy) => policy.enabled && policy.schedule.enabled && (!policyIds || policyIds.includes(policy.id)));
  const tasks = selected.flatMap(buildMatrixSearchTasks);
  const first = tasks[0];
  if (!first) return { started: false, reason: 'No enabled search policy was available to run.' };
  for (const policy of selected) {
    await updateStatus(policy.id, { state: 'running', lastAttemptAt: new Date().toISOString(), nextDueAt: nextDueAt(policy), message: 'Initializing the ITA Matrix browser session.' });
  }
  const tab = await chrome.tabs.create({ url: 'about:blank', active: interactive });
  const now = new Date().toISOString();
  await saveRun({
    id: `run-${Date.now()}`,
    startedAt: now,
    updatedAt: now,
    interactive,
    tasks,
    taskIndex: 0,
    tabId: tab.id,
    stage: 'matrix-home',
    stageAttempt: 0,
    dateQueue: [],
    dateIndex: 0,
    candidateQueue: [],
    candidateIndex: 0,
    retailerQueue: [],
    retailerIndex: 0,
    policyIds: selected.map((policy) => policy.id),
  });
  if (tab.id !== undefined) await chrome.tabs.update(tab.id, { url: 'https://matrix.itasoftware.com/search', active: interactive });
  return { started: true };
}

async function dispatchDuePolicies(): Promise<void> {
  const scheduler = await recoverScheduler();
  if (scheduler.run) return;
  const [policies, statuses] = await Promise.all([getPolicies(), getStatuses()]);
  const now = Date.now();
  const due = policies.filter((policy) => policy.enabled && policy.schedule.enabled && Date.parse(statuses.find((status) => status.policyId === policy.id)?.nextDueAt ?? '1970-01-01') <= now);
  if (due.length) await startRun(due.map((policy) => policy.id), false);
}

async function finishRun(run: ActiveVerificationRun): Promise<void> {
  const policies = await getPolicies();
  const statuses = await getStatuses();
  for (const policyId of run.policyIds) {
    const policy = policies.find((item) => item.id === policyId);
    const status = statuses.find((item) => item.policyId === policyId);
    if (!policy) continue;
    await updateStatus(policyId, {
      state: status?.state === 'retailer-match' || status?.state === 'manual-action-required' ? status.state : 'no-match',
      lastCompletedAt: new Date().toISOString(),
      nextDueAt: nextDueAt(policy),
      message: status?.state === 'retailer-match' || status?.state === 'manual-action-required' ? status.message : 'No retailer-validated match in this cycle.',
    });
  }
  if (!run.interactive && run.tabId !== undefined) await chrome.tabs.remove(run.tabId).catch(() => undefined);
  await saveRun(null);
}

async function failMatrixRun(run: ActiveVerificationRun, message: string): Promise<void> {
  const policies = await getPolicies();
  for (const policyId of run.policyIds) {
    const policy = policies.find((item) => item.id === policyId);
    if (!policy) continue;
    await updateStatus(policy.id, {
      state: 'error',
      lastCompletedAt: new Date().toISOString(),
      nextDueAt: nextDueAt(policy),
      message,
    });
  }
  if (!run.interactive && run.tabId !== undefined) await chrome.tabs.remove(run.tabId).catch(() => undefined);
  await saveRun(null);
}

async function retryMatrixCalendar(run: ActiveVerificationRun): Promise<void> {
  const task = run.tasks[run.taskIndex];
  if (!task || run.tabId === undefined) {
    await failMatrixRun(run, 'Matrix check could not be initialized. FareProof will retry at the next scheduled interval.');
    return;
  }
  if (run.stageAttempt >= 1) {
    await failMatrixRun(run, 'ITA Matrix did not return fare data after two attempts. The Matrix console ERROR Object is site-generated; FareProof will retry at the next scheduled interval.');
    return;
  }
  const next = { ...run, stage: 'matrix-home' as const, stageAttempt: run.stageAttempt + 1 };
  await saveRun(next);
  await updateStatus(task.policyId, { state: 'running', message: 'Matrix did not return fare data; retrying once with a fresh browser session.' });
  await chrome.tabs.update(run.tabId, { url: `https://matrix.itasoftware.com/search?fareproofRetry=${Date.now()}`, active: run.interactive });
}

async function advanceTask(run: ActiveVerificationRun, message: string, state: PolicyStatus['state'] = 'no-match'): Promise<void> {
  const policies = await getPolicies();
  const policy = policyForRun(run, policies);
  const statuses = await getStatuses();
  const existingState = policy ? statuses.find((status) => status.policyId === policy.id)?.state : undefined;
  const preservedState = existingState === 'retailer-match' || existingState === 'manual-action-required' ? existingState : state;
  if (policy) await updateStatus(policy.id, { state: preservedState, message: preservedState === existingState ? statuses.find((status) => status.policyId === policy.id)?.message ?? message : message });
  const taskIndex = run.taskIndex + 1;
  const nextTask = run.tasks[taskIndex];
  if (!nextTask) {
    await finishRun(run);
    return;
  }
  const next: ActiveVerificationRun = {
    ...run,
    taskIndex,
    stage: 'matrix-home',
    dateQueue: [],
    dateIndex: 0,
    candidateQueue: [],
    candidateIndex: 0,
    stageAttempt: 0,
    matrixJson: undefined,
    matrixItinerary: undefined,
    bookWithMatrixUrl: undefined,
    retailerQueue: [],
    retailerIndex: 0,
  };
  await saveRun(next);
  if (run.tabId !== undefined) await chrome.tabs.update(run.tabId, { url: 'https://matrix.itasoftware.com/search', active: run.interactive });
}

async function advanceCandidate(run: ActiveVerificationRun, message: string): Promise<void> {
  const candidateIndex = run.candidateIndex + 1;
  const candidate = run.candidateQueue[candidateIndex];
  if (!candidate) {
    await advanceTask(run, message, 'no-match');
    return;
  }
  const next = { ...run, candidateIndex, stage: 'itinerary' as const, stageAttempt: 0, matrixJson: undefined, matrixItinerary: undefined };
  await saveRun(next);
  if (run.tabId !== undefined) await chrome.tabs.update(run.tabId, { url: candidate.url, active: run.interactive });
}

async function advanceRetailer(run: ActiveVerificationRun, message: string): Promise<void> {
  await recordRetailerAttemptIfMissing(run, message);
  const retailerIndex = run.retailerIndex + 1;
  const retailer = run.retailerQueue[retailerIndex];
  if (!retailer) {
    const policies = await getPolicies();
    const policy = policyForRun(run, policies);
    if (policy && run.matrixItinerary) {
      const price = Math.round(run.matrixItinerary.fare.total.amountMinor / run.matrixItinerary.passengers.adults);
      await updateStatus(policy.id, { state: 'manual-action-required', message, bestPricePerPersonMinor: price, bestUrl: run.bookWithMatrixUrl ?? run.matrixItinerary.sourceUrl });
      await sendAlert(policy, 'FareProof: manual verification needed', `${policy.name} matched in ITA and reached BookWithMatrix, but no retailer exposed enough evidence to validate it.`, run.bookWithMatrixUrl ?? run.matrixItinerary.sourceUrl, price, false);
    }
    await advanceTask(run, message, 'manual-action-required');
    return;
  }
  const next = { ...run, retailerIndex, stage: 'retailer' as const, stageAttempt: 0 };
  await saveRun(next);
  const task = run.tasks[run.taskIndex];
  const previous = run.retailerQueue[run.retailerIndex];
  if (task) await updateStatus(task.policyId, { state: 'running', message: `${previous?.site ?? 'The previous agency'} did not validate the fare. Checking ${retailer.site}'s current booking price.` });
  if (run.tabId !== undefined) await chrome.tabs.update(run.tabId, { url: retailer.url, active: run.interactive });
}

async function currentDateCursor(taskId: string): Promise<number> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.dateCursors);
  const cursors = result[STORAGE_KEYS.dateCursors];
  return cursors && typeof cursors === 'object' && typeof (cursors as Record<string, unknown>)[taskId] === 'number' ? (cursors as Record<string, number>)[taskId]! : 0;
}

async function incrementDateCursor(taskId: string, value: number): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.dateCursors);
  const cursors = result[STORAGE_KEYS.dateCursors] && typeof result[STORAGE_KEYS.dateCursors] === 'object' ? result[STORAGE_KEYS.dateCursors] as Record<string, number> : {};
  await chrome.storage.local.set({ [STORAGE_KEYS.dateCursors]: { ...cursors, [taskId]: value } });
}

function captureMatrixJsonInPage(): void {
  const button = [...document.querySelectorAll('button')].find((element) => element.textContent?.includes('Copy itinerary as JSON'));
  const clipboard = navigator.clipboard;
  if (!button || !clipboard) {
    window.postMessage({ source: 'fareproof-main', type: 'MATRIX_CAPTURE_FAILED' }, location.origin);
    return;
  }
  const original = clipboard.writeText.bind(clipboard);
  Object.defineProperty(clipboard, 'writeText', {
    configurable: true,
    value: async (rawJson: string) => {
      window.postMessage({ source: 'fareproof-main', type: 'MATRIX_JSON', rawJson }, location.origin);
    },
  });
  (button as HTMLElement).click();
  window.setTimeout(() => Object.defineProperty(clipboard, 'writeText', { configurable: true, value: original }), 1_000);
}

async function handleMatrixCalendar(message: Extract<ExtensionMessage, { type: 'MATRIX_CALENDAR' }>, run: ActiveVerificationRun): Promise<void> {
  const policies = await getPolicies();
  const policy = policyForRun(run, policies);
  const task = run.tasks[run.taskIndex];
  if (!policy || !task || run.stage !== 'calendar') return;
  const entries = message.entries.filter((entry) => entry.date >= task.startDate && entry.date <= task.latestDate);
  if (!entries.length) {
    await advanceTask(run, 'ITA Matrix returned no calendar dates.', 'no-match');
    return;
  }
  const priced = entries.filter((entry) => entry.currency === policy.currency && entry.priceMinor !== undefined && entry.priceMinor <= policy.maximumPricePerPersonMinor);
  const pool = priced.length ? priced : entries;
  const cursor = await currentDateCursor(task.id);
  const selected = pool[cursor % pool.length]!;
  await incrementDateCursor(task.id, cursor + 1);
  const next = { ...run, stage: 'flights' as const, stageAttempt: 0, dateQueue: [selected.date], dateIndex: 0 };
  await saveRun(next);
  if (run.tabId !== undefined) {
    const response = await chrome.tabs.sendMessage(run.tabId, { type: 'SELECT_MATRIX_DATE', date: selected.date }).catch(() => ({ ok: false }));
    if (!response?.ok) await advanceTask(next, `Could not select ${selected.date} in ITA Matrix.`, 'error');
  }
}

async function handleMatrixFlights(message: Extract<ExtensionMessage, { type: 'MATRIX_FLIGHTS' }>, run: ActiveVerificationRun): Promise<void> {
  const policies = await getPolicies();
  const policy = policyForRun(run, policies);
  if (!policy || run.stage !== 'flights') return;
  const candidates = rankMatrixFlightCandidates(
    message.candidates,
    policy.currency,
    policy.maximumPricePerPersonMinor,
  ).slice(0, 5);
  const first = candidates[0];
  if (!first) {
    await advanceTask(run, 'No ITA flight result met the per-person price limit.', 'no-match');
    return;
  }
  const next = { ...run, stage: 'itinerary' as const, stageAttempt: 0, candidateQueue: candidates, candidateIndex: 0 };
  await saveRun(next);
  await updateStatus(policy.id, { state: 'candidate-found', message: `ITA candidate found at ${policy.currency} ${(first.priceMinor / 100).toFixed(2)} per person.` });
  if (run.tabId !== undefined) await chrome.tabs.update(run.tabId, { url: first.url, active: run.interactive });
}

async function handleMatrixItinerary(message: Extract<ExtensionMessage, { type: 'MATRIX_ITINERARY' }>, run: ActiveVerificationRun): Promise<void> {
  const policies = await getPolicies();
  const policy = policyForRun(run, policies);
  if (!policy || run.stage !== 'itinerary') return;
  const airportCountries = Object.fromEntries([...CANADIAN_AIRPORTS].map((airport) => [airport, 'CA']));
  const match = matchSearchPolicy(policy, message.itinerary, airportCountries);
  let linkedReturnReason: string | undefined;
  if (match.matches && policy.tripType === 'return-only' && policy.linkedOutboundPolicyIds?.length) {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.observations);
    const parsed = policyObservationSchema.array().safeParse(stored[STORAGE_KEYS.observations]);
    const outboundItineraries = (parsed.success ? parsed.data : []).filter((observation) => policy.linkedOutboundPolicyIds?.includes(observation.policyId) && observation.missingRules.length === 0).map((observation) => observation.itinerary);
    const linked = matchLinkedReturnWindow(policy, message.itinerary, outboundItineraries);
    if (!linked.matches) linkedReturnReason = linked.reason;
    else match.matchedRules.push('linked outbound return window');
  }
  const price = match.pricePerPersonMinor;
  const missingRules = [...match.failedRules, ...match.unknownRules, ...(linkedReturnReason ? [linkedReturnReason] : [])];
  await recordObservation({ id: `observation-${Date.now()}`, policyId: policy.id, observedAt: new Date().toISOString(), stage: 'ita-only', itinerary: message.itinerary, url: message.itinerary.sourceUrl, pricePerPersonMinor: price, matchedRules: match.matchedRules, missingRules });
  if (!match.matches || linkedReturnReason) {
    await advanceCandidate(run, `ITA candidate failed: ${missingRules.join(', ')}.`);
    return;
  }
  const next = { ...run, stage: 'bookwithmatrix' as const, stageAttempt: 0, matrixJson: message.rawJson, matrixItinerary: message.itinerary };
  await saveRun(next);
  await updateStatus(policy.id, { state: 'candidate-found', message: `ITA policy match at ${policy.currency} ${(price / 100).toFixed(2)} per person; checking BookWithMatrix.`, bestPricePerPersonMinor: price, bestUrl: message.itinerary.sourceUrl });
  if (run.tabId !== undefined) await chrome.tabs.update(run.tabId, { url: 'https://bookwithmatrix.com/', active: run.interactive });
}

function isKnownRetailer(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return RETAILER_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

async function handleBookWithMatrixResults(message: Extract<ExtensionMessage, { type: 'BOOKWITHMATRIX_RESULTS' }>, run: ActiveVerificationRun): Promise<void> {
  if (run.stage !== 'bookwithmatrix' || !run.matrixItinerary) return;
  const links = message.links.filter((link) => isKnownRetailer(link.url)).slice(0, 6);
  const first = links[0];
  const task = run.tasks[run.taskIndex]!;
  const matrixPrice = matrixPricePerPerson(run.matrixItinerary);
  const handoffMessage = first
    ? `BookWithMatrix produced ${links.length} agency link${links.length === 1 ? '' : 's'}. Checking ${first.site}'s current booking price.`
    : 'BookWithMatrix did not produce a supported agency link, so no real-world booking price could be checked.';
  await recordObservation({
    id: `observation-${run.id}-bookwithmatrix`,
    policyId: task.policyId,
    observedAt: new Date().toISOString(),
    stage: 'bookwithmatrix-handoff',
    itinerary: run.matrixItinerary,
    url: message.resultUrl,
    pricePerPersonMinor: matrixPrice,
    bookWithMatrixPricePerPersonMinor: first?.currency === run.matrixItinerary.fare.total.currency ? first.pricePerPersonMinor : undefined,
    matchedRules: links.length ? ['agency booking links found'] : [],
    missingRules: links.length ? RETAILER_VALIDATION_RULES : ['supported agency booking link'],
    failedRules: [],
    message: handoffMessage,
  });
  if (!first) {
    await advanceRetailer({ ...run, bookWithMatrixUrl: message.resultUrl, retailerQueue: [], retailerIndex: 0 }, 'BookWithMatrix returned no supported retailer link.');
    return;
  }
  const next = { ...run, stage: 'retailer' as const, stageAttempt: 0, bookWithMatrixUrl: message.resultUrl, retailerQueue: links, retailerIndex: 0 };
  await saveRun(next);
  await updateStatus(task.policyId, { state: 'running', message: handoffMessage, bestPricePerPersonMinor: matrixPrice, bestUrl: message.resultUrl });
  if (run.tabId !== undefined) await chrome.tabs.update(run.tabId, { url: first.url, active: run.interactive });
}

async function browserNotification(id: string, title: string, message: string, url: string): Promise<void> {
  const settings = await chrome.storage.local.get(STORAGE_KEYS.notificationSettings);
  const parsed = notificationSettingsSchema.safeParse(settings[STORAGE_KEYS.notificationSettings]);
  if (!parsed.success || !parsed.data.browserEnabled) return;
  const linksResult = await chrome.storage.local.get(STORAGE_KEYS.alertLinks);
  const links = linksResult[STORAGE_KEYS.alertLinks] && typeof linksResult[STORAGE_KEYS.alertLinks] === 'object' ? linksResult[STORAGE_KEYS.alertLinks] as Record<string, string> : {};
  await chrome.storage.local.set({ [STORAGE_KEYS.alertLinks]: { ...links, [id]: url } });
  await chrome.notifications.create(id, { type: 'basic', iconUrl: chrome.runtime.getURL('icon128.png'), title, message, priority: 2, requireInteraction: true, buttons: [{ title: 'Open match' }, { title: 'Open FareProof' }] });
}

async function mobileNotification(title: string, message: string, url: string): Promise<void> {
  const settings = await chrome.storage.local.get(STORAGE_KEYS.notificationSettings);
  const parsed = notificationSettingsSchema.safeParse(settings[STORAGE_KEYS.notificationSettings]);
  const topic = parsed.success ? parsed.data.ntfyTopic : undefined;
  if (!topic || !(await chrome.permissions.contains({ origins: ['https://ntfy.sh/*'] }))) return;
  await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: 'POST', headers: { Title: title, Priority: 'urgent', Tags: 'airplane', Click: url }, body: message }).catch(() => undefined);
}

async function sendAlert(policy: FareSearchPolicy, title: string, message: string, url: string, pricePerPersonMinor: number, exact: boolean): Promise<void> {
  const historyResult = await chrome.storage.local.get('fareproof.alertHistory');
  const history = historyResult['fareproof.alertHistory'] && typeof historyResult['fareproof.alertHistory'] === 'object' ? historyResult['fareproof.alertHistory'] as Record<string, { price: number; exact: boolean; sentAt: string }> : {};
  const previous = history[policy.id];
  const shouldSend = !previous || pricePerPersonMinor < previous.price || (exact && !previous.exact) || Date.now() - Date.parse(previous.sentAt) > 24 * 60 * 60 * 1_000;
  if (!shouldSend) return;
  const id = `fareproof-${policy.id}`;
  await Promise.allSettled([browserNotification(id, title, message, url), mobileNotification(title, message, url)]);
  await chrome.storage.local.set({ 'fareproof.alertHistory': { ...history, [policy.id]: { price: pricePerPersonMinor, exact, sentAt: new Date().toISOString() } } });
}

async function handleRetailerPage(message: Extract<ExtensionMessage, { type: 'RETAILER_PAGE' }>, run: ActiveVerificationRun): Promise<void> {
  const policies = await getPolicies();
  const policy = policyForRun(run, policies);
  const link = run.retailerQueue[run.retailerIndex] as BookWithMatrixResultLink | undefined;
  if (!policy || !link || !run.matrixItinerary || run.stage !== 'retailer') return;
  const verdict = validateRetailerObservation(policy, run.matrixItinerary, link, message.observation);
  const matrixPrice = matrixPricePerPerson(run.matrixItinerary);
  const agencyPrice = verdict.pricePerPersonMinor;
  const detail = `Agency evidence ${verdict.classification === 'mismatch' ? 'failed' : 'incomplete'}: ${[...verdict.failedRules, ...verdict.missingRules].join(', ')}.`;
  const agencyPriceText = agencyPrice === undefined ? 'No stable agency price is visible yet.' : `${link.site} shows ${policy.currency} ${(agencyPrice / 100).toFixed(2)} per person; Matrix showed ${policy.currency} ${(matrixPrice / 100).toFixed(2)}.`;
  await recordObservation({
    id: retailerObservationId(run),
    policyId: policy.id,
    observedAt: new Date().toISOString(),
    stage: verdict.alertEligible ? 'retailer-result-reproduced' : 'manual-confirmation-required',
    itinerary: { ...run.matrixItinerary, sourceSite: link.site, sourceUrl: message.observation.url, verificationStage: verdict.alertEligible ? 'retailer-result-reproduced' : 'manual-confirmation-required' },
    url: message.observation.url,
    retailer: link.site,
    pricePerPersonMinor: agencyPrice ?? matrixPrice,
    bookWithMatrixPricePerPersonMinor: link.currency === policy.currency ? link.pricePerPersonMinor : undefined,
    retailerPricePerPersonMinor: agencyPrice,
    matchedRules: verdict.matchedRules,
    missingRules: verdict.missingRules,
    failedRules: verdict.failedRules,
    message: verdict.alertEligible ? `${agencyPriceText} The agency route, date, flight, cabin, and price passed validation.` : `${agencyPriceText} ${detail}`,
  });
  if (!verdict.alertEligible) {
    if (verdict.classification === 'mismatch') await advanceRetailer(run, detail);
    else {
      await updateStatus(policy.id, { state: 'running', message: `${agencyPriceText} ${detail} Waiting briefly for the page to finish loading.` });
      await saveRun(run);
    }
    return;
  }
  const price = verdict.pricePerPersonMinor!;
  await updateStatus(policy.id, { state: 'retailer-match', message: `${link.site} confirms ${policy.currency} ${(price / 100).toFixed(2)} per person; Matrix showed ${policy.currency} ${(matrixPrice / 100).toFixed(2)}.`, bestPricePerPersonMinor: price, bestUrl: message.observation.url });
  await sendAlert(policy, 'FareProof: agency-validated fare found', `${policy.name}: ${policy.currency} ${(price / 100).toFixed(2)} per person at ${link.site}; Matrix showed ${policy.currency} ${(matrixPrice / 100).toFixed(2)}. Route, travel date, flight identity, long-leg cabin, and agency price were reproduced.`, message.observation.url, price, true);
  await advanceTask(run, 'Retailer-validated match found.', 'retailer-match');
}

async function handleMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (message.type === 'CREATE_WATCH') return { ok: true, watch: await saveWatch(message.itinerary) };
  if (message.type === 'PAGE_OBSERVATION') {
    await chrome.storage.local.set({ [CURRENT_OBSERVATION_KEY]: message.itinerary });
    return { ok: true };
  }
  if (message.type === 'OPEN_SIDE_PANEL' && sender.tab?.windowId !== undefined) {
    await chrome.sidePanel.open({ windowId: sender.tab.windowId });
    return { ok: true };
  }
  if (message.type === 'SAVE_SEARCH_POLICIES') {
    await chrome.storage.local.set({ [STORAGE_KEYS.policies]: message.policies });
    await ensureDefaults();
    return { ok: true };
  }
  if (message.type === 'RUN_POLICIES_NOW') {
    const result = await startRun(message.policyIds, true);
    return { ok: result.started, reason: result.reason };
  }
  if (message.type === 'RECOVER_SCHEDULER') {
    const result = await recoverScheduler();
    return { ok: true, recovered: result.recovered };
  }
  if (message.type === 'SAVE_NOTIFICATION_SETTINGS') {
    const settings = notificationSettingsSchema.parse({ browserEnabled: message.browserEnabled, ntfyTopic: message.ntfyTopic || undefined });
    await chrome.storage.local.set({ [STORAGE_KEYS.notificationSettings]: settings });
    return { ok: true };
  }
  if (message.type === 'TEST_NOTIFICATION') {
    await Promise.all([browserNotification('fareproof-test', 'FareProof test notification', 'Browser notifications are working.', 'https://matrix.itasoftware.com/'), mobileNotification('FareProof test notification', 'Mobile notifications are working.', 'https://matrix.itasoftware.com/')]);
    return { ok: true };
  }
  const run = await getRun();
  if (!run || sender.tab?.id !== run.tabId) return { ok: false };
  if (message.type === 'MATRIX_HOME_READY' && run.stage === 'matrix-home') {
    const task = run.tasks[run.taskIndex];
    if (!task || run.tabId === undefined) return { ok: false };
    const policies = await getPolicies();
    const policy = policies.find((item) => item.id === task.policyId);
    if (!policy) return { ok: false };
    const next = { ...run, stage: 'calendar' as const };
    await saveRun(next);
    await updateStatus(task.policyId, { state: 'running', message: 'Matrix initialized; submitting the flexible-date search.' });
    await chrome.tabs.sendMessage(run.tabId, { type: 'RUN_MATRIX_SEARCH', task, policy });
  }
  else if (message.type === 'MATRIX_FORM_FAILED' && run.stage === 'calendar') await retryMatrixCalendar(run);
  else if (message.type === 'MATRIX_CALENDAR') await handleMatrixCalendar(message, run);
  else if (message.type === 'MATRIX_FLIGHTS') await handleMatrixFlights(message, run);
  else if (message.type === 'MATRIX_ITINERARY_READY' && run.stage === 'itinerary' && run.tabId !== undefined) await chrome.scripting.executeScript({ target: { tabId: run.tabId }, world: 'MAIN', func: captureMatrixJsonInPage });
  else if (message.type === 'MATRIX_ITINERARY') await handleMatrixItinerary(message, run);
  else if (message.type === 'MATRIX_CAPTURE_FAILED') await advanceCandidate(run, 'Could not capture Matrix itinerary JSON.');
  else if (message.type === 'BOOKWITHMATRIX_READY' && run.stage === 'bookwithmatrix' && run.matrixJson && run.tabId !== undefined) await chrome.tabs.sendMessage(run.tabId, { type: 'SUBMIT_BOOKWITHMATRIX', rawJson: run.matrixJson });
  else if (message.type === 'BOOKWITHMATRIX_RESULTS') await handleBookWithMatrixResults(message, run);
  else if (message.type === 'RETAILER_PAGE') await handleRetailerPage(message, run);
  return { ok: true };
}

async function initializeExtension(): Promise<void> {
  await ensureDefaults();
  await recoverScheduler();
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void initializeExtension();
});

chrome.runtime.onStartup.addListener(() => void initializeExtension());

chrome.runtime.onMessage.addListener((rawMessage: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const parsed = extensionMessageSchema.safeParse(rawMessage);
  if (!parsed.success) {
    sendResponse({ ok: false, error: 'Invalid FareProof message.' });
    return false;
  }

  void handleMessage(parsed.data, sender).then(sendResponse).catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'FareProof action failed.' }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DISPATCH_ALARM) void dispatchDuePolicies();
  if (alarm.name === RUN_TIMEOUT_ALARM) {
    void getRun().then((run) => {
      if (!run) return undefined;
      if (run.stage === 'matrix-home' || run.stage === 'calendar') return retryMatrixCalendar(run);
      if (run.stage === 'itinerary') return advanceCandidate(run, 'Timed out while capturing the Matrix itinerary.');
      if (run.stage === 'retailer') return advanceRetailer(run, 'Retailer did not expose enough stable evidence before timeout.');
      if (run.stage === 'bookwithmatrix') return advanceRetailer({ ...run, retailerQueue: [], retailerIndex: 0 }, 'BookWithMatrix did not finish before timeout.');
      return advanceTask(run, `Timed out while checking ${run.stage}.`, 'error');
    });
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  void chrome.storage.local.get(STORAGE_KEYS.alertLinks).then((result) => {
    const storedLinks = result[STORAGE_KEYS.alertLinks];
    const url = storedLinks && typeof storedLinks === 'object' ? (storedLinks as Record<string, unknown>)[notificationId] : undefined;
    if (typeof url === 'string') void chrome.tabs.create({ url, active: true });
  });
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (buttonIndex === 0) {
    void chrome.storage.local.get(STORAGE_KEYS.alertLinks).then((result) => {
      const storedLinks = result[STORAGE_KEYS.alertLinks];
      const url = storedLinks && typeof storedLinks === 'object' ? (storedLinks as Record<string, unknown>)[notificationId] : undefined;
      if (typeof url === 'string') void chrome.tabs.create({ url, active: true });
    });
  } else {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab?.windowId !== undefined ? chrome.sidePanel.open({ windowId: tab.windowId }) : undefined);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void getRun().then(async (run) => {
    if (!run || run.tabId !== tabId) return;
    const policies = await getPolicies();
    const policy = policyForRun(run, policies);
    if (policy) await updateStatus(policy.id, { state: 'manual-action-required', message: 'Verification tab was closed before the check completed.' });
    await saveRun(null);
  });
});

void initializeExtension();