import { observeStablePage } from '../shared/pageObserver';
import { extractRetailerPage } from './extraction';

let lastPublished = '';

function inspectPage(): void {
  const observation = extractRetailerPage(document, location.href);
  const key = JSON.stringify(observation);
  if (key === lastPublished) return;
  lastPublished = key;
  void chrome.runtime.sendMessage({ type: 'RETAILER_PAGE', observation });
}

observeStablePage(inspectPage, 1_500);