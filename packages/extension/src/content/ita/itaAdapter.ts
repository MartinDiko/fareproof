import { parseImportedFare, type ObservedItinerary } from '@fareproof/core';
import type { FareSiteAdapter } from '../adapter';

function findCompactFare(value: unknown, budget = { remaining: 2_000 }): unknown | null {
  if (budget.remaining-- <= 0 || value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.route === 'string' && typeof record.date === 'string' && typeof record.total === 'number') return record;
  for (const child of Object.values(record)) {
    const found = findCompactFare(child, budget);
    if (found) return found;
  }
  return null;
}

async function extractFromScripts(document: Document): Promise<ObservedItinerary | null> {
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent?.trim();
    if (!text || text.length > 512_000 || (!text.startsWith('{') && !text.startsWith('['))) continue;
    try {
      const found = findCompactFare(JSON.parse(text) as unknown);
      if (found) return parseImportedFare(JSON.stringify(found));
    } catch {
      // Unrelated page scripts are expected to fail strict JSON parsing.
    }
  }
  return null;
}

export const itaAdapter: FareSiteAdapter = {
  id: 'ita-matrix',
  displayName: 'ITA Matrix',
  supportedHosts: ['matrix.itasoftware.com'],
  capabilities: {
    canExtractSearchCriteria: false,
    canExtractSearchResults: false,
    canExtractSelectedFare: true,
    canObserveRepricing: false,
    canBuildDeepLink: false,
    canCheckCheckoutStage: false,
    requiresManualInteraction: true,
  },
  canHandle: (url) => url.hostname === 'matrix.itasoftware.com',
  extractSelectedItinerary: extractFromScripts,
  observeDynamicChanges(callback) {
    let timer: number | undefined;
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(callback, 800);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  },
};