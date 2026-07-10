import { parseMatrixItineraryJson, type ObservedItinerary } from '@fareproof/core';
import { contentCommandSchema } from '../../shared/messages';
import { observeStablePage } from '../shared/pageObserver';
import { clickMatrixCalendarDate, extractMatrixCalendar, extractMatrixFlights } from './extraction';
import { submitMatrixSearch } from './formAutomation';

let lastPublished = '';
let latestItinerary: ObservedItinerary | null = null;
let overlayHost: HTMLElement | null = null;

function publish(message: unknown): void {
  const key = JSON.stringify(message);
  if (key === lastPublished) return;
  lastPublished = key;
  void chrome.runtime.sendMessage(message);
}

function renderOverlay(itinerary: ObservedItinerary): void {
  overlayHost?.remove();
  overlayHost = document.createElement('div');
  overlayHost.id = 'fareproof-overlay-host';
  overlayHost.dataset.status = 'captured';
  const shadow = overlayHost.attachShadow({ mode: 'closed' });
  const panel = document.createElement('aside');
  panel.setAttribute('style', 'position:fixed;right:20px;bottom:20px;z-index:2147483647;width:260px;padding:14px;border:1px solid #dedede;border-radius:8px;background:#fff;color:#242424;font:14px Segoe UI,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.16)');
  const segment = itinerary.segments[0];
  const title = document.createElement('strong');
  title.textContent = 'FareProof · ITA captured';
  const details = document.createElement('p');
  details.textContent = `${itinerary.fare.total.currency} ${(itinerary.fare.total.amountMinor / 100 / itinerary.passengers.adults).toFixed(2)} per person · ${segment?.cabin ?? 'Cabin unknown'} · ${segment?.marketingCarrier.code ?? ''} ${segment?.marketingFlightNumber ?? ''}`;
  const button = document.createElement('button');
  button.textContent = 'Watch and verify this fare';
  button.setAttribute('style', 'width:100%;padding:9px;border:0;border-radius:6px;background:#b11f4b;color:#fff;font-weight:600;cursor:pointer');
  button.addEventListener('click', () => {
    if (!latestItinerary) return;
    void chrome.runtime.sendMessage({ type: 'CREATE_WATCH', itinerary: latestItinerary }).then(() => chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }));
  });
  panel.append(title, details, button);
  shadow.append(panel);
  document.documentElement.append(overlayHost);
}

function renderLoadingOverlay(): void {
  if (overlayHost?.dataset.status === 'matrix-loading') return;
  overlayHost?.remove();
  overlayHost = document.createElement('div');
  overlayHost.id = 'fareproof-overlay-host';
  overlayHost.dataset.status = 'matrix-loading';
  const shadow = overlayHost.attachShadow({ mode: 'closed' });
  const panel = document.createElement('aside');
  panel.setAttribute('style', 'position:fixed;right:20px;bottom:20px;z-index:2147483647;width:260px;padding:14px;border:1px solid #dedede;border-radius:8px;background:#fff;color:#242424;font:14px Segoe UI,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.16)');
  const title = document.createElement('strong');
  title.textContent = 'FareProof · Waiting for Matrix';
  const details = document.createElement('p');
  details.textContent = 'Matrix is still loading fare data. FareProof will retry once after 60 seconds, then report the site unavailable.';
  panel.append(title, details);
  shadow.append(panel);
  document.documentElement.append(overlayHost);
}

function clearLoadingOverlay(): void {
  if (overlayHost?.dataset.status !== 'matrix-loading') return;
  overlayHost.remove();
  overlayHost = null;
}

function inspectPage(): void {
  if (document.querySelector('[role=progressbar]')) {
    if (location.pathname === '/calendar') renderLoadingOverlay();
    return;
  }
  clearLoadingOverlay();
  if (location.pathname === '/' || location.pathname === '/search') {
    publish({ type: 'MATRIX_HOME_READY' });
    return;
  }
  if (location.pathname === '/calendar') {
    const entries = extractMatrixCalendar(document, location.href);
    if (entries.length) publish({ type: 'MATRIX_CALENDAR', entries });
    return;
  }
  if (location.pathname === '/flights') {
    publish({ type: 'MATRIX_FLIGHTS', candidates: extractMatrixFlights(document, location.href) });
    return;
  }
  if (location.pathname === '/itinerary' && document.body.innerText.includes('Copy itinerary as JSON')) {
    publish({ type: 'MATRIX_ITINERARY_READY' });
  }
}

chrome.runtime.onMessage.addListener((rawMessage: unknown, _sender, sendResponse) => {
  const parsed = contentCommandSchema.safeParse(rawMessage);
  if (!parsed.success) return false;
  if (parsed.data.type === 'RUN_MATRIX_SEARCH') {
    sendResponse({ ok: true });
    void submitMatrixSearch(parsed.data.task, parsed.data.policy).catch((error: unknown) => {
      void chrome.runtime.sendMessage({ type: 'MATRIX_FORM_FAILED', reason: error instanceof Error ? error.message : 'Matrix form automation failed.' });
    });
    return false;
  }
  if (parsed.data.type === 'SELECT_MATRIX_DATE') {
    sendResponse({ ok: clickMatrixCalendarDate(document, parsed.data.date) });
  }
  return false;
});

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
  const data = event.data as { source?: string; type?: string; rawJson?: unknown };
  if (data.source !== 'fareproof-main') return;
  if (data.type === 'MATRIX_CAPTURE_FAILED') {
    void chrome.runtime.sendMessage({ type: 'MATRIX_CAPTURE_FAILED' });
    return;
  }
  if (data.type !== 'MATRIX_JSON' || typeof data.rawJson !== 'string') return;
  try {
    const itinerary = parseMatrixItineraryJson(data.rawJson, location.href);
    latestItinerary = itinerary;
    renderOverlay(itinerary);
    void chrome.runtime.sendMessage({ type: 'PAGE_OBSERVATION', itinerary });
    void chrome.runtime.sendMessage({ type: 'MATRIX_ITINERARY', rawJson: data.rawJson, itinerary });
  } catch {
    void chrome.runtime.sendMessage({ type: 'MATRIX_CAPTURE_FAILED' });
  }
});

observeStablePage(inspectPage);