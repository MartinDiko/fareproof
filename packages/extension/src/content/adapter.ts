import type { ObservedItinerary } from '@fareproof/core';

export interface AdapterCapabilities {
  canExtractSearchCriteria: boolean;
  canExtractSearchResults: boolean;
  canExtractSelectedFare: boolean;
  canObserveRepricing: boolean;
  canBuildDeepLink: boolean;
  canCheckCheckoutStage: boolean;
  requiresManualInteraction: boolean;
}

export interface FareSiteAdapter {
  id: string;
  displayName: string;
  supportedHosts: string[];
  capabilities: AdapterCapabilities;
  canHandle(url: URL): boolean;
  extractSelectedItinerary(document: Document): Promise<ObservedItinerary | null>;
  observeDynamicChanges(callback: () => void): () => void;
}